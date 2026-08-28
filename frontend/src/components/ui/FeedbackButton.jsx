import { useState } from "react";
import { MessageSquarePlus, X, CheckCircle2, Loader2, Star } from "lucide-react";
import { feedbackService } from "../../services";
import { useAuth } from "../../context/AuthContext";

// Reusable feedback button + modal. Used per-question (context="question") and
// on the result screens (context="quiz" | "test").
export default function FeedbackButton({ context = "question", questionText = "", source = "", questionNumber, details = "", question = null, label = "Feedback", className = "" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setError("");
    try {
      await feedbackService.send({ context, message, rating: rating || undefined, questionText, source, questionNumber, details, question, questionId: question?._id, name: user ? undefined : name, email: user ? undefined : email });
      setDone(true);
      setMessage("");
      setRating(0);
      setTimeout(() => { setOpen(false); setDone(false); }, 1200);
    } catch (e2) {
      setError(e2.message || "Could not send feedback");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className || "inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand-600 dark:text-slate-400"}
      >
        <MessageSquarePlus className="h-4 w-4" /> {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && setOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md animate-scale-in card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold">{context === "question" ? "Feedback on this question" : "Share your feedback"}</h3>
              <button type="button" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            </div>

            {done ? (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <CheckCircle2 className="h-5 w-5" /> Thanks! Your feedback was sent.
              </div>
            ) : (
              <>
                {questionText && context === "question" && (
                  <p className="mb-3 max-h-16 overflow-hidden rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{questionText}</p>
                )}
                {context !== "question" && (
                  <div className="mb-3 flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button type="button" key={n} onClick={() => setRating(n)} className={n <= rating ? "text-amber-400" : "text-slate-300 dark:text-slate-600"}>
                        <Star className="h-6 w-6" fill={n <= rating ? "currentColor" : "none"} />
                      </button>
                    ))}
                  </div>
                )}
                {user ? (
                  <p className="mb-3 text-xs text-slate-400">Sending as <b>{user.name}</b> ({user.email})</p>
                ) : (
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Your name" />
                    <input value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="Your email" type="email" />
                  </div>
                )}
                <textarea
                  required
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="input resize-none"
                  placeholder={context === "question" ? "Is something wrong or unclear with this question? Tell us…" : "How was your experience? Any suggestions?"}
                />
                {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
                <div className="mt-4 flex justify-end gap-3">
                  <button type="button" onClick={() => setOpen(false)} className="btn-outline">Cancel</button>
                  <button type="submit" disabled={busy} className="btn-primary">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}
