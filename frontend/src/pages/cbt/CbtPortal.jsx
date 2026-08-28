import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MonitorCheck, Clock, FileText, Award, RefreshCw, CalendarClock, GraduationCap,
  Mail, User as UserIcon, Loader2, ShieldCheck, LogOut, CheckCircle2, Lock, Trophy, X,
} from "lucide-react";
import { cbtService } from "../../services";
import { useSettings } from "../../context/SettingsContext";
import { getCbtSession, setCbtSession, clearCbtSession } from "../../lib/cbtSession";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "");

/* -------- Login / Register card — shown before entering the portal --------
   Login: returning students sign in with email + password (no OTP).
   Register: new students set a password and verify their email once (OTP). */
function AuthCard({ onAuthed }) {
  const [mode, setMode] = useState("login"); // login | register
  const [stage, setStage] = useState("form"); // form | otp (register only)
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const reset = (nextMode) => { setMode(nextMode); setStage("form"); setError(""); setInfo(""); setCode(""); setPassword(""); };

  const login = async (e) => {
    e.preventDefault();
    setError("");
    if (!EMAIL_RE.test(email.trim())) return setError("Please enter a valid email address.");
    if (!password) return setError("Please enter your password.");
    setBusy(true);
    try {
      const v = await cbtService.loginPortal({ email: email.trim().toLowerCase(), password });
      onAuthed({ name: v.name, email: v.email, sessionToken: v.sessionToken });
    } catch (err) {
      if (err?.data?.noAccount) { setError("No account with this email — please register."); setMode("register"); setStage("form"); return; }
      setError(err.message || "Could not log in.");
    } finally {
      setBusy(false);
    }
  };

  const sendResetCode = async (e) => {
    e.preventDefault();
    setError("");
    if (!EMAIL_RE.test(email.trim())) return setError("Please enter a valid email address.");
    setBusy(true);
    try {
      const r = await cbtService.forgotPortal({ email: email.trim().toLowerCase() });
      setInfo(`We emailed a reset code to ${r.email}.`);
      setStage("otp");
    } catch (err) {
      if (err?.data?.noAccount) { setError("No account with this email — please register."); reset("register"); return; }
      setError(err.message || "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  const doReset = async (e) => {
    e.preventDefault();
    setError("");
    if (!/^\d{4,8}$/.test(code.trim())) return setError("Enter the code from your email.");
    if (password.length < 6) return setError("New password must be at least 6 characters.");
    setBusy(true);
    try {
      const v = await cbtService.resetPortal({ email: email.trim().toLowerCase(), code: code.trim(), password });
      onAuthed({ name: v.name, email: v.email, sessionToken: v.sessionToken });
    } catch (err) {
      setError(err.message || "Could not reset your password.");
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async (e) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Please enter your full name.");
    if (!EMAIL_RE.test(email.trim())) return setError("Please enter a valid email address.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    setBusy(true);
    try {
      const r = await cbtService.registerPortal({ name: name.trim(), email: email.trim().toLowerCase(), password });
      setInfo(`We emailed a 6-digit code to ${r.email}.`);
      setStage("otp");
    } catch (err) {
      if (err?.data?.existsVerified) { setError("You already have an account — please log in."); reset("login"); return; }
      setError(err.message || "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError("");
    if (!/^\d{4,8}$/.test(code.trim())) return setError("Enter the code from your email.");
    setBusy(true);
    try {
      const v = await cbtService.verifyPortal({ email: email.trim().toLowerCase(), code: code.trim() });
      onAuthed({ name: v.name || name.trim(), email: v.email, sessionToken: v.sessionToken });
    } catch (err) {
      setError(err.message || "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(""); setBusy(true);
    try {
      const r = await cbtService.registerPortal({ name: name.trim(), email: email.trim().toLowerCase(), password });
      setInfo(`A new code was sent to ${r.email}.`);
      setCode("");
    } catch (err) {
      setError(err.message || "Could not resend the code.");
    } finally {
      setBusy(false);
    }
  };

  const inputWrap = "flex items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700";

  return (
    <div className="mx-auto max-w-md">
      <div className="card p-7">
        <div className="mb-4 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 text-white">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h2 className="mt-3 text-lg font-extrabold">Sign in to take exams</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Log in, or register once, to see which exams are live.</p>
        </div>

        {/* Login / Register tabs */}
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button onClick={() => reset("login")} className={`rounded-lg py-2 text-sm font-semibold transition ${mode === "login" ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-500"}`}>Log in</button>
          <button onClick={() => reset("register")} className={`rounded-lg py-2 text-sm font-semibold transition ${mode === "register" ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-500"}`}>Register</button>
        </div>

        {mode === "login" ? (
          <form onSubmit={login} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-semibold">Email</label>
              <div className={inputWrap}>
                <Mail className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" className="w-full bg-transparent py-2.5 text-sm outline-none" autoFocus />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">Password</label>
              <div className={inputWrap}>
                <Lock className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Your password" className="w-full bg-transparent py-2.5 text-sm outline-none" />
              </div>
            </div>
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {busy ? "Signing in…" : "Log in"}
            </button>
            <div className="flex items-center justify-between text-xs">
              <button type="button" onClick={() => reset("register")} className="text-slate-500 hover:underline">New here? Register</button>
              <button type="button" onClick={() => reset("reset")} className="text-brand-600 hover:underline">Forgot password?</button>
            </div>
          </form>
        ) : mode === "reset" ? (
          stage === "form" ? (
            <form onSubmit={sendResetCode} className="space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">Enter your email and we'll send a code to reset your password.</p>
              <div>
                <label className="mb-1 block text-sm font-semibold">Email</label>
                <div className={inputWrap}>
                  <Mail className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" className="w-full bg-transparent py-2.5 text-sm outline-none" autoFocus />
                </div>
              </div>
              {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {busy ? "Please wait…" : "Send reset code"}
              </button>
              <p className="text-center text-xs text-slate-400">Remembered it? <button type="button" onClick={() => reset("login")} className="text-brand-600 hover:underline">Log in</button></p>
            </form>
          ) : (
            <form onSubmit={doReset} className="space-y-3">
              {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">{info}</p>}
              <div>
                <label className="mb-1 block text-sm font-semibold">Reset code</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  inputMode="numeric"
                  placeholder="______"
                  className="w-full rounded-xl border border-slate-200 py-2.5 text-center text-2xl font-bold tracking-[0.4em] outline-none dark:border-slate-700 dark:bg-slate-800"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold">New password</label>
                <div className={inputWrap}>
                  <Lock className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="New password (min 6 chars)" className="w-full bg-transparent py-2.5 text-sm outline-none" />
                </div>
              </div>
              {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {busy ? "Resetting…" : "Reset password & sign in"}
              </button>
              <div className="flex items-center justify-between text-xs">
                <button type="button" onClick={() => setStage("form")} className="text-slate-500 hover:underline">← Back</button>
                <button type="button" onClick={sendResetCode} disabled={busy} className="text-brand-600 hover:underline disabled:opacity-50">Resend code</button>
              </div>
            </form>
          )
        ) : stage === "form" ? (
          <form onSubmit={sendCode} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-semibold">Full name</label>
              <div className={inputWrap}>
                <UserIcon className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full bg-transparent py-2.5 text-sm outline-none" autoFocus />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">Email</label>
              <div className={inputWrap}>
                <Mail className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" className="w-full bg-transparent py-2.5 text-sm outline-none" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">Password</label>
              <div className={inputWrap}>
                <Lock className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Create a password (min 6 chars)" className="w-full bg-transparent py-2.5 text-sm outline-none" />
              </div>
              <p className="mt-1 text-xs text-slate-400">You'll verify your email with a code, then use this password to log in next time.</p>
            </div>
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {busy ? "Please wait…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">{info}</p>}
            <div>
              <label className="mb-1 block text-sm font-semibold">Enter the 6-digit code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                placeholder="______"
                className="w-full rounded-xl border border-slate-200 py-2.5 text-center text-2xl font-bold tracking-[0.4em] outline-none dark:border-slate-700 dark:bg-slate-800"
                autoFocus
              />
            </div>
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {busy ? "Verifying…" : "Verify & Continue"}
            </button>
            <div className="flex items-center justify-between text-xs">
              <button type="button" onClick={() => { setStage("form"); setError(""); setInfo(""); }} className="text-slate-500 hover:underline">← Back</button>
              <button type="button" onClick={resend} disabled={busy} className="text-brand-600 hover:underline disabled:opacity-50">Resend code</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// The single, public exam portal (one shareable link). Students register once
// here (name + email + OTP); then they see which exams are live/scheduled and
// can start any live one — no per-exam sign-in.
export default function CbtPortal() {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [session, setSession] = useState(getCbtSession());
  const [showChangePw, setShowChangePw] = useState(false);
  const [tab, setTab] = useState("exams"); // exams | results | rankings
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadExams = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError("");
    cbtService
      .portal(session.email)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [session]);
  useEffect(loadExams, [loadExams]);

  const onRegistered = (s) => { setCbtSession(s); setSession(s); };
  const signOut = () => { clearCbtSession(); setSession(null); setRows([]); };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="container-page flex items-center gap-3 py-5">
          {settings?.logoUrl ? (
            <img src={settings.logoUrl} alt={settings.siteName} className="h-10 w-10 rounded-xl object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 text-white">
              <GraduationCap className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-extrabold leading-none">{settings?.siteName || "Online Exams"}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Online Examination Portal</p>
          </div>
          {session && (
            <div className="flex items-center gap-2">
              <span className="hidden text-right sm:block">
                <span className="block text-sm font-semibold leading-none">{session.name}</span>
                <span className="block text-xs text-slate-400">{session.email}</span>
              </span>
              <button onClick={() => setShowChangePw(true)} className="btn-outline py-1.5 text-xs" title="Change your password"><Lock className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Password</span></button>
              <button onClick={signOut} className="btn-outline py-1.5 text-xs"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
            </div>
          )}
        </div>
      </header>

      <div className="container-page py-8">
        {!session ? (
          <>
            <div className="mb-6 text-center">
              <h1 className="flex items-center justify-center gap-2 text-2xl font-extrabold">
                <MonitorCheck className="h-6 w-6 text-brand-600" /> Exam Portal
              </h1>
              <p className="text-slate-500 dark:text-slate-400">Log in or register to see and take the available exams.</p>
            </div>
            <AuthCard onAuthed={onRegistered} />
          </>
        ) : (
          <>
            {/* Dashboard tabs */}
            <div className="mb-6 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {[
                { id: "exams", label: "Available Exams", icon: MonitorCheck },
                { id: "results", label: "My Completed Exams", icon: CheckCircle2 },
                { id: "rankings", label: "All Students' Ranks", icon: Trophy },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === t.id ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                >
                  <t.icon className="h-4 w-4" /> <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>

            {tab === "exams" && (
            <>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-extrabold">
                  <MonitorCheck className="h-6 w-6 text-brand-600" /> Available Exams
                </h1>
                <p className="text-slate-500 dark:text-slate-400">
                  Hi {session.name}! Pick a live exam to begin. Your scorecard &amp; rank are emailed once the exam ends.
                </p>
              </div>
              <button onClick={loadExams} disabled={loading} className="btn-outline">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>

            {loading ? (
              <Loading label="Loading exams..." />
            ) : error ? (
              <ErrorState message={error} onRetry={loadExams} />
            ) : rows.length === 0 ? (
              <EmptyState message="No exams are available right now. Please check back later." />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((r) => {
                  const scheduled = r.state === "scheduled";
                  return (
                    <div key={r._id} className="card flex flex-col p-5">
                      <div className="flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          {r.completed ? (
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Completed</span>
                          ) : scheduled ? (
                            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">Scheduled</span>
                          ) : (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Live</span>
                          )}
                          {r.context && <span className="truncate text-xs text-slate-400">{r.context}</span>}
                        </div>
                        <h2 className="text-lg font-bold leading-snug">{r.name}</h2>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1"><FileText className="h-4 w-4" /> {r.questionCount} questions</span>
                          <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" /> {r.duration} min</span>
                          <span className="inline-flex items-center gap-1"><Award className="h-4 w-4" /> {r.marks} marks</span>
                        </div>
                        {scheduled && r.startAt && (
                          <p className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400"><CalendarClock className="h-3.5 w-3.5" /> Opens {fmtDate(r.startAt)}</p>
                        )}
                        {r.lateEntryGranted ? (
                          <p className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><ShieldCheck className="h-3.5 w-3.5" /> Late entry granted — you can start</p>
                        ) : r.entryCloseAt ? (
                          <p className="mt-1 inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400"><CalendarClock className="h-3.5 w-3.5" /> Enter by {fmtDate(r.entryCloseAt)}</p>
                        ) : null}
                        {r.endAt && (
                          <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><CalendarClock className="h-3.5 w-3.5" /> Closes {fmtDate(r.endAt)}</p>
                        )}
                      </div>

                      {r.completed ? (
                        <div className="mt-4 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-2.5 text-sm font-medium text-slate-500 dark:bg-slate-800">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Submitted — result after it ends
                        </div>
                      ) : scheduled ? (
                        <button disabled className="btn-outline mt-4 w-full cursor-not-allowed opacity-60">
                          <CalendarClock className="h-4 w-4" /> Not open yet
                        </button>
                      ) : r.entryClosed ? (
                        <div className="mt-4 flex items-center justify-center gap-1.5 rounded-xl bg-rose-50 py-2.5 text-sm font-medium text-rose-600 dark:bg-rose-900/20 dark:text-rose-300">
                          <Clock className="h-4 w-4" /> Entry closed
                        </div>
                      ) : (
                        <button onClick={() => navigate(`/cbt/exam/${r.token}`)} className="btn-primary mt-4 w-full">
                          <MonitorCheck className="h-4 w-4" /> Start Exam
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <p className="mt-8 text-center text-xs text-slate-400">
              Results (score &amp; rank) are released after each exam ends and sent to your email. One attempt per exam.
            </p>
            </>
            )}

            {tab === "results" && <MyResultsTab session={session} />}
            {tab === "rankings" && <RankingsTab session={session} />}
          </>
        )}
      </div>

      {showChangePw && session && <ChangePasswordModal session={session} onClose={() => setShowChangePw(false)} />}
    </div>
  );
}

/* -------- Change-password modal (signed-in student) -------- */
function ChangePasswordModal({ session, onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const inputWrap = "flex items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700";

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (next.length < 6) return setError("New password must be at least 6 characters.");
    setBusy(true);
    try {
      await cbtService.changePassword({ email: session.email, sessionToken: session.sessionToken, currentPassword: current, newPassword: next });
      setDone(true);
      setTimeout(onClose, 1300);
    } catch (err) {
      setError(err.message || "Could not change password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-16 w-full max-w-sm animate-scale-in card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Lock className="h-5 w-5 text-brand-600" /> Change password</h3>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        {done ? (
          <div className="flex flex-col items-center gap-2 py-6 text-emerald-600">
            <CheckCircle2 className="h-10 w-10" />
            <p className="font-semibold">Password updated.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-semibold">Current password</label>
              <div className={inputWrap}>
                <Lock className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <input value={current} onChange={(e) => setCurrent(e.target.value)} type="password" placeholder="Current password" className="w-full bg-transparent py-2.5 text-sm outline-none" autoFocus />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">New password</label>
              <div className={inputWrap}>
                <Lock className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <input value={next} onChange={(e) => setNext(e.target.value)} type="password" placeholder="New password (min 6 chars)" className="w-full bg-transparent py-2.5 text-sm outline-none" />
              </div>
            </div>
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-outline">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                {busy ? "Saving…" : "Update"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* -------- Tab: the student's completed exams (with rank once released) -------- */
function MyResultsTab({ session }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true); setError("");
    cbtService
      .myResults(session.email, session.sessionToken)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [session]);
  useEffect(load, [load]);

  if (loading) return <Loading label="Loading your exams..." />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (rows.length === 0) return <EmptyState message="You haven't completed any exams yet." />;

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-xl font-extrabold"><CheckCircle2 className="h-5 w-5 text-emerald-600" /> My Completed Exams</h2>
      {rows.map((r, i) => (
        <div key={i} className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate font-bold">{r.examName}</p>
            <p className="text-xs text-slate-400">Submitted {fmtDate(r.submittedAt)}</p>
          </div>
          {r.released ? (
            <div className="flex items-center gap-4">
              <div className="text-center"><p className="text-lg font-extrabold text-brand-600 dark:text-brand-400">{r.score}/{r.maxScore}</p><p className="text-[11px] text-slate-500">score</p></div>
              <div className="text-center"><p className="text-lg font-extrabold text-brand-600 dark:text-brand-400">{r.percentage}%</p><p className="text-[11px] text-slate-500">percent</p></div>
              <div className="text-center"><p className="text-lg font-extrabold text-amber-600 dark:text-amber-400">#{r.rank || "—"}{r.candidates ? `/${r.candidates}` : ""}</p><p className="text-[11px] text-slate-500">rank</p></div>
              <a href={`#/cbt/result/${r.resultToken}`} target="_blank" rel="noreferrer" className="btn-outline py-1.5 text-xs">View result</a>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              <Clock className="h-3.5 w-3.5" /> Result after the exam ends{r.endAt ? ` (${fmtDate(r.endAt)})` : ""}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/* -------- Tab: all students' ranks (leaderboards for released exams) -------- */
function RankingsTab({ session }) {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [board, setBoard] = useState(null); // { name, rows } | { loading } | { error }

  const load = useCallback(() => {
    setLoading(true); setError("");
    cbtService
      .rankings(session.email, session.sessionToken)
      .then((r) => setExams(Array.isArray(r) ? r : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [session]);
  useEffect(load, [load]);

  const openBoard = (exam) => {
    setBoard({ loading: true });
    cbtService
      .examRankings(exam.token, session.email, session.sessionToken)
      .then((d) => setBoard(d))
      .catch((e) => setBoard({ error: e.message }));
  };

  if (board) {
    return (
      <div className="space-y-3">
        <button onClick={() => setBoard(null)} className="text-sm text-brand-600 hover:underline">← Back to exams</button>
        {board.loading ? (
          <Loading label="Loading rankings..." />
        ) : board.error ? (
          <ErrorState message={board.error} />
        ) : (
          <>
            <h2 className="flex items-center gap-2 text-xl font-extrabold"><Trophy className="h-5 w-5 text-amber-500" /> {board.name}</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                    <th className="px-3 py-2 text-left font-semibold">Rank</th>
                    <th className="px-3 py-2 text-left font-semibold">Name</th>
                    <th className="px-3 py-2 text-left font-semibold">Score</th>
                    <th className="px-3 py-2 text-left font-semibold">%</th>
                    <th className="px-3 py-2 text-left font-semibold">Correct</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((a) => (
                    <tr key={a.rank} className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${a.isYou ? "bg-brand-50 dark:bg-brand-900/20" : ""}`}>
                      <td className="px-3 py-2 font-bold">{a.rank <= 3 ? ["🥇", "🥈", "🥉"][a.rank - 1] : `#${a.rank}`}</td>
                      <td className="px-3 py-2 font-semibold">{a.name}{a.isYou && <span className="ml-1 text-xs font-normal text-brand-600">(you)</span>}</td>
                      <td className="px-3 py-2">{a.score}{a.maxScore != null ? `/${a.maxScore}` : ""}</td>
                      <td className="px-3 py-2">{a.percentage}%</td>
                      <td className="px-3 py-2">{a.correct}/{a.totalQ}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    );
  }

  if (loading) return <Loading label="Loading rankings..." />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (exams.length === 0) return <EmptyState message="No rankings yet — they appear once an exam's results are released." />;

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-xl font-extrabold"><Trophy className="h-5 w-5 text-amber-500" /> All Students' Ranks</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">Pick an exam to see the full ranking of all students.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {exams.map((e) => (
          <button key={e.token} onClick={() => openBoard(e)} className="card flex items-center justify-between gap-3 p-4 text-left hover:border-brand-300">
            <div className="min-w-0">
              <p className="truncate font-bold">{e.name}</p>
              <p className="text-xs text-slate-400">{e.candidates} candidate{e.candidates === 1 ? "" : "s"}</p>
            </div>
            <Trophy className="h-5 w-5 flex-shrink-0 text-amber-500" />
          </button>
        ))}
      </div>
    </div>
  );
}
