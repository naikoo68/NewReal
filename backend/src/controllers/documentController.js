import Document from "../models/Document.js";

// The documents a request may see/manage: admin → platform docs (owner null);
// a client → only their own. Every query is scoped by this so a client can
// never see or touch another user's (or the admin's) documents.
function docOwner(req) {
  return req.user?.role === "client" ? req.user._id : null;
}

// GET /api/documents — list (lightweight; omits the full text body), scoped.
export async function listDocuments(req, res) {
  const docs = await Document.find({ owner: docOwner(req) })
    .select("title sourceName pages createdAt updatedAt")
    .sort({ createdAt: -1 })
    .lean();
  res.json(docs);
}

// GET /api/documents/:id — a single document (with full text), scoped.
export async function getDocument(req, res) {
  const doc = await Document.findOne({ _id: req.params.id, owner: docOwner(req) }).lean();
  if (!doc) return res.status(404).json({ message: "Document not found" });
  res.json(doc);
}

// POST /api/documents — create a document owned by the caller.
export async function createDocument(req, res) {
  const { title, content = "", sourceName = "", pages = 0 } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ message: "Title is required" });
  const doc = await Document.create({
    owner: docOwner(req),
    title: title.trim(),
    content: String(content || ""),
    sourceName: String(sourceName || "").trim(),
    pages: Math.max(0, parseInt(pages, 10) || 0),
    createdBy: req.user?._id,
  });
  res.status(201).json(doc);
}

// PUT /api/documents/:id — update title/content (own documents only).
export async function updateDocument(req, res) {
  const patch = {};
  if ("title" in req.body) patch.title = String(req.body.title || "").trim();
  if ("content" in req.body) patch.content = String(req.body.content || "");
  if (patch.title === "") return res.status(400).json({ message: "Title is required" });
  const doc = await Document.findOneAndUpdate({ _id: req.params.id, owner: docOwner(req) }, patch, { new: true });
  if (!doc) return res.status(404).json({ message: "Document not found" });
  res.json(doc);
}

// DELETE /api/documents/:id — own documents only.
export async function deleteDocument(req, res) {
  const doc = await Document.findOneAndDelete({ _id: req.params.id, owner: docOwner(req) });
  if (!doc) return res.status(404).json({ message: "Document not found" });
  res.json({ message: "Document deleted" });
}
