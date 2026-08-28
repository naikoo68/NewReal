import crypto from "crypto";
import bcrypt from "bcryptjs";
import TestSeries from "../models/TestSeries.js";
import CbtAttempt from "../models/CbtAttempt.js";
import CbtRegistration from "../models/CbtRegistration.js";
import { gradeSubmission } from "./testController.js";
import { sendMail, isMailConfigured } from "../config/mailer.js";

/* ============================ helpers ============================ */

// Only the admin manages CBT exams (they live on platform / ownerless tests).
const isAdmin = (req) => req.user?.role === "admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const optLetter = (n) => (n == null ? "—" : String.fromCharCode(65 + Number(n)));
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Base URL of the frontend (hash router), for links emailed to students.
const clientBase = () => (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");
// Prefer a per-attempt captured origin (the real site the student used) over
// CLIENT_URL, so links are correct even when CLIENT_URL isn't set.
const resultUrlFor = (token, base) => `${(base || clientBase()).replace(/\/$/, "")}/#/cbt/result/${token}`;
const portalUrl = () => `${clientBase()}/#/online-exams`;

// Work out the frontend's public origin from the request (the student's browser
// sends Origin/Referer), so emailed links don't fall back to localhost.
function frontendOriginFromReq(req) {
  const o = req.headers?.origin;
  if (o && /^https?:\/\//i.test(o)) return o.replace(/\/$/, "");
  const ref = req.headers?.referer || req.headers?.referrer;
  if (ref) {
    try { const u = new URL(ref); return `${u.protocol}//${u.host}`; } catch { /* ignore */ }
  }
  return "";
}

// Whether the exam's taking window has ended (fixed end time reached).
const endReached = (t) => t.cbtEndAt && new Date(t.cbtEndAt).getTime() <= Date.now();
// Whether results should now be declared AUTOMATICALLY (used by the sweep and
// on-demand release). Respects the per-exam result mode:
//  - "manual": declare only once the scheduled cbtResultAt timer is reached
//    (never purely because the exam ended). No timer set → never auto-declares
//    (the admin releases with the button).
//  - "auto" (default): declare as soon as the exam's end time is reached.
const resultDue = (t) => {
  if (t.cbtResultsReleased) return false;
  if (t.cbtResultMode === "manual") {
    return !!(t.cbtResultAt && new Date(t.cbtResultAt).getTime() <= Date.now());
  }
  return endReached(t);
};
// Whether the exam hasn't opened yet (scheduled start time not reached).
const notStartedYet = (t) => t.cbtStartAt && new Date(t.cbtStartAt).getTime() > Date.now();
// Whether NEW entries are closed: past the admin's manual late-entry cutoff.
// (Students already inside keep going — the timer is bound to the end time.)
const entryClosed = (t) => t.cbtEntryCloseAt && new Date(t.cbtEntryCloseAt).getTime() <= Date.now();
// Whether candidates may currently take the exam: on the portal, live, results
// not released, started (if scheduled), and the end time (if any) not reached.
const openForTaking = (t) =>
  t.cbtEnabled && t.cbtLive && !t.cbtResultsReleased && !notStartedYet(t) && !endReached(t);

// A single word describing where the exam is in its lifecycle (for the client).
function examWindowState(t) {
  if (t.cbtResultsReleased) return "released";
  if (endReached(t)) return "ended";
  if (!t.cbtLive) return "off";
  if (notStartedYet(t)) return "scheduled";
  return "open";
}

// Whether an email may take this exam (open exam, or on the allowlist).
const emailAllowed = (t, email) =>
  !t.cbtRestrictEntry || (t.cbtAllowedEmails || []).includes(String(email || "").toLowerCase());

// Whether an email was explicitly granted access on the allowlist. Such
// candidates may START even after the late-entry cutoff (a per-student
// late-entry override the admin can grant to re-admit someone who was late).
const onAllowedList = (t, email) =>
  (t.cbtAllowedEmails || []).includes(String(email || "").toLowerCase());

// Has this email already completed (submitted) this exam? Used to enforce the
// one-attempt-per-student rule.
async function hasCompleted(testId, email) {
  return !!(await CbtAttempt.exists({ testSeries: testId, email: String(email).toLowerCase() }));
}

const genOtp = () => String(Math.floor(100000 + Math.random() * 900000));

// Email a one-time code to the candidate. `label` describes what it's for.
async function emailOtp(email, code, label = "the exam portal") {
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 8px">Your verification code</h2>
      <p style="color:#475569;margin:0 0 16px">Use this code to continue with <b>${esc(label)}</b>:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f1f5f9;border-radius:12px;padding:16px;text-align:center;color:#4f46e5">${esc(code)}</div>
      <p style="color:#64748b;font-size:13px;margin-top:16px">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
    </div>`;
  return sendMail({ to: email, subject: `Your code: ${code}`, text: `Your verification code is ${code} (valid 10 minutes).`, html });
}

// The canonical leaderboard for a CBT exam: the BEST attempt per student
// (deduped by email — highest score, then fastest), ranked.
function rankBestPerStudent(attempts) {
  const best = new Map(); // email -> attempt
  for (const a of attempts) {
    const key = (a.email || "").toLowerCase();
    const cur = best.get(key);
    if (!cur || a.score > cur.score || (a.score === cur.score && (a.timeTaken || 0) < (cur.timeTaken || 0))) {
      best.set(key, a);
    }
  }
  const rows = [...best.values()].sort(
    (x, y) => (y.score || 0) - (x.score || 0) || (x.timeTaken || 0) - (y.timeTaken || 0)
  );
  return rows.map((a, i) => ({ ...a, rank: i + 1 }));
}

/* ===================== results release (deferred) ===================== */

// Release results for ONE exam: finalise ranks and email every candidate their
// scorecard (best attempt per student). Latches cbtResultsReleased so it runs
// once and stops further taking. Safe to call more than once (no-op if already
// released) thanks to the atomic guard below.
async function releaseOneCbtExam(test) {
  // Atomically flip the latch so concurrent sweeps / a manual click can't
  // double-send. Only the caller that actually flips it proceeds to email.
  const flipped = await TestSeries.updateOne(
    { _id: test._id, cbtResultsReleased: { $ne: true } },
    { $set: { cbtResultsReleased: true, cbtLive: false } }
  );
  if (!flipped.modifiedCount) return; // someone else already released it

  const all = await CbtAttempt.find({ testSeries: test._id }).lean();
  const board = rankBestPerStudent(all);
  const candidates = board.length;
  for (const row of board) {
    if (!row.resultToken || row.emailed) continue;
    // eslint-disable-next-line no-await-in-loop
    await emailCbtResult({ attempt: row, test, rank: row.rank, candidates, resultToken: row.resultToken }).catch(() => {});
  }
}

// Sweep: release any exam whose results are now due but haven't been sent yet.
// "Due" depends on the result mode: auto exams release at their end time; manual
// exams release only at their scheduled cbtResultAt timer. Runs on a timer and
// opportunistically on list loads.
export async function releaseEndedCbtExams() {
  try {
    const now = new Date();
    const due = await TestSeries.find({
      cbtEnabled: true,
      cbtResultsReleased: { $ne: true },
      $or: [
        // auto (default): declare when the exam end time is reached
        { cbtResultMode: { $ne: "manual" }, cbtEndAt: { $ne: null, $lte: now } },
        // manual: declare only when the scheduled result timer is reached
        { cbtResultMode: "manual", cbtResultAt: { $ne: null, $lte: now } },
      ],
    });
    for (const t of due) {
      if (!resultDue(t)) continue; // final guard (mode-aware)
      // eslint-disable-next-line no-await-in-loop
      await releaseOneCbtExam(t);
    }
  } catch { /* next sweep retries */ }
}
setInterval(releaseEndedCbtExams, 2 * 60 * 1000).unref();

/* ===================== public (no auth) endpoints ===================== */

// GET /api/cbt/portal — the single public exam portal: every exam that is added,
// live, not yet released, and still within its window. No auth.
export async function getCbtPortal(req, res) {
  await releaseEndedCbtExams(); // drop just-ended exams from the portal
  const now = Date.now();
  const tests = await TestSeries.find({ cbtEnabled: true, cbtLive: true, cbtResultsReleased: { $ne: true } })
    .populate("practiceStream", "name")
    .populate("practiceSubject", "name")
    .sort("-updatedAt")
    .lean();
  const email = String(req.query.email || "").trim().toLowerCase();

  // Keep exams whose window hasn't ended. Scheduled (not-yet-started) exams are
  // still listed so candidates can see what's coming and when. Restricted exams
  // are shown only to emails on their allowlist.
  const live = tests.filter(
    (t) => (!t.cbtEndAt || new Date(t.cbtEndAt).getTime() > now) && emailAllowed(t, email)
  );
  let completedSet = new Set();
  if (email && live.length) {
    const done = await CbtAttempt.find({ testSeries: { $in: live.map((t) => t._id) }, email }).select("testSeries").lean();
    completedSet = new Set(done.map((a) => String(a.testSeries)));
  }

  res.json(
    live.map((t) => ({
      _id: t._id,
      name: t.name,
      token: t.cbtToken,
      duration: t.duration,
      marks: t.marks,
      questionCount: t.questions?.length || 0,
      context: [t.practiceStream?.name, t.practiceSubject?.name].filter(Boolean).join(" › "),
      startAt: t.cbtStartAt || null,
      entryCloseAt: t.cbtEntryCloseAt || null,
      endAt: t.cbtEndAt || null,
      state: examWindowState(t), // "open" | "scheduled"
      // Entry is "closed" for this candidate only if the cutoff passed AND they
      // were NOT granted late-entry access. Allowlisted emails keep the Start
      // button so a re-admitted late student can actually enter.
      entryClosed: entryClosed(t) && !onAllowedList(t, email),
      lateEntryGranted: entryClosed(t) && onAllowedList(t, email), // show a "granted" badge
      completed: completedSet.has(String(t._id)),
    }))
  );
}

// GET /api/cbt/exam/:token — exam META only (no questions). No auth. Used to
// render the registration/sign-in screen. Questions are handed out only after
// OTP verification, via /start.
export async function getCbtExam(req, res) {
  const test = await TestSeries.findOne({ cbtToken: req.params.token, cbtEnabled: true })
    .select("name duration marks questions cbtLive cbtStartAt cbtEntryCloseAt cbtEndAt cbtResultsReleased cbtRequireOtp").lean();
  if (!test) return res.status(404).json({ message: "This exam link is invalid." });
  res.json({
    _id: test._id,
    name: test.name,
    duration: test.duration,
    marks: test.marks,
    questionCount: test.questions?.length || 0,
    requireOtp: test.cbtRequireOtp !== false,
    startAt: test.cbtStartAt || null,
    entryCloseAt: test.cbtEntryCloseAt || null,
    endAt: test.cbtEndAt || null,
    serverNow: new Date().toISOString(),
    state: examWindowState(test), // open | scheduled | ended | released | off
  });
}

// Validate a portal session (a verified email + its sessionToken). Returns the
// registration doc when valid, else null. Used to gate start & submit.
async function findPortalSession(email, sessionToken) {
  if (!email || !sessionToken) return null;
  const reg = await CbtRegistration.findOne({ email: String(email).toLowerCase() });
  if (!reg || !reg.verified || reg.sessionToken !== sessionToken) return null;
  if (reg.expiresAt && reg.expiresAt.getTime() < Date.now()) return null;
  return reg;
}

// POST /api/cbt/register — PORTAL registration step 1. Body { name, email,
// password }. Sets a password (so the student can log in later without OTP) and
// emails a one-time code to verify the email. Portal-wide (one account/email).
export async function registerPortal(req, res) {
  const { name = "", email = "", password = "" } = req.body || {};
  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  if (!cleanName) return res.status(400).json({ message: "Please enter your name." });
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ message: "Please enter a valid email address." });
  if (String(password).length < 6) return res.status(400).json({ message: "Password must be at least 6 characters." });
  if (!isMailConfigured()) return res.status(503).json({ message: "Email isn't configured on the server, so a code can't be sent. Please contact the organiser." });

  // If a verified account with a password already exists, ask them to log in.
  const existing = await CbtRegistration.findOne({ email: cleanEmail });
  if (existing?.verified && existing?.passwordHash) {
    return res.status(409).json({ existsVerified: true, message: "An account with this email already exists. Please log in instead." });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const code = genOtp();
  const now = Date.now();
  await CbtRegistration.findOneAndUpdate(
    { email: cleanEmail },
    {
      email: cleanEmail, name: cleanName, passwordHash,
      code, codeExpiresAt: new Date(now + 10 * 60 * 1000),
      verified: false, sessionToken: null,
      expiresAt: new Date(now + 24 * 60 * 60 * 1000), // TTL cleanup after 24h
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const sent = await emailOtp(cleanEmail, code, "the exam portal");
  if (!sent) return res.status(502).json({ message: "Could not send the code email. Please try again shortly." });
  res.json({ sent: true, email: cleanEmail });
}

// POST /api/cbt/login — returning candidate. Body { email, password }. No OTP:
// once registered & verified, a student signs back in with their password.
export async function loginPortal(req, res) {
  const { email = "", password = "" } = req.body || {};
  const cleanEmail = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail) || !password) return res.status(400).json({ message: "Enter your email and password." });

  const reg = await CbtRegistration.findOne({ email: cleanEmail });
  if (!reg || !reg.passwordHash) return res.status(404).json({ noAccount: true, message: "No account with this email. Please register first." });
  if (!reg.verified) return res.status(403).json({ message: "Please finish registering — verify the code sent to your email." });
  const ok = await bcrypt.compare(String(password), reg.passwordHash);
  if (!ok) return res.status(401).json({ message: "Incorrect email or password." });

  reg.sessionToken = crypto.randomBytes(24).toString("hex");
  reg.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // refresh TTL
  await reg.save();
  res.json({ sessionToken: reg.sessionToken, name: reg.name, email: cleanEmail });
}

// POST /api/cbt/verify — PORTAL sign-in step 2. Body { email, code }. On success
// issues a sessionToken the client keeps for the whole portal session.
export async function verifyPortal(req, res) {
  const { email = "", code = "" } = req.body || {};
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanCode = String(code).trim();

  const reg = await CbtRegistration.findOne({ email: cleanEmail });
  if (!reg || !reg.code) return res.status(400).json({ message: "Please request a code first." });
  if (!reg.codeExpiresAt || reg.codeExpiresAt.getTime() < Date.now()) return res.status(400).json({ message: "This code has expired. Please request a new one." });
  if (reg.code !== cleanCode) return res.status(400).json({ message: "Incorrect code. Please check and try again." });

  reg.verified = true;
  reg.sessionToken = crypto.randomBytes(24).toString("hex");
  reg.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // refresh TTL
  await reg.save();
  res.json({ sessionToken: reg.sessionToken, name: reg.name, email: cleanEmail });
}

// POST /api/cbt/forgot — request a password-reset code. Body { email }. Emails a
// one-time code to a registered candidate.
export async function forgotPasswordPortal(req, res) {
  const cleanEmail = String(req.body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ message: "Please enter a valid email address." });
  const reg = await CbtRegistration.findOne({ email: cleanEmail });
  if (!reg || !reg.passwordHash) return res.status(404).json({ noAccount: true, message: "No account with this email. Please register." });
  if (!isMailConfigured()) return res.status(503).json({ message: "Email isn't configured on the server. Please contact the organiser." });

  const code = genOtp();
  reg.code = code;
  reg.codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  reg.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await reg.save();
  const sent = await emailOtp(cleanEmail, code, "your password reset");
  if (!sent) return res.status(502).json({ message: "Could not send the code email. Please try again shortly." });
  res.json({ sent: true, email: cleanEmail });
}

// POST /api/cbt/reset — set a new password with the reset code. Body
// { email, code, password }. On success logs the student in (issues a session).
export async function resetPasswordPortal(req, res) {
  const { email = "", code = "", password = "" } = req.body || {};
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanCode = String(code).trim();
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ message: "Please enter a valid email address." });
  if (String(password).length < 6) return res.status(400).json({ message: "Password must be at least 6 characters." });

  const reg = await CbtRegistration.findOne({ email: cleanEmail });
  if (!reg || !reg.code) return res.status(400).json({ message: "Please request a reset code first." });
  if (!reg.codeExpiresAt || reg.codeExpiresAt.getTime() < Date.now()) return res.status(400).json({ message: "This code has expired. Please request a new one." });
  if (reg.code !== cleanCode) return res.status(400).json({ message: "Incorrect code. Please check and try again." });

  reg.passwordHash = await bcrypt.hash(String(password), 10);
  reg.verified = true;
  reg.code = null;
  reg.sessionToken = crypto.randomBytes(24).toString("hex");
  reg.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await reg.save();
  res.json({ sessionToken: reg.sessionToken, name: reg.name, email: cleanEmail });
}

// POST /api/cbt/change-password — a signed-in student changes their password.
// Body { email, sessionToken, currentPassword, newPassword }.
export async function changePasswordPortal(req, res) {
  const { email = "", sessionToken = "", currentPassword = "", newPassword = "" } = req.body || {};
  const cleanEmail = String(email).trim().toLowerCase();
  const reg = await findPortalSession(cleanEmail, sessionToken);
  if (!reg) return res.status(401).json({ message: "Please sign in again." });
  if (String(newPassword).length < 6) return res.status(400).json({ message: "New password must be at least 6 characters." });
  if (!reg.passwordHash || !(await bcrypt.compare(String(currentPassword), reg.passwordHash))) {
    return res.status(401).json({ message: "Your current password is incorrect." });
  }
  reg.passwordHash = await bcrypt.hash(String(newPassword), 10);
  await reg.save();
  res.json({ ok: true });
}

// POST /api/cbt/exam/:token/start — hand out the questions (answers stripped)
// for a verified candidate. Body { email, sessionToken }. Also returns the end
// time + server clock so the client can bind the timer to the exam's end.
export async function startCbt(req, res) {
  const { email = "", sessionToken = "" } = req.body || {};
  const cleanEmail = String(email).trim().toLowerCase();
  const test = await TestSeries.findOne({ cbtToken: req.params.token, cbtEnabled: true }).populate("questions");
  if (!test) return res.status(404).json({ message: "This exam link is invalid." });
  if (!openForTaking(test)) return res.status(403).json({ message: notStartedYet(test) ? "This exam hasn't started yet." : "This exam has ended or is not open right now." });
  // Manual late-entry cutoff: too late to START — UNLESS the admin explicitly
  // granted this email late-entry access (it's on the allowlist). Candidates
  // already inside are unaffected (their timer is bound to the end time).
  if (entryClosed(test) && !onAllowedList(test, cleanEmail)) {
    return res.status(403).json({ entryClosed: true, message: `Entry is closed — late entry was allowed only until ${new Date(test.cbtEntryCloseAt).toLocaleString()}. Ask the organiser to grant you late-entry access.` });
  }

  // Must be a verified portal session (registered on the portal page).
  if (!(await findPortalSession(cleanEmail, sessionToken))) {
    return res.status(401).json({ needRegister: true, message: "Please register on the exam portal to take this exam." });
  }
  // Entry allowlist: only approved emails may take a restricted (private) exam.
  if (!emailAllowed(test, cleanEmail)) {
    return res.status(403).json({ notAllowed: true, message: "You're not on the list of candidates allowed to take this exam. Please contact the organiser." });
  }
  if (await hasCompleted(test._id, cleanEmail)) return res.status(409).json({ alreadyCompleted: true, message: "You have already taken this exam." });

  // Record that this candidate has STARTED, so the admin's student-status view
  // can show them as "in progress" (fire-and-forget; never blocks the start).
  TestSeries.updateOne({ _id: test._id }, { $addToSet: { cbtStartedEmails: cleanEmail } }).catch(() => {});

  const obj = test.toObject();
  const questions = (obj.questions || []).map((q) => {
    const { correct, explanation, optionExplanations, ...rest } = q; // hide answers
    return rest;
  });
  res.json({
    _id: obj._id,
    name: obj.name,
    duration: obj.duration,
    marks: obj.marks,
    negativeMarking: obj.negativeMarking,
    questionCount: questions.length,
    endAt: obj.cbtEndAt || null,
    serverNow: new Date().toISOString(),
    questions,
  });
}

// POST /api/cbt/exam/:token/view — count that someone OPENED the exam link.
export async function registerCbtView(req, res) {
  const test = await TestSeries.findOne({ cbtToken: req.params.token, cbtEnabled: true }).select("_id cbtLive cbtEndAt cbtResultsReleased");
  if (!test) return res.status(404).json({ message: "This exam link is invalid." });
  await TestSeries.updateOne({ _id: test._id }, { $inc: { cbtViews: 1 } });
  res.json({ ok: true });
}

// POST /api/cbt/exam/:token/submit — record a CBT attempt. Body:
// { name, email, answers, timeTaken }. The attempt is stored WITH the student's
// identity and a full graded review snapshot, but NOTHING is revealed now: no
// rank, no score, no email. Results are released only after the exam ends.
export async function submitCbt(req, res) {
  const { name = "", email = "", sessionToken = "", answers = {}, timeTaken = 0 } = req.body || {};
  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  if (!cleanName) return res.status(400).json({ message: "Please enter your name." });
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ message: "Please enter a valid email address." });

  const test = await TestSeries.findOne({ cbtToken: req.params.token, cbtEnabled: true }).populate("questions");
  if (!test) return res.status(404).json({ message: "This exam link is invalid." });
  // The exam may have JUST ended while the candidate was finishing — accept a
  // submit within a short grace period so their work isn't lost, but block if
  // results are already released.
  if (test.cbtResultsReleased) return res.status(403).json({ message: "This exam's results are already released." });

  // Verified portal session gate.
  if (!(await findPortalSession(cleanEmail, sessionToken))) {
    return res.status(401).json({ message: "Your exam session is invalid. Please register on the portal again." });
  }
  // One attempt per student.
  if (await hasCompleted(test._id, cleanEmail)) {
    return res.status(409).json({ alreadyCompleted: true, message: "You have already submitted this exam." });
  }

  const g = gradeSubmission(test, answers);
  const resultToken = crypto.randomBytes(16).toString("hex");
  try {
    await CbtAttempt.create({
      testSeries: test._id,
      name: cleanName,
      email: cleanEmail,
      total: g.total, attempted: g.attempted, correct: g.correct, incorrect: g.incorrect,
      skipped: g.skipped, score: g.score, maxScore: g.maxScore, percentage: g.percentage,
      timeTaken: Number(timeTaken) || 0,
      review: g.review,
      resultToken,
      resultBase: frontendOriginFromReq(req), // for correct emailed links later
    });
  } catch (e) {
    return res.status(500).json({ message: "Could not save your attempt. Please try again." });
  }
  await TestSeries.findByIdAndUpdate(test._id, { $inc: { attempts: 1 } });

  // Deferred: acknowledge only — no score, rank, or review is returned.
  res.status(201).json({
    recorded: true,
    resultToken,
    resultsReleased: false,
    endAt: test.cbtEndAt || null,
    examName: test.name,
    emailConfigured: isMailConfigured(),
  });
}

// GET /api/cbt/result/:resultToken — the student's result. Until the exam's
// results are released this returns a "pending" payload (no score/rank/answers);
// afterwards it returns the full graded breakdown + live rank.
export async function getCbtResult(req, res) {
  const attempt = await CbtAttempt.findOne({ resultToken: req.params.resultToken }).lean();
  if (!attempt) return res.status(404).json({ message: "This result link is invalid or has expired." });
  let test = await TestSeries.findById(attempt.testSeries).select("name marks cbtEndAt cbtResultMode cbtResultAt cbtResultsReleased").lean();

  // If results are now due (auto: end reached · manual: scheduled timer reached)
  // but the sweep hasn't run yet, release now so results declare the moment a
  // candidate checks (and everyone gets emailed).
  if (test && resultDue(test)) {
    await releaseOneCbtExam(test).catch(() => {});
    test = await TestSeries.findById(attempt.testSeries).select("name marks cbtEndAt cbtResultMode cbtResultAt cbtResultsReleased").lean();
  }

  // Not released yet → keep everything hidden. Tell the candidate WHEN results
  // are expected: the scheduled result timer (manual) or the exam end (auto).
  if (!test?.cbtResultsReleased) {
    const declareAt = test?.cbtResultMode === "manual" ? (test?.cbtResultAt || null) : (test?.cbtEndAt || null);
    return res.json({
      pending: true,
      examName: test?.name || "Exam",
      name: attempt.name,
      email: attempt.email,
      endAt: test?.cbtEndAt || null,
      declareAt, // when results are expected (null = admin declares manually)
      submittedAt: attempt.createdAt,
    });
  }

  // Released → recompute live rank across all candidates.
  let rank = attempt.rankAtSubmit || null, candidates = attempt.candidatesAtSubmit || null;
  try {
    const all = await CbtAttempt.find({ testSeries: attempt.testSeries }).select("email score timeTaken").lean();
    const board = rankBestPerStudent(all);
    candidates = board.length;
    const mine = board.find((r) => (r.email || "").toLowerCase() === (attempt.email || "").toLowerCase());
    if (mine) rank = mine.rank;
  } catch { /* fall back to stored snapshot */ }

  res.json({
    pending: false,
    examName: test?.name || "Exam",
    name: attempt.name,
    email: attempt.email,
    submittedAt: attempt.createdAt,
    rank,
    candidates,
    total: attempt.total,
    attempted: attempt.attempted,
    skipped: attempt.skipped,
    correct: attempt.correct,
    incorrect: attempt.incorrect,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percentage: attempt.percentage,
    timeTaken: attempt.timeTaken,
    review: attempt.review || [],
  });
}

/* ============= student dashboard (session-gated public) ============= */

// Partially hide an email for public leaderboards: jo***@gmail.com
function maskEmail(e) {
  const [u, d] = String(e || "").split("@");
  if (!d) return e || "";
  const head = u.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, u.length - head.length))}@${d}`;
}

// GET /api/cbt/my?email=&session= — the logged-in student's completed exams,
// with score & rank once each exam's results are released.
export async function myCbtResults(req, res) {
  const email = String(req.query.email || "").trim().toLowerCase();
  const sessionToken = String(req.query.session || "");
  if (!(await findPortalSession(email, sessionToken))) return res.status(401).json({ message: "Please sign in again." });

  const attempts = await CbtAttempt.find({ email }).sort("-createdAt").lean();
  const testIds = [...new Set(attempts.map((a) => String(a.testSeries)))];
  const tests = await TestSeries.find({ _id: { $in: testIds } }).select("name cbtResultsReleased cbtEndAt").lean();
  const tmap = new Map(tests.map((t) => [String(t._id), t]));

  const out = [];
  for (const a of attempts) {
    const t = tmap.get(String(a.testSeries));
    const released = !!t?.cbtResultsReleased;
    let rank = null, candidates = null;
    if (released) {
      // eslint-disable-next-line no-await-in-loop
      const all = await CbtAttempt.find({ testSeries: a.testSeries }).select("email score timeTaken").lean();
      const board = rankBestPerStudent(all);
      candidates = board.length;
      rank = board.find((r) => (r.email || "").toLowerCase() === email)?.rank || null;
    }
    out.push({
      examName: t?.name || "Exam",
      released,
      endAt: t?.cbtEndAt || null,
      resultToken: a.resultToken,
      submittedAt: a.createdAt,
      score: released ? a.score : null,
      maxScore: released ? a.maxScore : null,
      percentage: released ? a.percentage : null,
      rank, candidates,
    });
  }
  res.json(out);
}

// GET /api/cbt/rankings?email=&session= — exams whose results are released
// (for the Rankings tab). Session-gated.
export async function listReleasedRankings(req, res) {
  const email = String(req.query.email || "").trim().toLowerCase();
  const sessionToken = String(req.query.session || "");
  if (!(await findPortalSession(email, sessionToken))) return res.status(401).json({ message: "Please sign in again." });

  const tests = await TestSeries.find({ cbtEnabled: true, cbtResultsReleased: true }).select("name cbtToken").sort("-updatedAt").lean();
  const ids = tests.map((t) => t._id);
  const attempts = await CbtAttempt.find({ testSeries: { $in: ids } }).select("testSeries email").lean();
  const byTest = new Map();
  for (const a of attempts) {
    const k = String(a.testSeries);
    if (!byTest.has(k)) byTest.set(k, new Set());
    byTest.get(k).add((a.email || "").toLowerCase());
  }
  res.json(tests.map((t) => ({ name: t.name, token: t.cbtToken, candidates: byTest.get(String(t._id))?.size || 0 })));
}

// GET /api/cbt/rankings/:token?email=&session= — full leaderboard for a
// released exam (names shown, emails masked). Session-gated.
export async function examRankings(req, res) {
  const email = String(req.query.email || "").trim().toLowerCase();
  const sessionToken = String(req.query.session || "");
  if (!(await findPortalSession(email, sessionToken))) return res.status(401).json({ message: "Please sign in again." });

  const test = await TestSeries.findOne({ cbtToken: req.params.token, cbtEnabled: true }).select("name cbtResultsReleased").lean();
  if (!test) return res.status(404).json({ message: "Exam not found." });
  if (!test.cbtResultsReleased) return res.status(403).json({ message: "Rankings will be available after the exam ends." });

  const all = await CbtAttempt.find({ testSeries: test._id }).select("name email score maxScore percentage correct total timeTaken createdAt").lean();
  const board = rankBestPerStudent(all);
  res.json({
    name: test.name,
    youEmail: email,
    rows: board.map((a) => ({
      rank: a.rank,
      name: a.name,
      email: maskEmail(a.email),
      isYou: (a.email || "").toLowerCase() === email,
      score: a.score,
      maxScore: a.maxScore,
      percentage: a.percentage,
      correct: a.correct,
      totalQ: a.total,
      timeTaken: a.timeTaken,
    })),
  });
}

/* ========================= admin endpoints ========================= */

// GET /api/cbt/admin/portal-url — the single shareable exam-portal link.
export async function getCbtPortalUrl(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  res.json({ url: portalUrl() });
}

// GET /api/cbt/admin/exams — every test added to the portal, with live/results
// state and stats (candidates, attempts, avg %, opens, last activity).
export async function listCbtExams(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  await releaseEndedCbtExams();
  const tests = await TestSeries.find({ cbtEnabled: true, owner: null })
    .populate("practiceStream", "name")
    .populate("practiceSubject", "name")
    .sort("-updatedAt")
    .lean();
  const ids = tests.map((t) => t._id);
  const attempts = await CbtAttempt.find({ testSeries: { $in: ids } })
    .select("testSeries email percentage score createdAt").lean();
  const byTest = new Map();
  for (const a of attempts) {
    const k = String(a.testSeries);
    if (!byTest.has(k)) byTest.set(k, []);
    byTest.get(k).push(a);
  }
  const now = Date.now();
  res.json(
    tests.map((t) => {
      const list = byTest.get(String(t._id)) || [];
      const students = new Set(list.map((a) => (a.email || "").toLowerCase()));
      const avg = list.length ? Math.round(list.reduce((s, a) => s + (a.percentage || 0), 0) / list.length) : null;
      const last = list.reduce((m, a) => (a.createdAt > m ? a.createdAt : m), null);
      const takingEnded = t.cbtEndAt && new Date(t.cbtEndAt).getTime() <= now;
      const ended = t.cbtResultsReleased || takingEnded;
      const scheduled = !ended && t.cbtStartAt && new Date(t.cbtStartAt).getTime() > now;
      // Manual-mode exams past their end but not yet released are "awaiting
      // result" (declared at the timer or by the button), not auto-"releasing".
      const status = t.cbtResultsReleased
        ? "released"
        : takingEnded ? (t.cbtResultMode === "manual" ? "awaiting_result" : "ended")
        : !t.cbtLive ? "off" : scheduled ? "scheduled" : "live";
      return {
        _id: t._id,
        name: t.name,
        cbtToken: t.cbtToken,
        cbtLive: !!t.cbtLive,
        cbtStartAt: t.cbtStartAt || null,
        cbtEntryCloseAt: t.cbtEntryCloseAt || null,
        cbtEndAt: t.cbtEndAt || null,
        cbtResultMode: t.cbtResultMode === "manual" ? "manual" : "auto",
        cbtResultAt: t.cbtResultAt || null,
        cbtRequireOtp: t.cbtRequireOtp !== false,
        cbtRestrictEntry: !!t.cbtRestrictEntry,
        cbtAllowedEmails: t.cbtAllowedEmails || [],
        cbtResultsReleased: !!t.cbtResultsReleased,
        status,
        questionCount: t.questions?.length || 0,
        duration: t.duration,
        marks: t.marks,
        context: [t.practiceStream?.name, t.practiceSubject?.name].filter(Boolean).join(" › "),
        opens: t.cbtViews || 0,
        candidates: students.size,
        attempts: list.length,
        avgPercentage: avg,
        lastAttemptAt: last,
      };
    })
  );
}

// GET /api/cbt/admin/candidates — the admin's "My Tests" that can be added to
// the portal (with whether each is already added), for the Add-test picker.
export async function listCbtCandidates(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  const tests = await TestSeries.find({ owner: null, practice: true, practiceKind: "test" })
    .populate("practiceStream", "name")
    .populate("practiceSubject", "name")
    .sort("-updatedAt")
    .lean();
  res.json(
    tests.map((t) => ({
      _id: t._id,
      name: t.name,
      questionCount: t.questions?.length || 0,
      duration: t.duration,
      marks: t.marks,
      // Grouping fields so the picker can drill down Stream → Subject → Test.
      stream: t.practiceStream ? { id: String(t.practiceStream._id), name: t.practiceStream.name } : null,
      subject: t.practiceSubject ? { id: String(t.practiceSubject._id), name: t.practiceSubject.name } : null,
      context: [t.practiceStream?.name, t.practiceSubject?.name].filter(Boolean).join(" › "),
      cbtEnabled: !!t.cbtEnabled,
    }))
  );
}

// GET /api/cbt/admin/registrations — every candidate who has registered on the
// portal, with how many exams they've completed. For the admin candidate list.
export async function listRegistrations(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  const regs = await CbtRegistration.find().select("name email verified createdAt updatedAt").sort("-updatedAt").limit(2000).lean();
  const counts = await CbtAttempt.aggregate([{ $group: { _id: "$email", n: { $sum: 1 } } }]);
  const byEmail = new Map(counts.map((c) => [String(c._id || "").toLowerCase(), c.n]));
  res.json(
    regs.map((r) => ({
      _id: r._id,
      name: r.name,
      email: r.email,
      verified: !!r.verified,
      examsTaken: byEmail.get((r.email || "").toLowerCase()) || 0,
      registeredAt: r.createdAt,
      lastActiveAt: r.updatedAt,
    }))
  );
}

// DELETE /api/cbt/admin/registrations/:id — remove a candidate's registration.
// Their exam results (CbtAttempt) are kept; they'd need to register again.
export async function deleteRegistration(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  await CbtRegistration.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}

// PATCH /api/cbt/admin/:id/add — add a My Test to the exam portal. Generates the
// token once (kept stable). Starts NOT live; the admin flips Live when ready.
export async function addCbtExam(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  const test = await TestSeries.findOne({ _id: req.params.id, owner: null });
  if (!test) return res.status(404).json({ message: "Test not found." });
  if (!test.questions?.length) return res.status(400).json({ message: "Add questions to this test before adding it to the exam page." });

  // (Re)add as a clean slate: clear any stale schedule/state left from a
  // previous run so the exam isn't instantly "ended" and can be made Live.
  test.cbtEnabled = true;
  test.cbtResultsReleased = false;
  test.cbtLive = false;
  test.cbtStartAt = null;
  test.cbtEndAt = null;
  test.cbtResultMode = "auto"; // fresh run defaults to automatic declaration at end
  test.cbtResultAt = null;
  test.cbtStartedEmails = []; // fresh run — clear any "in progress" state from a previous one
  if (!test.cbtToken) test.cbtToken = crypto.randomBytes(12).toString("hex");
  await test.save();
  res.json({ cbtEnabled: true, cbtToken: test.cbtToken, cbtLive: test.cbtLive });
}

// PATCH /api/cbt/admin/:id/update — set the Live toggle and/or the exam end time.
// Body: { live?, endAt? }. endAt "" / null clears it (manual release only).
export async function updateCbtExam(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  const test = await TestSeries.findOne({ _id: req.params.id, owner: null, cbtEnabled: true });
  if (!test) return res.status(404).json({ message: "Exam not found on the portal." });
  if (test.cbtResultsReleased) return res.status(400).json({ message: "Results are already released for this exam." });

  const body = req.body || {};
  if ("live" in body) test.cbtLive = !!body.live;
  if ("requireOtp" in body) test.cbtRequireOtp = !!body.requireOtp;
  if ("restrictEntry" in body) test.cbtRestrictEntry = !!body.restrictEntry;
  if ("allowedEmails" in body) {
    // Accept an array or a comma/newline-separated string; keep valid, unique, lowercased.
    const raw = Array.isArray(body.allowedEmails) ? body.allowedEmails : String(body.allowedEmails || "").split(/[\s,;]+/);
    const cleaned = [...new Set(raw.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
    test.cbtAllowedEmails = cleaned;
  }
  if ("startAt" in body) {
    if (!body.startAt) {
      test.cbtStartAt = null;
    } else {
      const d = new Date(body.startAt);
      if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid start date/time." });
      test.cbtStartAt = d;
    }
  }
  if ("entryCloseAt" in body) {
    if (!body.entryCloseAt) {
      test.cbtEntryCloseAt = null;
    } else {
      const d = new Date(body.entryCloseAt);
      if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid late-entry date/time." });
      test.cbtEntryCloseAt = d;
    }
  }
  if ("endAt" in body) {
    if (!body.endAt) {
      test.cbtEndAt = null;
    } else {
      const d = new Date(body.endAt);
      if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid end date/time." });
      test.cbtEndAt = d;
    }
  }
  // Result declaration: mode toggle + optional scheduled "declare results" timer.
  if ("resultMode" in body) test.cbtResultMode = body.resultMode === "manual" ? "manual" : "auto";
  if ("resultAt" in body) {
    if (!body.resultAt) {
      test.cbtResultAt = null;
    } else {
      const d = new Date(body.resultAt);
      if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid result-declaration date/time." });
      test.cbtResultAt = d;
    }
  }
  if (test.cbtStartAt && test.cbtEndAt && test.cbtEndAt.getTime() <= test.cbtStartAt.getTime()) {
    return res.status(400).json({ message: "The end time must be after the start time." });
  }
  if (test.cbtEntryCloseAt && test.cbtEndAt && test.cbtEntryCloseAt.getTime() > test.cbtEndAt.getTime()) {
    return res.status(400).json({ message: "Late-entry cutoff must be at or before the end time." });
  }
  // A scheduled result time can't be BEFORE the exam ends (you can't declare
  // results while candidates are still taking the exam).
  if (test.cbtResultMode === "manual" && test.cbtResultAt && test.cbtEndAt && test.cbtResultAt.getTime() < test.cbtEndAt.getTime()) {
    return res.status(400).json({ message: "The result-declaration time must be at or after the exam end time." });
  }
  await test.save();
  res.json({ cbtLive: test.cbtLive, cbtStartAt: test.cbtStartAt, cbtEntryCloseAt: test.cbtEntryCloseAt, cbtEndAt: test.cbtEndAt, cbtResultMode: test.cbtResultMode, cbtResultAt: test.cbtResultAt, cbtRequireOtp: test.cbtRequireOtp, cbtRestrictEntry: test.cbtRestrictEntry, cbtAllowedEmails: test.cbtAllowedEmails, cbtResultsReleased: test.cbtResultsReleased });
}

// PATCH /api/cbt/admin/:id/release — end the exam NOW and release results:
// finalise ranks and email every candidate their scorecard.
export async function releaseCbtResults(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  const test = await TestSeries.findOne({ _id: req.params.id, owner: null, cbtEnabled: true });
  if (!test) return res.status(404).json({ message: "Exam not found on the portal." });
  if (test.cbtResultsReleased) return res.json({ cbtResultsReleased: true, alreadyReleased: true });
  await releaseOneCbtExam(test);
  res.json({ cbtResultsReleased: true, emailConfigured: isMailConfigured() });
}

// PATCH /api/cbt/admin/:id/remove — take an exam off the portal (link stops
// working; stored attempts/rankings are kept).
export async function removeCbtExam(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  const test = await TestSeries.findOne({ _id: req.params.id, owner: null });
  if (!test) return res.status(404).json({ message: "Test not found." });
  test.cbtEnabled = false;
  test.cbtLive = false;
  await test.save();
  res.json({ cbtEnabled: false });
}

// GET /api/cbt/admin/:id/leaderboard — all candidates ranked (best attempt per
// student). The admin can view this any time, even before results are released.
export async function cbtLeaderboard(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  const test = await TestSeries.findOne({ _id: req.params.id, owner: null }).select("name marks cbtResultsReleased").lean();
  if (!test) return res.status(404).json({ message: "Test not found." });
  const all = await CbtAttempt.find({ testSeries: req.params.id })
    .select("name email score maxScore percentage correct incorrect attempted total timeTaken createdAt").lean();
  const board = rankBestPerStudent(all);
  res.json({
    name: test.name,
    resultsReleased: !!test.cbtResultsReleased,
    totalAttempts: all.length,
    candidates: board.length,
    rows: board.map((a) => ({
      rank: a.rank,
      name: a.name,
      email: a.email,
      score: a.score,
      maxScore: a.maxScore,
      percentage: a.percentage,
      correct: a.correct,
      incorrect: a.incorrect,
      attempted: a.attempted,
      totalQ: a.total,
      timeTaken: a.timeTaken,
      at: a.createdAt,
    })),
  });
}

// GET /api/cbt/admin/:id/students — status of every candidate who has JOINED
// this exam: completed (with score), in progress (started, not submitted), or
// granted late-entry access but not started yet. Used by the admin's per-exam
// "Students" view.
export async function listCbtStudents(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  const test = await TestSeries.findOne({ _id: req.params.id, owner: null })
    .select("name marks cbtResultsReleased cbtRestrictEntry cbtAllowedEmails cbtStartedEmails cbtEntryCloseAt").lean();
  if (!test) return res.status(404).json({ message: "Test not found." });

  const attempts = await CbtAttempt.find({ testSeries: test._id })
    .select("name email score maxScore percentage correct incorrect total timeTaken createdAt").lean();
  const board = rankBestPerStudent(attempts); // best attempt per student, ranked

  const completedEmails = new Set(board.map((a) => (a.email || "").toLowerCase()));
  const startedEmails = (test.cbtStartedEmails || []).map((e) => e.toLowerCase());
  const startedSet = new Set(startedEmails);
  const allowedEmails = (test.cbtAllowedEmails || []).map((e) => e.toLowerCase());
  const allowedSet = new Set(allowedEmails);

  // Resolve names for started/allowed candidates who haven't completed (their
  // name isn't in an attempt). Portal registrations hold name + email.
  const needNames = [...new Set([...startedEmails, ...allowedEmails])].filter((e) => !completedEmails.has(e));
  const regs = needNames.length
    ? await CbtRegistration.find({ email: { $in: needNames } }).select("name email").lean()
    : [];
  const nameByEmail = new Map(regs.map((r) => [(r.email || "").toLowerCase(), r.name]));

  const rows = [];
  // 1) Completed — from the ranked best-per-student board.
  for (const a of board) {
    const email = (a.email || "").toLowerCase();
    rows.push({
      email,
      name: a.name || nameByEmail.get(email) || "—",
      status: "completed",
      lateEntryAccess: allowedSet.has(email),
      rank: a.rank,
      score: a.score,
      maxScore: a.maxScore,
      percentage: a.percentage,
      correct: a.correct,
      totalQ: a.total,
      timeTaken: a.timeTaken,
      submittedAt: a.createdAt,
    });
  }
  // 2) In progress — started but not yet submitted.
  for (const email of startedEmails) {
    if (completedEmails.has(email)) continue;
    rows.push({ email, name: nameByEmail.get(email) || "—", status: "in_progress", lateEntryAccess: allowedSet.has(email) });
  }
  // 3) Granted late-entry access but not started (and not completed).
  for (const email of allowedEmails) {
    if (completedEmails.has(email) || startedSet.has(email)) continue;
    rows.push({ email, name: nameByEmail.get(email) || "—", status: "not_started", lateEntryAccess: true });
  }

  res.json({
    name: test.name,
    resultsReleased: !!test.cbtResultsReleased,
    restrictEntry: !!test.cbtRestrictEntry,
    entryCloseAt: test.cbtEntryCloseAt || null,
    counts: {
      total: rows.length,
      completed: board.length,
      inProgress: rows.filter((r) => r.status === "in_progress").length,
      notStarted: rows.filter((r) => r.status === "not_started").length,
    },
    rows,
  });
}

// PATCH /api/cbt/admin/:id/late-entry — grant or revoke ONE candidate's
// late-entry access by adding/removing their email on the allowlist. Body
// { email, allow }. Does NOT change the private "restrict" mode. Granting lets
// that student START the exam even after the late-entry cutoff.
export async function setLateEntryAccess(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ message: "Admins only." });
  const { email = "", allow = true } = req.body || {};
  const clean = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) return res.status(400).json({ message: "Enter a valid email address." });
  const test = await TestSeries.findOne({ _id: req.params.id, owner: null, cbtEnabled: true });
  if (!test) return res.status(404).json({ message: "Exam not found on the portal." });

  await TestSeries.updateOne(
    { _id: test._id },
    allow ? { $addToSet: { cbtAllowedEmails: clean } } : { $pull: { cbtAllowedEmails: clean } }
  );
  const updated = await TestSeries.findById(test._id).select("cbtAllowedEmails cbtRestrictEntry").lean();
  res.json({ email: clean, allow: !!allow, cbtAllowedEmails: updated.cbtAllowedEmails, cbtRestrictEntry: !!updated.cbtRestrictEntry });
}

/* ===================== result email (HTML) ===================== */

// Build a self-contained HTML result email: score + rank summary, then a
// question-by-question breakdown (each option marked correct / the student's
// choice) with explanations, plus a link to the fully-rendered printable page.
function buildResultEmailHtml({ attempt, test, rank, candidates, resultToken }) {
  const review = attempt.review || [];
  const link = resultUrlFor(resultToken, attempt.resultBase);
  const pct = attempt.percentage;

  const rows = review
    .map((r, i) => {
      const opts = (r.options || [])
        .map((opt, idx) => {
          const isCorrect = idx === r.correct;
          const isChosen = idx === r.chosen;
          const tag = isCorrect ? " ✓ correct" : isChosen ? " ✗ your answer" : "";
          const color = isCorrect ? "#047857" : isChosen ? "#be123c" : "#475569";
          const weight = isCorrect || isChosen ? "600" : "400";
          return `<div style="color:${color};font-weight:${weight};margin:2px 0">${esc(optLetter(idx))}. ${esc(opt)}${tag}</div>`;
        })
        .join("");
      const status = r.chosen == null ? "Skipped" : r.isCorrect ? "Correct" : "Wrong";
      const statusColor = r.chosen == null ? "#b45309" : r.isCorrect ? "#047857" : "#be123c";
      const expl = r.explanation
        ? `<div style="margin-top:6px;padding:8px;background:#eff6ff;border-radius:6px;font-size:13px"><b>Explanation:</b> ${esc(r.explanation)}</div>`
        : "";
      return `
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:10px 0">
          <div style="display:flex;justify-content:space-between">
            <b style="font-size:14px">Q${i + 1}. ${esc(r.text)}</b>
          </div>
          <div style="font-size:12px;color:${statusColor};font-weight:700;margin:4px 0">${status}</div>
          <div style="font-size:13px">${opts}</div>
          ${expl}
        </div>`;
    })
    .join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;color:#0f172a">
    <h2 style="margin:0 0 4px">${esc(test.name)} — Your Result</h2>
    <p style="margin:0 0 12px;color:#475569">Hi ${esc(attempt.name)}, the exam is over — here is your full result &amp; rank.</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#4f46e5">${attempt.score}/${attempt.maxScore ?? test.marks}</div>
          <div style="font-size:12px;color:#64748b">Score</div>
        </td>
        <td style="width:8px"></td>
        <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#4f46e5">${pct}%</div>
          <div style="font-size:12px;color:#64748b">Percentage</div>
        </td>
        <td style="width:8px"></td>
        <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#b45309">#${rank}${candidates ? ` / ${candidates}` : ""}</div>
          <div style="font-size:12px;color:#64748b">Rank</div>
        </td>
      </tr>
    </table>

    <p style="font-size:13px;color:#475569">
      Correct: <b>${attempt.correct}</b> · Wrong: <b>${attempt.incorrect}</b> · Skipped: <b>${attempt.skipped}</b> · Attempted: <b>${attempt.attempted}</b>/${attempt.total}
    </p>

    <p style="margin:14px 0">
      <a href="${esc(link)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700">
        View &amp; download full result (PDF)
      </a>
    </p>
    <p style="font-size:12px;color:#64748b">Tip: open the link above and use your browser's “Print → Save as PDF” for a clean copy with proper maths/diagrams.</p>

    <h3 style="margin:18px 0 6px">Answers &amp; explanations</h3>
    ${rows}

    <p style="font-size:11px;color:#94a3b8;margin-top:18px">This scorecard was sent because the exam has ended and results were released.</p>
  </div>`;
}

async function emailCbtResult({ attempt, test, rank, candidates, resultToken }) {
  if (!isMailConfigured()) return;
  const html = buildResultEmailHtml({ attempt, test, rank, candidates, resultToken });
  const text =
    `${test.name} — Your Result\n\n` +
    `Score: ${attempt.score}/${attempt.maxScore ?? test.marks} (${attempt.percentage}%)\n` +
    `Rank: #${rank}${candidates ? ` of ${candidates}` : ""}\n` +
    `Correct ${attempt.correct} · Wrong ${attempt.incorrect} · Skipped ${attempt.skipped}\n\n` +
    `View & download your full result: ${resultUrlFor(resultToken, attempt.resultBase)}`;
  const ok = await sendMail({
    to: attempt.email,
    subject: `Your result — ${test.name} (Rank #${rank}${candidates ? `/${candidates}` : ""})`,
    text,
    html,
  });
  if (ok) CbtAttempt.updateOne({ _id: attempt._id }, { $set: { emailed: true } }).catch(() => {});
}
