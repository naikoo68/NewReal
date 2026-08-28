import FbSchedule from "../models/FbSchedule.js";
import Question from "../models/Question.js";
import Settings from "../models/Settings.js";
import { runScheduleOnce, getFacebookConfig, hashtagsForQuestion } from "../config/facebook.js";
import { renderQuestionImage } from "../config/socialImage.js";

// GET /api/facebook/suggest-tags/:id — hashtags for one question (global default
// + auto tags from its subject/topic/section). Used to pre-fill the post modal.
export async function suggestTags(req, res) {
  const q = await Question.findById(req.params.id).lean();
  if (!q) return res.json({ hashtags: "" });
  const site = await Settings.findOne({ key: "site" }).lean().catch(() => null);
  res.json({ hashtags: await hashtagsForQuestion(q, site, "") });
}

// Common post-format fields from the per-question modal.
function postOpts(body = {}) {
  return {
    toFacebook: body.toFacebook !== false,
    toInstagram: !!body.toInstagram,
    asImage: !!body.asImage,
    includeOptions: body.includeOptions !== false,
    includeAnswer: !!body.includeAnswer,
    includeLink: !!body.includeLink,
    hashtags: String(body.hashtags || "").trim(),
    // Pre-captured, client-rendered screenshot (exactly what students see). When
    // present the poster uses it instead of the server-drawn card.
    imageUrl: String(body.imageUrl || "").trim(),
  };
}

// Only the fields an admin may set on a schedule (whitelist).
function pickScheduleFields(body = {}) {
  const src = body.source || {};
  const cleanId = (v) => (v ? v : null);
  return {
    title: String(body.title || "").trim(),
    enabled: body.enabled !== false,
    source: {
      label: String(src.label || "").trim(),
      subject: cleanId(src.subject),
      session: cleanId(src.session),
      quiz: cleanId(src.quiz),
      testSeries: cleanId(src.testSeries),
    },
    times: Array.isArray(body.times)
      ? body.times.map((t) => String(t).trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t)).slice(0, 20)
      : [],
    days: Array.isArray(body.days) ? body.days.map(Number).filter((d) => d >= 0 && d <= 6) : [],
    timezone: String(body.timezone || "Asia/Kolkata").trim() || "Asia/Kolkata",
    includeOptions: body.includeOptions !== false,
    includeAnswer: !!body.includeAnswer,
    includeLink: !!body.includeLink,
    hashtags: String(body.hashtags || "").trim(),
    order: body.order === "sequential" ? "sequential" : "random",
    toFacebook: body.toFacebook !== false,
    toInstagram: !!body.toInstagram,
    asImage: !!body.asImage,
  };
}

// GET /api/facebook/schedules — list all schedules (admin)
export async function listSchedules(req, res) {
  const schedules = await FbSchedule.find().sort({ createdAt: -1 }).lean();
  res.json(schedules);
}

// POST /api/facebook/schedules — create (admin)
export async function createSchedule(req, res) {
  const data = pickScheduleFields(req.body);
  if (!data.source.subject && !data.source.session && !data.source.quiz && !data.source.testSeries) {
    return res.status(400).json({ message: "Pick a source (a subject, session, quiz or test) to draw questions from." });
  }
  if (!data.times.length) return res.status(400).json({ message: "Add at least one time (HH:MM)." });
  const sch = await FbSchedule.create({ ...data, createdBy: req.user?._id || null });
  res.status(201).json(sch);
}

// PUT /api/facebook/schedules/:id — update (admin)
export async function updateSchedule(req, res) {
  const data = pickScheduleFields(req.body);
  if (!data.times.length) return res.status(400).json({ message: "Add at least one time (HH:MM)." });
  const sch = await FbSchedule.findByIdAndUpdate(req.params.id, data, { new: true });
  if (!sch) return res.status(404).json({ message: "Schedule not found." });
  res.json(sch);
}

// DELETE /api/facebook/schedules/:id — delete (admin)
export async function deleteSchedule(req, res) {
  await FbSchedule.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}

// POST /api/facebook/schedules/:id/post-now — post one question immediately (admin)
export async function postScheduleNow(req, res) {
  const sch = await FbSchedule.findById(req.params.id);
  if (!sch) return res.status(404).json({ message: "Schedule not found." });
  const cfg = await getFacebookConfig();
  if (!cfg.pageId || !cfg.token) {
    return res.status(400).json({ ok: false, error: "Connect Facebook first (Page ID + token) and enable posting." });
  }
  const result = await runScheduleOnce(sch, cfg);
  await sch.save().catch(() => {});
  return res.status(result.ok ? 200 : 502).json(result);
}

// POST /api/facebook/post-question — post ONE specific question right now (admin)
// Body: { questionId, toFacebook?, toInstagram?, asImage?, includeOptions?, includeAnswer?, hashtags? }
export async function postQuestionNow(req, res) {
  const questionId = req.body?.questionId;
  if (!questionId) return res.status(400).json({ ok: false, error: "Missing questionId." });
  const cfg = await getFacebookConfig();
  if (!cfg.pageId || !cfg.token) return res.status(400).json({ ok: false, error: "Connect Facebook first (Page ID + token) and enable posting." });
  const exists = await Question.exists({ _id: questionId });
  if (!exists) return res.status(404).json({ ok: false, error: "Question not found." });

  // A transient (unsaved) schedule-like object drives the same posting logic.
  const transient = { source: { question: questionId }, order: "random", postedQuestionIds: [], ...postOpts(req.body) };
  const result = await runScheduleOnce(transient, cfg);
  return res.status(result.ok ? 200 : 502).json(result);
}

// POST /api/facebook/preview-image — render the question card image and return
// its URL (no posting). Used for the live preview in the post/schedule modal.
export async function previewQuestionImage(req, res) {
  const { questionId } = req.body || {};
  if (!questionId) return res.status(400).json({ message: "Missing questionId." });
  const q = await Question.findById(questionId).lean();
  if (!q) return res.status(404).json({ message: "Question not found." });
  const r = await renderQuestionImage(q, {
    includeOptions: req.body.includeOptions !== false,
    includeAnswer: !!req.body.includeAnswer,
    hashtags: String(req.body.hashtags || "").trim(),
  });
  if (!r.url) return res.status(502).json({ message: r.error || "Could not generate the image." });
  res.json({ url: r.url });
}

// POST /api/facebook/schedule-question — schedule ONE specific question at a
// date/time (admin). Body: { questionId, runAt, label?, ...postOpts }
export async function scheduleQuestion(req, res) {
  const { questionId, runAt } = req.body || {};
  if (!questionId) return res.status(400).json({ message: "Missing questionId." });
  if (!runAt || isNaN(new Date(runAt).getTime())) return res.status(400).json({ message: "Pick a valid date & time." });
  const exists = await Question.exists({ _id: questionId });
  if (!exists) return res.status(404).json({ message: "Question not found." });

  const sch = await FbSchedule.create({
    title: String(req.body.title || "").trim() || "Scheduled question",
    enabled: true,
    mode: "once",
    runAt: new Date(runAt),
    source: { question: questionId, label: String(req.body.label || "Single question").slice(0, 120) },
    times: [], days: [], timezone: String(req.body.timezone || "Asia/Kolkata"),
    order: "random",
    ...postOpts(req.body), // includes the pre-captured imageUrl (posted at run time)
    createdBy: req.user?._id || null,
  });
  res.status(201).json(sch);
}
