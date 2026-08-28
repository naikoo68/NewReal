// Recycle Bin for the admin content library.
//
// Deletes across the content tree (Stream → Subject → Topic → Session → Quiz →
// Question) are SOFT: the item is flagged `deleted: true` and hidden from every
// normal list, but kept in the database. This controller powers the Recycle Bin
// UI: list the soft-deleted items, RESTORE one (un-flag it — its whole subtree
// comes back because children were never flagged), or PERMANENTLY DELETE one
// (the real cascade removal that can't be undone).

import Stream from "../models/Stream.js";
import Subject from "../models/Subject.js";
import Topic from "../models/Topic.js";
import Session from "../models/Session.js";
import Quiz from "../models/Quiz.js";
import Question from "../models/Question.js";
import TestSeries from "../models/TestSeries.js";
import { ONLY_DELETED, restorePatch } from "../utils/softDelete.js";

// Map a "type" key from the client to its model + friendly label.
const TYPES = {
  stream: { Model: Stream, label: "Stream" },
  subject: { Model: Subject, label: "Subject" },
  topic: { Model: Topic, label: "Topic" },
  session: { Model: Session, label: "Session" },
  quiz: { Model: Quiz, label: "Quiz" },
  question: { Model: Question, label: "Question" },
};

// A short human title for each item type (Questions have no title field).
const titleOf = (type, doc) =>
  type === "question"
    ? String(doc.text || "").slice(0, 120) || "(question)"
    : doc.title || doc.name || "(untitled)";

// GET /api/recycle-bin  (admin) — every soft-deleted content item, newest first,
// grouped-friendly with type, id, title and when it was deleted.
export async function listRecycleBin(req, res) {
  const groups = await Promise.all(
    Object.entries(TYPES).map(async ([type, { Model, label }]) => {
      const docs = await Model.find(ONLY_DELETED)
        .sort("-deletedAt")
        .limit(1000)
        .select("title name text deletedAt")
        .lean();
      return docs.map((d) => ({
        type,
        label,
        _id: d._id,
        title: titleOf(type, d),
        deletedAt: d.deletedAt || null,
      }));
    })
  );
  const items = groups.flat().sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
  // Per-type counts for the UI summary.
  const counts = items.reduce((acc, it) => { acc[it.type] = (acc[it.type] || 0) + 1; return acc; }, {});
  res.json({ items, counts, total: items.length });
}

// POST /api/recycle-bin/restore  { type, id }  (admin) — un-delete one item.
// Restoring a parent brings its whole subtree back (children were never flagged).
// A restored question is re-linked into its test's question list if it had one.
export async function restoreItem(req, res) {
  const { type, id } = req.body || {};
  const entry = TYPES[type];
  if (!entry) return res.status(400).json({ message: "Unknown item type." });
  const doc = await entry.Model.findByIdAndUpdate(id, restorePatch(), { new: true });
  if (!doc) return res.status(404).json({ message: `${entry.label} not found in the Recycle Bin.` });
  if (type === "question" && doc.testSeries) {
    await TestSeries.findByIdAndUpdate(doc.testSeries, { $addToSet: { questions: doc._id } });
  }
  res.json({ message: `${entry.label} restored.`, type, _id: doc._id });
}

// DELETE /api/recycle-bin/:type/:id  (admin) — permanently remove one item and
// cascade to its descendants. This is the real hard delete and cannot be undone.
export async function permanentDeleteItem(req, res) {
  const { type, id } = req.params;
  const entry = TYPES[type];
  if (!entry) return res.status(400).json({ message: "Unknown item type." });

  switch (type) {
    case "stream": {
      const subjectIds = (await Subject.find({ stream: id }).select("_id")).map((s) => s._id);
      await Promise.all([
        Question.deleteMany({ subject: { $in: subjectIds } }),
        Quiz.deleteMany({ subject: { $in: subjectIds } }),
        Session.deleteMany({ subject: { $in: subjectIds } }),
        Topic.deleteMany({ subject: { $in: subjectIds } }),
        Subject.deleteMany({ stream: id }),
        Stream.findByIdAndDelete(id),
      ]);
      break;
    }
    case "subject": {
      await Promise.all([
        Question.deleteMany({ subject: id }),
        Quiz.deleteMany({ subject: id }),
        Session.deleteMany({ subject: id }),
        Topic.deleteMany({ subject: id }),
        Subject.findByIdAndDelete(id),
      ]);
      break;
    }
    case "topic": {
      const sessionIds = (await Session.find({ topic: id }).select("_id")).map((s) => s._id);
      await Promise.all([
        Question.deleteMany({ session: { $in: sessionIds } }),
        Quiz.deleteMany({ session: { $in: sessionIds } }),
        Session.deleteMany({ topic: id }),
        Topic.findByIdAndDelete(id),
      ]);
      break;
    }
    case "session": {
      await Promise.all([
        Question.deleteMany({ session: id }),
        Quiz.deleteMany({ session: id }),
      ]);
      await Session.findByIdAndDelete(id);
      break;
    }
    case "quiz": {
      await Question.deleteMany({ quiz: id });
      await Quiz.findByIdAndDelete(id);
      break;
    }
    case "question": {
      const q = await Question.findById(id);
      if (q?.testSeries) await TestSeries.findByIdAndUpdate(q.testSeries, { $pull: { questions: q._id } });
      await Question.findByIdAndDelete(id);
      break;
    }
    default:
      return res.status(400).json({ message: "Unknown item type." });
  }
  res.json({ message: `${entry.label} permanently deleted.`, type, _id: id });
}

// DELETE /api/recycle-bin  (admin) — empty the whole content Recycle Bin.
// Permanently removes every soft-deleted content item and its descendants.
export async function emptyRecycleBin(req, res) {
  // Streams/subjects/topics/sessions/quizzes that are soft-deleted, plus their
  // descendants, and any soft-deleted questions.
  const [streamIds, subjectIds, topicIds, sessionIds, quizIds] = await Promise.all([
    Stream.find(ONLY_DELETED).select("_id").lean().then((r) => r.map((x) => x._id)),
    Subject.find(ONLY_DELETED).select("_id").lean().then((r) => r.map((x) => x._id)),
    Topic.find(ONLY_DELETED).select("_id").lean().then((r) => r.map((x) => x._id)),
    Session.find(ONLY_DELETED).select("_id").lean().then((r) => r.map((x) => x._id)),
    Quiz.find(ONLY_DELETED).select("_id").lean().then((r) => r.map((x) => x._id)),
  ]);

  // Expand cascade: subjects under deleted streams, topics under those, etc.
  const subUnderStream = (await Subject.find({ stream: { $in: streamIds } }).select("_id")).map((s) => s._id);
  const allSubjectIds = [...new Set([...subjectIds, ...subUnderStream].map(String))];
  const topicsUnder = (await Topic.find({ subject: { $in: allSubjectIds } }).select("_id")).map((t) => t._id);
  const allTopicIds = [...new Set([...topicIds, ...topicsUnder].map(String))];
  const sessionsUnder = (await Session.find({ $or: [{ subject: { $in: allSubjectIds } }, { topic: { $in: allTopicIds } }] }).select("_id")).map((s) => s._id);
  const allSessionIds = [...new Set([...sessionIds, ...sessionsUnder].map(String))];

  await Promise.all([
    Question.deleteMany({ $or: [
      { subject: { $in: allSubjectIds } },
      { session: { $in: allSessionIds } },
      { quiz: { $in: quizIds } },
      { deleted: true },
    ] }),
    Quiz.deleteMany({ $or: [{ subject: { $in: allSubjectIds } }, { session: { $in: allSessionIds } }, { _id: { $in: quizIds } }] }),
    Session.deleteMany({ _id: { $in: allSessionIds } }),
    Topic.deleteMany({ _id: { $in: allTopicIds } }),
    Subject.deleteMany({ _id: { $in: allSubjectIds } }),
    Stream.deleteMany({ _id: { $in: streamIds } }),
  ]);
  res.json({ message: "Recycle Bin emptied." });
}
