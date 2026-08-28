// Tiny fetch wrapper around the backend REST API.
// - Reads the base URL from VITE_API_URL (falls back to localhost).
// - Attaches the stored JWT as a Bearer token.
// - Retries automatically while a sleeping free-tier server wakes up.
// - Parses JSON and throws a useful Error on non-2xx responses.

const BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "http://localhost:5000/api";

const TOKEN_KEY = "mpm-token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry on network failures and gateway errors (502/503/504) — these happen
// while a free-tier host (e.g. Render) is spinning the server back up. A cold
// start of a Node app can take well over a minute, so the schedule now spans
// ~2.5 minutes to ride out even a slow wake-up instead of failing early.
const RETRY_WAITS = [1500, 3000, 5000, 8000, 10000, 12000, 15000, 15000, 20000, 20000, 25000, 25000]; // ms between attempts (~2.5 min total)
const MAX_RETRIES = RETRY_WAITS.length;
const RETRYABLE = [502, 503, 504];

// Abort a single attempt if the server accepts the request but never responds
// (e.g. the backend is busy running AI-key probes). Without this the fetch stays
// pending forever and the UI spins endlessly. On timeout we abort → it's treated
// like a network error → the retry/cold-start flow runs and eventually surfaces
// a real error instead of hanging. Generous by default; long endpoints override.
const DEFAULT_TIMEOUT = 120000;

// Optional hook so the UI can show "waking the server up…" progress during a
// long cold-start retry sequence. Set via api.onRetry.
let retryListener = null;

async function request(path, { method = "GET", body, auth = true, headers = {}, timeout = DEFAULT_TIMEOUT, signal } = {}) {
  const finalHeaders = { ...headers };
  let payload = body;

  const isFormData = body instanceof FormData;
  if (body !== undefined && !isFormData) {
    finalHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  if (auth) {
    const token = getToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  // Multi-tenancy: tell the backend which institute this browser is for, derived
  // from the site's own hostname (e.g. acme.example.com). The backend maps it to
  // a tenant (subdomain / custom domain) to serve that institute's branding &
  // data. Safe: for authenticated requests the server binds scope to the logged-
  // in user's OWN tenant, so this header can't reach another institute's data.
  try {
    if (typeof window !== "undefined" && window.location?.hostname) {
      finalHeaders["X-Tenant-Host"] = window.location.hostname;
    }
  } catch {
    /* non-browser / unavailable — the backend falls back to the default tenant */
  }

  // Shareable tenant links: when the URL carries ?t=<slug> (e.g.
  // mystudyguideme.vercel.app/?t=acme), target that institute explicitly. This
  // lets institutes share a public portal link before they own a custom domain.
  // The backend's resolveTenant prioritises this X-Tenant slug header over the
  // host, so the visitor sees that institute's branding & data. For logged-in
  // users the server still binds scope to their OWN tenant, so this can't leak
  // another institute's private data.
  try {
    if (typeof window !== "undefined" && window.location?.search) {
      const slug = new URLSearchParams(window.location.search).get("t");
      if (slug && slug.trim()) finalHeaders["X-Tenant"] = slug.trim().toLowerCase();
    }
  } catch {
    /* ignore — no query param available */
  }

  // If the caller passed an already-aborted signal, bail immediately.
  if (signal?.aborted) { const e = new Error("Cancelled"); e.aborted = true; throw e; }

  let lastNetworkError = false;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    // Link an external abort signal (e.g. a "Stop" button) to this attempt so
    // the in-flight request is cancelled on demand.
    const onExtAbort = () => controller.abort();
    if (signal) signal.addEventListener("abort", onExtAbort, { once: true });
    try {
      res = await fetch(`${BASE_URL}${path}`, { method, headers: finalHeaders, body: payload, signal: controller.signal });
    } catch {
      // A user-initiated cancel (external signal) must NOT be retried — surface
      // it as an abort so callers can quietly stop.
      if (signal?.aborted) { const e = new Error("Cancelled"); e.aborted = true; throw e; }
      // Network error OR our own timeout abort — both mean "no usable response";
      // retry a few times (rides out a cold start), then give up with an error.
      lastNetworkError = true;
      if (attempt < MAX_RETRIES) {
        retryListener?.(attempt + 1, MAX_RETRIES); // notify UI: still waking up
        await sleep(RETRY_WAITS[attempt]); // give the server time to wake up
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onExtAbort);
    }

    // Gateway/cold-start errors → wait and retry
    if (RETRYABLE.includes(res.status) && attempt < MAX_RETRIES) {
      retryListener?.(attempt + 1, MAX_RETRIES);
      await sleep(RETRY_WAITS[attempt]);
      continue;
    }

    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const message = data?.message || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.data = data; // full response body (e.g. { needsVerification, email })

      // If the server says the token is invalid/expired, clear local auth state
      // and redirect to login so the user isn't stuck in a broken session.
      if (res.status === 401 && auth) {
        clearToken();
        localStorage.removeItem("mpm-user");
        // Only redirect if we're not already on an auth page (avoid loops).
        const hash = window.location.hash || "";
        const isAuthPage = /^\#?\/(login|register|forgot-password|admin\/login|client\/register)/.test(hash);
        if (!isAuthPage) {
          window.location.hash = "#/login";
        }
      }

      throw err;
    }
    return data;
  }

  throw new Error(
    lastNetworkError
      ? "Cannot reach the server. It may be waking up from sleep — please wait a moment and try again."
      : "The server is starting up. Please try again in a few seconds."
  );
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: "GET" }),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
  put: (path, body, opts) => request(path, { ...opts, method: "PUT", body }),
  patch: (path, body, opts) => request(path, { ...opts, method: "PATCH", body }),
  del: (path, opts) => request(path, { ...opts, method: "DELETE" }),
  baseUrl: BASE_URL,
  // Register a callback fired on each cold-start retry: (attempt, max) => void.
  onRetry: (fn) => { retryListener = fn; },
};
