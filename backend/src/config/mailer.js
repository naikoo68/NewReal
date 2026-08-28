import nodemailer from "nodemailer";

// Email sending with two supported providers:
//
//   1. Brevo HTTPS API  (recommended)  — set BREVO_API_KEY.
//      Sends over port 443, so it works even on hosts that block SMTP ports
//      (e.g. Render's free plan blocks 25/465/587).
//
//   2. SMTP  (e.g. Gmail)              — set SMTP_HOST/PORT/USER/PASS.
//      Only works where outbound SMTP ports are open (paid hosts, local dev).
//
// In both cases the "from" address comes from SMTP_FROM (or SMTP_USER). If
// nothing is configured, sending is skipped gracefully and callers fall back
// to showing the code on screen.

let transporter;

function getTransporter() {
  if (transporter !== undefined) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Force IPv4 — some hosts have no outbound IPv6 and Node may otherwise
    // resolve the SMTP host to IPv6, causing "connect ENETUNREACH … :587".
    family: 4,
    // Fail fast instead of hanging when the SMTP port is blocked/unreachable.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transporter;
}

const brevoConfigured = () => !!process.env.BREVO_API_KEY;

// Parse a "from" string of the form `Name <email@x.com>` or `email@x.com`.
function parseFrom(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2].trim() };
  return { email: String(raw).trim() };
}

function senderIdentity() {
  return parseFrom(process.env.SMTP_FROM || process.env.MAIL_FROM || process.env.SMTP_USER);
}

// ---- Provider 1: Brevo HTTPS API ----
async function sendViaBrevo({ to, subject, text, html, replyTo, fromName }) {
  const from = senderIdentity();
  if (!from) {
    console.error("✉  Brevo: no sender configured (set SMTP_FROM to your verified sender email).");
    return false;
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: from.email, name: fromName || from.name || "My Study Guide" },
        to: [{ email: to }],
        subject,
        htmlContent: html || `<p>${text || ""}</p>`,
        textContent: text || undefined,
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      }),
    });
    if (res.ok) return true;
    const body = await res.text().catch(() => "");
    console.error("✉  Brevo send FAILED:", res.status, body);
    return false;
  } catch (err) {
    console.error("✉  Brevo send ERROR:", err.message);
    return false;
  }
}

// ---- Provider 2: SMTP ----
async function sendViaSmtp({ to, subject, text, html, replyTo, fromName }) {
  const t = getTransporter();
  if (!t) {
    console.log("✉  SMTP not configured — skipping email.");
    return false;
  }
  const raw = process.env.SMTP_FROM || process.env.SMTP_USER;
  // Prefix a display name (the site brand) when the address is a bare email.
  const from = fromName && raw && !/[<>]/.test(raw) ? `"${fromName}" <${raw}>` : raw;
  try {
    await t.sendMail({ from, to, subject, text, html, replyTo });
    return true;
  } catch (err) {
    console.error("✉  SMTP send FAILED:", err.message);
    return false;
  }
}

export async function sendMail({ to, subject, text, html, replyTo, fromName }) {
  // Prefer Brevo (works everywhere), otherwise fall back to SMTP.
  if (brevoConfigured()) return sendViaBrevo({ to, subject, text, html, replyTo, fromName });
  return sendViaSmtp({ to, subject, text, html, replyTo, fromName });
}

export function isMailConfigured() {
  return brevoConfigured() || !!getTransporter();
}

// Verifies the configured provider WITHOUT sending an email — used by the
// /api/health/mail diagnostic to surface the real reason when delivery fails.
export async function verifyMail() {
  if (brevoConfigured()) {
    try {
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" },
      });
      if (res.ok) return { configured: true, provider: "brevo", ok: true };
      const body = await res.text().catch(() => "");
      return { configured: true, provider: "brevo", ok: false, error: `Brevo API ${res.status}: ${body}` };
    } catch (err) {
      return { configured: true, provider: "brevo", ok: false, error: err.message };
    }
  }
  const t = getTransporter();
  if (!t) return { configured: false, ok: false, reason: "No email provider configured" };
  try {
    await t.verify();
    return { configured: true, provider: "smtp", ok: true };
  } catch (err) {
    return { configured: true, provider: "smtp", ok: false, error: err.message };
  }
}
