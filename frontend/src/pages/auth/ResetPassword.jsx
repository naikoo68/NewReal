import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Lock, Eye, EyeOff, KeyRound, CheckCircle2, ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import AuthShell from "../../components/auth/AuthShell";
import { authService } from "../../services";

const MIN_LEN = 6;

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [showPw, setShowPw] = useState(false);
  const [form, setForm] = useState({ password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    if (form.password.length < MIN_LEN) {
      setError(`Password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await authService.resetPassword(token, form.password);
      setDone(true);
    } catch (err) {
      setError(err.message || "This reset link is invalid or has expired. Please request a new one.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthShell title="Password updated">
        <div className="card p-6 text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-brand-600" />
          <h3 className="mt-4 text-lg font-bold">All set!</h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Your password has been reset. You can now log in with your new password.
          </p>
          <button onClick={() => navigate("/login", { replace: true })} className="btn-primary mt-6 w-full">
            <ArrowLeft className="h-4 w-4" /> Back to login
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose a strong password for your account.">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium">New password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              required
              type={showPw ? "text" : "password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              className="input px-9"
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Confirm password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              required
              type={showPw ? "text" : "password"}
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              placeholder="••••••••"
              className="input pl-9"
            />
          </div>
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {busy ? "Updating..." : "Reset Password"}
        </button>
      </form>
      <Link
        to="/login"
        className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
      >
        <ArrowLeft className="h-4 w-4" /> Back to login
      </Link>
    </AuthShell>
  );
}
