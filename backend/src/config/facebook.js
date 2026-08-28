import Settings from "../models/Settings.js";

// Facebook Page auto-posting via the Graph API. The Page ID + long-lived Page
// access token are stored in the singleton Settings document (entered by the
// admin in the panel) and NEVER exposed to the browser. Outbound calls use the
// global fetch (Node 18+), matching the mailer's HTTP style.

export async function getFacebookConfig() {
  const s = await Settings.findOne({ key: "site" }).lean();
  return {
    enabled: !!s?.fbEnabled,
    pageId: String(s?.fbPageId || "").trim(),
    token: String(s?.fbPageAccessToken || "").trim(),
    version: String(s?.fbGraphVersion || "v21.0").trim() || "v21.0",
    autoOnNotice: !!s?.fbAutoOnNotice,
    siteUrl: String(process.env.CLIENT_URL || "").replace(/\/$/, ""),
    igEnabled: !!s?.igEnabled,
    igUserId: String(s?.igUserId || "").trim(),
  };
}

export const isFacebookConfigured = (cfg) => !!(cfg?.pageId && cfg?.token);

// Posting to a Page requires a PAGE access token. Admins often paste a USER
// token by mistake (which triggers the deprecated "publish_actions" error).
// This resolves the correct Page token from whatever was saved: querying the
// Page node with a user OR page token returns the Page's own token. Cached
// briefly to avoid an extra call on every post.
const _pageTokenCache = new Map();
export async function resolvePageToken(cfg) {
  const key = `${cfg.pageId}:${String(cfg.token).slice(0, 16)}`;
  const hit = _pageTokenCache.get(key);
  if (hit && Date.now() - hit.ts < 10 * 60 * 1000) return hit.token;
  try {
    const res = await fetch(`https://graph.facebook.com/${cfg.version}/${encodeURIComponent(cfg.pageId)}?fields=access_token&access_token=${encodeURIComponent(cfg.token)}`);
    const data = await res.json().catch(() => ({}));
    const token = data?.access_token || cfg.token;
    _pageTokenCache.set(key, { token, ts: Date.now() });
    return token;
  } catch {
    return cfg.token;
  }
}

// Post a message (with an optional link) to the configured Facebook Page feed.
// Returns { ok, id?, error? }. Safe to call fire-and-forget — it never throws.
export async function postToFacebookPage({ message, link, imageUrl } = {}, cfgOverride) {
  const cfg = cfgOverride || (await getFacebookConfig());
  if (!isFacebookConfigured(cfg)) return { ok: false, error: "Facebook Page ID or access token is not set." };

  const msg = String(message || "").trim();
  const lnk = String(link || "").trim();
  const img = String(imageUrl || "").trim();
  if (!msg && !lnk && !img) return { ok: false, error: "Nothing to post (empty message)." };

  // With an image → post a PHOTO (message becomes the caption); otherwise a
  // normal feed post (optionally with a link).
  const endpoint = img ? "photos" : "feed";
  const url = `https://graph.facebook.com/${cfg.version}/${encodeURIComponent(cfg.pageId)}/${endpoint}`;
  const pageToken = await resolvePageToken(cfg); // ensure a PAGE token (not a user token)
  const body = new URLSearchParams();
  if (img) { body.set("url", img); if (msg) body.set("caption", msg); }
  else { if (msg) body.set("message", msg); if (lnk) body.set("link", lnk); }
  body.set("access_token", pageToken);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && (data.id || data.post_id)) return { ok: true, id: data.post_id || data.id };
    let error = data?.error?.message || `Facebook API error (${res.status}).`;
    if (/publish_actions|\(#200\)/i.test(error)) {
      error = "Facebook rejected the token. Use a PAGE access token (not a User token) with the pages_manage_posts permission, then save again. " + error;
    }
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: err.message || "Could not reach Facebook." };
  }
}

// Resolve the Instagram Business account id linked to the Facebook Page. Uses
// the configured igUserId if set, else auto-detects it from the Page.
export async function getInstagramUserId(cfgOverride) {
  const cfg = cfgOverride || (await getFacebookConfig());
  if (cfg.igUserId) return cfg.igUserId;
  if (!isFacebookConfigured(cfg)) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/${cfg.version}/${encodeURIComponent(cfg.pageId)}?fields=instagram_business_account&access_token=${encodeURIComponent(cfg.token)}`);
    const data = await res.json().catch(() => ({}));
    return data?.instagram_business_account?.id || null;
  } catch {
    return null;
  }
}

// Post a single image with caption to Instagram (create container → publish).
// Instagram REQUIRES an image. Returns { ok, id?, error? }.
export async function postToInstagram({ imageUrl, caption } = {}, cfgOverride) {
  const cfg = cfgOverride || (await getFacebookConfig());
  if (!isFacebookConfigured(cfg)) return { ok: false, error: "Facebook/Instagram is not connected." };
  const img = String(imageUrl || "").trim();
  if (!img) return { ok: false, error: "Instagram needs an image to post." };
  const igId = await getInstagramUserId(cfg);
  if (!igId) return { ok: false, error: "No Instagram Business account is linked to this Facebook Page." };
  const pageToken = await resolvePageToken(cfg); // IG publishing uses the Page token

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  try {
    // 1) Create a media container.
    const c = new URLSearchParams();
    c.set("image_url", img);
    if (caption) c.set("caption", String(caption).slice(0, 2100));
    c.set("access_token", pageToken);
    const cRes = await fetch(`https://graph.facebook.com/${cfg.version}/${igId}/media`, { method: "POST", headers, body: c });
    const cData = await cRes.json().catch(() => ({}));
    if (!cRes.ok || !cData.id) return { ok: false, error: cData?.error?.message || `Instagram container error (${cRes.status}).` };

    // 2) Publish the container.
    const p = new URLSearchParams();
    p.set("creation_id", cData.id);
    p.set("access_token", pageToken);
    const pRes = await fetch(`https://graph.facebook.com/${cfg.version}/${igId}/media_publish`, { method: "POST", headers, body: p });
    const pData = await pRes.json().catch(() => ({}));
    if (pRes.ok && pData.id) return { ok: true, id: pData.id };
    return { ok: false, error: pData?.error?.message || `Instagram publish error (${pRes.status}).` };
  } catch (err) {
    return { ok: false, error: err.message || "Could not reach Instagram." };
  }
}

// Verify the token/page WITHOUT posting — reads the Page name via the Graph API.
export async function verifyFacebook(cfgOverride) {
  const cfg = cfgOverride || (await getFacebookConfig());
  if (!isFacebookConfigured(cfg)) return { ok: false, error: "Add your Page ID and Page access token first." };
  try {
    const res = await fetch(`https://graph.facebook.com/${cfg.version}/${encodeURIComponent(cfg.pageId)}?fields=name&access_token=${encodeURIComponent(cfg.token)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.name) return { ok: true, name: data.name };
    return { ok: false, error: data?.error?.message || `Facebook API error (${res.status}).` };
  } catch (err) {
    return { ok: false, error: err.message || "Could not reach Facebook." };
  }
}


// ---------------------------------------------------------------------------
// Scheduled question auto-posting (independent of the Notice Board).
// ---------------------------------------------------------------------------
import FbSchedule from "../models/FbSchedule.js";
import Question from "../models/Question.js";
import Subject from "../models/Subject.js";
import Session from "../models/Session.js";
import Topic from "../models/Topic.js";
import Quiz from "../models/Quiz.js";
import { renderQuestionImage } from "./socialImage.js";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Strip inline-LaTeX $…$ markers so the post reads as plain text on Facebook.
const plain = (s) => String(s || "").replace(/\$/g, "").replace(/[ \t]+\n/g, "\n").trim();

// Turn a label ("Physiography of J&K") into a CamelCase hashtag ("#PhysiographyOfJK").
function toTagWords(s) {
  const words = String(s || "").replace(/[^a-zA-Z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return "#" + words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}
// Normalise an admin-typed tag ("economics" / "#Economics" → "#Economics").
function normTag(s) {
  const t = String(s || "").trim().replace(/^#+/, "").replace(/[^a-zA-Z0-9_]/g, "");
  return t ? "#" + t : "";
}

// Build the hashtag string for a question: per-post tags + the admin's global
// default tags + auto tags from the question's subject / topic / section.
// `site` is the Settings doc (fbDefaultHashtags, fbAutoHashtags).
export async function hashtagsForQuestion(q, site, extra = "") {
  const out = [];
  const push = (t) => { if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t); };
  for (const w of String(extra || "").split(/[\s,]+/)) push(normTag(w));
  for (const w of String(site?.fbDefaultHashtags || "").split(/[\s,]+/)) push(normTag(w));
  if (site?.fbAutoHashtags !== false && q) {
    let subjectName = "";
    let topicName = "";
    if (q.subject) {
      const s = await Subject.findById(q.subject).select("name").lean().catch(() => null);
      subjectName = s?.name || "";
    }
    // Look up the Topic name from the session hierarchy (Question → Session → Topic).
    // Falls back to q.topic (a plain string field used by test-series questions).
    let sessionId = q.session;
    if (!sessionId && q.quiz) {
      // Question linked to a quiz but not directly to a session — get session from quiz.
      const qz = await Quiz.findById(q.quiz).select("session").lean().catch(() => null);
      sessionId = qz?.session || null;
    }
    if (sessionId) {
      const sess = await Session.findById(sessionId).select("topic").lean().catch(() => null);
      if (sess?.topic) {
        const t = await Topic.findById(sess.topic).select("title").lean().catch(() => null);
        topicName = t?.title || "";
      }
    }
    if (!topicName && q.topic) topicName = q.topic;
    push(toTagWords(subjectName));
    push(toTagWords(topicName));
    push(toTagWords(q.section));
  }
  return out.join(" ");
}

// Build the Facebook post text for one question, honouring the schedule's
// formatting options (show options / reveal answer / hashtags).
export function formatQuestionPost(q, opts = {}) {
  const lines = [];
  if (q.text) lines.push(plain(q.text));

  // Matching / pair columns.
  if (Array.isArray(q.columnA) && q.columnA.length) {
    lines.push("");
    q.columnA.forEach((a, i) => lines.push(`${i + 1}. ${plain(a)}`));
    if (Array.isArray(q.columnB) && q.columnB.length) {
      lines.push("");
      q.columnB.forEach((b, i) => lines.push(`${ROMAN[i] || i + 1}. ${plain(b)}`));
    }
  }
  // Assertion & Reason.
  if (q.assertion) { lines.push("", `Assertion (A): ${plain(q.assertion)}`); if (q.reason) lines.push(`Reason (R): ${plain(q.reason)}`); }

  if (opts.includeOptions && Array.isArray(q.options) && q.options.length) {
    lines.push("");
    q.options.forEach((o, i) => lines.push(`${LETTERS[i]}) ${plain(o)}`));
  }

  if (opts.includeAnswer && Number.isInteger(q.correct)) {
    lines.push("", `✅ Answer: ${LETTERS[q.correct] || q.correct + 1}${Array.isArray(q.options) && q.options[q.correct] ? `) ${plain(q.options[q.correct])}` : ""}`);
    if (q.explanation) lines.push("", plain(q.explanation));
  } else if (opts.includeOptions) {
    lines.push("", "👉 Comment your answer below!");
  }

  if (opts.hashtags && String(opts.hashtags).trim()) lines.push("", String(opts.hashtags).trim());
  return lines.join("\n").slice(0, 60000); // FB text limit is generous; cap defensively
}

// Build the Mongo filter for a schedule's chosen content scope. Deepest wins.
function scopeFilter(source = {}) {
  const base = { status: "published" };
  if (source.quiz) return { ...base, quiz: source.quiz };
  if (source.session) return { ...base, session: source.session };
  if (source.testSeries) return { ...base, testSeries: source.testSeries };
  if (source.subject) return { ...base, subject: source.subject };
  return null;
}

// Pick the next question for a schedule (random or sequential), skipping ones
// already posted until the pool is exhausted, then cycling. Returns the doc.
export async function pickQuestionForSchedule(sch) {
  // A single specific question (scheduled straight from the question view).
  if (sch.source?.question) {
    const q = await Question.findById(sch.source.question).lean();
    return q ? { q, recycled: false } : null;
  }
  const filter = scopeFilter(sch.source);
  if (!filter) return null;
  const posted = (sch.postedQuestionIds || []).map(String);

  const unusedFilter = posted.length ? { ...filter, _id: { $nin: sch.postedQuestionIds } } : filter;
  let count = await Question.countDocuments(unusedFilter);
  let useFilter = unusedFilter;
  let recycled = false;
  if (count === 0) {
    // All posted already → start over from the full pool.
    count = await Question.countDocuments(filter);
    useFilter = filter;
    recycled = true;
  }
  if (count === 0) return null; // no questions at all in this scope

  let q;
  if (sch.order === "sequential") {
    q = await Question.findOne(useFilter).sort({ createdAt: 1 }).lean();
  } else {
    const skip = Math.floor(Math.random() * count);
    q = await Question.findOne(useFilter).skip(skip).lean();
  }
  return q ? { q, recycled } : null;
}

// Time helpers ------------------------------------------------------------
function tzParts(date, timeZone) {
  try {
    const f = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone || "Asia/Kolkata", hour12: false,
      weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
    const hour = p.hour === "24" ? 0 : parseInt(p.hour, 10);
    return { dateStr: `${p.year}-${p.month}-${p.day}`, hh: hour, mm: parseInt(p.minute, 10), dow: WEEKDAYS.indexOf(p.weekday) };
  } catch {
    return { dateStr: date.toISOString().slice(0, 10), hh: date.getUTCHours(), mm: date.getUTCMinutes(), dow: date.getUTCDay() };
  }
}

// Return the slot key ("YYYY-MM-DD HH:MM") that is due to fire now, or null.
// A slot fires when the current time (in the schedule's timezone) is at/after
// it, within a grace window (so a brief downtime still posts, but stale slots
// from hours ago are skipped). lastSlot prevents re-firing the same slot.
const GRACE_MIN = 180;
function dueSlot(sch, now) {
  const { dateStr, hh, mm, dow } = tzParts(now, sch.timezone);
  if (Array.isArray(sch.days) && sch.days.length && !sch.days.includes(dow)) return null;
  const cur = hh * 60 + mm;
  let best = null;
  for (const t of sch.times || []) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
    if (!m) continue;
    const tmin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if (cur >= tmin && cur - tmin <= GRACE_MIN) {
      const key = `${dateStr} ${String(m[1]).padStart(2, "0")}:${m[2]}`;
      if (!best || tmin > best.tmin) best = { key, tmin };
    }
  }
  if (best && sch.lastSlot !== best.key) return best.key;
  return null;
}

// Post one question from a schedule right now (used by the scheduler AND the
// admin "Post now" button). Posts to Facebook and/or Instagram, as an image
// card when requested (Instagram always needs one). Returns { ok, error? }.
export async function runScheduleOnce(sch, cfgOverride) {
  const cfg = cfgOverride || (await getFacebookConfig());
  if (!isFacebookConfigured(cfg)) return { ok: false, error: "Facebook is not connected." };
  const picked = await pickQuestionForSchedule(sch);
  if (!picked || !picked.q) return { ok: false, error: "No published questions found in the selected source." };
  const { q, recycled } = picked;

  const wantFb = sch.toFacebook !== false;
  const wantIg = !!sch.toInstagram && cfg.igEnabled;
  // Global default + auto hashtags (from the question's subject/topic/section)
  // merged with any per-post tags — so every post is tagged consistently.
  const site = await Settings.findOne({ key: "site" }).lean().catch(() => null);
  const finalTags = await hashtagsForQuestion(q, site, sch.hashtags);
  const message = formatQuestionPost(q, {
    includeOptions: sch.includeOptions,
    includeAnswer: sch.includeAnswer,
    hashtags: finalTags,
  });
  const link = sch.includeLink && cfg.siteUrl ? cfg.siteUrl : undefined;

  // Render an image if a photo post is requested, or if Instagram is a target
  // (IG can't post text-only). Falls back to text if rendering fails.
  // Also render an image when the selfie watermark is enabled — this ensures the
  // admin's selfie branding appears on EVERY post (text + image).
  const selfieWatermarkActive = site?.fbSelfieWatermarkEnabled !== false && !!site?.fbSelfieWatermarkUrl;
  let imageUrl = null, imageErr = "";
  if (sch.asImage || wantIg || selfieWatermarkActive) {
    if (sch.imageUrl && !selfieWatermarkActive) {
      // A screenshot captured in the admin's browser — used only when no
      // watermark is active (watermark requires server-side rendering).
      imageUrl = sch.imageUrl;
    } else {
      // Server-rendered image includes the watermark overlay automatically.
      const r = await renderQuestionImage(q, {
        includeOptions: sch.includeOptions,
        includeAnswer: sch.includeAnswer,
        hashtags: finalTags,
      });
      imageUrl = r.url || null;
      imageErr = r.error || "";
    }
  }

  const notes = [];
  let anyOk = false;

  if (wantFb) {
    // Always attach the image when a selfie watermark is active (ensures branding on every post).
    const fbImageUrl = (sch.asImage || selfieWatermarkActive) ? imageUrl : undefined;
    const r = await postToFacebookPage({ message, link, imageUrl: fbImageUrl }, cfg);
    if (r.ok) { anyOk = true; notes.push("Facebook ✓"); } else notes.push(`Facebook ✗ (${r.error})`);

    // Cross-post to any extra Facebook Pages the admin added (each with its own
    // token). Groups are NOT supported by the Facebook API, so only Pages work.
    for (const t of site?.fbExtraTargets || []) {
      const pageId = String(t?.pageId || "").trim();
      const token = String(t?.token || "").trim();
      if (!pageId || !token) continue;
      const rr = await postToFacebookPage(
        { message, link, imageUrl: fbImageUrl },
        { ...cfg, pageId, token }
      );
      const name = t.label || pageId;
      if (rr.ok) { anyOk = true; notes.push(`${name} ✓`); } else notes.push(`${name} ✗ (${rr.error})`);
    }
  }
  if (wantIg) {
    if (!imageUrl) notes.push(`Instagram ✗ (image failed${imageErr ? `: ${imageErr}` : ""})`);
    else {
      const r = await postToInstagram({ imageUrl, caption: message }, cfg);
      if (r.ok) { anyOk = true; notes.push("Instagram ✓"); } else notes.push(`Instagram ✗ (${r.error})`);
    }
  }
  if (!wantFb && !wantIg) return { ok: false, error: "No destination selected (enable Facebook and/or Instagram)." };

  sch.lastRunAt = new Date();
  if (anyOk) {
    sch.postedQuestionIds = recycled ? [q._id] : [...(sch.postedQuestionIds || []), q._id];
    sch.postCount = (sch.postCount || 0) + 1;
    sch.lastResult = `${notes.join(" · ")}${recycled ? " (restarted the pool)" : ""}`;
  } else {
    sch.lastResult = `Failed: ${notes.join(" · ")}`;
  }
  return { ok: anyOk, error: anyOk ? undefined : notes.join(" · "), id: undefined };
}

// The scheduler tick — called every minute (server interval) and, as a
// safety net, from the throttled /api/health ping. Guarded so overlapping
// calls can't double-post.
let fbTickRunning = false;
export async function runDueFbSchedules() {
  if (fbTickRunning) return;
  fbTickRunning = true;
  try {
    const cfg = await getFacebookConfig();
    if (!cfg.enabled || !isFacebookConfigured(cfg)) return; // posting off / not connected
    const now = new Date();
    const schedules = await FbSchedule.find({ enabled: true });
    for (const sch of schedules) {
      let slot = null;
      if (sch.mode === "once") {
        // One-off: fire once when its time has arrived and it hasn't run yet.
        if (sch.runAt && new Date(sch.runAt).getTime() <= now.getTime() && !sch.lastSlot) slot = "once";
      } else {
        slot = dueSlot(sch, now);
      }
      if (!slot) continue;
      // Claim the slot FIRST (persist) so a concurrent tick won't repost it,
      // then post. If the post fails, lastResult records why.
      sch.lastSlot = slot === "once" ? "done" : slot;
      if (sch.mode === "once") sch.enabled = false; // one-off never repeats
      await sch.save();
      try {
        await runScheduleOnce(sch, cfg);
        await sch.save();
      } catch (e) {
        sch.lastResult = `Error: ${e.message}`;
        await sch.save().catch(() => {});
      }
    }
  } catch {
    /* never let the scheduler throw */
  } finally {
    fbTickRunning = false;
  }
}
