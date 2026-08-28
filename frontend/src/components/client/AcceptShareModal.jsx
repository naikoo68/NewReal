import { useEffect, useState, useRef } from "react";
import { X, Check, Loader2 } from "lucide-react";
import { practiceService } from "../../services";
import { runAcceptShareJob, acceptSharePercent } from "../../lib/acceptShareProgress";

// Dialog shown when accepting a shared subject / topic / quiz / test. It asks,
// for each container level the content needs (stream → subject → topic), whether
// to save it into an EXISTING container of the recipient's or CREATE a NEW one.
// A whole-stream share never opens this — it's accepted directly.
//
// Props:
//   share    — the pending ContentShare ({ _id, level, kind, title, ... })
//   onClose  — close without accepting
//   onDone   — called after a successful accept (host removes it + refreshes)
const LABEL = { stream: "Stream", subject: "Subject", topic: "Topic" };

export default function AcceptShareModal({ share, onClose, onDone }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null); // live { itemsSaved, itemsTotal, questionsSaved, questionsTotal } while the copy runs
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const [chain, setChain] = useState([]); // [{ level, suggestedName }]
  const [choice, setChoice] = useState({}); // level -> { mode:'existing'|'new', id, name }
  const [options, setOptions] = useState({ stream: [], subject: [], topic: [] }); // existing containers per level

  // Load the placement plan (which levels + suggested names) and the recipient's
  // existing streams for the first dropdown.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const plan = await practiceService.sharePlacement(share._id);
        const streams = await practiceService.adminStreams(share.kind).catch(() => []);
        if (!alive) return;
        const initial = {};
        for (const step of plan.chain) {
          // Default to "new" (pre-filled with the sender's name) so a first-time
          // recipient with an empty library can accept without extra clicks.
          initial[step.level] = { mode: "new", id: "", name: step.suggestedName || "" };
        }
        setChain(plan.chain);
        setChoice(initial);
        setOptions((o) => ({ ...o, stream: Array.isArray(streams) ? streams : [] }));
      } catch (e) {
        if (alive) setError(e.message || "Could not load save options.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [share._id, share.kind]);

  // When an existing stream/subject is chosen, load the children for the next
  // level's "existing" dropdown.
  const loadChildren = async (level, parentId) => {
    try {
      if (level === "subject") {
        const subs = await practiceService.adminSubjects(parentId);
        setOptions((o) => ({ ...o, subject: Array.isArray(subs) ? subs : [], topic: [] }));
      } else if (level === "topic") {
        const tops = await practiceService.adminTopics(parentId);
        setOptions((o) => ({ ...o, topic: Array.isArray(tops) ? tops : [] }));
      }
    } catch {
      /* leave existing options empty; user can still create new */
    }
  };

  const parentLevel = (level) => (level === "subject" ? "stream" : level === "topic" ? "subject" : null);

  // A level can only reuse an EXISTING container when its parent is also an
  // existing (already-saved) container — you can't pick an existing subject
  // under a brand-new stream.
  const canUseExisting = (level) => {
    const p = parentLevel(level);
    if (!p) return true;
    const pc = choice[p];
    return pc?.mode === "existing" && pc?.id;
  };

  const setMode = (level, mode) => {
    setChoice((c) => {
      const next = { ...c, [level]: { ...c[level], mode } };
      // If a parent becomes "new", its descendants can't reuse an existing
      // container, so force them back to "new" (and drop any selected ids).
      if (mode === "new") {
        if (level === "stream") {
          if (next.subject) next.subject = { ...next.subject, mode: "new", id: "" };
          if (next.topic) next.topic = { ...next.topic, mode: "new", id: "" };
        }
        if (level === "subject" && next.topic) next.topic = { ...next.topic, mode: "new", id: "" };
      }
      return next;
    });
    if (mode === "new") {
      if (level === "stream") setOptions((o) => ({ ...o, subject: [], topic: [] }));
      if (level === "subject") setOptions((o) => ({ ...o, topic: [] }));
    }
  };

  const setExistingId = (level, id) => {
    setChoice((c) => {
      const next = { ...c, [level]: { ...c[level], id } };
      // Reset descendants — their existing lists depend on this parent.
      if (level === "stream") { next.subject = next.subject ? { ...next.subject, mode: "new", id: "" } : next.subject; next.topic = next.topic ? { ...next.topic, mode: "new", id: "" } : next.topic; }
      if (level === "subject") { next.topic = next.topic ? { ...next.topic, mode: "new", id: "" } : next.topic; }
      return next;
    });
    if (id) loadChildren(level === "stream" ? "subject" : "topic", id);
    else setOptions((o) => (level === "stream" ? { ...o, subject: [], topic: [] } : { ...o, topic: [] }));
  };

  const setName = (level, name) => {
    setChoice((c) => ({ ...c, [level]: { ...c[level], name } }));
  };

  const valid = chain.every((step) => {
    const c = choice[step.level] || {};
    if (c.mode === "existing") return !!c.id;
    return !!String(c.name || "").trim();
  });

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try {
      const placement = {};
      for (const step of chain) {
        const c = choice[step.level];
        placement[step.level] = c.mode === "existing"
          ? { mode: "existing", id: c.id }
          : { mode: "new", name: String(c.name || "").trim() };
      }
      const { jobId, itemsTotal = 0, questionsTotal = 0 } = await practiceService.acceptShare(share._id, placement);
      setProgress({ status: "running", itemsSaved: 0, itemsTotal, questionsSaved: 0, questionsTotal });
      await runAcceptShareJob(jobId, setProgress, () => aliveRef.current);
      if (aliveRef.current) onDone?.();
    } catch (e) {
      setError(e.message || "Could not save. Please try again.");
      setSaving(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">Save shared content</h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Choose where to save <b>{share.title}</b> in your library.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        {progress ? (
          (() => {
            const pct = acceptSharePercent(progress);
            const remaining = progress.questionsTotal > 0
              ? progress.questionsTotal - progress.questionsSaved
              : progress.itemsTotal - progress.itemsSaved;
            const itemLabel = share.kind === "test" ? "Tests" : "Quizzes";
            return (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-semibold"><Loader2 className="h-4 w-4 animate-spin text-brand-600" /> Saving to your library…</span>
                  <span className="text-slate-500">{pct}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-brand-600 transition-all duration-300" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <p className="text-base font-bold text-brand-600 dark:text-brand-400">{progress.questionsSaved} / {progress.questionsTotal}</p>
                    <p className="text-slate-500">Questions saved</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <p className="text-base font-bold text-brand-600 dark:text-brand-400">{progress.itemsSaved} / {progress.itemsTotal}</p>
                    <p className="text-slate-500">{itemLabel} saved</p>
                  </div>
                </div>
                <p className="mt-2 text-center text-xs text-slate-400">{remaining} remaining · please keep this open until it finishes</p>
              </div>
            );
          })()
        ) : loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : error && !chain.length ? (
          <p className="py-6 text-sm text-rose-600">{error}</p>
        ) : (
          <div className="mt-4 space-y-4">
            {chain.map((step) => {
              const level = step.level;
              const c = choice[level] || {};
              const existingAllowed = canUseExisting(level);
              const opts = options[level] || [];
              return (
                <div key={level} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <p className="mb-2 text-sm font-semibold">{LABEL[level]}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => existingAllowed && setMode(level, "existing")}
                      disabled={!existingAllowed}
                      className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${c.mode === "existing" ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300" : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`}
                    >
                      Use existing
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode(level, "new")}
                      className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${c.mode === "new" ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300" : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`}
                    >
                      Create new
                    </button>
                  </div>

                  {c.mode === "existing" ? (
                    <select
                      value={c.id || ""}
                      onChange={(e) => setExistingId(level, e.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    >
                      <option value="">Select a {level}…</option>
                      {opts.map((o) => (<option key={o._id} value={o._id}>{o.name}</option>))}
                    </select>
                  ) : (
                    <input
                      value={c.name || ""}
                      onChange={(e) => setName(level, e.target.value)}
                      placeholder={`New ${level} name`}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    />
                  )}
                  {c.mode === "existing" && !existingAllowed && (
                    <p className="mt-1 text-[11px] text-slate-400">Pick an existing parent first to reuse an existing {level}.</p>
                  )}
                  {c.mode === "new" && (
                    <p className="mt-1 text-[11px] text-slate-400">If you already have a {level} with this name, a separate "(shared)" copy is created.</p>
                  )}
                </div>
              );
            })}

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="btn-outline py-2 text-sm">Cancel</button>
              <button onClick={submit} disabled={!valid || saving} className="btn-primary py-2 text-sm disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {saving ? "Saving…" : "Accept & save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
