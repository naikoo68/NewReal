import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Star, Send, CheckCircle2, MessageSquarePlus, Loader2, Camera } from "lucide-react";
import { reviewService } from "../services";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";
import Avatar from "../components/ui/Avatar";
import { fileToResizedDataUrl } from "../lib/imageResize";

export default function WriteReview() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const [form, setForm] = useState({ name: "", exam: "", rating: 5, text: "", photo: "" });
  const [hover, setHover] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { window.scrollTo(0, 0); }, []);
  // Pre-fill the review from the signed-in user's account: their name and, by
  // default, their existing profile picture (they can still change either).
  useEffect(() => {
    if (!user) return;
    const isImg = (v) => typeof v === "string" && (v.startsWith("http") || v.startsWith("data:"));
    setForm((f) => ({
      ...f,
      name: f.name || user.name || "",
      photo: f.photo || (isImg(user.avatar) ? user.avatar : ""),
    }));
  }, [user]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { set("photo", await fileToResizedDataUrl(file, 256, 0.85)); }
    catch (ex) { setError(ex?.message || "Couldn't load that image."); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Please enter your name.");
    if (form.text.trim().length < 8) return setError("Please write a few words about your experience.");
    setBusy(true);
    try {
      await reviewService.submit(form);
      setDone(true);
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="container-page py-20">
        <div className="mx-auto max-w-lg text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckCircle2 className="h-8 w-8" />
          </span>
          <h1 className="mt-5 text-2xl font-extrabold">Thank you! 🙌</h1>
          <p className="mt-3 text-slate-600 dark:text-slate-300">
            Your review has been submitted. It will appear on our home page once our team approves it.
          </p>
          <Link to="/" className="btn-primary mt-6 inline-flex">Back to home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page py-14">
      <div className="mx-auto max-w-xl">
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <MessageSquarePlus className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-3xl font-extrabold">Share your experience</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-300">
            Tell other students how {settings.siteName} helped you. Your review may be featured on our home page.
          </p>
        </div>

        <form onSubmit={submit} className="card mt-8 space-y-4 p-6">
          <div className="flex items-center gap-4">
            <label className="group relative cursor-pointer" title="Add your photo">
              <Avatar src={form.photo} name={form.name} size={64} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100">
                <Camera className="h-5 w-5 text-white" />
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={onPhoto} />
            </label>
            <div>
              <p className="text-sm font-medium">Your photo <span className="font-normal text-slate-400">(optional)</span></p>
              <p className="text-xs text-slate-400">{user ? "Your account photo is used by default — tap to change it." : "Tap the circle to add a picture."}</p>
              {form.photo && (
                <button type="button" onClick={() => set("photo", "")} className="mt-1 text-xs text-rose-600 hover:underline">Remove photo</button>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Your name</label>
            <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Rahul Verma" maxLength={80} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Exam / role <span className="font-normal text-slate-400">(optional)</span></label>
            <input className="input" value={form.exam} onChange={(e) => set("exam", e.target.value)} placeholder="e.g. Cleared SSC CGL 2025, or NEET Aspirant" maxLength={120} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Your rating</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => set("rating", n)}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  className="p-0.5"
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                >
                  <Star className={`h-7 w-7 ${n <= (hover || form.rating) ? "fill-amber-400 text-amber-400" : "text-slate-300 dark:text-slate-600"}`} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Your review</label>
            <textarea rows={4} className="input resize-none" value={form.text} onChange={(e) => set("text", e.target.value)} placeholder="What did you like? How did it help your preparation?" maxLength={600} />
            <p className="mt-1 text-right text-xs text-slate-400">{form.text.length}/600</p>
          </div>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : <><Send className="h-4 w-4" /> Submit review</>}
          </button>
          <p className="text-center text-xs text-slate-400">Reviews are checked before they appear on the site.</p>
        </form>
      </div>
    </div>
  );
}
