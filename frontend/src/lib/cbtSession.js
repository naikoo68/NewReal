// The exam-portal sign-in session (kept in localStorage). A candidate registers
// once on the portal (name + email + OTP); the verified { name, email,
// sessionToken } is stored here and reused to start/submit any live exam.
const KEY = "mpm-cbt-session";

export function getCbtSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    return s && s.email && s.sessionToken ? s : null;
  } catch {
    return null;
  }
}

export function setCbtSession(session) {
  try { localStorage.setItem(KEY, JSON.stringify(session)); } catch { /* ignore */ }
}

export function clearCbtSession() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
