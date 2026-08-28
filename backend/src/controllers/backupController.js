// Full ADMIN content-library backup & restore, run as background jobs so the
// admin UI can show a live % progress bar. Covers the whole platform library:
//   Content:  Stream → Subject → Topic → Session → Quiz → Question
//   Study:    Institution → SmSubject → SmClass → SmFile
//   Tests:    Exam → ExamPost → TestSeries → Question
//
// RESTORE is "merge by name": because the main content models have globally
// UNIQUE names (Stream/Subject) and no per-owner isolation, restore reuses an
// existing record when one with the same name/parent already exists and only
// creates what's missing — so it never collides and restoring twice does not
// duplicate the structure. Questions/files are de-duplicated by text/title.
import Stream from "../models/Stream.js";
import Subject from "../models/Subject.js";
import Topic from "../models/Topic.js";
import Session from "../models/Session.js";
import Quiz from "../models/Quiz.js";
import Question from "../models/Question.js";
import Institution from "../models/Institution.js";
import SmSubject from "../models/SmSubject.js";
import SmClass from "../models/SmClass.js";
import SmFile from "../models/SmFile.js";
import Exam from "../models/Exam.js";
import ExamPost from "../models/ExamPost.js";
import TestSeries from "../models/TestSeries.js";
import PracticeStream from "../models/PracticeStream.js";
import PracticeSubject from "../models/PracticeSubject.js";
import PracticeTopic from "../models/PracticeTopic.js";

const Q_FIELDS = [
  "text", "type", "options", "correct", "difficulty", "explanation",
  "optionExplanations", "columnA", "columnB", "tableRows", "assertion",
  "reason", "image", "topic", "section", "status",
];

const jobs = new Map(); // id -> { user, kind, status, phase, total, done, payload?, result?, error, updatedAt }
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
function guard(id, p) {
  Promise.resolve(p).catch((e) => {
    const j = jobs.get(id);
    if (j) { j.status = "error"; j.error = e?.message || "Operation failed"; j.updatedAt = Date.now(); }
    console.error("[admin-backup] background job failed:", e?.stack || e);
  });
}
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) if (j.updatedAt < cutoff) jobs.delete(id);
}, 5 * 60 * 1000).unref();
const touch = (j, x = {}) => { Object.assign(j, x); j.updatedAt = Date.now(); };
const slug = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ============================ BACKUP ============================ */

export async function startAdminBackup(req, res) {
  const [nStream, nSub, nTop, nSes, nQuiz, nInst, nSmSub, nSmCls, nSmFile, nExam, nPost] = await Promise.all([
    Stream.countDocuments({}), Subject.countDocuments({}), Topic.countDocuments({}), Session.countDocuments({}), Quiz.countDocuments({}),
    Institution.countDocuments({}), SmSubject.countDocuments({}), SmClass.countDocuments({}), SmFile.countDocuments({}),
    Exam.countDocuments({}), ExamPost.countDocuments({}),
  ]);
  const adminTests = await TestSeries.find({ owner: null, practice: { $ne: true } }, { _id: 1 }).lean();
  const testIds = adminTests.map((t) => t._id);
  const nContentQ = await Question.countDocuments({ owner: null, quiz: { $ne: null } });
  const nTestQ = testIds.length ? await Question.countDocuments({ owner: null, testSeries: { $in: testIds } }) : 0;
  // My Practice content (admin's own — owner null): practice tree + practice items + their questions.
  const [nPStream, nPSub, nPTop] = await Promise.all([
    PracticeStream.countDocuments({ owner: null }), PracticeSubject.countDocuments({ owner: null }), PracticeTopic.countDocuments({ owner: null }),
  ]);
  const practiceItems = await TestSeries.find({ owner: null, practice: true }, { _id: 1 }).lean();
  const practiceIds = practiceItems.map((t) => t._id);
  const nPracticeQ = practiceIds.length ? await Question.countDocuments({ owner: null, testSeries: { $in: practiceIds } }) : 0;
  const total = nStream + nSub + nTop + nSes + nQuiz + nInst + nSmSub + nSmCls + nSmFile + nExam + nPost + adminTests.length + nContentQ + nTestQ
    + nPStream + nPSub + nPTop + practiceItems.length + nPracticeQ;

  const jobId = newId();
  jobs.set(jobId, { user: String(req.user._id), kind: "backup", status: "running", phase: "Starting…", total, done: 0, payload: null, error: null, updatedAt: Date.now() });
  guard(jobId, runAdminBackup(jobId));
  res.status(202).json({ jobId, total });
}

async function runAdminBackup(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  const bump = (n = 1) => { job.done += n; job.updatedAt = Date.now(); };
  const dump = async (Model, phase, mapFn, filter = {}) => {
    touch(job, { phase });
    const rows = await Model.find(filter).lean();
    return rows.map((r) => { bump(); return mapFn(r); });
  };
  const qMap = (extra) => (q) => { const o = { _id: q._id, ...extra(q) }; for (const f of Q_FIELDS) if (q[f] !== undefined) o[f] = q[f]; return o; };

  const streams = await dump(Stream, "Streams", (s) => ({ _id: s._id, name: s.name, slug: s.slug, icon: s.icon, color: s.color, description: s.description, order: s.order, isActive: s.isActive }));
  const subjects = await dump(Subject, "Subjects", (s) => ({ _id: s._id, stream: s.stream, name: s.name, slug: s.slug, icon: s.icon, color: s.color, description: s.description, isActive: s.isActive }));
  const topics = await dump(Topic, "Topics", (t) => ({ _id: t._id, subject: t.subject, title: t.title, index: t.index, description: t.description, isActive: t.isActive }));
  const sessions = await dump(Session, "Sessions", (s) => ({ _id: s._id, subject: s.subject, topic: s.topic, title: s.title, index: s.index, difficulty: s.difficulty, isActive: s.isActive }));
  const quizzes = await dump(Quiz, "Quizzes", (q) => ({ _id: q._id, subject: q.subject, session: q.session, title: q.title, index: q.index, difficulty: q.difficulty, isActive: q.isActive, aiTopic: q.aiTopic, aiSubtopics: q.aiSubtopics }));
  const contentQuestions = await dump(Question, "Content questions", qMap((q) => ({ quiz: q.quiz, subject: q.subject, session: q.session })), { owner: null, quiz: { $ne: null } });

  const institutions = await dump(Institution, "Institutions", (i) => ({ _id: i._id, name: i.name, kind: i.kind, description: i.description, order: i.order }));
  const smSubjects = await dump(SmSubject, "Study subjects", (s) => ({ _id: s._id, institution: s.institution, name: s.name, order: s.order }));
  const smClasses = await dump(SmClass, "Study classes", (c) => ({ _id: c._id, institution: c.institution, subject: c.subject, name: c.name, order: c.order }));
  const smFiles = await dump(SmFile, "Study files", (f) => ({ _id: f._id, institution: f.institution, subject: f.subject, smClass: f.smClass, title: f.title, url: f.url, fileType: f.fileType, description: f.description, order: f.order }));

  const exams = await dump(Exam, "Exams", (e) => ({ _id: e._id, name: e.name, description: e.description, order: e.order }));
  const posts = await dump(ExamPost, "Exam posts", (p) => ({ _id: p._id, exam: p.exam, name: p.name, description: p.description, order: p.order }));
  touch(job, { phase: "Test series" });
  const seriesRaw = await TestSeries.find({ owner: null, practice: { $ne: true } }).lean();
  const series = seriesRaw.map((t) => { bump(); return { _id: t._id, exam: t.exam, post: t.post, name: t.name, category: t.category, duration: t.duration, marks: t.marks, difficulty: t.difficulty, negativeMarking: t.negativeMarking, status: t.status, subjectPlan: t.subjectPlan, aiTopic: t.aiTopic, aiSubtopics: t.aiSubtopics }; });
  const testIds = seriesRaw.map((t) => t._id);
  const testQuestions = testIds.length
    ? await dump(Question, "Test questions", qMap((q) => ({ testSeries: q.testSeries })), { owner: null, testSeries: { $in: testIds } })
    : [];

  // My Practice (admin's own): practice streams/subjects/topics + practice items + their questions.
  const pStreams = await dump(PracticeStream, "My Practice streams", (s) => ({ _id: s._id, kind: s.kind, name: s.name, slug: s.slug, icon: s.icon, color: s.color, description: s.description, order: s.order, isActive: s.isActive }), { owner: null });
  const pSubjects = await dump(PracticeSubject, "My Practice subjects", (s) => ({ _id: s._id, stream: s.stream, name: s.name, slug: s.slug, icon: s.icon, color: s.color, description: s.description, order: s.order, isActive: s.isActive }), { owner: null });
  const pTopics = await dump(PracticeTopic, "My Practice topics", (t) => ({ _id: t._id, subject: t.subject, name: t.name, slug: t.slug, icon: t.icon, color: t.color, description: t.description, order: t.order, isActive: t.isActive }), { owner: null });
  touch(job, { phase: "My Practice items" });
  const pItemsRaw = await TestSeries.find({ owner: null, practice: true }).lean();
  const pItems = pItemsRaw.map((it) => { bump(); return { _id: it._id, name: it.name, practiceKind: it.practiceKind, practiceStream: it.practiceStream, practiceSubject: it.practiceSubject, practiceTopic: it.practiceTopic, category: it.category, duration: it.duration, marks: it.marks, difficulty: it.difficulty, subjectPlan: it.subjectPlan, negativeMarking: it.negativeMarking, status: it.status, aiTopic: it.aiTopic, aiSubtopics: it.aiSubtopics, paperPdfUrl: it.paperPdfUrl, answerKeyPdfUrl: it.answerKeyPdfUrl, answerKeys: it.answerKeys, additionalInfo: it.additionalInfo }; });
  const pItemIds = pItemsRaw.map((i) => i._id);
  const pQuestions = pItemIds.length
    ? await dump(Question, "My Practice questions", qMap((q) => ({ testSeries: q.testSeries })), { owner: null, testSeries: { $in: pItemIds } })
    : [];

  job.payload = {
    format: "mystudyguide-admin-backup", version: 1, exportedAt: new Date().toISOString(),
    counts: {
      streams: streams.length, subjects: subjects.length, topics: topics.length, sessions: sessions.length, quizzes: quizzes.length, contentQuestions: contentQuestions.length,
      institutions: institutions.length, smSubjects: smSubjects.length, smClasses: smClasses.length, smFiles: smFiles.length,
      exams: exams.length, posts: posts.length, series: series.length, testQuestions: testQuestions.length,
      practiceStreams: pStreams.length, practiceSubjects: pSubjects.length, practiceTopics: pTopics.length, practiceItems: pItems.length, practiceQuestions: pQuestions.length,
    },
    content: { streams, subjects, topics, sessions, quizzes, questions: contentQuestions },
    study: { institutions, smSubjects, smClasses, smFiles },
    tests: { exams, posts, series, questions: testQuestions },
    practice: { streams: pStreams, subjects: pSubjects, topics: pTopics, items: pItems, questions: pQuestions },
  };
  touch(job, { status: "done", phase: "Done", done: job.total });
}

export function adminBackupJob(req, res) {
  const j = jobs.get(req.params.id);
  if (!j || String(j.user) !== String(req.user._id)) return res.status(404).json({ message: "Backup job not found or expired." });
  res.json({ status: j.status, phase: j.phase, total: j.total, done: j.done, counts: j.payload?.counts || null, error: j.error });
}

export function adminBackupFile(req, res) {
  const j = jobs.get(req.params.id);
  if (!j || String(j.user) !== String(req.user._id)) return res.status(404).json({ message: "Backup job not found or expired." });
  if (j.status !== "done" || !j.payload) return res.status(409).json({ message: "Backup is not ready yet." });
  res.json(j.payload);
}

/* ============================ RESTORE (merge by name) ============================ */

export async function startAdminRestore(req, res) {
  const b = req.body || {};
  if (b.format && b.format !== "mystudyguide-admin-backup") return res.status(400).json({ message: "This file is not an admin content backup." });
  const arr = (x) => (Array.isArray(x) ? x : []);
  const content = b.content || {}, study = b.study || {}, tests = b.tests || {}, practice = b.practice || {};
  const data = {
    streams: arr(content.streams), subjects: arr(content.subjects), topics: arr(content.topics), sessions: arr(content.sessions), quizzes: arr(content.quizzes), contentQuestions: arr(content.questions),
    institutions: arr(study.institutions), smSubjects: arr(study.smSubjects), smClasses: arr(study.smClasses), smFiles: arr(study.smFiles),
    exams: arr(tests.exams), posts: arr(tests.posts), series: arr(tests.series), testQuestions: arr(tests.questions),
    pStreams: arr(practice.streams), pSubjects: arr(practice.subjects), pTopics: arr(practice.topics), pItems: arr(practice.items), pQuestions: arr(practice.questions),
  };
  const total = Object.values(data).reduce((a, x) => a + x.length, 0);
  if (!total) return res.status(400).json({ message: "This backup file has no content to restore." });

  const jobId = newId();
  jobs.set(jobId, { user: String(req.user._id), kind: "restore", status: "running", phase: "Starting…", total, done: 0, result: null, error: null, updatedAt: Date.now() });
  guard(jobId, runAdminRestore(jobId, data));
  res.status(202).json({ jobId, total });
}

async function runAdminRestore(jobId, d) {
  const job = jobs.get(jobId);
  if (!job) return;
  const bump = (n = 1) => { job.done += n; job.updatedAt = Date.now(); };
  const M = { stream: {}, subject: {}, topic: {}, session: {}, quiz: {}, inst: {}, smsub: {}, smcls: {}, exam: {}, post: {}, pstream: {}, psubject: {}, ptopic: {} };
  const created = { streams: 0, subjects: 0, topics: 0, sessions: 0, quizzes: 0, questions: 0, institutions: 0, smSubjects: 0, smClasses: 0, smFiles: 0, exams: 0, posts: 0, series: 0, practiceStreams: 0, practiceSubjects: 0, practiceTopics: 0, practiceItems: 0, practiceQuestions: 0 };

  // Reuse an existing record matching `filter`, else create one via makeDoc().
  const upsert = async (Model, filter, makeDoc) => {
    const found = await Model.findOne(filter).select("_id").lean();
    if (found) return { id: found._id, isNew: false };
    const doc = await Model.create(makeDoc());
    return { id: doc._id, isNew: true };
  };

  touch(job, { phase: "Streams" });
  for (const s of d.streams) { const r = await upsert(Stream, { name: s.name }, () => ({ name: s.name, slug: s.slug || slug(s.name), icon: s.icon, color: s.color, description: s.description, order: s.order || 0, isActive: s.isActive !== false })); M.stream[String(s._id)] = r.id; if (r.isNew) created.streams++; bump(); }
  touch(job, { phase: "Subjects" });
  for (const s of d.subjects) { const stream = M.stream[String(s.stream)]; const r = await upsert(Subject, { name: s.name }, () => ({ stream, name: s.name, slug: s.slug || slug(s.name), icon: s.icon, color: s.color, description: s.description, isActive: s.isActive !== false })); M.subject[String(s._id)] = r.id; if (r.isNew) created.subjects++; bump(); }
  touch(job, { phase: "Topics" });
  for (const t of d.topics) { const subject = M.subject[String(t.subject)]; if (!subject) { bump(); continue; } const r = await upsert(Topic, { subject, title: t.title }, () => ({ subject, title: t.title, index: t.index || 1, description: t.description, isActive: t.isActive !== false })); M.topic[String(t._id)] = r.id; if (r.isNew) created.topics++; bump(); }
  touch(job, { phase: "Sessions" });
  for (const s of d.sessions) { const subject = M.subject[String(s.subject)]; if (!subject) { bump(); continue; } const topic = M.topic[String(s.topic)]; const r = await upsert(Session, { subject, title: s.title }, () => ({ subject, topic, title: s.title, index: s.index || 1, difficulty: s.difficulty || "Medium", isActive: s.isActive !== false })); M.session[String(s._id)] = r.id; if (r.isNew) created.sessions++; bump(); }
  touch(job, { phase: "Quizzes" });
  for (const q of d.quizzes) { const session = M.session[String(q.session)]; const subject = M.subject[String(q.subject)]; if (!session || !subject) { bump(); continue; } const r = await upsert(Quiz, { session, title: q.title }, () => ({ subject, session, title: q.title, index: q.index || 1, difficulty: q.difficulty || "Medium", isActive: q.isActive !== false, aiTopic: q.aiTopic, aiSubtopics: q.aiSubtopics })); M.quiz[String(q._id)] = r.id; if (r.isNew) created.quizzes++; bump(); }
  touch(job, { phase: "Content questions" });
  for (const q of d.contentQuestions) { const quiz = M.quiz[String(q.quiz)]; if (!quiz) { bump(); continue; } const exists = await Question.findOne({ quiz, text: q.text }).select("_id").lean(); if (!exists) { const doc = { owner: null, quiz, subject: M.subject[String(q.subject)], session: M.session[String(q.session)] }; for (const f of Q_FIELDS) if (q[f] !== undefined) doc[f] = q[f]; await Question.create(doc); created.questions++; } bump(); }

  touch(job, { phase: "Institutions" });
  for (const i of d.institutions) { const r = await upsert(Institution, { name: i.name }, () => ({ name: i.name, kind: i.kind || "University", description: i.description || "", order: i.order || 1 })); M.inst[String(i._id)] = r.id; if (r.isNew) created.institutions++; bump(); }
  touch(job, { phase: "Study subjects" });
  for (const s of d.smSubjects) { const institution = M.inst[String(s.institution)]; if (!institution) { bump(); continue; } const r = await upsert(SmSubject, { institution, name: s.name }, () => ({ institution, name: s.name, order: s.order || 1 })); M.smsub[String(s._id)] = r.id; if (r.isNew) created.smSubjects++; bump(); }
  touch(job, { phase: "Study classes" });
  for (const c of d.smClasses) { const institution = M.inst[String(c.institution)]; const subject = M.smsub[String(c.subject)]; if (!institution || !subject) { bump(); continue; } const r = await upsert(SmClass, { institution, subject, name: c.name }, () => ({ institution, subject, name: c.name, order: c.order || 1 })); M.smcls[String(c._id)] = r.id; if (r.isNew) created.smClasses++; bump(); }
  touch(job, { phase: "Study files" });
  for (const f of d.smFiles) { const institution = M.inst[String(f.institution)]; const subject = M.smsub[String(f.subject)]; const smClass = M.smcls[String(f.smClass)]; if (!institution || !subject || !smClass) { bump(); continue; } const exists = await SmFile.findOne({ smClass, title: f.title, url: f.url }).select("_id").lean(); if (!exists) { await SmFile.create({ institution, subject, smClass, title: f.title, url: f.url, fileType: f.fileType, description: f.description, order: f.order || 1 }); created.smFiles++; } bump(); }

  touch(job, { phase: "Exams" });
  for (const e of d.exams) { const r = await upsert(Exam, { name: e.name }, () => ({ name: e.name, description: e.description || "", order: e.order || 1 })); M.exam[String(e._id)] = r.id; if (r.isNew) created.exams++; bump(); }
  touch(job, { phase: "Exam posts" });
  for (const p of d.posts) { const exam = M.exam[String(p.exam)]; if (!exam) { bump(); continue; } const r = await upsert(ExamPost, { exam, name: p.name }, () => ({ exam, name: p.name, description: p.description || "", order: p.order || 1 })); M.post[String(p._id)] = r.id; if (r.isNew) created.posts++; bump(); }
  touch(job, { phase: "Test series & questions" });
  for (const t of d.series) {
    const exam = M.exam[String(t.exam)]; const post = M.post[String(t.post)];
    const r = await upsert(TestSeries, { owner: null, practice: { $ne: true }, name: t.name, ...(post ? { post } : {}) }, () => ({ owner: null, practice: false, exam, post, name: t.name, category: t.category || "Full-Length", duration: t.duration, marks: t.marks, difficulty: t.difficulty, negativeMarking: t.negativeMarking, status: t.status || "published", subjectPlan: t.subjectPlan, aiTopic: t.aiTopic, aiSubtopics: t.aiSubtopics, questions: [] }));
    if (r.isNew) created.series++;
    bump();
    const mine = d.testQuestions.filter((q) => String(q.testSeries) === String(t._id));
    for (const q of mine) {
      const exists = await Question.findOne({ testSeries: r.id, text: q.text }).select("_id").lean();
      if (!exists) { const doc = { owner: null, testSeries: r.id }; for (const f of Q_FIELDS) if (q[f] !== undefined) doc[f] = q[f]; const qd = await Question.create(doc); await TestSeries.updateOne({ _id: r.id }, { $addToSet: { questions: qd._id } }); created.questions++; }
      bump();
    }
  }

  // My Practice (owner null) — merge by name within each parent.
  touch(job, { phase: "My Practice streams" });
  for (const s of d.pStreams) { const r = await upsert(PracticeStream, { owner: null, kind: s.kind || "quiz", name: s.name }, () => ({ owner: null, kind: s.kind || "quiz", name: s.name, slug: s.slug || slug(s.name), icon: s.icon, color: s.color, description: s.description, order: s.order || 0, isActive: s.isActive !== false })); M.pstream[String(s._id)] = r.id; if (r.isNew) created.practiceStreams++; bump(); }
  touch(job, { phase: "My Practice subjects" });
  for (const s of d.pSubjects) { const stream = M.pstream[String(s.stream)]; if (!stream) { bump(); continue; } const r = await upsert(PracticeSubject, { owner: null, stream, name: s.name }, () => ({ owner: null, stream, name: s.name, slug: s.slug || slug(s.name), icon: s.icon, color: s.color, description: s.description, order: s.order || 0, isActive: s.isActive !== false })); M.psubject[String(s._id)] = r.id; if (r.isNew) created.practiceSubjects++; bump(); }
  touch(job, { phase: "My Practice topics" });
  for (const t of d.pTopics) { const subject = M.psubject[String(t.subject)]; if (!subject) { bump(); continue; } const r = await upsert(PracticeTopic, { owner: null, subject, name: t.name }, () => ({ owner: null, subject, name: t.name, slug: t.slug || slug(t.name), icon: t.icon, color: t.color, description: t.description, order: t.order || 0, isActive: t.isActive !== false })); M.ptopic[String(t._id)] = r.id; if (r.isNew) created.practiceTopics++; bump(); }
  touch(job, { phase: "My Practice items & questions" });
  for (const it of d.pItems) {
    const r = await upsert(TestSeries, { owner: null, practice: true, name: it.name }, () => ({ owner: null, practice: true, practiceKind: it.practiceKind || "quiz", practiceStream: M.pstream[String(it.practiceStream)], practiceSubject: M.psubject[String(it.practiceSubject)], practiceTopic: M.ptopic[String(it.practiceTopic)], name: it.name, category: it.category || "Full-Length", duration: it.duration, marks: it.marks, difficulty: it.difficulty, subjectPlan: it.subjectPlan, negativeMarking: it.negativeMarking, status: it.status || "published", visibleToAll: false, aiTopic: it.aiTopic, aiSubtopics: it.aiSubtopics, paperPdfUrl: it.paperPdfUrl, answerKeyPdfUrl: it.answerKeyPdfUrl, answerKeys: it.answerKeys, additionalInfo: it.additionalInfo, questions: [] }));
    if (r.isNew) created.practiceItems++;
    bump();
    const mine = d.pQuestions.filter((q) => String(q.testSeries) === String(it._id));
    for (const q of mine) {
      const exists = await Question.findOne({ testSeries: r.id, text: q.text }).select("_id").lean();
      if (!exists) { const doc = { owner: null, testSeries: r.id }; for (const f of Q_FIELDS) if (q[f] !== undefined) doc[f] = q[f]; const qd = await Question.create(doc); await TestSeries.updateOne({ _id: r.id }, { $addToSet: { questions: qd._id } }); created.practiceQuestions++; }
      bump();
    }
  }

  touch(job, { status: "done", phase: "Done", done: job.total, result: created });
}

export function adminRestoreJob(req, res) {
  const j = jobs.get(req.params.id);
  if (!j || String(j.user) !== String(req.user._id)) return res.status(404).json({ message: "Restore job not found or expired." });
  res.json({ status: j.status, phase: j.phase, total: j.total, done: j.done, result: j.result, error: j.error });
}
