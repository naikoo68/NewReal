import Institution from "../models/Institution.js";
import SmSubject from "../models/SmSubject.js";
import SmClass from "../models/SmClass.js";
import SmFile from "../models/SmFile.js";

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

/* ---------------- Institutions ---------------- */
export async function listInstitutions(req, res) {
  const items = await Institution.find().sort("order name").lean();
  const map = await countBy(SmSubject, items.map((i) => i._id), "institution");
  res.json(items.map((i) => ({ ...i, subjects: map[String(i._id)] || 0 })));
}
export async function createInstitution(req, res) {
  res.status(201).json(await Institution.create(req.body));
}
export async function updateInstitution(req, res) {
  const it = await Institution.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!it) return res.status(404).json({ message: "Institution not found" });
  res.json(it);
}
export async function deleteInstitution(req, res) {
  const id = req.params.id;
  await Promise.all([
    SmFile.deleteMany({ institution: id }),
    SmClass.deleteMany({ institution: id }),
    SmSubject.deleteMany({ institution: id }),
    Institution.findByIdAndDelete(id),
  ]);
  res.json({ message: "Institution and its contents deleted" });
}

/* ---------------- Subjects ---------------- */
export async function listSmSubjects(req, res) {
  const items = await SmSubject.find({ institution: req.params.institutionId }).sort("order name").lean();
  const map = await countBy(SmClass, items.map((s) => s._id), "subject");
  res.json(items.map((s) => ({ ...s, classes: map[String(s._id)] || 0 })));
}
export async function createSmSubject(req, res) {
  res.status(201).json(await SmSubject.create(req.body));
}
export async function updateSmSubject(req, res) {
  const s = await SmSubject.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!s) return res.status(404).json({ message: "Subject not found" });
  res.json(s);
}
export async function deleteSmSubject(req, res) {
  const id = req.params.id;
  await Promise.all([
    SmFile.deleteMany({ subject: id }),
    SmClass.deleteMany({ subject: id }),
    SmSubject.findByIdAndDelete(id),
  ]);
  res.json({ message: "Subject and its classes/files deleted" });
}

/* ---------------- Classes ---------------- */
export async function listSmClasses(req, res) {
  const items = await SmClass.find({ subject: req.params.subjectId }).sort("order name").lean();
  const map = await countBy(SmFile, items.map((c) => c._id), "smClass");
  res.json(items.map((c) => ({ ...c, files: map[String(c._id)] || 0 })));
}
export async function createSmClass(req, res) {
  res.status(201).json(await SmClass.create(req.body));
}
export async function updateSmClass(req, res) {
  const c = await SmClass.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!c) return res.status(404).json({ message: "Class not found" });
  res.json(c);
}
export async function deleteSmClass(req, res) {
  const id = req.params.id;
  await Promise.all([SmFile.deleteMany({ smClass: id }), SmClass.findByIdAndDelete(id)]);
  res.json({ message: "Class and its files deleted" });
}

/* ---------------- Files ---------------- */

// Ensure a link is absolute (a link pasted without http:// is otherwise treated
// as a path on our own site, giving "This site can't be reached").
function normalizeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s) || s.startsWith("data:")) return s;
  return `https://${s}`;
}

export async function listSmFiles(req, res) {
  res.json(await SmFile.find({ smClass: req.params.classId }).sort("order createdAt").lean());
}
export async function createSmFile(req, res) {
  if (req.body.url) req.body.url = normalizeUrl(req.body.url);
  res.status(201).json(await SmFile.create(req.body));
}
export async function updateSmFile(req, res) {
  if (req.body.url) req.body.url = normalizeUrl(req.body.url);
  const f = await SmFile.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!f) return res.status(404).json({ message: "File not found" });
  res.json(f);
}
export async function deleteSmFile(req, res) {
  await SmFile.findByIdAndDelete(req.params.id);
  res.json({ message: "File deleted" });
}
