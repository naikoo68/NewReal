import Stream from "../models/Stream.js";
import Subject from "../models/Subject.js";
import Topic from "../models/Topic.js";
import Session from "../models/Session.js";
import Quiz from "../models/Quiz.js";
import Question from "../models/Question.js";
import TestSeries from "../models/TestSeries.js";
import { notifyNewContent } from "../utils/notify.js";
import { ownerValue, ownerFilter, isClient } from "../utils/ownership.js";
import { duplicateQuestions } from "../utils/duplicateQuestions.js";
import { byNatural } from "../utils/naturalSort.js";
import { NOT_DELETED, softDeletePatch } from "../utils/softDelete.js";

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ---------------- Streams (top level) ---------------- */

// GET /api/streams — includes subject count per stream
export async function listStreams(req, res) {
  const streams = await Stream.find({ isActive: true, ...NOT_DELETED }).sort("order name").lean();
  const subs = await Subject.aggregate([
    { $match: { stream: { $ne: null }, deleted: { $ne: true } } },
    { $group: { _id: "$stream", count: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(subs.map((s) => [String(s._id), s.count]));
  res.json(streams.map((s) => ({ ...s, subjects: map[String(s._id)] || 0 })));
}

export async function createStream(req, res) {
  const { name } = req.body;
  const stream = await Stream.create({ ...req.body, slug: slugify(name) });
  res.status(201).json(stream);
}

export async function updateStream(req, res) {
  const data = { ...req.body };
  if (data.name) data.slug = slugify(data.name);
  const stream = await Stream.findByIdAndUpdate(req.params.id, data, { new: true });
  if (!stream) return res.status(404).json({ message: "Stream not found" });
  res.json(stream);
}

// Soft delete (Recycle Bin): flag the stream as deleted. Its subjects/topics/
// sessions/quizzes/questions are left intact but become unreachable (you reach
// them only by navigating into the now-hidden stream), so restoring the stream
// brings its whole tree back. A permanent delete from the Recycle Bin does the
// real cascade removal.
export async function deleteStream(req, res) {
  const stream = await Stream.findByIdAndUpdate(req.params.id, softDeletePatch(), { new: true });
  if (!stream) return res.status(404).json({ message: "Stream not found" });
  res.json({ message: "Stream moved to Recycle Bin", softDeleted: true });
}

// GET /api/streams/:streamId/subjects — subjects in a stream, with topic counts
export async function listStreamSubjects(req, res) {
  const subjects = await Subject.find({ stream: req.params.streamId, isActive: true, ...NOT_DELETED }).sort("name").lean();
  const topics = await Topic.aggregate([{ $match: { deleted: { $ne: true } } }, { $group: { _id: "$subject", count: { $sum: 1 } } }]);
  const tMap = Object.fromEntries(topics.map((t) => [String(t._id), t.count]));
  res.json(subjects.map((s) => ({ ...s, topics: tMap[String(s._id)] || 0 })));
}

async function countMap(Model, matchIds, field) {
  const rows = await Model.aggregate([
    { $match: { [field]: { $in: matchIds }, deleted: { $ne: true } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
}

/* ---------------- Subjects ---------------- */

// GET /api/subjects — includes topic count per subject
export async function listSubjects(req, res) {
  const subjects = await Subject.find({ isActive: true, ...NOT_DELETED }).sort("name").lean();
  const topics = await Topic.aggregate([{ $match: { deleted: { $ne: true } } }, { $group: { _id: "$subject", count: { $sum: 1 } } }]);
  const tMap = Object.fromEntries(topics.map((t) => [String(t._id), t.count]));
  res.json(subjects.map((s) => ({ ...s, topics: tMap[String(s._id)] || 0 })));
}

export async function createSubject(req, res) {
  const { name } = req.body;
  const subject = await Subject.create({ ...req.body, slug: slugify(name) });
  res.status(201).json(subject);
}

export async function updateSubject(req, res) {
  const data = { ...req.body };
  if (data.name) data.slug = slugify(data.name);
  const subject = await Subject.findByIdAndUpdate(req.params.id, data, { new: true });
  if (!subject) return res.status(404).json({ message: "Subject not found" });
  res.json(subject);
}

// Soft delete (Recycle Bin): flag the subject; its tree is kept and restored
// with it. Permanent removal happens from the Recycle Bin.
export async function deleteSubject(req, res) {
  const subject = await Subject.findByIdAndUpdate(req.params.id, softDeletePatch(), { new: true });
  if (!subject) return res.status(404).json({ message: "Subject not found" });
  res.json({ message: "Subject moved to Recycle Bin", softDeleted: true });
}

/* ---------------- Topics ---------------- */

// GET /api/subjects/:subjectId/topics — includes session count per topic
export async function listTopics(req, res) {
  const topics = await Topic.find({ subject: req.params.subjectId, ...NOT_DELETED }).sort("index createdAt").lean();
  const sMap = await countMap(Session, topics.map((t) => t._id), "topic");
  res.json(topics.map((t) => ({ ...t, sessions: sMap[String(t._id)] || 0 })));
}

export async function createTopic(req, res) {
  // Append at the end: index = current number of topics in this subject.
  const index = req.body.index ?? (await Topic.countDocuments({ subject: req.body.subject }));
  const topic = await Topic.create({ ...req.body, index });
  res.status(201).json(topic);
}

export async function updateTopic(req, res) {
  const topic = await Topic.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!topic) return res.status(404).json({ message: "Topic not found" });
  res.json(topic);
}

// Soft delete (Recycle Bin): flag the topic; its sessions/quizzes/questions are
// kept and restored with it. Permanent removal happens from the Recycle Bin.
export async function deleteTopic(req, res) {
  const topic = await Topic.findByIdAndUpdate(req.params.id, softDeletePatch(), { new: true });
  if (!topic) return res.status(404).json({ message: "Topic not found" });
  res.json({ message: "Topic moved to Recycle Bin", softDeleted: true });
}

/* ---------------- Sessions ---------------- */

// GET /api/topics/:topicId/sessions — includes quiz count per session
export async function listSessions(req, res) {
  const sessions = await Session.find({ topic: req.params.topicId, ...NOT_DELETED }).sort("index createdAt").lean();
  const qMap = await countMap(Quiz, sessions.map((s) => s._id), "session");
  res.json(sessions.map((s) => ({ ...s, quizzes: qMap[String(s._id)] || 0 })));
}

export async function createSession(req, res) {
  const index = req.body.index ?? (await Session.countDocuments({ topic: req.body.topic }));
  const session = await Session.create({ ...req.body, index });
  res.status(201).json(session);
}

export async function updateSession(req, res) {
  const session = await Session.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(session);
}

// Soft delete (Recycle Bin): flag the session; its quizzes/questions are kept
// and restored with it. Permanent removal happens from the Recycle Bin.
export async function deleteSession(req, res) {
  const session = await Session.findByIdAndUpdate(req.params.id, softDeletePatch(), { new: true });
  if (!session) return res.status(404).json({ message: "Session not found" });
  res.json({ message: "Session moved to Recycle Bin", softDeleted: true });
}

/* ---------------- Quizzes (within a session) ---------------- */

// GET /api/sessions/:sessionId/quizzes — includes question count per quiz.
// Ordered by title in NATURAL order (Quiz 1, Quiz 2, … Quiz 9, Quiz 10) instead
// of creation order, so numbered quizzes read in the expected sequence.
export async function listQuizzes(req, res) {
  const quizzes = (await Quiz.find({ session: req.params.sessionId, ...NOT_DELETED }).lean()).sort(byNatural("title"));
  const qMap = await countMap(Question, quizzes.map((q) => q._id), "quiz");
  res.json(quizzes.map((q) => ({ ...q, questions: qMap[String(q._id)] || 0 })));
}

export async function createQuiz(req, res) {
  // Append at the end so Quiz 1 stays before Quiz 2, etc.
  const index = req.body.index ?? (await Quiz.countDocuments({ session: req.body.session }));
  const quiz = await Quiz.create({ ...req.body, index });
  notifyNewContent("quiz", quiz); // fire-and-forget (respects admin toggle)
  res.status(201).json(quiz);
}

export async function updateQuiz(req, res) {
  const quiz = await Quiz.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });
  res.json(quiz);
}

// Soft delete (Recycle Bin): flag the quiz; its questions are kept and restored
// with it. Permanent removal happens from the Recycle Bin.
export async function deleteQuiz(req, res) {
  const quiz = await Quiz.findByIdAndUpdate(req.params.id, softDeletePatch(), { new: true });
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });
  res.json({ message: "Quiz moved to Recycle Bin", softDeleted: true });
}

// PATCH /api/quizzes/:id/move  { session } — move a quiz to another session
// (internal migration). Its questions follow to the new session/subject.
export async function moveQuiz(req, res) {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });
  const session = await Session.findById(req.body.session);
  if (!session) return res.status(400).json({ message: "Choose a target session." });

  if (req.body.copy) {
    const index = await Quiz.countDocuments({ session: session._id });
    const newQuiz = await Quiz.create({ title: `${quiz.title} (copy)`, subject: session.subject, session: session._id, index });
    await duplicateQuestions({ quiz: quiz._id }, { quiz: newQuiz._id, subject: session.subject, session: session._id });
    return res.json({ message: "Copied", _id: newQuiz._id });
  }

  quiz.session = session._id;
  quiz.subject = session.subject;
  await quiz.save();
  // Association-only move — don't bump the questions' updatedAt (their content isn't changing), so the "Updated" stamp keeps meaning "content was edited".
  await Question.updateMany({ quiz: quiz._id }, { $set: { session: session._id, subject: session.subject } }, { timestamps: false });
  res.json({ message: "Migrated", _id: quiz._id });
}

// POST /api/quizzes/:id/split  { perQuiz }
// Split ONE quiz's questions into multiple quizzes of `perQuiz` each. The
// original quiz keeps the first chunk (renamed "Quiz 1"); the rest go into new
// quizzes "Quiz 2", "Quiz 3", … under the same session. e.g. 300 questions at
// 50/quiz → Quiz 1..Quiz 6.
export async function splitQuiz(req, res) {
  const per = Math.max(1, Math.min(500, parseInt(req.body?.perQuiz, 10) || 50));
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });

  const questions = await Question.find({ quiz: quiz._id }).sort("createdAt _id").select("_id").lean();
  const total = questions.length;
  if (total <= per) {
    return res.json({ message: `No split needed — this quiz has ${total} question(s) (≤ ${per}).`, quizzes: 1, created: 0 });
  }

  // Chunk the question ids into groups of `per`.
  const chunks = [];
  for (let i = 0; i < total; i += per) chunks.push(questions.slice(i, i + per).map((q) => q._id));

  // Keep the original quiz's OWN title and its first chunk (no move needed).
  // Name the NEW chunks "Quiz N" continuing AFTER the highest existing quiz
  // number in this session, so splitting e.g. "Quiz 2" (with a "Quiz 1" already
  // present) yields Quiz 3, Quiz 4, … instead of restarting at "Quiz 1" and
  // clobbering the existing one.
  const siblings = await Quiz.find({ session: quiz.session }).select("title").lean();
  const usedNums = new Set();
  let maxNum = 0;
  for (const s of siblings) {
    const m = String(s.title || "").match(/\bQuiz\s+(\d+)\b/i);
    if (m) { const n = parseInt(m[1], 10); usedNums.add(n); if (n > maxNum) maxNum = n; }
  }
  let nextNum = maxNum + 1;
  const nextQuizTitle = () => { while (usedNums.has(nextNum)) nextNum++; usedNums.add(nextNum); return `Quiz ${nextNum++}`; };

  // New quizzes for the remaining chunks, appended after existing quizzes.
  let index = await Quiz.countDocuments({ session: quiz.session });
  for (let k = 1; k < chunks.length; k++) {
    const newQuiz = await Quiz.create({ title: nextQuizTitle(), subject: quiz.subject, session: quiz.session, index: index++ });
    await Question.updateMany({ _id: { $in: chunks[k] } }, { $set: { quiz: newQuiz._id, session: quiz.session, subject: quiz.subject } }, { timestamps: false }); // split = association only, keep updatedAt
  }
  res.json({ message: `Split ${total} questions into ${chunks.length} quizzes.`, quizzes: chunks.length, created: chunks.length - 1 });
}

// POST /api/quizzes/:id/merge  { sourceIds: [] }
// Merge other quizzes' questions INTO this quiz (the inverse of split). Every
// question from each source quiz is moved into the target quiz; the emptied
// source quizzes are then deleted. Sources must be in the SAME session.
export async function mergeQuiz(req, res) {
  const target = await Quiz.findById(req.params.id);
  if (!target) return res.status(404).json({ message: "Quiz not found" });
  const ids = (Array.isArray(req.body?.sourceIds) ? req.body.sourceIds : [])
    .map(String)
    .filter((s) => s && s !== String(target._id));
  if (!ids.length) return res.status(400).json({ message: "Pick at least one other quiz to merge in." });

  const sources = await Quiz.find({ _id: { $in: ids }, session: target.session });
  if (!sources.length) return res.status(404).json({ message: "No matching quizzes to merge (they must be in the same session)." });

  let moved = 0;
  for (const src of sources) {
    const r = await Question.updateMany(
      { quiz: src._id },
      { $set: { quiz: target._id, session: target.session, subject: target.subject } },
      { timestamps: false } // merge = association only, don't bump questions' updatedAt
    );
    moved += r.modifiedCount || 0;
    await Quiz.deleteOne({ _id: src._id });
  }
  const total = await Question.countDocuments({ quiz: target._id });
  res.json({
    message: `Merged ${sources.length} quiz(zes) (${moved} questions) into "${target.title}". It now has ${total} question(s).`,
    merged: sources.length,
    moved,
    total,
  });
}

// POST /api/topics/:id/split  { perQuiz }
// Split ALL questions in a topic (across its sessions/quizzes) into quizzes of
// `perQuiz` each, named "Quiz 1".."Quiz N", under a single session in the topic.
// Now-empty quizzes and sessions are cleaned up. e.g. 200 questions at 50/quiz
// → Quiz 1..Quiz 4.
export async function splitTopic(req, res) {
  const per = Math.max(1, Math.min(500, parseInt(req.body?.perQuiz, 10) || 50));
  const topic = await Topic.findById(req.params.id);
  if (!topic) return res.status(404).json({ message: "Topic not found" });

  const sessions = await Session.find({ topic: topic._id }).sort("index createdAt");
  const sessionIds = sessions.map((s) => s._id);
  if (!sessionIds.length) return res.json({ message: "This topic has no sessions/questions yet.", quizzes: 0, created: 0 });

  const questions = await Question.find({ session: { $in: sessionIds } }).sort("createdAt _id").select("_id").lean();
  const total = questions.length;
  if (!total) return res.json({ message: "This topic has no questions yet.", quizzes: 0, created: 0 });

  // Target session: reuse the first session (keeps the topic tidy), rest are removed.
  const targetSession = sessions[0];

  const chunks = [];
  for (let i = 0; i < total; i += per) chunks.push(questions.slice(i, i + per).map((q) => q._id));

  // Remove the topic's existing quizzes (questions are reassigned below, not deleted).
  await Quiz.deleteMany({ session: { $in: sessionIds } });

  // Create Quiz 1..N under the target session and move each chunk's questions in.
  for (let k = 0; k < chunks.length; k++) {
    const newQuiz = await Quiz.create({ title: `Quiz ${k + 1}`, subject: targetSession.subject, session: targetSession._id, index: k });
    await Question.updateMany(
      { _id: { $in: chunks[k] } },
      { $set: { quiz: newQuiz._id, session: targetSession._id, subject: targetSession.subject } },
      { timestamps: false } // split = association only, don't bump questions' updatedAt
    );
  }

  // Drop the now-empty extra sessions (all questions live under targetSession now).
  const extraSessionIds = sessionIds.filter((id) => String(id) !== String(targetSession._id));
  if (extraSessionIds.length) await Session.deleteMany({ _id: { $in: extraSessionIds } });

  res.json({ message: `Split ${total} questions into ${chunks.length} quizzes.`, quizzes: chunks.length, created: chunks.length });
}

// GET /api/quizzes/:quizId/questions — practice questions (with answers)
export async function listQuizQuestions(req, res) {
  // Block students whose quiz access was disabled by an admin.
  if (req.user && req.user.role !== "admin" && req.user.quizAccess === false) {
    return res.status(403).json({ message: "Quiz access has been disabled for your account." });
  }
  const isAdmin = req.user?.role === "admin";
  const questions = await Question.find({
    quiz: req.params.quizId,
    ...NOT_DELETED,
    ...(isAdmin ? {} : { status: "published" }),
  });
  res.json(questions);
}

/* ---------------- Questions ---------------- */

// GET /api/sessions/:sessionId/questions
// Quizzes are practice with instant feedback, so the correct answer and
// explanation are returned. (Graded tests hide the answer — see testController.)
export async function listQuestions(req, res) {
  const isAdmin = req.user?.role === "admin";
  const questions = await Question.find({
    session: req.params.sessionId,
    ...NOT_DELETED,
    ...(isAdmin ? {} : { status: "published" }),
  });
  res.json(questions);
}

// GET /api/questions  (admin) — list all questions with their full location
// (stream → subject → topic → session → quiz) so the UI can show a breadcrumb.
export async function listAllQuestions(req, res) {
  const questions = await Question.find({ ...NOT_DELETED })
    .sort("-createdAt")
    .limit(2000)
    .populate({ path: "subject", select: "name stream", populate: { path: "stream", select: "name" } })
    .populate({ path: "session", select: "title topic", populate: { path: "topic", select: "title" } })
    .populate("quiz", "title")
    .lean();
  res.json(
    questions.map((q) => ({
      ...q,
      stream: q.subject?.stream?.name || "",
      subject: q.subject?.name || "—",
      // Hierarchical topic (from the session) with a fallback to the free-text topic.
      topicName: q.session?.topic?.title || q.topic || "",
      session: q.session?.title || "—",
      quiz: q.quiz?.title || "—",
    }))
  );
}

export async function createQuestion(req, res) {
  const question = await Question.create(req.body);
  res.status(201).json(question);
}

// POST /api/questions/bulk
// Body: { questions: [...], context: { subject, session, quiz, testSeries, status } }
// The context is merged into every question so the client only sends the
// per-question fields (text, options, correct, …). Test-series questions are
// also linked into that test's question list.
export async function bulkCreateQuestions(req, res) {
  const { questions, context = {} } = req.body;
  if (!Array.isArray(questions) || !questions.length) {
    return res.status(400).json({ message: "questions array is required" });
  }
  // A client may only bulk-add into their OWN test/practice item.
  if (context.testSeries) {
    const ts = await TestSeries.findById(context.testSeries).select("owner");
    if (!ts) return res.status(404).json({ message: "Target item not found" });
    if (isClient(req) && String(ts.owner || "") !== String(req.user._id)) {
      return res.status(403).json({ message: "Not your content" });
    }
  }
  const owner = ownerValue(req);

  // Validate each question UP FRONT so we can (a) insert every good one and
  // (b) tell the client EXACTLY which questions were rejected and why. Before,
  // insertMany(ordered:false) silently dropped any doc that failed the schema
  // (e.g. not exactly 4 options), so an upload of 199 could quietly become 179
  // with no explanation. Now nothing is lost silently — each failure is
  // reported with its 1-based number, type, a snippet of its text, and the
  // exact validation reason.
  const good = [];
  const errors = [];
  questions.forEach((q, i) => {
    const doc = new Question({ status: "published", ...q, ...context, owner });
    const ve = doc.validateSync();
    if (ve) {
      const reason =
        Object.values(ve.errors || {})
          .map((e) => e.message)
          .join("; ") || "Invalid question";
      errors.push({ number: i + 1, type: q.type || "mcq", text: String(q.text || "").slice(0, 80), reason });
    } else {
      good.push(doc);
    }
  });

  // ordered:false still guards against any residual write error on the good set.
  let created = [];
  if (good.length) {
    try {
      created = await Question.insertMany(good, { ordered: false });
    } catch (err) {
      created = Array.isArray(err?.insertedDocs) ? err.insertedDocs : [];
    }
  }

  // Attach to the test series' question list when uploading test questions.
  if (context.testSeries && created.length) {
    await TestSeries.findByIdAndUpdate(context.testSeries, {
      $push: { questions: { $each: created.map((c) => c._id) } },
    });
  }
  res.status(201).json({
    inserted: created.length,
    requested: questions.length,
    skipped: errors.length,
    errors: errors.slice(0, 50), // cap the payload; enough to diagnose the batch
  });
}

export async function updateQuestion(req, res) {
  const patch = { ...req.body };
  delete patch.owner;
  const question = await Question.findOneAndUpdate({ _id: req.params.id, ...ownerFilter(req) }, patch, { new: true });
  if (!question) return res.status(404).json({ message: "Question not found" });
  res.json(question);
}

// Normalize a text fragment for comparison: lowercase, strip LaTeX markers and
// punctuation, collapse whitespace. So "What is 2+2?" and "what is  2 + 2" match.
function normalizeText(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/\$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normArr = (a) => (Array.isArray(a) ? a : []).map(normalizeText).join("|");
const normTable = (rows) =>
  Array.isArray(rows)
    ? rows.map((r) => (Array.isArray(r) ? r.map(normalizeText).join("~") : normalizeText(r))).join("||")
    : "";

// A question is a duplicate only if EVERY content detail matches — not just the
// stem text. This includes the type-specific fields so, e.g., two Assertion &
// Reason questions (which share the same stem + standard options) are only
// duplicates when their Assertion AND Reason texts are also identical.
function questionSignature(q) {
  return [
    q.type || "mcq",
    normalizeText(q.text),
    normArr(q.options), // all options
    normArr(q.columnA), // matching / pair / pairselect
    normArr(q.columnB),
    normalizeText(q.assertion), // assertion & reason
    normalizeText(q.reason),
    normTable(q.tableRows), // table-based
    normalizeText(q.image), // image/diagram
  ].join("##");
}

// GET /api/questions/duplicates  (admin)
// Finds full-question duplicates, but ONLY within the same container so copies
// never cross categories:
//   • Quiz content  → grouped per SUBJECT (a subject's quizzes only)
//   • Test Series   → grouped per test series
//   • Practice Quiz / Practice Test → grouped per practice item
// Returns groups (count > 1) with the full question (options + correct) so the
// admin can view and confirm before deleting.
export async function findDuplicates(req, res) {
  // Optional filters restrict the scan to one container:
  //   ?subject=<id>          → one quiz subject (e.g. Economics)
  //   ?practiceSubject=<id>  → all practice items under one practice subject
  //   ?testSeries=<id>       → a single test-series / practice item
  const filter = { ...ownerFilter(req), ...NOT_DELETED }; // clients scan only their own (non-binned) bank
  if (req.query.subject && req.query.subject !== "all") filter.subject = req.query.subject;
  if (req.query.testSeries) filter.testSeries = req.query.testSeries;
  if (req.query.practiceSubject) {
    const items = await TestSeries.find({ practiceSubject: req.query.practiceSubject }).select("_id").lean();
    filter.testSeries = { $in: items.map((i) => i._id) };
  }
  // ?pool=1 (with practiceSubject): pool the comparison ACROSS all of the
  // subject's items/topics, so the same question appearing in two different
  // topic quizzes is flagged — instead of the default per-item grouping.
  const poolScopeId = (req.query.practiceSubject && (req.query.pool === "1" || req.query.pool === "true"))
    ? `psub:${req.query.practiceSubject}`
    : null;

  const questions = await Question.find(filter)
    .select("text options correct type difficulty status subject quiz session testSeries createdAt assertion reason columnA columnB tableRows image")
    .populate("subject", "name")
    .populate("quiz", "title")
    .populate("testSeries", "name practice practiceKind")
    .lean();

  // Determine which container a question belongs to (its dedup scope).
  const meta = (q) => {
    if (q.testSeries) {
      const ts = q.testSeries;
      const category = ts.practice
        ? ts.practiceKind === "quiz"
          ? "Practice Quiz"
          : "Practice Test"
        : "Test Series";
      return {
        category,
        scopeId: poolScopeId || String(ts._id),
        scopeName: poolScopeId ? "Across all topics" : (ts.name || "Untitled"),
        location: ts.name || "Untitled",
      };
    }
    if (q.subject || q.quiz) {
      return {
        category: "Quiz",
        scopeId: String(q.subject?._id || "no-subject"),
        scopeName: q.subject?.name || "Quiz",
        location: [q.subject?.name, q.quiz?.title].filter(Boolean).join(" › ") || "Quiz",
      };
    }
    return { category: "Uncategorized", scopeId: "none", scopeName: "—", location: "—" };
  };

  const groups = new Map();
  for (const q of questions) {
    if (!normalizeText(q.text)) continue;
    const m = meta(q);
    // Group only within the SAME category + container + identical full question.
    const key = `${m.category}::${m.scopeId}::${questionSignature(q)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        category: m.category,
        scopeName: m.scopeName,
        text: q.text,
        options: q.options || [],
        correct: q.correct,
        type: q.type,
        difficulty: q.difficulty,
        // full content for the "View question" confirmation panel
        assertion: q.assertion,
        reason: q.reason,
        columnA: q.columnA,
        columnB: q.columnB,
        tableRows: q.tableRows,
        image: q.image,
        questions: [],
      });
    }
    groups.get(key).questions.push({
      _id: q._id,
      status: q.status,
      location: m.location,
      createdAt: q.createdAt,
    });
  }

  const dupes = [...groups.values()]
    .filter((g) => g.questions.length > 1)
    .map((g) => ({ ...g, count: g.questions.length }))
    .sort((a, b) => b.count - a.count);

  const extras = dupes.reduce((s, g) => s + (g.count - 1), 0);
  res.json({ scanned: questions.length, groups: dupes.length, extras, duplicates: dupes });
}

// Soft delete (Recycle Bin): flag the question so it disappears from lists but
// can be restored. If it belonged to a test, remove it from that test's
// question list (it's re-added on restore) so it doesn't count while binned.
export async function deleteQuestion(req, res) {
  const q = await Question.findOne({ _id: req.params.id, ...ownerFilter(req), ...NOT_DELETED });
  if (!q) return res.status(404).json({ message: "Question not found" });
  if (q.testSeries) await TestSeries.findByIdAndUpdate(q.testSeries, { $pull: { questions: q._id } });
  await Question.findByIdAndUpdate(q._id, softDeletePatch());
  res.json({ message: "Question moved to Recycle Bin", softDeleted: true });
}


/* ------------------------- Question Checker -------------------------------
   "Did this question come from my bank?" — given pasted text (bulk or single
   questions) or an explicit list of stems, report for EACH input question
   whether the caller's OWN bank already contains it: an exact copy, a very
   similar (near-duplicate) question, or a related one (same topic/terms, e.g.
   the same question reworded with different options). Owner-scoped, so a client
   only searches their own content and an admin only platform content. Pure DB +
   lexical matching (Mongo full-text index + token overlap) — no AI/quota. */

// Meaningful words in a stem (lowercased, length >= 4, minus filler words) used
// to measure topical overlap between two questions independent of their options.
const CHECK_STOPWORDS = new Set(
  ("the a an of to in on at for and or but is are was were be been being do does did which what who whom whose when where why how " +
   "that this these those with without into from by as it its their his her they them following consider statement statements " +
   "correct incorrect true false not all none only both about above given below choose select mark identify option options " +
   "question answer regarding respectively context term following which specific").split(/\s+/)
);
const checkTokens = (t) =>
  new Set(
    String(t || "")
      .toLowerCase()
      .replace(/\$[^$]*\$/g, " ") // ignore LaTeX so wording, not symbols, is compared
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !CHECK_STOPWORDS.has(w))
  );
const checkJaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
};
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Human-readable location of a matched bank question (Stream › Subject › Topic ›
// Quiz, or the Test/Practice item name).
export function questionLocation(q) {
  if (q.testSeries) {
    const ts = q.testSeries;
    const cat = ts.practice ? (ts.practiceKind === "quiz" ? "Practice Quiz" : "Practice Test") : "Test Series";
    return `${cat}: ${ts.name || "Untitled"}`;
  }
  const parts = [q.subject?.stream?.name, q.subject?.name, q.session?.topic?.title || q.topic, q.quiz?.title].filter(Boolean);
  return parts.length ? parts.join(" › ") : "Quiz";
}

// Strip a leading question number ("1.", "Q2)", "12 -") and keep only the STEM
// of a pasted block — drop trailing option lines ("A) …", "(b) …", "1. …") and
// answer/explanation lines so we compare the question, not its options.
function stemOfBlock(block) {
  const lines = String(block || "").split(/\n/).map((l) => l.trim()).filter(Boolean);
  const stemLines = [];
  for (const l of lines) {
    if (/^\(?\s*[a-dA-D1-4]\s*[).\]]\s+\S/.test(l)) break;                 // option line: "A) …" / "(b) …" / "1. …"
    if (/^(ans(wer)?|correct(\s+answer)?|explanation|sol(ution)?|reason)\b/i.test(l)) break; // answer/explanation
    stemLines.push(l);
  }
  let stem = (stemLines.join(" ") || lines.join(" ")).trim();
  stem = stem.replace(/^\s*(?:Q(?:uestion)?\s*)?\.?\s*\d{1,3}\s*[.)\-:]\s*/i, "").trim(); // leading number
  return stem;
}

// FULL content of a pasted block for comparison — every line EXCEPT the trailing
// answer-key / explanation lines. Unlike stemOfBlock this KEEPS the options,
// the matching/pair columns, the statement list AND the Reason line, so
// structured questions (matching, pair, statement, assertion & reason) are
// compared on their real content, not just their short/generic stem.
export function contentOfBlock(block) {
  return String(block || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(ans(wer)?|correct(\s+answer)?|explanation|sol(ution)?)\b/i.test(l))
    .join(" ");
}

// Split pasted text into individual question stems. Prefers explicit numbering
// ("1." / "Q2)" / "3 -"); falls back to blank-line separation; else treats the
// whole text as a single question.
export function splitIntoStems(content) {
  const raw = String(content || "").replace(/\r/g, "").trim();
  if (!raw) return [];
  let blocks = raw
    .split(/\n(?=\s*(?:Q(?:uestion)?\s*)?\.?\s*\d{1,3}\s*[.)\-:]\s)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (blocks.length < 2) {
    const byBlank = raw.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
    blocks = byBlank.length >= 2 ? byBlank : [raw];
  }
  return blocks
    .map((block) => ({ stem: stemOfBlock(block).trim(), block: String(block).trim() }))
    .filter((it) => it.stem.length >= 8)
    .slice(0, 200);
}

// POST /api/questions/check  { content? , stems?[] }
// Returns per-question match status against the caller's own bank.
export async function checkQuestions(req, res) {
  const own = { ...ownerFilter(req), ...NOT_DELETED };
  const provided = Array.isArray(req.body?.stems)
    ? req.body.stems.map((s) => String(s || "").trim()).filter((s) => s.length >= 8).map((s) => ({ stem: s, block: s }))
    : null;
  const items = (provided && provided.length ? provided : splitIntoStems(req.body?.content)).slice(0, 200);
  if (!items.length) {
    return res.status(400).json({ message: "Paste at least one question (or upload a file) to check." });
  }

  const summary = { exact: 0, strong: 0, related: 0, none: 0 };
  const scored = [];
  for (const { stem, block } of items) {
    const fullContent = contentOfBlock(block);
    const stemTokens = checkTokens(stem);              // stem only — catches reworded MCQs (options ignored)
    const fullTokens = checkTokens(fullContent);       // stem + columns/pairs/statements/assertion/reason/options
    const normStem = normalizeText(stem);
    // Search the full-text index with the WHOLE content (it indexes text,
    // options, assertion, reason, columnA & columnB), so a matching/pair/
    // assertion question is found by its columns/pairs/reason, not just a
    // generic intro like "Consider the following pairs:".
    const searchText = (fullContent || stem).slice(0, 400);
    let candidates = [];
    try {
      candidates = await Question.find(
        { $text: { $search: searchText }, ...own },
        { score: { $meta: "textScore" }, text: 1, type: 1, options: 1, columnA: 1, columnB: 1, assertion: 1, reason: 1 }
      ).sort({ score: { $meta: "textScore" } }).limit(25).lean();
    } catch {
      candidates = [];
    }
    // Fallback keyword search when the text index returns nothing.
    if (!candidates.length && (fullTokens.size || stemTokens.size)) {
      const words = [...(fullTokens.size ? fullTokens : stemTokens)].slice(0, 10).map(escapeRe);
      if (words.length) {
        candidates = await Question.find({ text: new RegExp(words.join("|"), "i"), ...own })
          .select("text type options columnA columnB assertion reason").limit(25).lean();
      }
    }
    const cand = [];
    for (const c of candidates) {
      // Compare on BOTH the stem alone and the full content; take the stronger
      // signal. So plain MCQs match on the stem (reworded options still count),
      // while matching/pair/statement/assertion questions match on their
      // columns/pairs/statements/assertion/reason content.
      const bankFull = [
        c.text, c.assertion, c.reason,
        ...(Array.isArray(c.columnA) ? c.columnA : []),
        ...(Array.isArray(c.columnB) ? c.columnB : []),
        ...(Array.isArray(c.options) ? c.options : []),
      ].filter(Boolean).join(" ");
      const stemSim = checkJaccard(stemTokens, checkTokens(c.text));
      const fullSim = checkJaccard(fullTokens, checkTokens(bankFull));
      const sim = Math.max(stemSim, fullSim);
      // A true exact copy: identical stem AND its overall content matches too
      // (so two different pair questions that share the generic intro aren't
      // wrongly called "exact").
      const exact = normStem.length > 0 && normalizeText(c.text) === normStem && fullSim >= 0.6;
      // Only surface matches with a meaningful overlap: hide anything below 40%
      // (weak/noise). exact = 100, strong >= 60%, related = 40-60%.
      let st = "none";
      if (exact) st = "exact";
      else if (sim >= 0.6) st = "strong";
      else if (sim >= 0.4) st = "related";
      if (st !== "none") cand.push({ id: String(c._id), status: st, similarity: exact ? 100 : Math.round(sim * 100), sim, exact });
    }
    // Best first (exact, then strongest overlap), keep the top few so the user
    // sees EVERY place this question appears in the bank (incl. matching / pair /
    // assertion versions of the same content), not just one.
    cand.sort((a, b) => (Number(b.exact) - Number(a.exact)) || (b.sim - a.sim));
    const matches = cand.slice(0, 10);
    const status = matches[0]?.status || "none";
    summary[status] += 1;
    scored.push({ question: stem, yourQuestion: block, status, similarity: matches[0]?.similarity || 0, matches });
  }

  // Resolve human-readable locations for the matched questions in one query.
  const ids = [...new Set(scored.flatMap((s) => s.matches.map((m) => m.id)))];
  const locMap = new Map();
  if (ids.length) {
    const docs = await Question.find({ _id: { $in: ids } })
      .select("text type options correct columnA columnB assertion reason tableRows image explanation difficulty subject quiz session testSeries topic")
      .populate({ path: "subject", select: "name stream", populate: { path: "stream", select: "name" } })
      .populate({ path: "session", select: "title topic", populate: { path: "topic", select: "title" } })
      .populate("quiz", "title")
      .populate("testSeries", "name practice practiceKind")
      .lean();
    for (const d of docs) locMap.set(String(d._id), d);
  }

  const buildMatch = (m) => {
    const d = locMap.get(String(m.id));
    if (!d) return null;
    return {
      id: String(d._id),
      text: d.text,
      type: d.type,
      options: d.options || [],
      correct: d.correct,
      columnA: d.columnA || [],
      columnB: d.columnB || [],
      assertion: d.assertion,
      reason: d.reason,
      tableRows: d.tableRows,
      image: d.image,
      explanation: d.explanation,
      difficulty: d.difficulty,
      location: questionLocation(d),
      status: m.status,
      similarity: m.similarity,
    };
  };
  const results = scored.map((s) => {
    const matches = s.matches.map(buildMatch).filter(Boolean);
    return {
      question: s.question,
      yourQuestion: s.yourQuestion,
      status: s.status,
      similarity: s.similarity,
      matches,
      match: matches[0] || null, // first/best match (kept for compatibility)
    };
  });

  const found = summary.exact + summary.strong + summary.related;
  res.json({ total: items.length, found, summary, results });
}
