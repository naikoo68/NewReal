import Message from "../models/Message.js";
import { sendMail } from "../config/mailer.js";

// POST /api/messages  (auth required) — a logged-in user submits the contact form.
// The sender's identity comes from their account; a notification email is sent
// to the admin (best-effort — the message is always saved regardless).
export async function createMessage(req, res) {
  const { subject, message } = req.body;
  const name = req.user?.name || req.body.name;
  const email = req.user?.email || req.body.email;
  if (!name || !email || !message) {
    return res.status(400).json({ message: "A message is required" });
  }

  const doc = await Message.create({
    user: req.user?._id,
    name,
    email,
    subject,
    message,
  });

  // Notify the admin by email (fire-and-forget).
  const to = process.env.NOTIFY_EMAIL || process.env.SMTP_USER;
  if (to) {
    sendMail({
      to,
      replyTo: email,
      subject: `New contact message: ${subject || "(no subject)"}`,
      text: `From: ${name} <${email}>\nSubject: ${subject || "(none)"}\n\n${message}`,
      html: `<h3>New contact message</h3>
             <p><b>From:</b> ${name} &lt;${email}&gt;</p>
             <p><b>Subject:</b> ${subject || "(none)"}</p>
             <p><b>Message:</b></p>
             <p style="white-space:pre-wrap">${message}</p>`,
    }).catch((e) => console.error("Email notification failed:", e.message));
  }

  res.status(201).json({ id: doc._id, message: "Thanks! Your message has been received." });
}

// GET /api/messages  (admin) — inbox, newest first
export async function listMessages(req, res) {
  const messages = await Message.find().sort("-createdAt").limit(500).lean();
  const unread = await Message.countDocuments({ read: false });
  res.json({ messages, unread });
}

// GET /api/messages/unread-count  (admin) — for the sidebar badge
export async function unreadCount(req, res) {
  const unread = await Message.countDocuments({ read: false });
  res.json({ unread });
}

// PATCH /api/messages/:id/read  (admin) — toggle read/unread
export async function toggleRead(req, res) {
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ message: "Message not found" });
  msg.read = req.body.read ?? !msg.read;
  await msg.save();
  res.json({ id: msg._id, read: msg.read });
}

// DELETE /api/messages/:id  (admin)
export async function deleteMessage(req, res) {
  await Message.findByIdAndDelete(req.params.id);
  res.json({ message: "Message deleted" });
}
