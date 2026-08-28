import { useEffect, useState } from "react";
import { X, ArrowRightLeft, Loader2, CheckCircle2 } from "lucide-react";
import { practiceService } from "../../services";

// Move selected questions from a source quiz into ANY other quiz the admin
// owns — pick the destination by drilling Stream → Subject → Topic → Quiz
// (My-Quiz hierarchy), not just siblings in the same topic.
//
// Moves run ONE question at a time so the modal can show real-time progress
// ("Moving 12 of 70…") and, when done, a clear summary: how many moved, how
// many remain in this quiz, and the destination quiz's new total.
//
// Props:
//  - open, onClose
//  - sourceId:    the quiz the questions currently live in (excluded as a target)
//  - questionIds: ids to move/copy
//  - mode:        "move" (default) relocates the questions; "copy" duplicates
//                 them into the target and leaves the originals in place
//  - onMoved(res): called after a successful move/copy so the parent can refresh
export default function MoveQuestionsModal({ open, onClose, sourceId, questionIds = [], mode = "move", onMoved }) {
  const isCopy = mode === "copy";
  const verb = isCopy ? "Copy" : "Move";
  const verbing = isCopy ? "Copying" : "Moving";
  const [streams, setStreams] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [topics, setTopics] = useState([]);
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState({ stream: "", subject: "", topic: "", item: "" });
  const [progress, setProgress] = useState(null); // { done, total } while moving
  const [result, setResult] = useState(null); // { moved, sourceTotal, targetTotal, name } when finished
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setSel({ stream: "", subject: "", topic: "", item: "" });
    setSubjects([]); setTopics([]); setItems([]); setMsg(""); setProgress(null); setResult(null);
    practiceService.adminStreams("quiz").then(setStreams).catch(() => setStreams([]));
  }, [open]);

  if (!open) return null;

  const count = questionIds.length;
  const busy = !!progress;
  const targetItems = items.filter((it) => it._id !== sourceId);

  const Select = ({ value, onChange, placeholder, options, disabled }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="input py-2 text-sm disabled:opacity-60">
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o._id} value={o._id}>{o.name || o.title}</option>)}
    </select>
  );

  const doMove = async () => {
    if (!sel.item || busy || !count) return;
    const targetName = items.find((it) => it._id === sel.item)?.name || "the quiz";
    setMsg(""); setResult(null);
    setProgress({ done: 0, total: count });
    let last = null;
    try {
      let done = 0;
      // One at a time so progress ticks up live and the last response carries
      // the final source/target totals.
      for (const id of questionIds) {
        last = isCopy
          ? await practiceService.copyQuestions(sourceId, [id], sel.item)
          : await practiceService.moveQuestions(sourceId, [id], sel.item);
        done += 1;
        setProgress({ done, total: count });
      }
      setResult({ moved: done, sourceTotal: last?.sourceTotal, targetTotal: last?.targetTotal, name: targetName });
      onMoved?.({ moved: done, sourceTotal: last?.sourceTotal, targetTotal: last?.targetTotal });
    } catch (e) {
      setMsg(e.message || `${verb} failed.`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-10 w-full max-w-lg animate-scale-in card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <ArrowRightLeft className="h-5 w-5 text-brand-600" /> {verb} {count} question{count === 1 ? "" : "s"}
          </h3>
          <button type="button" onClick={onClose} disabled={busy}><X className="h-5 w-5" /></button>
        </div>

        {result ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900/50 dark:bg-emerald-900/20">
            <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> {isCopy ? "Copied" : "Moved"} {result.moved} question{result.moved === 1 ? "" : "s"} to “{result.name}”.
            </p>
            <ul className="mt-2 space-y-0.5 text-emerald-800 dark:text-emerald-200">
              {result.sourceTotal != null && <li>• This quiz {isCopy ? "still has" : "now has"} <b>{result.sourceTotal}</b> question{result.sourceTotal === 1 ? "" : "s"}{isCopy ? "." : " remaining."}</li>}
              {result.targetTotal != null && <li>• “{result.name}” now has <b>{result.targetTotal}</b> question{result.targetTotal === 1 ? "" : "s"}.</li>}
            </ul>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
              Choose any destination quiz — pick its Stream, Subject, Topic and Quiz.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select
                value={sel.stream}
                placeholder="Stream…"
                options={streams}
                disabled={busy}
                onChange={(v) => {
                  setSel({ stream: v, subject: "", topic: "", item: "" });
                  setSubjects([]); setTopics([]); setItems([]);
                  if (v) practiceService.adminSubjects(v).then(setSubjects).catch(() => setSubjects([]));
                }}
              />
              <Select
                value={sel.subject}
                placeholder="Subject…"
                options={subjects}
                disabled={busy}
                onChange={(v) => {
                  setSel((s) => ({ ...s, subject: v, topic: "", item: "" }));
                  setTopics([]); setItems([]);
                  if (v) practiceService.adminTopics(v).then(setTopics).catch(() => setTopics([]));
                }}
              />
              <Select
                value={sel.topic}
                placeholder="Topic…"
                options={topics}
                disabled={busy}
                onChange={(v) => {
                  setSel((s) => ({ ...s, topic: v, item: "" }));
                  setItems([]);
                  if (v) practiceService.adminTopicItems(v).then(setItems).catch(() => setItems([]));
                }}
              />
              <select value={sel.item} disabled={busy} onChange={(e) => setSel((s) => ({ ...s, item: e.target.value }))} className="input py-2 text-sm disabled:opacity-60">
                <option value="">Quiz…</option>
                {targetItems.map((it) => <option key={it._id} value={it._id}>{it.name} ({it.questionCount ?? 0})</option>)}
              </select>
            </div>
            {sel.topic && targetItems.length === 0 && (
              <p className="mt-2 text-xs text-slate-400">No other quiz in this topic — pick another topic, or create a quiz there first.</p>
            )}
          </>
        )}

        {busy && (
          <p className="mt-3 flex items-center gap-2 text-sm font-medium text-brand-600 dark:text-brand-300">
            <Loader2 className="h-4 w-4 animate-spin" /> {verbing} {progress.done} of {progress.total}…
          </p>
        )}
        {msg && <p className="mt-3 text-sm font-medium text-rose-600">{msg}</p>}

        <div className="mt-5 flex justify-end gap-2">
          {result ? (
            <button type="button" onClick={onClose} className="btn-primary">Done</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy} className="btn-outline">Cancel</button>
              <button type="button" onClick={doMove} disabled={!sel.item || busy || !count} className="btn-primary disabled:opacity-50">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {verbing}…</> : <><ArrowRightLeft className="h-4 w-4" /> {verb} here</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
