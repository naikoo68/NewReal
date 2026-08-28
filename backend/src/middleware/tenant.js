import Tenant from "../models/Tenant.js";
import { tenantStore } from "../utils/tenantContext.js";

// Resolves the current institute (tenant) for a request and annotates it as
// req.tenant / req.tenantId. Resolution order:
//   1. X-Tenant header (explicit slug — handy for local dev / API tools)
//   2. Custom domain match (Tenant.customDomain === host)
//   3. Subdomain match (slug.<ROOT_DOMAIN>)
//   4. The default tenant (isDefault) — fallback for the apex domain / dev
//
// PHASE 2: this middleware is NOT mounted yet and nothing reads req.tenantId —
// it's shipped ready so Phase 3 can mount it and turn on query scoping. It is
// deliberately resilient: any miss or error leaves req.tenant = null rather
// than failing the request.

// Small in-memory cache (host/slug -> tenant) to avoid a DB hit per request.
const cache = new Map();
const TTL_MS = 60 * 1000;

const baseHost = (h) => String(h || "").toLowerCase().split(":")[0].trim();

// The subdomain label for a host given the app's ROOT_DOMAIN (env), e.g.
// "acme" from "acme.app.com". Falls back to the first label of a 3+ part host.
function subdomainOf(host) {
  const root = String(process.env.ROOT_DOMAIN || "").toLowerCase().replace(/^\./, "");
  if (root && host === root) return "";
  if (root && host.endsWith("." + root)) return host.slice(0, -(root.length + 1));
  const parts = host.split(".");
  return parts.length >= 3 ? parts[0] : "";
}

async function lookupTenant(host, headerSlug) {
  if (headerSlug) return Tenant.findOne({ slug: headerSlug, deleted: { $ne: true } });

  const byDomain = await Tenant.findOne({ customDomain: host, deleted: { $ne: true } });
  if (byDomain) return byDomain;

  const sub = subdomainOf(host);
  if (sub && !["www", "app", "api"].includes(sub)) {
    const bySlug = await Tenant.findOne({ slug: sub, deleted: { $ne: true } });
    if (bySlug) return bySlug;
  }
  return Tenant.findOne({ isDefault: true, deleted: { $ne: true } });
}

export async function resolveTenant(req, res, next) {
  let ctx = { tenantId: null, tenant: null, bypass: false };
  try {
    // Prefer the browser's own hostname (sent by the frontend as X-Tenant-Host)
    // so subdomain/custom-domain resolution works even when the frontend and API
    // are on different domains. Falls back to the request's own host.
    const host = baseHost(req.headers["x-tenant-host"] || req.headers["x-forwarded-host"] || req.headers.host);
    const headerSlug = String(req.headers["x-tenant"] || "").toLowerCase().trim();
    const key = headerSlug ? `h:${headerSlug}` : `d:${host}`;
    const now = Date.now();
    const hit = cache.get(key);

    let tenant;
    if (hit && now - hit.at < TTL_MS) {
      tenant = hit.tenant;
    } else {
      tenant = await lookupTenant(host, headerSlug);
      cache.set(key, { tenant, at: now });
    }
    req.tenant = tenant || null;
    req.tenantId = tenant?._id || null;
    ctx = { tenantId: req.tenantId, tenant: req.tenant, bypass: false };
  } catch {
    req.tenant = null;
    req.tenantId = null;
  }
  // Run the REST of the request inside the tenant context so every downstream
  // query can be auto-scoped. (Everything after next() inherits this store.)
  tenantStore.run(ctx, () => next());
}

// Clear the resolution cache (call after creating/renaming/suspending a tenant).
export function clearTenantCache() {
  cache.clear();
}
