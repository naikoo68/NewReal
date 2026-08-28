import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ShieldCheck, Mail, Lock, LogIn, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

export default function AdminLogin() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const [showPw, setShowPw] = useState(false);
  const [form, setForm] = useState({ email: "admin@mystudyguide.com", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const profile = await login(form.email, form.password);
      if (profile?.role !== "admin" && profile?.role !== "institute_admin") {
        logout();
        setError("This account does not have admin access.");
        return;
      }
      navigate("/admin");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 p-6">
      <div className="w-full max-w-md animate-scale-in rounded-2xl bg-white p-8 shadow-2xl dark:bg-slate-900">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 text-white">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold">Admin Login</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Secure access to the admin panel.
          </p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Admin Email</label>
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
                className="input pl-9"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                required
                type={showPw ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Enter admin password"
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
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {busy ? "Verifying..." : "Access Admin Panel"}
          </button>
        </form>

        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          Demo: <b>admin@mystudyguide.com</b> / <b>admin123</b>
        </p>

        <p className="mt-4 text-center text-sm text-slate-500">
          <Link to="/" className="hover:underline">← Back to site</Link>
        </p>
      </div>
    </div>
  );
}
