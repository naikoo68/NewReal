import Settings from "../models/Settings.js";
import Notice from "../models/Notice.js";
import User from "../models/User.js";
import Message from "../models/Message.js";
import Stream from "../models/Stream.js";
import Subject from "../models/Subject.js";
import Session from "../models/Session.js";
import Topic from "../models/Topic.js";
import Exam from "../models/Exam.js";
import ExamPost from "../models/ExamPost.js";
import { sendMail } from "../config/mailer.js";

// Build the full "Stream › Subject › Topic › Session › Quiz" breadcrumb + a
// deep link to the quiz itself.
async function buildQuizPath(quiz) {
  const [subject, session] = await Promise.all([
    quiz.subject ? Subject.findById(quiz.subject).select("name stream").lean() : null,
    quiz.session ? Session.findById(quiz.session).select("title topic").lean() : null,
  ]);
  const [stream, topic] = await Promise.all([
    subject?.stream ? Stream.findById(subject.stream).select("name").lean() : null,
    session?.topic ? Topic.findById(session.topic).select("title").lean() : null,
  ]);
  const parts = [stream?.name, subject?.name, topic?.title, session?.title, quiz.title].filter(Boolean);
  // Quiz play route needs subject/topic/session/quiz ids.
  let link = "/quiz";
  if (quiz.subject && session?.topic && quiz.session && quiz._id) link = `/quiz/${quiz.subject}/${session.topic}/${quiz.session}/${quiz._id}`;
  else if (quiz.subject) link = `/quiz/${quiz.subject}`;
  return { parts, link };
}

// Build the full "Exam › Post › Category › Test" breadcrumb + a deep link.
async function buildTestPath(test) {
  const [exam, post] = await Promise.all([
    test.exam ? Exam.findById(test.exam).select("name").lean() : null,
    test.post ? ExamPost.findById(test.post).select("name").lean() : null,
  ]);
  const parts = [exam?.name, post?.name, test.category, test.name].filter(Boolean);
  let link = "/test-series";
  if (test.exam && test.post) link = `/test-series/${test.exam}/${test.post}`;
  else if (test.exam) link = `/test-series/${test.exam}`;
  return { parts, link };
}

// When a new quiz/test is added (and the admin enabled it in Notice Board
// settings), announce the FULL path on the notice board AND email every
// student. Fire-and-forget: callers should NOT await this.
export async function notifyNewContent(kind, doc) {
  try {
    const settings = await Settings.findOne({ key: "site" }).lean();
    if (!settings?.notifyOnNewContent) return;

    const siteName = settings.siteName || "My Study Guide";
    const label = kind === "test" ? "Test Series" : "Quiz";
    const { parts, link } = kind === "test" ? await buildTestPath(doc) : await buildQuizPath(doc);
    const fallback = (kind === "test" ? doc.name : doc.title) || label;
    const path = parts.length ? parts.join(" › ") : fallback;

    // 1) Notice board entry — full path + deep link to the quiz/test
    await Notice.create({ text: `New ${label} added — ${path}`, link, active: true, order: 0 });

    // 2) Email all students — full path
    const users = await User.find({ role: "student" }).select("email").lean();
    const subject = `New ${label} added on ${siteName}`;
    const html =
      `<p>Hello,</p>` +
      `<p>A new ${label.toLowerCase()} has just been added on ${siteName}:</p>` +
      `<p style="font-size:15px;font-weight:700">${path}</p>` +
      `<p>Log in to start practising. Good luck!</p>` +
      `<p style="color:#64748b;font-size:12px">— ${siteName}</p>`;
    const text = `New ${label} on ${siteName}: ${path}. Log in to start practising.`;

    for (const u of users) {
      if (u.email) sendMail({ to: u.email, subject, text, html }).catch(() => {});
    }
  } catch (err) {
    console.error("notifyNewContent error:", err.message);
  }
}

// When a new student registers/verifies, notify the admin via email AND drop a
// message into the admin panel inbox. Fire-and-forget.
export async function notifyNewUser(user) {
  try {
    const settings = await Settings.findOne({ key: "site" }).lean();
    const siteName = settings?.siteName || "My Study Guide";
    const body = `${user.name || "A new student"} (${user.email}) just registered on ${siteName}.`;

    // 1) Admin message-box entry
    await Message.create({
      user: user._id,
      name: user.name || "New user",
      email: user.email,
      subject: "New student registration",
      message: body,
      read: false,
    });

    // 2) Email the admin (NOTIFY_EMAIL, else the first admin account's email)
    const adminUser = await User.findOne({ role: "admin" }).select("email").lean();
    const to = process.env.NOTIFY_EMAIL || adminUser?.email;
    if (to) {
      await sendMail({
        to,
        subject: `New registration on ${siteName}`,
        text: body,
        html: `<p><b>${user.name || "A new student"}</b> (${user.email}) just registered on ${siteName}.</p><p style="color:#64748b;font-size:12px">Automatic notification from ${siteName}.</p>`,
      }).catch(() => {});
    }
  } catch (err) {
    console.error("notifyNewUser error:", err.message);
  }
}
