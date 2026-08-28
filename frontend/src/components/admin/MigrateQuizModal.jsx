import { useEffect, useMemo, useState } from "react";
import { X, ArrowRightLeft, Loader2, ArrowRight } from "lucide-react";
import { practiceService, contentService, testService } from "../../services";

// Cascading destination picker. `levels` = [{ key, label, load(parentId), labelKey }].
// Reports the full selection object up via onChange.
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
          {(opts[i] || []).map((o) => (
            <option key={o._id} value={o._id}>{o[lv.labelKey || "name"] || o.name || o.title}</option>
          ))}
        </select>
      ))}
    </div>
  );
}

// Per-quiz migration. `quiz` is a My Quiz practice item ({ _id, name }).
//   • Internal → move/copy it to another My Quiz Stream → Subject → Topic.
//   • External → move/copy it into a Content quiz (Stream → Subject → Topic → Session).
// External is admin-only (Content is platform), so it's hidden for clients.
export default function MigrateQuizModal({ quiz, clientMode = false, onClose, onDone }) {
  const [type, setType] = useState("internal"); // internal | external
  const [action, setAction] = useState("move"); // move | copy
  const [dest, setDest] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  // Memoized so their reference is STABLE across renders — otherwise the
  // Cascade's load effect (keyed on `levels`) re-fires every render, endlessly
  // resetting and so the Stream dropdown never populates.
  const internalLevels = useMemo(() => [
    { key: "stream", label: "Stream…", load: () => practiceService.adminStreams("quiz") },
    { key: "subject", label: "Subject…", load: (v) => practiceService.adminSubjects(v) },
    { key: "topic", label: "Topic…", load: (v) => practiceService.adminTopics(v) },
  ], []);
  const externalLevels = useMemo(() => [
    { key: "stream", label: "Stream…", load: () => contentService.streams() },
    { key: "subject", label: "Subject…", load: (v) => contentService.subjectsByStream(v) },
    { key: "topic", label: "Topic…", load: (v) => contentService.topics(v), labelKey: "title" },
    { key: "session", label: "Session…", load: (v) => contentService.sessions(v), labelKey: "title" },
  ], []);
  const levels = type === "internal" ? internalLevels : externalLevels;
  const requiredKeys = type === "internal" ? ["stream", "subject", "topic"] : ["session"];

  const setType_ = (t) => { setType(t); setDest({}); setMsg(""); setOk(false); };

  const migrate = async () => {
    if (requiredKeys.some((k) => !dest[k])) { setMsg("Choose the full destination."); setOk(false); return; }
    setBusy(true);
    setMsg("");
    try {
      if (type === "internal") {
        await practiceService.moveItem(quiz._id, {
          practiceStream: dest.stream, practiceSubject: dest.subject, practiceTopic: dest.topic, copy: action === "copy",
        });
      } else {
        await testService.toQuiz(quiz._id, { session: dest.session, copy: action === "copy" });
      }
      setOk(true);
      setMsg(`✓ ${action === "copy" ? "Copied" : "Moved"} “${quiz.name}”.`);
      setTimeout(() => { onDone?.(); onClose(); }, 900);
    } catch (e) {
      setOk(false);
      setMsg(e?.message || "Migration failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-12 w-full max-w-md animate-scale-in card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <ArrowRightLeft className="h-5 w-5 text-brand-600" /> Migrate quiz
          </h3>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Move or copy <b className="text-slate-700 dark:text-slate-200">{quiz.name}</b> to another location.
        </p>

        {/* Internal / External — admins only. Clients can migrate only WITHIN
            their own My Quiz (internal), so the toggle is hidden for them. */}
        {!clientMode && (
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setType_("internal")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${type === "internal" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}
            >
              Internal
              <span className="block text-[11px] font-normal opacity-80">My Quiz → My Quiz</span>
            </button>
            <button
              onClick={() => setType_("external")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${type === "external" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}
            >
              External
              <span className="block text-[11px] font-normal opacity-80">My Quiz → Content</span>
            </button>
          </div>
        )}

        <label className="mb-1 block text-sm font-medium">
          Destination — {type === "internal" ? "My Quiz Stream → Subject → Topic" : "Content Stream → Subject → Topic → Session"}
        </label>
        <Cascade key={type} levels={levels} onChange={setDest} />

        {msg && <p className={`mt-3 text-sm font-medium ${ok ? "text-emerald-600" : "text-rose-600"}`}>{msg}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            {["move", "copy"].map((a) => (
              <button
                key={a}
                onClick={() => setAction(a)}
                className={`px-4 py-1.5 text-sm font-semibold capitalize ${action === a ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300"}`}
              >
                {a}
              </button>
            ))}
          </div>
          <button onClick={migrate} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {busy ? (action === "copy" ? "Copying…" : "Moving…") : (action === "copy" ? "Copy here" : "Move here")}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {action === "copy"
            ? "Copy duplicates the quiz into the destination and keeps the original."
            : "Move relocates the quiz to the destination (original is moved, not duplicated)."}
        </p>
      </div>
    </div>
  );
}
