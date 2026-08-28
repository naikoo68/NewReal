import { useEffect, useMemo, useState } from "react";
import { X, ArrowRightLeft, Loader2, ArrowRight } from "lucide-react";
import { practiceService } from "../../services";

// Cascading destination picker (Stream → Subject) with stable, memoized levels.
function Cascade({ levels, onChange }) {
  const [opts, setOpts] = useState([[]]);
  const [sel, setSel] = useState({});

  useEffect(() => {
    setSel({});
    setOpts([[]]);
    onChange?.({});
    levels[0].load().then((r) => setOpts([r || []])).catch(() => setOpts([[]]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels]);

  const pick = (i, value) => {
    const next = {};
    for (let k = 0; k < i; k++) next[levels[k].key] = sel[levels[k].key];
    next[levels[i].key] = value;
    setSel(next);
    onChange?.(next);
    setOpts((o) => o.slice(0, i + 1));
    const nextLevel = levels[i + 1];
    if (value && nextLevel) {
      nextLevel.load(value).then((r) => setOpts((o) => { const c = o.slice(0, i + 1); c[i + 1] = r || []; return c; })).catch(() => {});
    }
  };

  return (
    <div className="space-y-2">
      {levels.map((lv, i) => (
        <select
          key={lv.key + i}
          value={sel[lv.key] || ""}
          disabled={i > 0 && !sel[levels[i - 1].key]}
          onChange={(e) => pick(i, e.target.value)}
          className="input"
        >
          <option value="">{lv.label}</option>
          {(opts[i] || []).map((o) => <option key={o._id} value={o._id}>{o.name || o.title}</option>)}
        </select>
      ))}
    </div>
  );
}

// Bulk-move one or more My Quiz TOPICS to another subject (within My Quiz). Each
// topic's quizzes move with it. `topics` = [{ _id, name }].
export default function MigrateTopicsModal({ topics = [], onClose, onDone }) {
  const [dest, setDest] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  const levels = useMemo(() => [
    { key: "stream", label: "Stream…", load: () => practiceService.adminStreams("quiz") },
    { key: "subject", label: "Subject…", load: (v) => practiceService.adminSubjects(v) },
  ], []);

  const migrate = async () => {
    if (!dest.subject) { setMsg("Choose the destination subject."); setOk(false); return; }
    setBusy(true);
    setMsg("");
    let done = 0, failed = 0, lastErr = "";
    for (const t of topics) {
      try { await practiceService.moveTopic(t._id, { subject: dest.subject }); done++; }
      catch (e) { failed++; lastErr = e?.message || "failed"; }
    }
    setBusy(false);
    if (done && !failed) {
      setOk(true);
      setMsg(`✓ Moved ${done} topic${done === 1 ? "" : "s"}.`);
      setTimeout(() => { onDone?.(); onClose(); }, 900);
    } else if (done) {
      setOk(false);
      setMsg(`Moved ${done}, but ${failed} failed. ${lastErr}`);
      onDone?.();
    } else {
      setOk(false);
      setMsg(lastErr || "Could not move the topics.");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-12 w-full max-w-md animate-scale-in card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <ArrowRightLeft className="h-5 w-5 text-brand-600" /> Migrate {topics.length} topic{topics.length === 1 ? "" : "s"}
          </h3>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          Move the selected topic{topics.length === 1 ? "" : "s"} (and their quizzes) to another My Quiz subject.
        </p>
        <div className="mb-3 max-h-24 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          {topics.map((t) => t.name).join(", ")}
        </div>

        <label className="mb-1 block text-sm font-medium">Destination — Stream → Subject</label>
        <Cascade levels={levels} onChange={setDest} />

        {msg && <p className={`mt-3 text-sm font-medium ${ok ? "text-emerald-600" : "text-rose-600"}`}>{msg}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-outline">Cancel</button>
          <button onClick={migrate} disabled={busy || !dest.subject} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {busy ? "Moving…" : "Move here"}
          </button>
        </div>
      </div>
    </div>
  );
}
