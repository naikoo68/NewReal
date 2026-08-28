import crypto from "crypto";
import PracticeStream from "../models/PracticeStream.js";
import PracticeSubject from "../models/PracticeSubject.js";
import PracticeTopic from "../models/PracticeTopic.js";
import TestSeries from "../models/TestSeries.js";
import Question from "../models/Question.js";
import User from "../models/User.js";
import ContentShare from "../models/ContentShare.js";
import { isTestVisibleToUser, isSharedWithUser, hasActiveSubscription } from "../utils/accessControl.js";
import { ownerFilter, ownerValue } from "../utils/ownership.js";
import { sendMail, isMailConfigured } from "../config/mailer.js";
import { clientBaseFromReq } from "../config/clientUrl.js";
import { duplicateQuestions } from "../utils/duplicateQuestions.js";
import { byNatural } from "../utils/naturalSort.js";

// True when the caller owns this document (or is an admin working in the shared
// space). Used to guard edits/plays of a specific record.
const owns = (req, doc) =>
  req.user?.role === "client"
    ? String(doc?.owner || "") === String(req.user._id)
    : !doc?.owner; // admin space = ownerless content

// "Practice Quizzes" section. Items (My Quiz / My Test Series) are stored as
// TestSeries documents with practice=true, so they reuse the existing question
// management, per-student visibility and attempt/grading engine. They are
// hidden by default (visibleToAll:false) and never trigger notifications.

const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ---------------- Streams (admin) ---------------- */
export async function listStreams(req, res) {
  const filter = { isActive: true, ...ownerFilter(req) };
  if (req.query.kind) filter.kind = req.query.kind;
  const streams = await PracticeStream.find(filter).sort("order name").lean();
  const streamIds = streams.map((s) => s._id);
  const subs = await PracticeSubject.aggregate([
    { $match: { stream: { $in: streamIds } } },
    { $group: { _id: "$stream", count: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(subs.map((s) => [String(s._id), s.count]));
  res.json(streams.map((s) => ({ ...s, subjects: map[String(s._id)] || 0 })));
}
export async function createStream(req, res) {
  const s = await PracticeStream.create({ ...req.body, slug: slugify(req.body.name), owner: ownerValue(req) });
  res.status(201).json(s);
}
export async function updateStream(req, res) {
  const d = { ...req.body };
  if (d.name) d.slug = slugify(d.name);
  delete d.owner; // never reassign ownership from the client
  const s = await PracticeStream.findOneAndUpdate({ _id: req.params.id, ...ownerFilter(req) }, d, { new: true });
  if (!s) return res.status(404).json({ message: "Stream not found" });
  res.json(s);
}
export async function deleteStream(req, res) {
  const id = req.params.id;
  const stream = await PracticeStream.findOne({ _id: id, ...ownerFilter(req) });
  if (!stream) return res.status(404).json({ message: "Stream not found" });
  const items = await TestSeries.find({ practice: true, practiceStream: id }).select("questions");
  const qIds = items.flatMap((i) => i.questions || []);
  const subjectIds = (await PracticeSubject.find({ stream: id }).select("_id")).map((s) => s._id);
  await Promise.all([
    Question.deleteMany({ _id: { $in: qIds } }),
    TestSeries.deleteMany({ practice: true, practiceStream: id }),
    PracticeTopic.deleteMany({ subject: { $in: subjectIds } }),
    PracticeSubject.deleteMany({ stream: id }),
    PracticeStream.findByIdAndDelete(id),
  ]);
  res.json({ message: "Practice stream and all its content deleted" });
}

/* ---------------- Subjects (admin) ---------------- */
export async function listSubjects(req, res) {
  const subjects = await PracticeSubject.find({ stream: req.params.streamId, isActive: true, ...ownerFilter(req) }).sort("order name").lean();
  const subjectIds = subjects.map((s) => s._id);
  const items = await TestSeries.aggregate([
    { $match: { practice: true, practiceSubject: { $in: subjectIds } } },
    { $group: { _id: "$practiceSubject", count: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(items.map((i) => [String(i._id), i.count]));
  res.json(subjects.map((s) => ({ ...s, items: map[String(s._id)] || 0 })));
}
export async function createSubject(req, res) {
  const s = await PracticeSubject.create({ ...req.body, slug: slugify(req.body.name), owner: ownerValue(req) });
  res.status(201).json(s);
}
// GET /api/practice/all-subjects — flat list of every practice subject (for the
// "Add from Practice" picker when composing a test).
export async function allSubjects(req, res) {
  const subs = await PracticeSubject.find({ isActive: true, ...ownerFilter(req) })
    .populate("stream", "name kind")
    .sort("name")
    .lean();
  res.json(
    subs.map((s) => ({
      _id: s._id,
      name: s.name,
      stream: s.stream?.name || "",
      kind: s.stream?.kind || "",
    }))
  );
}
export async function updateSubject(req, res) {
  const d = { ...req.body };
  if (d.name) d.slug = slugify(d.name);
  delete d.owner;
  const s = await PracticeSubject.findOneAndUpdate({ _id: req.params.id, ...ownerFilter(req) }, d, { new: true });
  if (!s) return res.status(404).json({ message: "Subject not found" });
  res.json(s);
}
export async function deleteSubject(req, res) {
  const id = req.params.id;
  const subject = await PracticeSubject.findOne({ _id: id, ...ownerFilter(req) });
  if (!subject) return res.status(404).json({ message: "Subject not found" });
  const items = await TestSeries.find({ practice: true, practiceSubject: id }).select("questions");
  const qIds = items.flatMap((i) => i.questions || []);
  await Promise.all([
    Question.deleteMany({ _id: { $in: qIds } }),
    TestSeries.deleteMany({ practice: true, practiceSubject: id }),
    PracticeTopic.deleteMany({ subject: id }),
    PracticeSubject.findByIdAndDelete(id),
  ]);
  res.json({ message: "Practice subject and all its items deleted" });
}

/* ---------------- Topics (admin) — My Quiz only ---------------- */
export async function listTopics(req, res) {
  const topics = await PracticeTopic.find({ subject: req.params.subjectId, isActive: true, ...ownerFilter(req) }).sort("order name").lean();
  const topicIds = topics.map((t) => t._id);
  const items = await TestSeries.aggregate([
    { $match: { practice: true, practiceTopic: { $in: topicIds } } },
    { $group: { _id: "$practiceTopic", count: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(items.map((i) => [String(i._id), i.count]));
  res.json(topics.map((t) => ({ ...t, items: map[String(t._id)] || 0 })));
}
export async function createTopic(req, res) {
  const t = await PracticeTopic.create({ ...req.body, slug: slugify(req.body.name), owner: ownerValue(req) });
  res.status(201).json(t);
}
export async function updateTopic(req, res) {
  const d = { ...req.body };
  if (d.name) d.slug = slugify(d.name);
  delete d.owner;
  const t = await PracticeTopic.findOneAndUpdate({ _id: req.params.id, ...ownerFilter(req) }, d, { new: true });
  if (!t) return res.status(404).json({ message: "Topic not found" });
  res.json(t);
}
// PATCH /api/practice/topics/:id/move — move a My Quiz topic to another subject
// (within My Quiz). Its quizzes move with it (their stream/subject are updated
// to the destination; the topic id stays the same).
export async function moveTopic(req, res) {
  const topic = await PracticeTopic.findOne({ _id: req.params.id, ...ownerFilter(req) });
  if (!topic) return res.status(404).json({ message: "Topic not found" });
  const destSubject = await PracticeSubject.findOne({ _id: req.body?.subject, ...ownerFilter(req) });
  if (!destSubject) return res.status(400).json({ message: "Choose a destination subject." });
  topic.subject = destSubject._id;
  await topic.save();
  // Relocate the topic's quizzes to the destination stream/subject.
  await TestSeries.updateMany(
    { practice: true, practiceTopic: topic._id, ...ownerFilter(req) },
    { $set: { practiceSubject: destSubject._id, practiceStream: destSubject.stream } }
  );
  res.json({ message: "Topic moved", _id: topic._id });
}

export async function deleteTopic(req, res) {
  const id = req.params.id;
  const topic = await PracticeTopic.findOne({ _id: id, ...ownerFilter(req) });
  if (!topic) return res.status(404).json({ message: "Topic not found" });
  const items = await TestSeries.find({ practice: true, practiceTopic: id }).select("questions");
  const qIds = items.flatMap((i) => i.questions || []);
  await Promise.all([
    Question.deleteMany({ _id: { $in: qIds } }),
    TestSeries.deleteMany({ practice: true, practiceTopic: id }),
    PracticeTopic.findByIdAndDelete(id),
  ]);
  res.json({ message: "Practice topic and all its quizzes deleted" });
}

/* ---------------- Items (admin) — items are practice TestSeries ---------------- */
// My Test Series: items live directly under a subject.
export async function listItems(req, res) {
  const filter = { practice: true, practiceSubject: req.params.subjectId, ...ownerFilter(req) };
  if (req.query.kind) filter.practiceKind = req.query.kind;
  // Natural order by name (Test 1, Test 2, … Test 10) instead of creation order.
  const items = (await TestSeries.find(filter).lean()).sort(byNatural("name"));
  res.json(items.map((t) => ({ ...t, questionCount: t.questions?.length || 0, questions: undefined })));
}
// My Quiz: items live under a topic.
export async function listTopicItems(req, res) {
  // Natural order by name (Quiz 1, Quiz 2, … Quiz 10) instead of creation order.
  const items = (await TestSeries.find({ practice: true, practiceTopic: req.params.topicId, ...ownerFilter(req) }).lean()).sort(byNatural("name"));
  res.json(items.map((t) => ({ ...t, questionCount: t.questions?.length || 0, questions: undefined })));
}
export async function createItem(req, res) {
  const { name, practiceStream, practiceSubject, practiceTopic, practiceKind = "quiz", duration = 15, marks = 0, difficulty = "Medium", subjectPlan } = req.body;
  const item = await TestSeries.create({
    name,
    owner: ownerValue(req),
    practice: true,
    practiceKind,
    practiceStream,
    practiceSubject,
    // Quiz uses Topics; Previous Papers uses a Year level (also a PracticeTopic).
    practiceTopic: (practiceKind === "quiz" || practiceKind === "paper") ? practiceTopic : undefined,
    category: "Full-Length", // required by schema; unused for practice
    duration,
    marks,
    difficulty,
    // Manual subject blueprint (subject name + planned question count) — drives
    // the subject-based question manager and its per-subject limits.
    subjectPlan: Array.isArray(subjectPlan) ? subjectPlan : [],
    status: "published",
    visibleToAll: false, // hidden by default — admin grants access per student
  });
  res.status(201).json(item);
}

// PATCH /api/practice/items/:id — update a practice item's editable fields
// (name + the remembered AI topic/subtopics). Owner-scoped.
export async function updateItem(req, res) {
  const item = await TestSeries.findOne({ _id: req.params.id, practice: true, ...ownerFilter(req) });
  if (!item) return res.status(404).json({ message: "Item not found" });
  const { name, aiTopic, aiSubtopics, paperPdfUrl, answerKeyPdfUrl, answerKeys, additionalInfo } = req.body;
  if (typeof name === "string" && name.trim()) item.name = name.trim();
  if (typeof aiTopic === "string") item.aiTopic = aiTopic;
  if (typeof aiSubtopics === "string") item.aiSubtopics = aiSubtopics;
  // Previous Papers metadata — allow setting or clearing (empty string).
  if (typeof paperPdfUrl === "string") item.paperPdfUrl = paperPdfUrl.trim();
  // Answer keys: prefer the new multi-key array; fall back to the legacy single
  // field. Keep answerKeyPdfUrl in sync with the first key for old clients.
  if (Array.isArray(answerKeys)) {
    const cleaned = answerKeys
      .filter((k) => k && typeof k.url === "string" && k.url.trim())
      .map((k) => ({ label: (typeof k.label === "string" && k.label.trim()) ? k.label.trim() : "Answer key", url: k.url.trim() }));
    item.answerKeys = cleaned;
    item.answerKeyPdfUrl = cleaned[0]?.url || "";
  } else if (typeof answerKeyPdfUrl === "string") {
    item.answerKeyPdfUrl = answerKeyPdfUrl.trim();
    item.answerKeys = answerKeyPdfUrl.trim() ? [{ label: "Answer key", url: answerKeyPdfUrl.trim() }] : [];
  }
  if (typeof additionalInfo === "string") item.additionalInfo = additionalInfo;
  await item.save();
  res.json(item);
}

// PATCH /api/practice/items/:id/move — relocate a practice item (My Quiz / My
// Test) to a different Stream → Subject → (Topic). Owner-scoped.
export async function moveItem(req, res) {
  const item = await TestSeries.findOne({ _id: req.params.id, practice: true, ...ownerFilter(req) });
  if (!item) return res.status(404).json({ message: "Item not found" });
  const { practiceStream, practiceSubject, practiceTopic, copy } = req.body;
  const stream = await PracticeStream.findOne({ _id: practiceStream, ...ownerFilter(req) });
  if (!stream) return res.status(400).json({ message: "Choose a target stream." });
  if (stream.kind && stream.kind !== item.practiceKind) {
    return res.status(400).json({ message: `Pick a ${item.practiceKind === "quiz" ? "My Quiz" : "My Test"} stream.` });
  }
  const subject = await PracticeSubject.findOne({ _id: practiceSubject, stream: stream._id, ...ownerFilter(req) });
  if (!subject) return res.status(400).json({ message: "Choose a subject in that stream." });
  let topicId;
  if (item.practiceKind === "quiz") {
    const topic = await PracticeTopic.findOne({ _id: practiceTopic, subject: subject._id, ...ownerFilter(req) });
    if (!topic) return res.status(400).json({ message: "Choose a topic in that subject." });
    topicId = topic._id;
  }

  if (copy) {
    const newItem = await TestSeries.create({
      name: `${item.name} (copy)`,
      owner: ownerValue(req),
      practice: true,
      practiceKind: item.practiceKind,
      practiceStream: stream._id,
      practiceSubject: subject._id,
      practiceTopic: topicId,
      category: item.category || "Full-Length",
      duration: item.duration,
      marks: item.marks,
      difficulty: item.difficulty,
      status: item.status || "published",
      visibleToAll: false,
    });
    const created = await duplicateQuestions({ testSeries: item._id }, { testSeries: newItem._id, owner: ownerValue(req) });
    if (created.length) await TestSeries.findByIdAndUpdate(newItem._id, { $push: { questions: { $each: created.map((c) => c._id) } } });
    return res.json({ message: "Copied", _id: newItem._id });
  }

  item.practiceStream = stream._id;
  item.practiceSubject = subject._id;
  item.practiceTopic = topicId;
  await item.save();
  res.json({ message: "Migrated", _id: item._id });
}

// POST /api/practice/items/:id/split  { perQuiz }
// Split ONE practice quiz item's questions into multiple quiz items of `perQuiz`
// each. The original keeps the first chunk (renamed "Quiz 1"); the rest go into
// new items "Quiz 2".."Quiz N" under the same topic. Owner-scoped (covers client
// quizzes). e.g. 300 questions at 50/quiz → Quiz 1..Quiz 6.
export async function splitItem(req, res) {
  const per = Math.max(1, Math.min(500, parseInt(req.body?.perQuiz, 10) || 50));
  const item = await TestSeries.findOne({ _id: req.params.id, practice: true, practiceKind: "quiz", ...ownerFilter(req) });
  if (!item) return res.status(404).json({ message: "Quiz not found" });

  const qids = (item.questions || []).map((q) => q);
  const total = qids.length;
  if (total <= per) {
    return res.json({ message: `No split needed — this quiz has ${total} question(s) (≤ ${per}).`, quizzes: 1, created: 0 });
  }

  const chunks = [];
  for (let i = 0; i < total; i += per) chunks.push(qids.slice(i, i + per));

  // Keep the original quiz's OWN name and its first chunk. Name the NEW chunks
  // "Quiz N" continuing AFTER the highest existing quiz number in this topic, so
  // splitting e.g. "Quiz 2" (with a "Quiz 1" already present) yields Quiz 3,
  // Quiz 4, … instead of restarting at "Quiz 1" and clobbering the existing one.
  const siblings = await TestSeries.find({
    practice: true, practiceKind: "quiz", practiceTopic: item.practiceTopic, ...ownerFilter(req),
  }).select("name").lean();
  const usedNums = new Set();
  let maxNum = 0;
  for (const s of [...siblings, item]) {
    const m = String(s.name || "").match(/\bQuiz\s+(\d+)\b/i);
    if (m) { const n = parseInt(m[1], 10); usedNums.add(n); if (n > maxNum) maxNum = n; }
  }
  let nextNum = maxNum + 1;
  const nextQuizName = () => { while (usedNums.has(nextNum)) nextNum++; usedNums.add(nextNum); return `Quiz ${nextNum++}`; };

  item.questions = chunks[0]; // original keeps its name; just trim to the first chunk
  await item.save();

  for (let k = 1; k < chunks.length; k++) {
    const newItem = await TestSeries.create({
      name: nextQuizName(),
      owner: ownerValue(req),
      practice: true,
      practiceKind: "quiz",
      practiceStream: item.practiceStream,
      practiceSubject: item.practiceSubject,
      practiceTopic: item.practiceTopic,
      category: item.category || "Full-Length",
      duration: item.duration,
      marks: item.marks,
      difficulty: item.difficulty,
      status: "published",
      visibleToAll: false,
      questions: chunks[k],
    });
    // Point each moved question at its new item.
    await Question.updateMany({ _id: { $in: chunks[k] } }, { $set: { testSeries: newItem._id } }, { timestamps: false }); // split = association only, keep updatedAt
  }
  res.json({ message: `Split ${total} questions into ${chunks.length} quizzes.`, quizzes: chunks.length, created: chunks.length - 1 });
}

// POST /api/practice/items/:id/merge  { sourceIds: [] }
// Merge other My-Quiz items' questions INTO this one (the inverse of split).
// Each source item's questions are appended to the target and their `testSeries`
// pointer is repointed; the emptied source items are then deleted. Owner-scoped
// (covers client quizzes). Sources must be under the SAME topic.
export async function mergeItem(req, res) {
  const target = await TestSeries.findOne({ _id: req.params.id, practice: true, practiceKind: "quiz", ...ownerFilter(req) });
  if (!target) return res.status(404).json({ message: "Quiz not found" });
  const ids = (Array.isArray(req.body?.sourceIds) ? req.body.sourceIds : [])
    .map(String)
    .filter((s) => s && s !== String(target._id));
  if (!ids.length) return res.status(400).json({ message: "Pick at least one other quiz to merge in." });

  const sources = await TestSeries.find({
    _id: { $in: ids },
    practice: true,
    practiceKind: "quiz",
    practiceTopic: target.practiceTopic,
    ...ownerFilter(req),
  });
  if (!sources.length) return res.status(404).json({ message: "No matching quizzes to merge (they must be under the same topic)." });

  const have = new Set((target.questions || []).map((q) => String(q)));
  let moved = 0;
  for (const src of sources) {
    for (const qid of src.questions || []) {
      if (!have.has(String(qid))) { target.questions.push(qid); have.add(String(qid)); }
    }
    const r = await Question.updateMany({ _id: { $in: src.questions || [] } }, { $set: { testSeries: target._id } }, { timestamps: false }); // merge = association only, keep updatedAt
    moved += r.modifiedCount || 0;
    await TestSeries.deleteOne({ _id: src._id });
  }
  await target.save();
  res.json({
    message: `Merged ${sources.length} quiz(zes) (${moved} questions) into "${target.name}". It now has ${target.questions.length} question(s).`,
    merged: sources.length,
    moved,
    total: target.questions.length,
  });
}

// POST /api/practice/items/:id/move-questions  { questionIds, targetId }
// Move only the SELECTED questions from this quiz (:id) into ANY other quiz
// (targetId) the caller owns — anywhere in their My-Quiz hierarchy (any Stream
// → Subject → Topic), not just the same topic. Repoints each Question.testSeries
// and updates both quizzes' denormalized questions[] arrays. Owner-scoped.
// Powers the "tick questions & move them to another quiz" action in the
// full-quiz view (with a Stream → Subject → Topic → Quiz destination picker).
export async function moveQuestions(req, res) {
  const source = await TestSeries.findOne({ _id: req.params.id, practice: true, practiceKind: "quiz", ...ownerFilter(req) });
  if (!source) return res.status(404).json({ message: "Source quiz not found" });
  const targetId = String(req.body?.targetId || "");
  if (!targetId || targetId === String(source._id)) return res.status(400).json({ message: "Pick a different destination quiz." });
  // Destination can be ANY quiz the caller owns (any topic/subject/stream).
  const target = await TestSeries.findOne({ _id: targetId, practice: true, practiceKind: "quiz", ...ownerFilter(req) });
  if (!target) return res.status(404).json({ message: "Destination quiz not found." });

  const sourceSet = new Set((source.questions || []).map((q) => String(q)));
  const ids = (Array.isArray(req.body?.questionIds) ? req.body.questionIds : [])
    .map(String)
    .filter((qid) => sourceSet.has(qid)); // only questions that really belong to this quiz
  if (!ids.length) return res.status(400).json({ message: "Select at least one question in this quiz to move." });

  const idSet = new Set(ids);
  const r = await Question.updateMany({ _id: { $in: ids } }, { $set: { testSeries: target._id } }, { timestamps: false }); // move = association only, keep updatedAt
  source.questions = (source.questions || []).filter((q) => !idSet.has(String(q)));
  const have = new Set((target.questions || []).map((q) => String(q)));
  for (const qid of ids) { if (!have.has(qid)) { target.questions.push(qid); have.add(qid); } }
  await source.save();
  await target.save();
  res.json({
    message: `Moved ${r.modifiedCount || ids.length} question(s) to "${target.name}". This quiz now has ${source.questions.length}; "${target.name}" has ${target.questions.length}.`,
    moved: r.modifiedCount || ids.length,
    sourceTotal: source.questions.length,
    targetTotal: target.questions.length,
  });
}

// POST /api/practice/items/:id/copy-questions  { questionIds, targetId }
// Like moveQuestions, but DUPLICATES the selected questions into the target quiz
// (fresh Question docs, same owner) and LEAVES the originals in the source quiz.
// Powers the "tick questions & Copy selected" action alongside Move.
export async function copyQuestions(req, res) {
  const source = await TestSeries.findOne({ _id: req.params.id, practice: true, practiceKind: "quiz", ...ownerFilter(req) });
  if (!source) return res.status(404).json({ message: "Source quiz not found" });
  const targetId = String(req.body?.targetId || "");
  if (!targetId) return res.status(400).json({ message: "Pick a destination quiz." });
  const target = await TestSeries.findOne({ _id: targetId, practice: true, practiceKind: "quiz", ...ownerFilter(req) });
  if (!target) return res.status(404).json({ message: "Destination quiz not found." });

  const sourceSet = new Set((source.questions || []).map((q) => String(q)));
  const ids = (Array.isArray(req.body?.questionIds) ? req.body.questionIds : [])
    .map(String)
    .filter((qid) => sourceSet.has(qid)); // only questions that really belong to this quiz
  if (!ids.length) return res.status(400).json({ message: "Select at least one question in this quiz to copy." });

  // Load the originals and build fresh copies (new ids) stamped to the target.
  const originals = await Question.find({ _id: { $in: ids } }).lean();
  const owner = ownerValue(req);
  const copies = originals.map((q) => {
    const d = { owner, testSeries: target._id };
    for (const f of Q_CONTENT_FIELDS) if (q[f] !== undefined) d[f] = q[f];
    if (q.graph !== undefined) d.graph = q.graph;
    return d;
  });
  let created = [];
  try { created = await Question.insertMany(copies, { ordered: false }); }
  catch (e) { created = Array.isArray(e?.insertedDocs) ? e.insertedDocs : []; }

  const have = new Set((target.questions || []).map((q) => String(q)));
  for (const c of created) { const cid = String(c._id); if (!have.has(cid)) { target.questions.push(c._id); have.add(cid); } }
  await target.save();

  res.json({
    message: `Copied ${created.length} question(s) to "${target.name}". This quiz still has ${source.questions.length}; "${target.name}" now has ${target.questions.length}.`,
    copied: created.length,
    sourceTotal: source.questions.length,
    targetTotal: target.questions.length,
  });
}

// POST /api/practice/topics/:id/split  { perQuiz }
// Split ALL questions in a My-Quiz topic (across its quiz items) into quiz items
// of `perQuiz` each, named "Quiz 1".."Quiz N". The topic's old items are replaced
// (questions preserved). Owner-scoped. e.g. 200 questions at 50/quiz → Quiz 1..4.
export async function splitTopic(req, res) {
  const per = Math.max(1, Math.min(500, parseInt(req.body?.perQuiz, 10) || 50));
  const topic = await PracticeTopic.findOne({ _id: req.params.id, ...ownerFilter(req) });
  if (!topic) return res.status(404).json({ message: "Topic not found" });

  const items = await TestSeries.find({ practice: true, practiceKind: "quiz", practiceTopic: topic._id, ...ownerFilter(req) }).sort("createdAt");
  if (!items.length) return res.json({ message: "This topic has no quizzes yet.", quizzes: 0, created: 0 });

  const allQids = items.flatMap((i) => i.questions || []);
  const total = allQids.length;
  if (!total) return res.json({ message: "This topic has no questions yet.", quizzes: 0, created: 0 });

  const ctx = {
    practiceStream: items[0].practiceStream,
    practiceSubject: items[0].practiceSubject,
    practiceTopic: topic._id,
  };

  // Remove the topic's existing quiz items (their questions are preserved and
  // reassigned to the fresh items below).
  await TestSeries.deleteMany({ _id: { $in: items.map((i) => i._id) } });

  const chunks = [];
  for (let i = 0; i < total; i += per) chunks.push(allQids.slice(i, i + per));

  for (let k = 0; k < chunks.length; k++) {
    const newItem = await TestSeries.create({
      name: `Quiz ${k + 1}`,
      owner: ownerValue(req),
      practice: true,
      practiceKind: "quiz",
      ...ctx,
      category: "Full-Length",
      duration: 15,
      marks: 0,
      difficulty: "Medium",
      status: "published",
      visibleToAll: false,
      questions: chunks[k],
    });
    await Question.updateMany({ _id: { $in: chunks[k] } }, { $set: { testSeries: newItem._id } }, { timestamps: false }); // split = association only, keep updatedAt
  }
  res.json({ message: `Split ${total} questions into ${chunks.length} quizzes.`, quizzes: chunks.length, created: chunks.length });
}

// The FIRST published quiz in a topic (natural order — "Quiz 1") is a FREE
// preview anyone may attempt without login or subscription.
export async function isFreePreviewQuiz(item) {
  if (!item || item.practiceKind !== "quiz" || !item.practiceTopic) return false;
  const siblings = (await TestSeries.find({
    practice: true, practiceKind: "quiz", status: "published",
    practiceTopic: item.practiceTopic, owner: item.owner || null,
  }).select("_id name").lean()).sort(byNatural("name"));
  return siblings.length > 0 && String(siblings[0]._id) === String(item._id);
}

// GET /api/practice/quiz/:id/play — full questions WITH answers, so a "My Quiz"
// practice quiz can reveal correctness instantly (like the regular Quiz). Route
// is optionalAuth so the FREE first quiz of a topic can be attempted by anyone
// (no login). Access rules:
//   • Previous Papers  → LOGIN required, but NO subscription.
//   • My Quiz          → first quiz in the topic is FREE for everyone; every
//                        other quiz needs login + subscription/access.
export async function playQuiz(req, res) {
  const item = await TestSeries.findById(req.params.id).populate("questions");
  // Both "quiz" and "paper" are PLAYED like a quiz (instant reveal); only "test"
  // uses the timed test-attempt flow.
  if (!item || !item.practice || (item.practiceKind !== "quiz" && item.practiceKind !== "paper")) {
    return res.status(404).json({ message: "Practice quiz not found" });
  }
  if (item.practiceKind === "paper") {
    // Previous Papers: login is enough — no subscription needed.
    if (!req.user) return res.status(401).json({ message: "Please log in to open Previous Papers." });
  } else {
    // My Quiz: the first quiz of the topic is free; the rest need access.
    const free = await isFreePreviewQuiz(item);
    if (!free) {
      if (!req.user) {
        return res.status(401).json({ message: "Log in and subscribe to attempt this quiz. The first quiz in each topic is free." });
      }
      if (req.user.role !== "admin" && !owns(req, item) && req.user.myQuizAccess !== true && !hasActiveSubscription(req.user) && !isTestVisibleToUser(item.toObject(), req.user._id) && !isSharedWithUser(item, req.user._id)) {
        return res.status(403).json({ message: "A subscription is needed to attempt this quiz. The first quiz in each topic is free." });
      }
    }
  }
  const obj = item.toObject();
  res.json({
    _id: obj._id,
    name: obj.name,
    duration: obj.duration,
    difficulty: obj.difficulty,
    questionCount: obj.questions.length,
    questions: obj.questions, // includes correct / explanation / optionExplanations
    // Previous Papers extras (empty for normal quizzes): the student can open
    // the actual question-paper PDF / answer-key PDF and read the extra notes.
    paperPdfUrl: obj.paperPdfUrl || "",
    answerKeyPdfUrl: obj.answerKeyPdfUrl || "",
    answerKeys: Array.isArray(obj.answerKeys) && obj.answerKeys.length
      ? obj.answerKeys.map((k) => ({ label: k.label || "Answer key", url: k.url || "" })).filter((k) => k.url)
      : (obj.answerKeyPdfUrl ? [{ label: "Answer key", url: obj.answerKeyPdfUrl }] : []),
    additionalInfo: obj.additionalInfo || "",
  });
}

// GET /api/practice/my-items — list of the caller's OWN practice items (both
// My Quiz and My Test). Each item carries its Stream → Subject → Topic context
// so the client dashboard can present a drill-down browser:
//   My Quiz : Stream → Subject → Topic → Quiz
//   My Test : Stream → Test
const nodeInfo = (n) => (n ? { _id: n._id, name: n.name, icon: n.icon, color: n.color } : null);
export async function myItems(req, res) {
  // The caller's OWN items PLUS any shared with them (account-to-account). Shared
  // items carry the same Stream › Subject › Topic context, so the dashboard shows
  // them in the same hierarchy. Admins keep the ownerless space.
  const filter = req.user?.role === "client"
    ? { practice: true, $or: [{ owner: req.user._id }, { sharedWith: req.user._id }] }
    : { practice: true, ...ownerFilter(req) };
  const items = await TestSeries.find(filter)
    .populate("practiceStream", "name icon color")
    .populate("practiceSubject", "name icon color")
    .populate("practiceTopic", "name icon color")
    .sort("createdAt")
    .lean();
  res.json(
    items.map((t) => ({
      _id: t._id,
      name: t.name,
      kind: t.practiceKind,
      duration: t.duration,
      marks: t.marks,
      difficulty: t.difficulty,
      questionCount: t.questions?.length || 0,
      // The manual subject blueprint (GK, Accountancy, …) so the "Add to test"
      // picker can offer the test's sub-subjects/sections.
      subjectPlan: Array.isArray(t.subjectPlan) ? t.subjectPlan : [],
      stream: nodeInfo(t.practiceStream),
      subject: nodeInfo(t.practiceSubject),
      topic: nodeInfo(t.practiceTopic),
      // Flag items someone else shared with this user (vs their own).
      sharedByOther: String(t.owner || "") !== String(req.user._id),
    }))
  );
}

// POST /api/practice/share  (admin or client) — share practice content with
// ANOTHER REGISTERED user by email. Body: { level: "stream"|"subject"|"topic"|
// "item", id, email }. Only works if the email belongs to an existing account
// (else 404 "user has no account"). Adds the recipient to sharedWith on EVERY
// practice item under the chosen node (so they see the whole hierarchy), scoped
// to the caller's OWN content only. Best-effort emails the recipient.
// Build the TestSeries scope for a share/copy of a node, restricted to the
// given owner (the sender). Returns a Mongo filter.
function nodeItemFilter(level, id, owner) {
  const f = { practice: true, owner: owner ?? null };
  if (level === "item") f._id = id;
  else if (level === "topic") f.practiceTopic = id;
  else if (level === "subject") f.practiceSubject = id;
  else if (level === "stream") f.practiceStream = id;
  return f;
}

// Which container levels the recipient must place when accepting a share.
// A whole STREAM needs no placement (it's the top container — saved as-is).
// A subject/topic/quiz/test needs the recipient to say, for each parent
// container (and for a shared subject/topic, that node itself), whether to use
// an EXISTING container of theirs or CREATE a NEW one. Tests have no topic level.
function placementChain(level, kind) {
  if (level === "subject") return ["stream", "subject"];
  if (level === "topic") return ["stream", "subject", "topic"];
  if (level === "item") return kind === "test" ? ["stream", "subject"] : ["stream", "subject", "topic"];
  return []; // stream (or unknown) → no placement prompt
}

// Turn the recipient's placement choices into concrete container ids (in their
// own space). For each level: "existing" → validate & reuse their container;
// "new" → find-or-create by the given name under the resolved parent.
async function resolvePlacementChain(chainLevels, placement, kind, copyOwner, cache) {
  const models = { stream: PracticeStream, subject: PracticeSubject, topic: PracticeTopic };
  const resolved = {};
  for (const level of chainLevels) {
    const choice = (placement && placement[level]) || {};
    const parentId = level === "stream" ? null : level === "subject" ? resolved.stream : resolved.subject;
    const parentKey = level === "subject" ? "stream" : level === "topic" ? "subject" : undefined;
    if (choice.mode === "existing" && choice.id) {
      const q = { _id: choice.id, owner: copyOwner ?? null };
      if (parentKey) q[parentKey] = parentId;
      const found = await models[level].findOne(q).lean();
      if (!found) {
        const e = new Error(`The selected ${level} was not found in your account.`);
        e.status = 400;
        throw e;
      }
      resolved[level] = found._id;
    } else {
      const name = String(choice.name || "").trim();
      if (!name) {
        const e = new Error(`Please choose an existing ${level} or enter a name for a new one.`);
        e.status = 400;
        throw e;
      }
      // "Create new" must stay separate from a same-named container the
      // recipient already has, so suffix it on a clash rather than merge.
      resolved[level] = await createUniqueContainer(
        models[level],
        { name, kind: level === "stream" ? kind : undefined, parentKey, parentId },
        copyOwner,
        cache
      );
    }
  }
  return resolved;
}

// POST /api/practice/share — SEND content to another registered user. This does
// NOT grant access directly; it creates a PENDING share the recipient must
// ACCEPT, at which point the content is DUPLICATED (saved) into THEIR account.
export async function shareContent(req, res) {
  const level = String(req.body?.level || "").trim();
  const id = String(req.body?.id || "").trim();
  const email = String(req.body?.email || "").toLowerCase().trim();
  if (!["stream", "subject", "topic", "item"].includes(level)) return res.status(400).json({ message: "Invalid share level." });
  if (!id) return res.status(400).json({ message: "Nothing selected to share." });
  if (!email) return res.status(400).json({ message: "Enter the recipient's email." });

  // Recipient MUST have an account.
  const recipient = await User.findOne({ email }).select("_id name email").lean();
  if (!recipient) return res.status(404).json({ message: "This user doesn't have an account, so nothing was shared." });
  if (String(recipient._id) === String(req.user._id)) return res.status(400).json({ message: "That's your own account." });

  // Only your OWN content, scoped to the chosen node.
  const filter = nodeItemFilter(level, id, ownerValue(req));
  const matches = await TestSeries.find(filter).select("_id name practiceKind").lean();
  if (!matches.length) return res.status(404).json({ message: "No quizzes/tests found here to share (or not your content)." });

  // Title = the node's own name (stream/subject/topic) or the single item's name.
  let title = matches[0].name;
  if (level !== "item") {
    const Model = level === "stream" ? PracticeStream : level === "subject" ? PracticeSubject : PracticeTopic;
    const node = await Model.findOne({ _id: id, owner: ownerValue(req) }).select("name").lean();
    if (node?.name) title = node.name;
  }
  const kind = matches[0].practiceKind === "test" ? "test" : "quiz";

  const share = await ContentShare.create({
    from: req.user._id,
    to: recipient._id,
    fromName: req.user?.name || "",
    level,
    sourceId: id,
    kind,
    title,
    itemCount: matches.length,
    status: "pending",
  });

  // Best-effort email — the pending share is saved regardless.
  let emailed = false;
  if (isMailConfigured()) {
    try {
      const link = `${clientBaseFromReq(req)}#/client`;
      const label = level === "item" ? `"${title}"` : `${matches.length} ${kind}(s) from "${title}"`;
      await sendMail({
        to: recipient.email,
        subject: `${req.user?.name || "Someone"} sent you study content`,
        text: `${req.user?.name || "A teacher"} sent you ${label}. Open your dashboard and click "Accept" under Incoming to save it to your account: ${link}`,
        html: `<p><b>${req.user?.name || "A teacher"}</b> sent you ${label}.</p><p>Open your dashboard and click <b>Accept</b> under <b>Incoming</b> to save it to your account: <a href="${link}">${link}</a></p>`,
      });
      emailed = true;
    } catch { /* ignore mail errors */ }
  }

  res.json({ sent: matches.length, pending: true, shareId: share._id, recipient: { name: recipient.name, email: recipient.email }, emailed });
}

// GET /api/practice/shares/incoming — pending shares waiting for THIS user to
// accept or decline.
export async function incomingShares(req, res) {
  const shares = await ContentShare.find({ to: req.user._id, status: "pending" }).sort("-createdAt").lean();
  res.json(
    shares.map((s) => ({
      _id: s._id,
      from: s.fromName || "Someone",
      level: s.level,
      kind: s.kind,
      title: s.title,
      itemCount: s.itemCount,
      createdAt: s.createdAt,
    }))
  );
}

// POST /api/practice/shares/:id/decline — dismiss a pending share.
export async function declineShare(req, res) {
  const share = await ContentShare.findOne({ _id: req.params.id, to: req.user._id, status: "pending" });
  if (!share) return res.status(404).json({ message: "Share not found." });
  share.status = "declined";
  await share.save();
  res.json({ message: "Declined" });
}

// Remove content that was shared WITH the caller (the older reference/view
// share) from their dashboard: pull them out of `sharedWith` on every practice
// item under the chosen node (stream / subject / topic / single item). This
// only affects the caller's access — the owner's original content is untouched,
// and the caller's OWN items are never affected (filtered by sharedWith).
export async function removeSharedWithMe(req, res) {
  const level = String(req.body?.level || "").trim();
  const id = String(req.body?.id || "").trim();
  if (!["stream", "subject", "topic", "item"].includes(level)) return res.status(400).json({ message: "Invalid level." });
  if (!id) return res.status(400).json({ message: "Nothing selected to remove." });
  const key = level === "item" ? "_id" : level === "topic" ? "practiceTopic" : level === "subject" ? "practiceSubject" : "practiceStream";
  const result = await TestSeries.updateMany(
    { practice: true, sharedWith: req.user._id, [key]: id },
    { $pull: { sharedWith: req.user._id } }
  );
  res.json({ removed: result.modifiedCount || 0 });
}

// Find-or-create an owner-scoped practice container (stream/subject/topic) that
// mirrors a source node by name, so a copied item lands in the same hierarchy
// under the recipient. `cache` dedupes within one accept.
async function ensureContainer(Model, { name, kind, parentKey, parentId, icon, color }, owner, cache) {
  const cacheKey = `${Model.modelName}:${parentId || "-"}:${name}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const query = { owner, name };
  if (kind) query.kind = kind;
  if (parentKey) query[parentKey] = parentId;
  let node = await Model.findOne(query).lean();
  if (!node) {
    const doc = { name, owner, slug: slugify(name), status: undefined };
    if (kind) doc.kind = kind;
    if (parentKey) doc[parentKey] = parentId;
    if (icon) doc.icon = icon;
    if (color) doc.color = color;
    node = (await Model.create(doc)).toObject();
  }
  cache.set(cacheKey, node._id);
  return node._id;
}

// Like ensureContainer, but ALWAYS creates a brand-new container instead of
// merging into an existing same-named one. On a name clash (same owner / parent
// / kind) it appends " (shared)" — then " (shared 2)", " (shared 3)"… — so an
// incoming "JKSSB" stream becomes "JKSSB (shared)" when the recipient already
// has a "JKSSB", keeping the two separate. Used for every "create new" choice
// (and the automatic whole-stream accept); "use existing" still reuses/merges.
async function createUniqueContainer(Model, { name, kind, parentKey, parentId, icon, color }, owner, cache) {
  const cacheKey = `${Model.modelName}:${parentId || "-"}:new:${name}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const baseQuery = { owner: owner ?? null };
  if (kind) baseQuery.kind = kind;
  if (parentKey) baseQuery[parentKey] = parentId;
  let finalName = name;
  for (let n = 1; ; n++) {
    const clash = await Model.exists({ ...baseQuery, name: finalName });
    if (!clash) break;
    finalName = n === 1 ? `${name} (shared)` : `${name} (shared ${n})`;
  }
  const doc = { name: finalName, owner, slug: slugify(finalName), status: undefined };
  if (kind) doc.kind = kind;
  if (parentKey) doc[parentKey] = parentId;
  if (icon) doc.icon = icon;
  if (color) doc.color = color;
  const created = (await Model.create(doc)).toObject();
  cache.set(cacheKey, created._id);
  return created._id;
}

// Pick a name for a saved quiz/test copy that doesn't collide with an item the
// recipient already has in the SAME destination (topic for a quiz, subject for
// a test). On a clash it suffixes "(shared)", then "(shared 2)"… so the copy
// stays distinct instead of showing up as a duplicate name.
async function uniqueItemName(baseName, scope) {
  let finalName = baseName;
  for (let n = 1; ; n++) {
    const clash = await TestSeries.exists({ ...scope, name: finalName });
    if (!clash) break;
    finalName = n === 1 ? `${baseName} (shared)` : `${baseName} (shared ${n})`;
  }
  return finalName;
}

// POST /api/practice/shares/:id/accept — DUPLICATE the shared content into the
// recipient's own account (owned by them) and mark the share accepted.
// The owner space the SENDER's content lives in: a client owns content under
// their user id; an admin/staff sender's content is platform (owner:null).
// ContentShare.from is the sender's user id, which only equals the owner for
// client senders — so derive it from the sender's role.
async function senderContentOwner(fromUserId) {
  const sender = await User.findById(fromUserId).select("role").lean();
  return sender?.role === "client" ? fromUserId : null;
}

/* ---- Accept-share background jobs (in-memory, single instance) ----
   Accepting a whole shared subject/topic can copy hundreds of questions, so the
   duplication runs as a background job and the recipient polls for live
   progress (saved / total / remaining) instead of staring at a frozen spinner.
   Jobs are cleaned up 20 minutes after their last update. */
const acceptJobs = new Map(); // id -> { user, status, itemsTotal, itemsSaved, questionsTotal, questionsSaved, error, updatedAt }
const newAcceptJobId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
function guardAcceptJob(id, p) {
  Promise.resolve(p).catch((e) => {
    const j = acceptJobs.get(id);
    if (j) { j.status = "error"; j.error = e?.message || "Could not save the shared content."; j.updatedAt = Date.now(); }
    console.error("[acceptShare] background job failed:", e?.stack || e);
  });
}
setInterval(() => {
  const cutoff = Date.now() - 20 * 60 * 1000;
  for (const [id, j] of acceptJobs) if (j.updatedAt < cutoff) acceptJobs.delete(id);
}, 5 * 60 * 1000).unref();

export async function acceptShare(req, res) {
  const share = await ContentShare.findOne({ _id: req.params.id, to: req.user._id, status: "pending" });
  if (!share) return res.status(404).json({ message: "Share not found." });

  // Load the sender's source items (they must still exist). NOTE: the share
  // stores `from` = the sender's USER id, but that is NOT the content owner for
  // an admin sender (whose practice content is platform, owner:null). Resolve
  // the sender's real owner space from their role, else admin-sent shares find
  // no items and save nothing.
  const fromOwner = await senderContentOwner(share.from);
  const items = await TestSeries.find(nodeItemFilter(share.level, String(share.sourceId), fromOwner))
    .populate("practiceStream", "name kind icon color")
    .populate("practiceSubject", "name icon color")
    .populate("practiceTopic", "name icon color")
    .lean();
  if (!items.length) {
    share.status = "declined";
    await share.save();
    return res.status(410).json({ message: "The sender no longer has this content, so there's nothing to save." });
  }

  // Where the saved copy lives: a client keeps it under their own id; an admin
  // saves it into the shared PLATFORM space (owner:null) so it shows up in the
  // normal admin practice lists (which are all scoped to owner:null).
  const copyOwner = ownerValue(req);
  const cache = new Map();

  // Resolve the recipient's placement choices (which existing containers to
  // reuse / new ones to create) into fixed ids for the top of the hierarchy.
  // A whole-stream share has an empty chain → nothing to resolve (recreated by
  // the sender's names, as before). Levels BELOW the chosen chain (e.g. the
  // topics inside a shared subject) are still recreated by their source names,
  // preserving the sub-structure.
  const shareKind = share.kind === "test" ? "test" : "quiz";
  const chainLevels = placementChain(share.level, shareKind);
  let placed;
  try {
    placed = await resolvePlacementChain(chainLevels, req.body?.placement, shareKind, copyOwner, cache);
  } catch (err) {
    return res.status(err.status || 400).json({ message: err.message });
  }

  // Count the questions across all source items up front so the recipient sees
  // a real "saved / total / remaining" bar while the copy runs.
  const questionsTotal = await Question.countDocuments({ testSeries: { $in: items.map((i) => i._id) } });

  // Run the (potentially large) duplication in the background; return a job id
  // the client polls for live progress.
  const jobId = newAcceptJobId();
  acceptJobs.set(jobId, {
    user: String(req.user._id),
    status: "running",
    itemsTotal: items.length, itemsSaved: 0,
    questionsTotal, questionsSaved: 0,
    error: null, updatedAt: Date.now(),
  });
  guardAcceptJob(jobId, runAcceptJob(jobId, { share, items, placed, copyOwner, cache }));
  return res.status(202).json({ jobId, itemsTotal: items.length, questionsTotal });
}

// Background worker: duplicate every shared item (and its questions) into the
// recipient's account, updating the job's progress after each item. Marks the
// share accepted once everything has been copied. Any throw is caught by
// guardAcceptJob, which flags the job errored.
async function runAcceptJob(jobId, { share, items, placed, copyOwner, cache }) {
  const job = acceptJobs.get(jobId);
  if (!job) return;
  for (const src of items) {
    const kind = src.practiceKind === "test" ? "test" : "quiz";
    // Recreate the hierarchy under the recipient — using the placed containers
    // where the recipient chose them, else create by the source name. This
    // fallback only runs for a whole-stream accept (no placement prompt); it
    // creates a NEW stream (suffixed on a name clash, e.g. "JKSSB (shared)")
    // rather than merging into the recipient's existing same-named stream.
    const streamId = placed.stream || await createUniqueContainer(
      PracticeStream,
      { name: src.practiceStream?.name || "Shared", kind, icon: src.practiceStream?.icon, color: src.practiceStream?.color },
      copyOwner, cache
    );
    const subjectId = placed.subject || await ensureContainer(
      PracticeSubject,
      { name: src.practiceSubject?.name || "Shared", parentKey: "stream", parentId: streamId, icon: src.practiceSubject?.icon, color: src.practiceSubject?.color },
      copyOwner, cache
    );
    let topicId;
    if (kind === "quiz") {
      topicId = placed.topic || await ensureContainer(
        PracticeTopic,
        { name: src.practiceTopic?.name || "Shared", parentKey: "subject", parentId: subjectId, icon: src.practiceTopic?.icon, color: src.practiceTopic?.color },
        copyOwner, cache
      );
    }
    // Create the recipient-owned copy, then duplicate its questions. Keep the
    // copy's name distinct from any same-named item already in the destination.
    const itemScope = kind === "quiz"
      ? { practice: true, owner: copyOwner ?? null, practiceTopic: topicId }
      : { practice: true, owner: copyOwner ?? null, practiceSubject: subjectId };
    const copyName = await uniqueItemName(src.name, itemScope);
    // Preserve the original "uploaded"/"updated" dates on the copy so the
    // recipient sees the same dates as the sender (timestamps:false stops
    // Mongoose from resetting them to the accept time).
    const copy = new TestSeries({
      name: copyName,
      owner: copyOwner,
      practice: true,
      practiceKind: kind,
      practiceStream: streamId,
      practiceSubject: subjectId,
      practiceTopic: topicId,
      category: src.category || "Full-Length",
      duration: src.duration,
      marks: src.marks,
      difficulty: src.difficulty,
      negativeMarking: src.negativeMarking,
      subjectPlan: Array.isArray(src.subjectPlan) ? src.subjectPlan : [],
      status: "published",
      visibleToAll: false,
      ...(src.createdAt ? { createdAt: src.createdAt } : {}),
      ...(src.updatedAt ? { updatedAt: src.updatedAt } : {}),
    });
    await copy.save({ timestamps: false });
    const created = await duplicateQuestions({ testSeries: src._id }, { testSeries: copy._id, owner: copyOwner }, { preserveDates: true });
    if (created.length) await TestSeries.findByIdAndUpdate(copy._id, { $push: { questions: { $each: created.map((c) => c._id) } } });
    job.itemsSaved += 1;
    job.questionsSaved += created.length;
    job.updatedAt = Date.now();
  }

  share.status = "accepted";
  await share.save();
  job.status = "done";
  job.updatedAt = Date.now();
}

// GET /api/practice/shares/job/:id — poll accept-share progress. Scoped to the
// recipient who started the job (the id is random, but we still check).
export function acceptShareJob(req, res) {
  const job = acceptJobs.get(req.params.id);
  if (!job || String(job.user) !== String(req.user._id)) return res.status(404).json({ message: "Job not found or expired." });
  res.json({
    status: job.status, // "running" | "done" | "error"
    itemsTotal: job.itemsTotal, itemsSaved: job.itemsSaved,
    questionsTotal: job.questionsTotal, questionsSaved: job.questionsSaved,
    error: job.error,
  });
}

// Placement plan for the accept dialog: which container levels the recipient
// must choose (existing vs new) for this share, plus a suggested name for each
// (the sender's own stream/subject/topic name) to pre-fill the "create new"
// option. An empty chain (whole stream) means accept can proceed with no prompt.
export async function sharePlacement(req, res) {
  const share = await ContentShare.findOne({ _id: req.params.id, to: req.user._id, status: "pending" });
  if (!share) return res.status(404).json({ message: "Share not found." });
  const kind = share.kind === "test" ? "test" : "quiz";
  const levels = placementChain(share.level, kind);
  let names = {};
  if (levels.length) {
    const src = await TestSeries.findOne(nodeItemFilter(share.level, String(share.sourceId), await senderContentOwner(share.from)))
      .populate("practiceStream", "name")
      .populate("practiceSubject", "name")
      .populate("practiceTopic", "name")
      .lean();
    names = {
      stream: src?.practiceStream?.name || "",
      subject: src?.practiceSubject?.name || "",
      topic: src?.practiceTopic?.name || "",
    };
  }
  res.json({
    level: share.level,
    kind,
    title: share.title,
    chain: levels.map((l) => ({ level: l, suggestedName: names[l] || "" })),
  });
}

/* ---------------- Student browse ----------------
   FREEMIUM MODEL for My Quiz + Previous Papers: the whole hierarchy is PUBLIC
   so anyone (even a guest) can discover it. The FIRST quiz in each topic is a
   FREE preview anyone can attempt (no login/subscription); every other quiz
   needs login + subscription (myQuizAccess / access / ownership / share).
   Previous Papers need only LOGIN (no subscription). My Test Series is
   unchanged — it keeps the original per-item visibility + master-grant model. */

// Does this user have full paid access to a specific quiz/paper item?
const hasQuizAccess = (req, t) =>
  req.user?.role === "admin" ||
  req.user?.myQuizAccess === true ||
  hasActiveSubscription(req.user) || // active student subscription unlocks all quizzes
  isTestVisibleToUser(t, req.user?._id) ||
  isSharedWithUser(t, req.user?._id);

export async function browseStreams(req, res) {
  const kind = req.params.kind;
  const freemium = true; // all practice kinds are publicly discoverable (freemium)
  const grantAll = kind === "test" ? req.user?.myTestAccess === true : req.user?.myQuizAccess === true;
  const items = await TestSeries.find({ practice: true, practiceKind: kind, status: "published", owner: null })
    .select("practiceStream visibleToAll access")
    .lean();
  const ok = new Set(items.filter((t) => freemium || grantAll || isTestVisibleToUser(t, req.user?._id)).map((t) => String(t.practiceStream)));
  const streams = await PracticeStream.find({ isActive: true, kind, owner: null }).sort("order name").lean();
  res.json(streams.filter((s) => ok.has(String(s._id))));
}
export async function browseSubjects(req, res) {
  const { kind, streamId } = req.params;
  const freemium = true; // all practice kinds are publicly discoverable (freemium)
  const grantAll = kind === "test" ? req.user?.myTestAccess === true : req.user?.myQuizAccess === true;
  const items = await TestSeries.find({ practice: true, practiceKind: kind, status: "published", practiceStream: streamId, owner: null })
    .select("practiceSubject visibleToAll access")
    .lean();
  const ok = new Set(items.filter((t) => freemium || grantAll || isTestVisibleToUser(t, req.user?._id)).map((t) => String(t.practiceSubject)));
  const subjects = await PracticeSubject.find({ stream: streamId, isActive: true, owner: null }).sort("order name").lean();
  res.json(subjects.filter((s) => ok.has(String(s._id))));
}
// My Test Series: items under a subject. PUBLIC list in natural order (Test 1,
// Test 2, …). The FIRST test is a FREE preview anyone can attempt; the rest are
// `locked` unless the user has access (login + subscription / share / owner).
export async function browseItems(req, res) {
  const { kind, subjectId } = req.params;
  const grantAll = req.user?.role === "admin" || (kind === "quiz" ? req.user?.myQuizAccess === true : req.user?.myTestAccess === true);
  const items = (await TestSeries.find({ practice: true, practiceKind: kind, status: "published", practiceSubject: subjectId, owner: null })
    .lean()).sort(byNatural("name"));
  res.json(
    items.map((t, idx) => {
      const freePreview = idx === 0; // first test in the subject is free for everyone
      const hasAccess = grantAll || hasActiveSubscription(req.user) || isTestVisibleToUser(t, req.user?._id) || isSharedWithUser(t, req.user?._id);
      return {
        _id: t._id, name: t.name, duration: t.duration, marks: t.marks, difficulty: t.difficulty,
        questionCount: t.questions?.length || 0,
        freePreview,
        locked: !freePreview && !hasAccess,
      };
    })
  );
}
// My Quiz: topics under a subject that contain ANY published quiz (public —
// the first quiz in each is free, so every non-empty topic is discoverable).
export async function browseTopics(req, res) {
  const { subjectId } = req.params;
  const items = await TestSeries.find({ practice: true, practiceKind: "quiz", status: "published", practiceSubject: subjectId, owner: null })
    .select("practiceTopic")
    .lean();
  const has = new Set(items.map((t) => String(t.practiceTopic)));
  const topics = await PracticeTopic.find({ subject: subjectId, isActive: true, owner: null }).sort("order name").lean();
  res.json(topics.filter((t) => has.has(String(t._id))));
}
// Previous Papers: items listed DIRECTLY under a stream (no subject drill-down).
// PUBLIC list; each paper needs only LOGIN to open (no subscription) — a guest
// sees them as `locked` with `loginOnly` so the UI can prompt sign-in.
export async function browseStreamItems(req, res) {
  const { kind, streamId } = req.params;
  const items = (await TestSeries.find({ practice: true, practiceKind: kind, status: "published", practiceStream: streamId, owner: null }).lean()).sort(byNatural("name"));
  if (kind === "paper") {
    return res.json(items.map((t) => ({ _id: t._id, name: t.name, duration: t.duration, marks: t.marks, difficulty: t.difficulty, questionCount: t.questions?.length || 0, loginOnly: true, locked: !req.user })));
  }
  const grantAll = (kind === "quiz" ? req.user?.myQuizAccess === true : req.user?.myTestAccess === true) || hasActiveSubscription(req.user);
  res.json(
    items
      .filter((t) => grantAll || isTestVisibleToUser(t, req.user?._id))
      .map((t) => ({ _id: t._id, name: t.name, duration: t.duration, marks: t.marks, difficulty: t.difficulty, questionCount: t.questions?.length || 0 }))
  );
}
// My Quiz: quizzes under a topic. PUBLIC list in natural order (Quiz 1, Quiz 2,
// …). The FIRST quiz is a FREE preview anyone can attempt; the rest are
// `locked` unless the user has access (login + subscription / share / owner).
export async function browseTopicItems(req, res) {
  const items = (await TestSeries.find({ practice: true, practiceKind: "quiz", status: "published", practiceTopic: req.params.topicId, owner: null })
    .lean()).sort(byNatural("name"));
  res.json(
    items.map((t, idx) => {
      const freePreview = idx === 0; // first quiz in the topic is free for everyone
      return {
        _id: t._id, name: t.name, duration: t.duration, marks: t.marks, difficulty: t.difficulty,
        questionCount: t.questions?.length || 0,
        freePreview,
        locked: !freePreview && !hasQuizAccess(req, t),
      };
    })
  );
}


/* ---------------- Public share links for practice NODES (stream / subject / topic) ----------------
   Mirrors TestSeries public sharing, but for a whole node. Enabling a node mints
   a token (once, reused so the link is stable) AND turns on a public link for
   every published item beneath it — minting each item's own token if needed — so
   the shared page's items are directly playable via the existing
   /public/quiz|test/:token players. Disabling cascades OFF too. */

const newPublicToken = () => crypto.randomBytes(12).toString("hex");
const nodePublicExpired = (n) => n.publicExpiresAt && new Date(n.publicExpiresAt).getTime() < Date.now();

// Shared toggle. `childField` = the TestSeries field that points at this node.
async function toggleNodeLink(Model, childField, req, res) {
  const node = await Model.findById(req.params.id);
  if (!node) return res.status(404).json({ message: "Not found" });
  if (!owns(req, node)) return res.status(403).json({ message: "Not your content" });

  const enable = req.body?.enable !== false; // default: enable
  if (enable) {
    node.publicShare = true;
    if (!node.publicToken) node.publicToken = newPublicToken();
  } else {
    node.publicShare = false;
  }
  // Optional expiry: explicit value sets it; null/"" clears it (never expires).
  if ("expiresAt" in (req.body || {})) {
    if (!req.body.expiresAt) {
      node.publicExpiresAt = null;
    } else {
      const d = new Date(req.body.expiresAt);
      if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid expiry date" });
      node.publicExpiresAt = d;
    }
  }
  await node.save();

  // Cascade to the published items beneath this node (same owner) so the shared
  // page can actually open them via their own public links.
  const childFilter = { practice: true, [childField]: node._id, ...ownerFilter(req) };
  if (enable) {
    const children = await TestSeries.find({ ...childFilter, status: "published" }).select("_id publicToken");
    const ops = children.map((c) => ({
      updateOne: {
        filter: { _id: c._id },
        update: {
          $set: {
            publicShare: true,
            publicExpiresAt: node.publicExpiresAt || null, // items don't outlive the shared page
            ...(c.publicToken ? {} : { publicToken: newPublicToken() }),
          },
        },
      },
    }));
    if (ops.length) await TestSeries.bulkWrite(ops);
  } else {
    await TestSeries.updateMany(childFilter, { $set: { publicShare: false } });
  }

  res.json({ publicShare: node.publicShare, publicToken: node.publicToken, publicExpiresAt: node.publicExpiresAt });
}

export async function toggleStreamPublicLink(req, res) { return toggleNodeLink(PracticeStream, "practiceStream", req, res); }
export async function toggleSubjectPublicLink(req, res) { return toggleNodeLink(PracticeSubject, "practiceSubject", req, res); }
export async function toggleTopicPublicLink(req, res) { return toggleNodeLink(PracticeTopic, "practiceTopic", req, res); }

// GET /api/practice/public/node/:token — anonymous. Finds the stream/subject/
// topic that owns this token and returns its published, publicly-shared items
// (name + minimal meta + each item's OWN public token so the page can link
// straight to the existing quiz/test players). No questions/answers exposed.
export async function getPublicNode(req, res) {
  const token = req.params.token;
  let level = null;
  let node = await PracticeStream.findOne({ publicToken: token, publicShare: true });
  if (node) level = "stream";
  if (!node) { node = await PracticeSubject.findOne({ publicToken: token, publicShare: true }); if (node) level = "subject"; }
  if (!node) { node = await PracticeTopic.findOne({ publicToken: token, publicShare: true }); if (node) level = "topic"; }
  if (!node) return res.status(404).json({ message: "This link is invalid or public sharing was turned off." });
  if (nodePublicExpired(node)) return res.status(403).json({ message: "This public link has expired." });

  const field = level === "stream" ? "practiceStream" : level === "subject" ? "practiceSubject" : "practiceTopic";
  const items = (await TestSeries.find({
    practice: true,
    [field]: node._id,
    owner: node.owner || null,
    status: "published",
    publicShare: true,
    publicToken: { $ne: null },
  }).select("name practiceKind duration marks difficulty questions publicToken publicExpiresAt").lean())
    .filter((t) => !(t.publicExpiresAt && new Date(t.publicExpiresAt).getTime() < Date.now()))
    .sort(byNatural("name"))
    .map((t) => ({
      name: t.name,
      kind: t.practiceKind || "quiz",
      duration: t.duration,
      marks: t.marks,
      difficulty: t.difficulty,
      questionCount: t.questions?.length || 0,
      token: t.publicToken, // opens via /public/quiz|test/:token
    }));

  res.json({ level, name: node.name, description: node.description || "", items });
}

/* ---------------- Backup / Restore (a client's own My Practice content) ---------------- */

// Content fields copied for each question in a backup/restore (no ids/refs).
const Q_CONTENT_FIELDS = [
  "text", "type", "options", "correct", "difficulty", "explanation",
  "optionExplanations", "columnA", "columnB", "tableRows", "assertion",
  "reason", "image", "topic", "section", "status",
];

// In-memory backup/restore jobs so the UI can show a live % progress bar
// (mirrors the accept-share job pattern). id -> { user, kind, status, phase,
// total, done, payload?, result?, error, updatedAt }.
const pbJobs = new Map();
const newPbId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
function guardPb(id, p) {
  Promise.resolve(p).catch((e) => {
    const j = pbJobs.get(id);
    if (j) { j.status = "error"; j.error = e?.message || "Operation failed"; j.updatedAt = Date.now(); }
    console.error("[practice-backup] background job failed:", e?.stack || e);
  });
}
setInterval(() => {
  const cutoff = Date.now() - 20 * 60 * 1000;
  for (const [id, j] of pbJobs) if (j.updatedAt < cutoff) pbJobs.delete(id);
}, 5 * 60 * 1000).unref();
const touchPb = (j, extra = {}) => { Object.assign(j, extra); j.updatedAt = Date.now(); };

// POST /api/practice/backup/start — begin assembling the caller's My Practice
// backup in the background; returns { jobId, total } to poll for live progress.
export async function startBackup(req, res) {
  const of = ownerFilter(req);
  const [nStreams, nSubjects, nTopics, itemIdDocs] = await Promise.all([
    PracticeStream.countDocuments(of),
    PracticeSubject.countDocuments(of),
    PracticeTopic.countDocuments(of),
    TestSeries.find({ ...of, practice: true }, { _id: 1 }).lean(),
  ]);
  const itemIds = itemIdDocs.map((i) => i._id);
  const nQuestions = itemIds.length ? await Question.countDocuments({ ...of, testSeries: { $in: itemIds } }) : 0;
  const total = nStreams + nSubjects + nTopics + itemIds.length + nQuestions;
  const jobId = newPbId();
  pbJobs.set(jobId, { user: String(req.user._id), kind: "backup", status: "running", phase: "Starting…", total, done: 0, payload: null, error: null, updatedAt: Date.now() });
  guardPb(jobId, runBackupJob(jobId, of));
  res.status(202).json({ jobId, total });
}

async function runBackupJob(jobId, of) {
  const job = pbJobs.get(jobId);
  if (!job) return;
  const pick = (c) => ({ _id: c._id, name: c.name, icon: c.icon, color: c.color, description: c.description, order: c.order, isActive: c.isActive });
  const bump = (n = 1) => { job.done += n; job.updatedAt = Date.now(); };

  touchPb(job, { phase: "Streams" });
  const streams = (await PracticeStream.find(of).lean()).map((s) => { bump(); return { ...pick(s), kind: s.kind }; });
  touchPb(job, { phase: "Subjects" });
  const subjects = (await PracticeSubject.find(of).lean()).map((s) => { bump(); return { ...pick(s), stream: s.stream }; });
  touchPb(job, { phase: "Topics" });
  const topics = (await PracticeTopic.find(of).lean()).map((t) => { bump(); return { ...pick(t), subject: t.subject }; });
  touchPb(job, { phase: "Items" });
  const itemsRaw = await TestSeries.find({ ...of, practice: true }).lean();
  const items = itemsRaw.map((it) => { bump(); return {
    _id: it._id, name: it.name, practiceKind: it.practiceKind,
    practiceStream: it.practiceStream, practiceSubject: it.practiceSubject, practiceTopic: it.practiceTopic,
    category: it.category, duration: it.duration, marks: it.marks, difficulty: it.difficulty,
    subjectPlan: it.subjectPlan, negativeMarking: it.negativeMarking, status: it.status,
    aiTopic: it.aiTopic, aiSubtopics: it.aiSubtopics,
    paperPdfUrl: it.paperPdfUrl, answerKeyPdfUrl: it.answerKeyPdfUrl, answerKeys: it.answerKeys, additionalInfo: it.additionalInfo,
  }; });
  touchPb(job, { phase: "Questions" });
  const itemIds = itemsRaw.map((i) => i._id);
  const qRaw = itemIds.length ? await Question.find({ ...of, testSeries: { $in: itemIds } }).lean() : [];
  const questions = qRaw.map((q) => { bump(); const o = { _id: q._id, testSeries: q.testSeries }; for (const f of Q_CONTENT_FIELDS) if (q[f] !== undefined) o[f] = q[f]; return o; });

  job.payload = {
    format: "mystudyguide-practice-backup", version: 1, exportedAt: new Date().toISOString(),
    counts: { streams: streams.length, subjects: subjects.length, topics: topics.length, items: items.length, questions: questions.length },
    streams, subjects, topics, items, questions,
  };
  touchPb(job, { status: "done", phase: "Done", done: job.total });
}

// GET /api/practice/backup/job/:id — progress only (never the payload).
export function backupJobStatus(req, res) {
  const job = pbJobs.get(req.params.id);
  if (!job || String(job.user) !== String(req.user._id)) return res.status(404).json({ message: "Backup job not found or expired." });
  res.json({ status: job.status, phase: job.phase, total: job.total, done: job.done, counts: job.payload?.counts || null, error: job.error });
}

// GET /api/practice/backup/job/:id/file — the finished backup JSON to download.
export function backupJobFile(req, res) {
  const job = pbJobs.get(req.params.id);
  if (!job || String(job.user) !== String(req.user._id)) return res.status(404).json({ message: "Backup job not found or expired." });
  if (job.status !== "done" || !job.payload) return res.status(409).json({ message: "Backup is not ready yet." });
  res.json(job.payload);
}

// POST /api/practice/restore/start — rebuild content from an uploaded backup in
// the background (additive; new ids; owner = caller). Returns { jobId, total }.
export async function startRestore(req, res) {
  const owner = ownerValue(req);
  const b = req.body || {};
  // Accept both practice backups and admin backups (extract practice section from admin).
  let src = b;
  if (b.format === "mystudyguide-admin-backup") {
    const p = b.practice || {};
    src = { streams: p.streams, subjects: p.subjects, topics: p.topics, items: p.items, questions: p.questions };
  } else if (b.format && b.format !== "mystudyguide-practice-backup") {
    return res.status(400).json({ message: "This file is not a My Practice backup." });
  }
  const streams = Array.isArray(src.streams) ? src.streams : [];
  const subjects = Array.isArray(src.subjects) ? src.subjects : [];
  const topics = Array.isArray(src.topics) ? src.topics : [];
  const items = Array.isArray(src.items) ? src.items : [];
  const questions = Array.isArray(src.questions) ? src.questions : [];
  if (!streams.length && !items.length) return res.status(400).json({ message: "This backup file has no My Practice content to restore." });
  const total = streams.length + subjects.length + topics.length + items.length + questions.length;
  const jobId = newPbId();
  pbJobs.set(jobId, { user: String(req.user._id), kind: "restore", status: "running", phase: "Starting…", total, done: 0, result: null, error: null, updatedAt: Date.now() });
  guardPb(jobId, runRestoreJob(jobId, owner, { streams, subjects, topics, items, questions }));
  res.status(202).json({ jobId, total });
}

async function runRestoreJob(jobId, owner, data) {
  const job = pbJobs.get(jobId);
  if (!job) return;
  const { streams, subjects, topics, items, questions } = data;
  const bump = (n = 1) => { job.done += n; job.updatedAt = Date.now(); };
  const map = { stream: {}, subject: {}, topic: {} };

  touchPb(job, { phase: "Streams" });
  for (const s of streams) {
    const doc = await PracticeStream.create({ owner, kind: s.kind || "quiz", name: s.name, slug: slugify(s.name), icon: s.icon, color: s.color, description: s.description, order: s.order || 0, isActive: s.isActive !== false });
    map.stream[String(s._id)] = doc._id; bump();
  }
  touchPb(job, { phase: "Subjects" });
  for (const s of subjects) {
    const stream = map.stream[String(s.stream)]; if (!stream) { bump(); continue; }
    const doc = await PracticeSubject.create({ owner, stream, name: s.name, slug: slugify(s.name), icon: s.icon, color: s.color, description: s.description, order: s.order || 0, isActive: s.isActive !== false });
    map.subject[String(s._id)] = doc._id; bump();
  }
  touchPb(job, { phase: "Topics" });
  for (const t of topics) {
    const subject = map.subject[String(t.subject)]; if (!subject) { bump(); continue; }
    const doc = await PracticeTopic.create({ owner, subject, name: t.name, slug: slugify(t.name), icon: t.icon, color: t.color, description: t.description, order: t.order || 0, isActive: t.isActive !== false });
    map.topic[String(t._id)] = doc._id; bump();
  }
  touchPb(job, { phase: "Items & questions" });
  let restoredQuestions = 0;
  for (const it of items) {
    const doc = await TestSeries.create({
      owner, practice: true, practiceKind: it.practiceKind || "quiz",
      practiceStream: map.stream[String(it.practiceStream)], practiceSubject: map.subject[String(it.practiceSubject)], practiceTopic: map.topic[String(it.practiceTopic)],
      name: it.name, category: it.category || "Full-Length", duration: it.duration, marks: it.marks, difficulty: it.difficulty,
      subjectPlan: it.subjectPlan, negativeMarking: it.negativeMarking, status: it.status || "published", visibleToAll: false,
      aiTopic: it.aiTopic, aiSubtopics: it.aiSubtopics, paperPdfUrl: it.paperPdfUrl, answerKeyPdfUrl: it.answerKeyPdfUrl, answerKeys: it.answerKeys, additionalInfo: it.additionalInfo, questions: [],
    });
    bump();
    const mine = questions.filter((q) => String(q.testSeries) === String(it._id));
    if (mine.length) {
      const docs = mine.map((q) => { const d = { owner, testSeries: doc._id }; for (const f of Q_CONTENT_FIELDS) if (q[f] !== undefined) d[f] = q[f]; return d; });
      let created = [];
      try { created = await Question.insertMany(docs, { ordered: false }); }
      catch (e) { created = Array.isArray(e?.insertedDocs) ? e.insertedDocs : []; }
      restoredQuestions += created.length;
      doc.questions = created.map((c) => c._id);
      await doc.save();
      bump(mine.length);
    }
  }
  touchPb(job, { status: "done", phase: "Done", done: job.total, result: { streams: streams.length, subjects: subjects.length, topics: topics.length, items: items.length, questions: restoredQuestions } });
}

// GET /api/practice/restore/job/:id — restore progress.
export function restoreJobStatus(req, res) {
  const job = pbJobs.get(req.params.id);
  if (!job || String(job.user) !== String(req.user._id)) return res.status(404).json({ message: "Restore job not found or expired." });
  res.json({ status: job.status, phase: job.phase, total: job.total, done: job.done, result: job.result, error: job.error });
}
