import { useEffect, useState } from "react";
import { UserCog, Loader2, Check, X, Pencil } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { authService } from "../../services";

const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
const phoneOk = (v) => v === "" || /^[+()\-\s\d]{6,30}$/.test(String(v || "").trim());

// Reusable "profile details" editor: view + edit name, email and phone.
// Works for any signed-in user (student or client) via PUT /auth/profile.
export default function ProfileEditCard({ className = "" }) {
  const { user, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Keep the form in sync with the current user whenever we (re)open the editor.
  useEffect(() => {
    setForm({ name: user?.name || "", email: user?.email || "", phone: user?.phone || "" });
  }, [user?.name, user?.email, user?.phone]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const startEdit = () => {
    setForm({ name: user?.name || "", email: user?.email || "", phone: user?.phone || "" });
    setErr(""); setMsg("");
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setErr(""); setMsg("");
    setForm({ name: user?.name || "", email: user?.email || "", phone: user?.phone || "" });
  };

  const save = async (e) => {
    e?.preventDefault?.();
    const name = form.name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();
    if (!name) return setErr("Please enter your name.");
    if (!emailOk(email)) return setErr("Please enter a valid email address.");
    if (!phoneOk(phone)) return setErr("Please enter a valid phone number, or leave it blank.");

    setBusy(true); setErr(""); setMsg("");
    try {
      await authService.updateProfile({ name, email, phone });
      await refreshUser();
      setEditing(false);
      setMsg("Your details were updated.");
    } catch (ex) {
      setErr(ex?.message || "Couldn't save — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card p-5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <UserCog className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-bold leading-none">My details</h2>
            <p className="mt-0.5 text-xs text-slate-400">Your name, email and phone number.</p>
          </div>
        </div>
        {!editing && (
          <button type="button" onClick={startEdit} className="btn-outline py-1.5 text-sm">
            <Pencil className="h-4 w-4" /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={set("name")}
              className="input w-full"
              placeholder="Your full name"
              maxLength={80}
              autoComplete="name"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={set("email")}
              className="input w-full"
              placeholder="you@example.com"
              autoComplete="email"
            />
            <p className="mt-1 text-[11px] text-slate-400">This is also the email you sign in with.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Phone <span className="font-normal text-slate-400">(optional)</span></label>
            <input
              type="tel"
              value={form.phone}
              onChange={set("phone")}
              className="input w-full"
              placeholder="+91 98765 43210"
              maxLength={30}
              autoComplete="tel"
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={busy} className="btn-primary py-1.5 text-sm">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save changes
            </button>
            <button type="button" onClick={cancel} disabled={busy} className="btn-ghost py-1.5 text-sm">
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold text-slate-400">Name</dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-700 dark:text-slate-200">{user?.name || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-400">Email</dt>
            <dd className="mt-0.5 break-all text-sm font-medium text-slate-700 dark:text-slate-200">{user?.email || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-400">Phone</dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-700 dark:text-slate-200">{user?.phone || "—"}</dd>
          </div>
        </dl>
      )}

      {msg && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{msg}</p>}
      {err && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{err}</p>}
    </div>
  );
}
