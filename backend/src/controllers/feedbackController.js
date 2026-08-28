import Feedback from "../models/Feedback.js";
import { sendMail } from "../config/mailer.js";

// POST /api/feedback — submit feedback (works for logged-in or guest users)
export async function createFeedback(req, res) {
  const { context = "question", message, rating, questionText = "", source = "", questionNumber, details = "", question = null, questionId = null } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ message: "Feedback message is required" });
  }
  const fb = await Feedback.create({
    user: req.user?._id,
    name: (req.body.name || "").trim() || req.user?.name || "Guest",
    email: (req.body.email || "").trim() || req.user?.email || "",
    context,
    message: message.trim(),
    rating: rating || undefined,
    questionText,
    question,
    questionId: questionId || question?._id || undefined,
    questionNumber,
    details,
    source,
  });

  // Notify the admin by email (best-effort — needs SMTP/Brevo + NOTIFY_EMAIL).
  const to = process.env.NOTIFY_EMAIL || process.env.SMTP_FROM;
  if (to) {
    const body = [
      `New ${context} feedback on My Study Guide`,
      source ? `Source: ${source}` : "",
      questionNumber ? `Question number: ${questionNumber}` : "",
      questionText ? `Question: ${questionText}` : "",
      details ? `Details: ${details}` : "",
      rating ? `Rating: ${rating}/5` : "",
      `From: ${fb.name}${fb.email ? ` (${fb.email})` : " (guest)"}`,
      "",
      "Message:",
      message.trim(),
    ].filter(Boolean).join("\n");
    sendMail({
      to,
      subject: `New ${context} feedback${source ? ` — ${source}` : ""}`,
      text: body,
      replyTo: fb.email || undefined,
    }).catch(() => {});
  }

  res.status(201).json({ ok: true, id: fb._id });
}

// GET /api/feedback  (admin) — list all feedback
export async function listFeedback(req, res) {
  const items = await Feedback.find().sort("-createdAt").limit(500).lean();
  const unread = await Feedback.countDocuments({ read: false });
  res.json({ items, unread });
}

// PATCH /api/feedback/:id/read  (admin)
export async function toggleFeedbackRead(req, res) {
  const fb = await Feedback.findById(req.params.id);
  if (!fb) return res.status(404).json({ message: "Not found" });
  fb.read = req.body.read ?? !fb.read;
  await fb.save();
  res.json({ id: fb._id, read: fb.read });
}

// DELETE /api/feedback/:id  (admin)
export async function deleteFeedback(req, res) {
  await Feedback.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
}
