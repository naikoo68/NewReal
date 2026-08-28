import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Phone, MapPin, Send, CheckCircle2, Loader2, AlertCircle, LogIn, UserPlus, Lock } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";
import { messageService } from "../services";

const ICONS = { email: Mail, phone: Phone, address: MapPin };
const LABELS = { email: "Email", phone: "Phone", address: "Address" };

export default function Contact() {
  const { settings } = useSettings();
  const { user } = useAuth();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ subject: "", message: "" });

  const info = (settings.contacts || []).map((c) => ({
    icon: ICONS[c.type] || Mail,
    label: LABELS[c.type] || "Contact",
    value: c.value,
  }));

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await messageService.send(form);
      setSent(true);
    } catch (err) {
      setError(err.message || "Could not send your message. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page py-14">
      <div className="mx-auto max-w-2xl text-center">
        <span className="badge bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">Contact</span>
        <h1 className="mt-4 text-4xl font-extrabold">Get in touch</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">
          Questions, feedback or partnership ideas — we'd love to hear from you.
        </p>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          {info.map((i, idx) => (
            <div key={idx} className="card flex items-center gap-4 p-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <i.icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{i.label}</p>
                <p className="font-semibold">{i.value}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="card p-6 lg:col-span-2">
          {!user ? (
            /* Must have an account to contact */
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Lock className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-xl font-bold">Please sign in to contact us</h3>
              <p className="mt-2 max-w-md text-slate-600 dark:text-slate-400">
                To send us a message you need an account. It's free and takes less than a minute — this helps us respond to you directly.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link to="/register" className="btn-primary">
                  <UserPlus className="h-4 w-4" /> Create an account
                </Link>
                <Link to="/login" className="btn-outline">
                  <LogIn className="h-4 w-4" /> Log in
                </Link>
              </div>
            </div>
          ) : sent ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle2 className="h-14 w-14 text-emerald-500" />
              <h3 className="mt-4 text-xl font-bold">Message sent!</h3>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                Thanks for reaching out. We'll reply to <b>{user.email}</b> soon.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
                </div>
              )}
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                Sending as <b>{user.name}</b> ({user.email})
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Subject</label>
                <input required className="input" placeholder="How can we help?" value={form.subject} onChange={(e) => set("subject", e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Message</label>
                <textarea required rows={5} className="input resize-none" placeholder="Write your message..." value={form.message} onChange={(e) => set("message", e.target.value)} />
              </div>
              <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {busy ? "Sending..." : "Send Message"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
