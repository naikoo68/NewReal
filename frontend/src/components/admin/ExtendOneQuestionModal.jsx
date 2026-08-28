import { useEffect, useState } from "react";
import { X, Wand2, Loader2, Server, KeyRound, StopCircle } from "lucide-react";
import { aiService } from "../../services";
import { useAuth } from "../../context/AuthContext";

/**
 * ExtendOneQuestionModal — in-app popup (replaces the native window.confirm)
 * asking whether AI should also fix off-category / wrong options and/or extend
 * the question length while it extends a SINGLE question's explanation.
 *
 * Props:
 *  - open: boolean
 *  - busy: boolean          — true while the extend request is running
 *  - onCancel()             — close without doing anything
 *  - onConfirm({ fixOptions, extendQuestion, shuffleOptions, model, mode })  — run the extend
 *  - modelPicker: boolean   — (optional) show an AI source + model chooser; adds model/mode to onConfirm
 *  - onStop()               — (optional) abort the in-flight extend; shows a Stop button while busy
 */
export default function ExtendOneQuestionModal({ open, busy, onCancel, onConfirm, modelPicker = false, onStop }) {
  const { user } = useAuth();
  const isClient = user?.role === "client" && user?.aiAccess;
  const canChooseSource = isClient && user?.aiAllowInbuilt !== false && user?.aiAllowSelf !== false;

  const [fixOptions, setFixOptions] = useState(false);
  const [extendQuestion, setExtendQuestion] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [srcMode, setSrcMode] = useState(user?.aiMode === "self" ? "self" : "inbuilt");
  const [status, setStatus] = useState(null);
  const [model, setModel] = useState("");

  useEffect(() => { if (open) { setFixOptions(false); setExtendQuestion(false); setShuffleOptions(false); } }, [open]);

  // Load the available models for the chosen source (only when the picker is shown).
  useEffect(() => {
    if (!open || !modelPicker) return;
    aiService
      .status(isClient ? srcMode : undefined)
      .then((s) => { setStatus(s); setModel(s?.model || (s?.models && s.models[0]) || ""); })
      .catch(() => setStatus({ enabled: false }));
  }, [open, modelPicker, srcMode, isClient]);

  if (!open) return null;

  const confirm = () => onConfirm({
    fixOptions,
    extendQuestion,
    shuffleOptions,
    ...(modelPicker ? { model: model || undefined, mode: isClient ? srcMode : undefined } : {}),
  });

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md animate-scale-in card p-6">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Wand2 className="h-5 w-5 text-brand-600" /> Extend explanation
          </h3>
          <button onClick={onCancel} disabled={busy}><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          AI will rewrite this question's explanation and per-option notes to be detailed and complete.
        </p>

        {modelPicker && (
          <div className="mb-3 space-y-2">
            {canChooseSource && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setSrcMode("inbuilt")} disabled={busy}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${srcMode === "inbuilt" ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300" : "border-slate-200 text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:text-slate-300"}`}>
                  <Server className="h-4 w-4" /> Built-in APIs
                </button>
                <button type="button" onClick={() => setSrcMode("self")} disabled={busy}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${srcMode === "self" ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300" : "border-slate-200 text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:text-slate-300"}`}>
                  <KeyRound className="h-4 w-4" /> My own APIs
                </button>
              </div>
            )}
            {status?.models && status.models.length > 1 && (
              <div>
                <label className="mb-1 block text-sm font-semibold">AI model</label>
                <select className="input" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
                  {status.models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-brand-600"
            checked={fixOptions}
            onChange={(e) => setFixOptions(e.target.checked)}
            disabled={busy}
          />
          <span>
            Also fix <b>off-category / wrong options</b> — replace any option that isn't the same type as
            the answer (e.g. a bird among tree names) with a closely-related one. The question &amp; correct
            answer stay the same.
          </span>
        </label>

        <label className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-brand-600"
            checked={extendQuestion}
            onChange={(e) => setExtendQuestion(e.target.checked)}
            disabled={busy}
          />
          <span>
            Also <b>extend the question length</b> — only if the stem genuinely needs it (a bare/terse
            stem) it's rewritten into a clearer question (kept to <b>at most 3 lines</b>); an already-clear
            one like "full form of…" or "SI unit of…" is left unchanged. The <b>meaning</b>, options and correct answer stay the same.
          </span>
        </label>

        <label className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-brand-600"
            checked={shuffleOptions}
            onChange={(e) => setShuffleOptions(e.target.checked)}
            disabled={busy}
          />
          <span>
            Also <b>reshuffle the options</b> — move the answer to a new position so it isn't always in the
            same place. The <b>same</b> option stays correct (assertion questions are left as-is).
          </span>
        </label>

        <div className="mt-6 flex justify-end gap-2">
          {busy && onStop ? (
            <button type="button" onClick={onStop} className="btn-outline text-rose-600">
              <StopCircle className="h-4 w-4" /> Stop
            </button>
          ) : (
            <button type="button" onClick={onCancel} disabled={busy} className="btn-outline">Cancel</button>
          )}
          <button type="button" onClick={confirm} disabled={busy} className="btn-primary">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Extending…</> : <><Wand2 className="h-4 w-4" /> Extend</>}
          </button>
        </div>
      </div>
    </div>
  );
}
