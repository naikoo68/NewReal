import Notice from "../models/Notice.js";

// GET /api/notices — public: only active notices for the ticker
export async function listActiveNotices(req, res) {
  const notices = await Notice.find({ active: true })
    .sort({ order: 1, createdAt: -1 })
    .limit(50)
    .lean();
  res.json(notices);
}

// GET /api/notices/all — admin: every notice
export async function listNotices(req, res) {
  const notices = await Notice.find().sort({ order: 1, createdAt: -1 }).lean();
  res.json(notices);
}

// POST /api/notices — admin
export async function createNotice(req, res) {
  const { text, link = "", active = true, order = 0 } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ message: "Notice text is required" });
  }
  const notice = await Notice.create({ text: text.trim(), link, active, order });
  res.status(201).json(notice);
}

// PUT /api/notices/:id — admin
export async function updateNotice(req, res) {
  const notice = await Notice.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!notice) return res.status(404).json({ message: "Notice not found" });
  res.json(notice);
}

// DELETE /api/notices/:id — admin
export async function deleteNotice(req, res) {
  await Notice.findByIdAndDelete(req.params.id);
  res.json({ message: "Notice deleted" });
}
