import { useEffect, useState, useRef } from "react";
import { X, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Server, KeyRound } from "lucide-react";
import { aiService } from "../../services";
import { useAuth } from "../../context/AuthContext";

// Which question types the bulk action can be limited to. "all" = every type.
const Q_TYPE_OPTIONS = [
  { value: "all", label: "All question types" },
  { value: "mcq", label: "Only MCQ" },
  { value: "matching", label: "Only Matching" },
  { value: "statement", label: "Only Statement" },
  { value: "pair", label: "Only Pair" },
  { value: "pairselect", label: "Only Pair-select" },
  { value: "assertion", label: "Only Assertion" },
  { value: "table", label: "Only Table" },
  { value: "journal", label: "Only Journal / Ledger" },
  { value: "diagram", label: "Only Diagram" },
  { value: "not_updated", label: "Only Not Updated" },
];

/**
 * RegenerateAllModal — AI-regenerates EVERY question in one quiz or test in
 * place: rebuilds the options, correct answer, explanation and per-option notes
 * to fit each stem, and reshuffles the Column B order of pair/matching
 * questions (recomputing the correct answer). Runs as a background job with
 * progress. Nothing about the question stem's meaning changes.
 *
 * Props:
 *  - open: boolean
 *  - target: { quiz } | { testSeries }  — the id set to regenerate
 *  - title: string  — the quiz/test name (shown in the header)
 *  - onClose()
 *  - onDone()  — called after a successful run so the parent can reload questions
 */
export default function RegenerateAllModal({ open, target, title, onClose, onDone }) {
  const { user } = useAuth();
  const isClient = user?.role === "client" && user?.aiAccess;
  const canChooseSource = isClient && user?.aiAllowInbuilt !== false && user?.aiAllowSelf !== false;
  const [srcMode, setSrcMode] = useState(user?.aiMode === "self" ? "self" : "inbuilt");
  const [status, setStatus] = useState(null);
  const [model, setModel] = useState("");
  const [notes, setNotes] = useState("");
  const [qType, setQType] = useState("all"); // limit to one question type, or "all"
  // Per-run toggles (default to the classic full-rebuild + reshuffle behaviour).
  const [fixOptions, setFixOptions] = useState(true);
  const [extendQuestion, setExtendQuestion] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [msg, setMsg] = useState("");
  const [keyStats, setKeyStats] = useState(null); // live per-key activity this run
  const jobRef = useRef(null);      // current background job id (for Cancel)
  const cancelRef = useRef(false);  // set true when the user cancels → stops polling

  useEffect(() => {
    if (!open) return;
    setMsg("");
    setProgress(null);
    setBusy(false);
    setNotes("");
    setQType("all");
    setFixOptions(true);
    setExtendQuestion(false);
    setShuffleOptions(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    aiService
      .status(isClient ? srcMode : undefined)
      .then((s) => { setStatus(s); setModel(s?.model || (s?.models && s.models[0]) || ""); })
      .catch(() => setStatus({ enabled: false }));
  }, [open, srcMode, isClient]);

  if (!open) return null;

  const cancel = async () => {
    cancelRef.current = true;
    setMsg("Cancelling…");
    try { if (jobRef.current) await aiService.cancelJob(jobRef.current); } catch { /* ignore */ }
  };

  const run = async () => {
    setBusy(true);
    setMsg("Starting…");
    setProgress(null);
    setKeyStats(null);
    cancelRef.current = false;
    try {
      const { jobId, requested } = await aiService.regenerateAll({
        ...target,
        model: model || undefined,
        notes: notes.trim() || undefined,
        mode: isClient ? srcMode : undefined,
        type: qType !== "all" ? qType : undefined,
        fixOptions,
        extendQuestion,
        shuffleOptions,
      });
      if (!jobId) throw new Error("Could not start.");
      jobRef.current = jobId;
      setProgress({ done: 0, total: requested });
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let done = false;
      let lastCount = 0;
      for (let i = 0; i < 400 && !done; i++) {
        await sleep(2000);
        if (cancelRef.current) {
          setMsg(`✓ Cancelled — kept the ${lastCount} question(s) already regenerated.`);
          onDone?.();
          break;
        }
        let s;
        try { s = await aiService.job(jobId); } catch { continue; }
        if (s.keyStats && Object.keys(s.keyStats).length) setKeyStats(s.keyStats);
        const total = s.requested || requested;
        lastCount = s.count ?? lastCount;
        if (s.status === "done") {
          const doneCount = s.updatedCount ?? s.count ?? total;
          setProgress({ done: doneCount, total });
          const note = s.error === "quota"
            ? " — the AI kept hitting its rate/quota limit even after waiting (often a DAILY free-tier limit). Add another API key or try later, then click “Regenerate all questions” to resume."
            : s.error === "partial" || doneCount < total
            ? ` — ${total - doneCount} couldn't be regenerated. Click “Regenerate all” again to finish them.`
            : "";
          setMsg(`✓ Regenerated ${doneCount} of ${total} question(s)${note}`);
          done = true;
          onDone?.();
        } else if (s.status === "error") {
          setMsg(s.error || "Failed.");
          done = true;
        } else {
          setProgress({ done: s.count || 0, total });
          const waitLeft = s.waitUntil ? Math.ceil((s.waitUntil - Date.now()) / 1000) : 0;
          setMsg(waitLeft > 0
            ? `⏳ AI rate limit reached at ${s.count || 0} of ${total} — auto-continuing in ${waitLeft}s…`
            : `Regenerating… ${s.count || 0} of ${total}`);
        }
      }
      if (!done) setMsg("Still working — this is taking longer than expected. It keeps running in the background; reopen later.");
    } catch (e) {
      setMsg(e.message || "Failed.");
    } finally {
      jobRef.current = null;
      setBusy(false);
    }
  };

  const pct = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="min-h-full w-full max-w-none animate-scale-in card m-0 rounded-none p-4 sm:rounded-2xl sm:p-6">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><RefreshCw className="h-5 w-5 text-violet-600" /> Regenerate all questions</h3>
          <button onClick={onClose} disabled={busy}><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{title}</p>

        {canChooseSource && (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-semibold">API source</label>
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
          </div>
        )}

        {status && !status.enabled ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> AI is not available</p>
            <p className="mt-1">{isClient ? "Add an API key in the AI tab, or ask your administrator." : "Add an API key in Admin → AI Keys to enable this."}</p>
          </div>
        ) : (
          <>
            <div className="mb-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              This rebuilds the <b>options, correct answer, explanation and per-option notes</b> of{" "}
              <b>every question</b> in this {target?.testSeries ? "test" : "quiz"} to fit each stem, and
              reshuffles the <b>Column B order</b> of pair/matching questions (recomputing the correct answer).
              The question wording &amp; meaning are kept.
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-sm font-semibold">Apply to</label>
              <select className="input" value={qType} onChange={(e) => setQType(e.target.value)} disabled={busy}>
                {Q_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose a single question type to regenerate only those (e.g. only Matching or only Pair), or leave on "All question types".</p>
            </div>

            {status?.models && status.models.length > 1 && (
              <div className="mb-3">
                <label className="mb-1 block text-sm font-semibold">AI model</label>
                <select className="input" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
                  {status.models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}

            <label className="mb-1 block text-sm font-semibold">Instructions (optional — followed strictly)</label>
            <textarea
              rows={2}
              className="input resize-y"
              placeholder='e.g. "Keep options in Hindi", "Make distractors harder", "Only NCERT facts"'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
            />

            <div className="mt-3 space-y-2">
              <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={fixOptions} onChange={(e) => setFixOptions(e.target.checked)} disabled={busy} />
                <span>
                  <b>Rebuild the options &amp; correct answer</b> — analyse each stem and replace options that
                  don't fit. Untick to KEEP every question's current options &amp; answer and only refresh the
                  explanation and per-option notes. (Assertion questions keep their fixed A/R options either way.)
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={extendQuestion} onChange={(e) => setExtendQuestion(e.target.checked)} disabled={busy} />
                <span>
                  Also <b>extend the question length</b> — only where a stem genuinely needs it (a bare/terse
                  stem) it's rewritten into a clearer question (kept to <b>at most 3 lines</b>); already-clear
                  stems are left unchanged. The meaning, options &amp; correct answer stay the same.
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={shuffleOptions} onChange={(e) => setShuffleOptions(e.target.checked)} disabled={busy} />
                <span>
                  <b>Reshuffle the options</b> — move each correct answer to a new position so it isn't always
                  in the same place. The same option stays correct (assertion questions are left as-is).
                </span>
              </label>
            </div>

            {progress && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>{progress.done} / {progress.total} regenerated</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}

            <button type="button" onClick={run} disabled={busy} className="btn-primary mt-4 w-full">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Regenerating…</> : <><RefreshCw className="h-4 w-4" /> Regenerate all questions</>}
            </button>
            {busy && (
              <button type="button" onClick={cancel} className="btn-outline mt-2 w-full text-rose-600">
                <X className="h-4 w-4" /> Cancel (keep what's done)
              </button>
            )}
          </>
        )}

        {msg && (
          <p className="mt-3 inline-flex items-center gap-1 text-sm font-medium">
            {msg.startsWith("✓") && <CheckCircle2 className="h-4 w-4 text-emerald-600" />} {msg}
          </p>
        )}

        {/* Live per-key activity — see every key working at once, in real time. */}
        {keyStats && Object.keys(keyStats).length > 0 && (
          <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Keys working this run ({Object.keys(keyStats).length}) · {Object.values(keyStats).reduce((a, s) => a + (s.requests || 0), 0)} requests · {Object.values(keyStats).reduce((a, s) => a + (s.questions || 0), 0)} done
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {Object.entries(keyStats).sort((a, b) => (b[1].requests || 0) - (a[1].requests || 0)).map(([label, s]) => (
                <div key={label} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">{label}</span>
                  <span className="flex flex-shrink-0 items-center gap-2 whitespace-nowrap">
                    <span className="text-slate-500 dark:text-slate-400">{s.requests || 0} req</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{s.questions || 0} done</span>
                    {s.limited > 0 && <span className="text-amber-600 dark:text-amber-400">{s.limited} limited</span>}
                    {s.error > 0 && <span className="text-rose-600 dark:text-rose-400">{s.error} err</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="btn-outline">Close</button>
        </div>
      </div>
    </div>
  );
}
