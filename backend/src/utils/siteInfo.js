import Settings from "../models/Settings.js";

// White-label helper: returns the admin-configured site name so server-sent
// emails (OTP, password reset) and any other backend text carry the buyer's
// brand instead of a hard-coded "My Study Guide". Cached briefly so we don't
// hit the DB on every email; falls back safely if Settings can't be read.
const FALLBACK = "My Study Guide";
let cache = { name: null, at: 0 };
const TTL_MS = 60 * 1000;

export async function getSiteName() {
  const now = Date.now();
  if (cache.name && now - cache.at < TTL_MS) return cache.name;
  try {
    const s = await Settings.findOne({ key: "site" }).select("siteName").lean();
    cache = { name: (s && s.siteName) || FALLBACK, at: now };
  } catch {
    return cache.name || FALLBACK;
  }
  return cache.name;
}
