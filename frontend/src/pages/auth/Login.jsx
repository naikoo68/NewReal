import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, LogIn, Loader2, AlertCircle } from "lucide-react";
import AuthShell, { GoogleButton } from "../../components/auth/AuthShell";
import OtpVerify from "../../components/auth/OtpVerify";
import AccountTypeTabs from "../../components/auth/AccountTypeTabs";
import { useAuth } from "../../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPw, setShowPw] = useState(false);
  const [acctType, setAcctType] = useState("student"); // guides the sign-up link
  const [otpStep, setOtpStep] = useState(null); // { email } when account needs verification
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const dest = location.state?.from || "/dashboard";
  // Route each role to its home: admins & institute admins → admin panel,
  // clients → My Practice workspace, students → their intended destination.
  const homeFor = (role) =>
    (role === "admin" || role === "institute_admin") ? "/admin" : role === "client" ? "/client" : dest;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const profile = await login(form.email, form.password);
      navigate(homeFor(profile?.role), { replace: true });
    } catch (err) {
      // Unverified account → move to the OTP verification step
      if (err.status === 403 && err.data?.needsVerification) {
        setOtpStep({ email: err.data.email || form.email });
        return;
      }
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  if (otpStep) {
    return (
      <AuthShell title="Verify to continue">
        <OtpVerify
          email={otpStep.email}
          autoResend
          onVerified={(profile) => navigate(homeFor(profile?.role), { replace: true })}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Welcome back" subtitle="Log in to your account.">
      <AccountTypeTabs active={acctType} onSelect={setAcctType} />
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              required
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              className="input pl-9"
            />
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm font-medium">Password</label>
            <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
              Forgot?
            </Link>
          </div>
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

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" />
          Remember me
        </label>

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {busy ? "Logging in..." : "Log In"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /> OR
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>

      <GoogleButton />

      {acctType === "client" ? (
        <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-300">
          New client?{" "}
          <Link to="/client/register" className="font-semibold text-accent-600 hover:underline dark:text-accent-400">
            Pick a plan &amp; sign up
          </Link>
        </p>
      ) : (
        <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-300">
          New here?{" "}
          <Link to="/register" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
            Create a student account
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
