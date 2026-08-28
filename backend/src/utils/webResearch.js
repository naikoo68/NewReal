// Auto-research: fetch real, up-to-date source material from the web for a topic
// so the AI generator can build accurate CURRENT-AFFAIRS questions instead of
// relying on the model's (frozen, outdated) memory.
//
// Providers, in priority order:
//   1) Tavily (only if TAVILY_API_KEY is set) — an LLM-friendly search API that
//      returns page content directly. Best coverage for fresh news/events.
//   2) Wikipedia (keyless, free, always on) — searches and returns the plain-text
//      extracts of the top matching articles. Great for current office-holders,
//      bodies, places, schemes, etc.; needs no API key and costs nothing.
//
// The result is cached briefly in memory so the multiple "waves" of a single
// generation reuse the same fetched material instead of re-researching each wave.

const UA = "MyStudyGuide/1.0 (AI question generator)";
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map(); // topicKey -> { at, text, sources }

function cacheKey(topic) {
  return String(topic || "").trim().toLowerCase().slice(0, 200);
}

// Optional richer search when an admin has configured a Tavily key.
async function viaTavily(topic) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: topic,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        include_raw_content: true,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const parts = [];
    const sources = [];
    for (const r of results) {
      const body = String(r?.raw_content || r?.content || "").replace(/\s+/g, " ").trim();
      if (!body) continue;
      sources.push(r?.url || r?.title || "");
      parts.push(`# ${r?.title || r?.url || "Source"}\n${body.slice(0, 4000)}`);
    }
    return parts.length ? { text: parts.join("\n\n"), sources } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function wikiFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Free, keyless default: search Wikipedia and return the top articles' text.
async function viaWikipedia(topic) {
  const search = await wikiFetch(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=3&srsearch=${encodeURIComponent(topic)}`
  );
  const hits = search?.query?.search || [];
  const titles = hits.slice(0, 3).map((h) => h.title).filter(Boolean);
  if (!titles.length) return null;
  const extract = await wikiFetch(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(titles.join("|"))}`
  );
  const pages = extract?.query?.pages || {};
  const parts = [];
  const sources = [];
  for (const k of Object.keys(pages)) {
    const p = pages[k];
    const body = String(p?.extract || "").replace(/\s+/g, " ").trim();
    if (!body) continue;
    sources.push(`Wikipedia: ${p.title}`);
    parts.push(`# ${p.title}\n${body.slice(0, 6000)}`);
  }
  return parts.length ? { text: parts.join("\n\n"), sources } : null;
}

// Returns { ok, text, sources }. Never throws — on failure returns ok:false and
// the caller simply proceeds with topic-only generation.
export async function webResearch(topic, { maxChars = 16000 } = {}) {
  const t = String(topic || "").trim();
  if (!t) return { ok: false, text: "", sources: [] };
  const key = cacheKey(t);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return { ok: !!hit.text, text: hit.text, sources: hit.sources, cached: true };

  let res = await viaTavily(t);
  if (!res) res = await viaWikipedia(t);

  const text = res ? String(res.text || "").slice(0, maxChars) : "";
  const out = { ok: !!text, text, sources: res?.sources || [] };
  cache.set(key, { at: now, text, sources: out.sources });
  return out;
}
