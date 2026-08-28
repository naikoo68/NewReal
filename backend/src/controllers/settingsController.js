import Settings from "../models/Settings.js";
import Tenant from "../models/Tenant.js";
import { getCurrentTenantId } from "../utils/tenantContext.js";
import { postToFacebookPage, verifyFacebook, getFacebookConfig, getInstagramUserId, postToInstagram } from "../config/facebook.js";
import { renderQuestionImage } from "../config/socialImage.js";
import { uploadToCloudinary } from "../config/cloudinary.js";

// A freshly-provisioned institute must start as a CLEAN SLATE — it should carry
// only its own name, never the platform's demo branding, marketing copy, fake
// testimonials/stats or contact details. We pass these fields explicitly (empty)
// so Mongoose does NOT fall back to the schema defaults ("My Study Guide", the
// sample toppers, "1,20,000+ students", hello@mystudyguide.com, …). Functional
// defaults (colours, nav sizing, watermark, subscription plans) are left to the
// schema so the institute still has sensible, working settings.
function cleanTenantSeed(instituteName) {
  return {
    key: "site",
    siteName: instituteName || "",
    tagline: "",
    aboutHeading: "",
    aboutIntro: "",
    aboutValues: [],
    aboutStats: [],
    testimonials: [],
    contacts: [],
    socialLinks: [],
  };
}

// Fetch this scope's settings, creating the doc on first access. For a NON-default
// institute the new doc is seeded empty (its own name only); the default/platform
// tenant keeps the full demo defaults so nothing about the main site changes.
async function getOrCreate() {
  let s = await Settings.findOne({ key: "site" });
  if (s) return s;
  const tenantId = getCurrentTenantId();
  if (tenantId) {
    const t = await Tenant.findById(tenantId).select("name isDefault").lean();
    if (t && !t.isDefault) return Settings.create(cleanTenantSeed(t.name));
  }
  return Settings.create({ key: "site" });
}

// Never send the Facebook access token to the browser. Replace it with a
// boolean (fbTokenSet) so the admin UI can show "saved" without exposing it.
function safeSettings(s) {
  const obj = s && s.toObject ? s.toObject() : { ...(s || {}) };
  obj.fbTokenSet = !!obj.fbPageAccessToken;
  delete obj.fbPageAccessToken;
  // Extra cross-post pages: never send their tokens to the browser.
  if (Array.isArray(obj.fbExtraTargets)) {
    obj.fbExtraTargets = obj.fbExtraTargets.map((t) => ({ label: t.label || "", pageId: t.pageId || "", tokenSet: !!t.token }));
  }
  return obj;
}

// GET /api/settings — public (frontend reads this to brand/theme itself)
export async function getSettings(req, res) {
  res.json(safeSettings(await getOrCreate()));
}

// PUT /api/settings — admin only
export async function updateSettings(req, res) {
  // Ensure the settings doc already exists (clean-seeded for institutes) BEFORE
  // the update below, so a first-save by an institute admin can't trigger the
  // upsert's setDefaultsOnInsert and re-introduce the platform demo content.
  await getOrCreate();

  const allowed = [
    "siteName", "tagline", "logoUrl", "primaryColor", "accentColor",
    "fontFamily", "socialLinks", "contacts",
    "navHeight", "navBrandSize", "navFontSize", "navFontWeight", "navFontFamily", "navTextTransform", "defaultZoom",
    "watermarkEnabled", "watermarkText", "watermarkOpacity", "watermarkSize", "watermarkMode", "restrictCopy", "screenshotGuard", "guardHoldMs", "statsAuto", "notifyOnNewContent",
    "homeSections",
    "clientAnnouncement",
    "aboutHeading", "aboutIntro", "aboutValues", "aboutStats", "testimonials",
    "aiMaxPerBatch", "clientPlans", "studentPlans", "tenantPlans",
    "fbEnabled", "fbPageId", "fbAutoOnNotice", "fbGraphVersion", "fbPageAccessToken",
    "fbDefaultHashtags", "fbAutoHashtags", "fbExtraTargets",
    "fbSelfieWatermarkUrl", "fbSelfieWatermarkEnabled", "fbSelfieWatermarkPosition", "fbSelfieWatermarkSize", "fbSelfieWatermarkOpacity", "fbSelfieWatermarkShape",
    "igEnabled", "igUserId",
    "googleClientId",
  ];
  const update = {};
  for (const k of allowed) if (k in req.body) update[k] = req.body[k];

  // Facebook: keep the token server-side. Only overwrite it when a NEW non-empty
  // value is provided (the admin UI submits it blank to keep the saved one).
  if ("fbPageAccessToken" in update) {
    const tok = String(update.fbPageAccessToken || "").trim();
    if (tok) update.fbPageAccessToken = tok; else delete update.fbPageAccessToken;
  }
  if ("fbPageId" in update) update.fbPageId = String(update.fbPageId || "").trim();
  // Extra cross-post Pages: keep each page's saved token when the UI submits a
  // blank one (tokens are never sent to the browser, so blank = "unchanged").
  if (Array.isArray(update.fbExtraTargets)) {
    const current = await getOrCreate();
    const savedTokens = new Map((current.fbExtraTargets || []).map((t) => [String(t.pageId), t.token]));
    update.fbExtraTargets = update.fbExtraTargets
      .map((t) => {
        const pageId = String(t?.pageId || "").trim();
        const token = String(t?.token || "").trim() || savedTokens.get(pageId) || "";
        return { label: String(t?.label || "").trim(), pageId, token };
      })
      .filter((t) => t.pageId);
  }
  if ("fbGraphVersion" in update) update.fbGraphVersion = String(update.fbGraphVersion || "").trim() || "v21.0";
  if ("igUserId" in update) update.igUserId = String(update.igUserId || "").trim();
  if ("googleClientId" in update) update.googleClientId = String(update.googleClientId || "").trim();

  // Selfie watermark: validate position and clamp size/opacity.
  if ("fbSelfieWatermarkUrl" in update) update.fbSelfieWatermarkUrl = String(update.fbSelfieWatermarkUrl || "").trim();
  if ("fbSelfieWatermarkPosition" in update) {
    const pos = String(update.fbSelfieWatermarkPosition || "").trim();
    update.fbSelfieWatermarkPosition = ["bottom-right", "bottom-left", "top-right", "top-left"].includes(pos) ? pos : "bottom-right";
  }
  if ("fbSelfieWatermarkSize" in update) update.fbSelfieWatermarkSize = Math.max(40, Math.min(300, parseInt(update.fbSelfieWatermarkSize, 10) || 120));
  if ("fbSelfieWatermarkOpacity" in update) update.fbSelfieWatermarkOpacity = Math.max(10, Math.min(100, parseInt(update.fbSelfieWatermarkOpacity, 10) || 90));
  if ("fbSelfieWatermarkShape" in update) {
    const sh = String(update.fbSelfieWatermarkShape || "").trim();
    update.fbSelfieWatermarkShape = ["circle", "rectangle"].includes(sh) ? sh : "circle";
  }

  // Client welcome popup announcement: coerce enabled + trim/limit text.
  if ("clientAnnouncement" in update) {
    const a = update.clientAnnouncement || {};
    update.clientAnnouncement = {
      enabled: !!a.enabled,
      title: String(a.title || "").trim().slice(0, 200),
      message: String(a.message || "").trim().slice(0, 4000),
    };
  }

  // AI limits: clamp the admin's global per-batch ceiling.
  if ("aiMaxPerBatch" in update) {
    update.aiMaxPerBatch = Math.max(1, Math.min(5000, parseInt(update.aiMaxPerBatch, 10) || 50));
  }
  // Client subscription plans: pricing + AI limits. Keys are kept stable
  // (referenced by user.subscriptionPlan); a missing key is generated from the
  // label and de-duplicated so each plan stays uniquely addressable.
  if (Array.isArray(update.clientPlans)) {
    const usedKeys = new Set();
    update.clientPlans = update.clientPlans
      .map((p) => {
        const label = String(p?.label || "").trim();
        let base = String(p?.key || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
        if (!base) base = (label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "plan");
        let key = base;
        let i = 2;
        while (usedKeys.has(key)) key = `${base}${i++}`;
        usedKeys.add(key);
        return {
          key,
          label,
          cycle: String(p?.cycle || "").trim().slice(0, 30),
          months: Math.max(0, Math.min(120, parseInt(p?.months, 10) || 0)),
          price: Math.max(0, Math.min(10000000, parseInt(p?.price, 10) || 0)),
          trial: !!p?.trial,
          maxPerBatch: Math.max(1, Math.min(5000, parseInt(p?.maxPerBatch, 10) || 1)),
          perWindow: Math.max(1, Math.min(100000, parseInt(p?.perWindow, 10) || 1)),
          windowMinutes: Math.max(1, Math.min(1440, parseInt(p?.windowMinutes, 10) || 5)),
        };
      })
      .filter((p) => p.label);
  }

  // Pricing-only plan lists (no AI limits): student + institute plans share the
  // same normalization — stable/de-duplicated keys, clamped numbers.
  const normalizePricingPlans = (plans) => {
    const usedKeys = new Set();
    return plans
      .map((p) => {
        const label = String(p?.label || "").trim();
        let base = String(p?.key || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
        if (!base) base = (label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "plan");
        let key = base;
        let i = 2;
        while (usedKeys.has(key)) key = `${base}${i++}`;
        usedKeys.add(key);
        return {
          key,
          label,
          cycle: String(p?.cycle || "").trim().slice(0, 30),
          months: Math.max(0, Math.min(120, parseInt(p?.months, 10) || 0)),
          price: Math.max(0, Math.min(10000000, parseInt(p?.price, 10) || 0)),
          trial: !!p?.trial,
        };
      })
      .filter((p) => p.label);
  };
  if (Array.isArray(update.studentPlans)) update.studentPlans = normalizePricingPlans(update.studentPlans);
  if (Array.isArray(update.tenantPlans)) update.tenantPlans = normalizePricingPlans(update.tenantPlans);

  // Make social links absolute so a link pasted without http:// still works.
  if (Array.isArray(update.socialLinks)) {
    update.socialLinks = update.socialLinks
      .filter((s) => s && s.url && s.url.trim() && s.url.trim() !== "#")
      .map((s) => {
        const u = s.url.trim();
        return { platform: s.platform, url: /^https?:\/\//i.test(u) ? u : `https://${u}` };
      });
  }

  const s = await Settings.findOneAndUpdate({ key: "site" }, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });
  res.json(safeSettings(s));
}

// POST /api/settings/facebook/test — admin: verify the connection and (unless
// verifyOnly) publish a test post to the configured Facebook Page.
export async function testFacebookPost(req, res) {
  const cfg = await getFacebookConfig();
  if (!cfg.pageId || !cfg.token) {
    return res.status(400).json({ ok: false, error: "Enter your Page ID and Page access token, click Save, then try again." });
  }
  if (req.body?.verifyOnly) {
    const v = await verifyFacebook(cfg);
    return res.status(v.ok ? 200 : 502).json(v);
  }
  const site = await getOrCreate();
  const message = String(req.body?.message || "").trim() ||
    `✅ Test post from ${site.siteName || "My Study Guide"} — Facebook auto-posting is connected.`;
  const result = await postToFacebookPage({ message, link: req.body?.link }, cfg);
  return res.status(result.ok ? 200 : 502).json(result);
}

// POST /api/settings/instagram/test — admin: verify the linked IG account and
// (unless verifyOnly) publish a test image post to Instagram.
export async function testInstagramPost(req, res) {
  const cfg = await getFacebookConfig();
  if (!cfg.pageId || !cfg.token) {
    return res.status(400).json({ ok: false, error: "Connect Facebook first (Page ID + token)." });
  }
  const igId = await getInstagramUserId(cfg);
  if (!igId) {
    return res.status(400).json({ ok: false, error: "No Instagram Business/Creator account is linked to this Facebook Page. Link it in your Facebook Page settings, then try again." });
  }
  if (req.body?.verifyOnly) return res.json({ ok: true, igUserId: igId });

  const site = await getOrCreate();
  const title = `Test post from ${site.siteName || "My Study Guide"}`;
  const rendered = await renderQuestionImage(
    { text: title, options: ["Ready", "Set", "Go", "Posted!"], correct: 3 },
    { includeOptions: true }
  );
  if (!rendered.url) return res.status(502).json({ ok: false, error: rendered.error || "Could not generate the image." });
  const result = await postToInstagram({ imageUrl: rendered.url, caption: `${title} — Instagram auto-posting is connected. ✅` }, cfg);
  return res.status(result.ok ? 200 : 502).json(result);
}

// POST /api/settings/selfie-watermark — admin: upload a selfie image to be used
// as a watermark on Facebook/Instagram image posts. Accepts multipart (file) or
// a base64 data URI in the body. Stores the Cloudinary URL in Settings.
export async function uploadSelfieWatermark(req, res) {
  try {
    let fileStr = null;

    // If multer attached a file (multipart upload), convert it to a base64 data URI.
    if (req.file) {
      const mime = req.file.mimetype || "image/png";
      fileStr = `data:${mime};base64,${req.file.buffer.toString("base64")}`;
    } else if (req.body?.image) {
      // Base64 data URI sent directly in the body (from frontend FileReader).
      fileStr = String(req.body.image);
    }

    if (!fileStr) {
      return res.status(400).json({ ok: false, error: "No image provided. Upload a file or send a base64 image." });
    }

    const { url } = await uploadToCloudinary(fileStr, "mystudyguide/watermarks");
    if (!url) return res.status(502).json({ ok: false, error: "Cloudinary upload failed." });

    // Save the URL to settings.
    const s = await Settings.findOneAndUpdate(
      { key: "site" },
      { fbSelfieWatermarkUrl: url },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true, url, settings: safeSettings(s) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Upload failed." });
  }
}

// DELETE /api/settings/selfie-watermark — admin: remove the selfie watermark.
export async function deleteSelfieWatermark(req, res) {
  const s = await Settings.findOneAndUpdate(
    { key: "site" },
    { fbSelfieWatermarkUrl: "" },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  res.json({ ok: true, settings: safeSettings(s) });
}
