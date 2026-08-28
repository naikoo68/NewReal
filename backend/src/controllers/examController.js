import Exam from "../models/Exam.js";
import ExamPost from "../models/ExamPost.js";
import TestSeries from "../models/TestSeries.js";

// Count documents grouped by a reference field, returned as { id: count }.
async function countBy(Model, ids, field) {
  if (!ids.length) return {};
  const rows = await Model.aggregate([
    { $match: { [field]: { $in: ids } } },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
  ]);
  const map = {};
  rows.forEach((r) => { map[String(r._id)] = r.n; });
  return map;
}

/* ---------------- Exams ---------------- */

// GET /api/exams — with post counts
export async function listExams(req, res) {
  const exams = await Exam.find().sort("order name").lean();
  const map = await countBy(ExamPost, exams.map((e) => e._id), "exam");
  res.json(exams.map((e) => ({ ...e, posts: map[String(e._id)] || 0 })));
}

export async function createExam(req, res) {
  res.status(201).json(await Exam.create(req.body));
}

export async function updateExam(req, res) {
  const exam = await Exam.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!exam) return res.status(404).json({ message: "Exam not found" });
  res.json(exam);
}

// Delete an exam → remove its posts and detach its tests (tests are kept).
export async function deleteExam(req, res) {
  await Promise.all([
    ExamPost.deleteMany({ exam: req.params.id }),
    TestSeries.updateMany({ exam: req.params.id }, { $unset: { exam: "", post: "" } }),
    Exam.findByIdAndDelete(req.params.id),
  ]);
  res.json({ message: "Exam and its posts deleted" });
}

/* ---------------- Posts (sub-sections) ---------------- */

// GET /api/exams/:examId/posts — with test counts
export async function listPosts(req, res) {
  const posts = await ExamPost.find({ exam: req.params.examId }).sort("order name").lean();
  const map = await countBy(TestSeries, posts.map((p) => p._id), "post");
  res.json(posts.map((p) => ({ ...p, tests: map[String(p._id)] || 0 })));
}

export async function createPost(req, res) {
  res.status(201).json(await ExamPost.create(req.body));
}

export async function updatePost(req, res) {
  const post = await ExamPost.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!post) return res.status(404).json({ message: "Post not found" });
  res.json(post);
}

// Delete a post → detach its tests (tests are kept, just unlinked).
export async function deletePost(req, res) {
  await TestSeries.updateMany({ post: req.params.id }, { $unset: { post: "" } });
  await ExamPost.findByIdAndDelete(req.params.id);
  res.json({ message: "Post deleted" });
}
