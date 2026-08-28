import Question from "../models/Question.js";

// Content fields carried over when duplicating a question into a new container.
const FIELDS = [
  "text", "type", "options", "correct", "difficulty", "explanation",
  "optionExplanations", "columnA", "columnB", "tableRows", "assertion",
  "reason", "image", "topic", "section", "status",
];

// Duplicate every question matching `filter` into a new container described by
// `assign` (e.g. { quiz, subject, session } or { testSeries, owner }). Returns
// the created docs. Uses ordered:false so a bad row never blocks the copy.
//
// options.preserveDates: when true, the copies keep the ORIGINAL question's
// "uploaded"/"updated" timestamps (createdAt/updatedAt) instead of being
// stamped with the current time. Used when accepting shared content so the
// recipient sees the same dates as the sender.
export async function duplicateQuestions(filter, assign, { preserveDates = false } = {}) {
  const qs = await Question.find(filter).lean();
  if (!qs.length) return [];
  const docs = qs.map((q) => {
    const doc = { ...assign };
    for (const f of FIELDS) if (q[f] !== undefined) doc[f] = q[f];
    if (preserveDates) {
      if (q.createdAt) doc.createdAt = q.createdAt;
      if (q.updatedAt) doc.updatedAt = q.updatedAt;
    }
    return doc;
  });
  try {
    // timestamps:false when preserving so Mongoose doesn't overwrite the
    // createdAt/updatedAt we copied from the originals.
    return await Question.insertMany(docs, { ordered: false, timestamps: !preserveDates });
  } catch (e) {
    return Array.isArray(e?.insertedDocs) ? e.insertedDocs : [];
  }
}
