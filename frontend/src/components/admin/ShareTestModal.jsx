import { useState } from "react";
import { X, Share2, Copy, Check, Clock } from "lucide-react";
import { testService } from "../../services";

// Build the public URL for a share token (hash-router friendly). A My Quiz opens
// in the quiz-style player; everything else uses the exam-style test player.
const publicUrl = (token, kind) =>
  `${window.location.origin}${window.location.pathname}#/public/${kind === "quiz" ? "quiz" : "test"}/${token}`;

// ISO date -> value for <input type="datetime-local"> (local time).
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const fmtExpiry = (iso) =>
  new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Reusable "Share public link" modal for a test (regular Test Series OR a
 * practice My Test — both are TestSeries). Anyone with the link can take the
 * test with no account/login. Supports an optional expiry.
 *
 * Props:
 *  - test: { _id, name, publicShare, publicToken, publicExpiresAt }
 *  - onClose()
 *  - onUpdated(patch)  // { publicShare, publicToken, publicExpiresAt } to sync the list
 */
export default function ShareTestModal({ test, onClose, onUpdated }) {
  const [publicShare, setPublicShare] = useState(!!test.publicShare);
  const [token, setToken] = useState(test.publicToken || "");
  const [expiresAt, setExpiresAt] = useState(test.publicExpiresAt || null);
  const [expiryInput, setExpiryInput] = useState(toLocalInput(test.publicExpiresAt));
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const expired = expiresAt && new Date(expiresAt).getTime() < Date.now();

  const inputToIso = () => (expiryInput ? new Date(expiryInput).toISOString() : null);

  const apply = async (enable) => {
    setLoading(true);
    setError("");
    try {
      const res = await testService.togglePublicLink(test._id, enable, inputToIso());
      setPublicShare(res.publicShare);
      setToken(res.publicToken || "");
      setExpiresAt(res.publicExpiresAt || null);
      onUpdated?.({ publicShare: res.publicShare, publicToken: res.publicToken, publicExpiresAt: res.publicExpiresAt || null });
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await testService.togglePublicLink(test._id, false); // expiry untouched
      setPublicShare(res.publicShare);
      onUpdated?.({ publicShare: res.publicShare });
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl(token, test.practiceKind));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this public link:", publicUrl(token, test.practiceKind));
    }
  };

  const isLive = publicShare && token;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-8 w-full max-w-lg animate-scale-in card p-6">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Share2 className="h-5 w-5 text-emerald-600" /> Share Public Link</h3>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{test.name}</p>

        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>
        )}

        {isLive ? (
          <>
            <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
              Anyone with this link can take the test — <b>no account or login required</b>. Results are graded but not saved to any account.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <input readOnly value={publicUrl(token, test.practiceKind)} className="w-full bg-transparent text-sm outline-none" onFocus={(e) => e.target.select()} />
              <button onClick={copyLink} className="btn-primary flex-shrink-0 py-1.5 text-sm">
                {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
              </button>
            </div>

            {expired && (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                <Clock className="h-3.5 w-3.5" /> This link expired on {fmtExpiry(expiresAt)}. Update the expiry below to reactivate it.
              </p>
            )}

            {/* Expiry control */}
            <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><Clock className="h-4 w-4" /> Link expiry (optional)</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  value={expiryInput}
                  onChange={(e) => setExpiryInput(e.target.value)}
                  className="input py-1.5 text-sm"
                />
                {expiryInput && (
                  <button onClick={() => setExpiryInput("")} className="text-xs text-slate-400 hover:text-rose-600">Clear</button>
                )}
                <button onClick={() => apply(true)} disabled={loading} className="btn-outline py-1.5 text-sm">
                  {loading ? "Saving…" : "Save expiry"}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                {expiresAt && !expired ? `Currently expires ${fmtExpiry(expiresAt)}.` : "Leave empty for no expiry (link never expires)."}
              </p>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <a href={publicUrl(token, test.practiceKind)} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-600 hover:underline">Open link ↗</a>
              <button onClick={disable} disabled={loading} className="btn-outline py-1.5 text-sm text-rose-600">
                {loading ? "Turning off…" : "Turn off public link"}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-400">Turning it off disables the link immediately. Turning it back on restores the same link.</p>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              Generate a public link so anyone can take this test without creating an account or logging in.
            </p>
            <div className="mb-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><Clock className="h-4 w-4" /> Link expiry (optional)</label>
              <input
                type="datetime-local"
                value={expiryInput}
                onChange={(e) => setExpiryInput(e.target.value)}
                className="input py-1.5 text-sm"
              />
              <p className="mt-1.5 text-xs text-slate-400">Leave empty for no expiry.</p>
            </div>
            <button onClick={() => apply(true)} disabled={loading} className="btn-primary w-full">
              <Share2 className="h-4 w-4" /> {loading ? "Generating…" : "Create public link"}
            </button>
          </>
        )}

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="btn-outline">Close</button>
        </div>
      </div>
    </div>
  );
}
