import { useEffect, useState, useCallback, useMemo } from "react";
import { X, Files, Trash2, RefreshCw, Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { contentService } from "../../services";
import { Loading, ErrorState } from "../ui/AsyncState";
import MathText from "../ui/MathText";
import AssertionReasonView from "../ui/AssertionReasonView";
import TableView from "../ui/TableView";
import GraphView from "../ui/GraphView";

const toRoman = (n) => ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][n] || String(n + 1);

const LETTERS = ["A", "B", "C", "D"];

const CONTEXT_STYLE = {
  Quiz: "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
  "Test Series": "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "Practice Quiz": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "Practice Test": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  Uncategorized: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

// Finds FULL-question duplicates (text + all options + type) scoped to each
// container: Quiz per subject, Test Series per test, Practice per item. Lets
// the admin view the full question and delete the extra copies.
// `scope` (optional) locks the scan to a fixed container and hides the subject
// dropdown — used by Practice, e.g. { practiceSubject: id } or { testSeries: id }.
// `scopeName` is shown in the banner. Without a scope, the quiz-subject dropdown
// is shown (used by Content).
export default function DuplicatesModal({
  open,
  onClose,
  defaultSubject = "all",
  defaultSubjectName = "",
  defaultCategory = "All",
  scope = null,
  scopeName = "",
  hideSubjectPicker = false,
}) {
  const [data, setData] = useState(null); // { scanned, groups, extras, duplicates }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState({}); // id -> true
  const [filter, setFilter] = useState(defaultCategory); // category filter
  const [expanded, setExpanded] = useState({}); // groupKey -> bool
  const [subjects, setSubjects] = useState([]); // for the subject dropdown
  const [subjectId, setSubjectId] = useState(defaultSubject || "all"); // "all" or a subject _id
  const [bulkBusy, setBulkBusy] = useState(false); // deleting all extras in one go
  const [bulkProgress, setBulkProgress] = useState(0);

  const scan = useCallback((params) => {
    setLoading(true);
    setError("");
    setExpanded({});
    contentService
      .duplicates(params)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    setFilter(defaultCategory || "All");
    if (scope) {
      // Fixed scope (practice) — scan it directly, no subject dropdown.
      scan(scope);
      return;
    }
    const sid = defaultSubject || "all";
    setSubjectId(sid);
    contentService.subjects().then(setSubjects).catch(() => setSubjects([]));
    scan({ subject: sid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultSubject, defaultCategory, JSON.stringify(scope), scan]);

  const onSubjectChange = (sid) => {
    setSubjectId(sid);
    scan({ subject: sid });
  };

  // Category tabs come from whatever categories actually have duplicates.
  const categories = useMemo(() => {
    const set = new Set((data?.duplicates || []).map((g) => g.category));
    return ["All", ...[...set]];
  }, [data]);

  const visible = useMemo(() => {
    const list = data?.duplicates || [];
    return filter === "All" ? list : list.filter((g) => g.category === filter);
  }, [data, filter]);

  if (!open) return null;

  const deleteOne = async (groupKey, id) => {
    if (!window.confirm("Delete this copy of the question? This cannot be undone.")) return;
    setDeleting((d) => ({ ...d, [id]: true }));
    try {
      await contentService.deleteQuestion(id);
      setData((prev) => {
        if (!prev) return prev;
        const duplicates = prev.duplicates
          .map((g, i) =>
            `${g.category}-${i}` === groupKey
              ? { ...g, questions: g.questions.filter((q) => q._id !== id), count: g.count - 1 }
              : g
          )
          .filter((g) => g.questions.length > 1); // resolved once one copy remains
        return {
          ...prev,
          duplicates,
          groups: duplicates.length,
          extras: duplicates.reduce((s, g) => s + (g.count - 1), 0),
        };
      });
    } catch (e) {
      window.alert(e.message || "Could not delete the question.");
    } finally {
      setDeleting((d) => ({ ...d, [id]: false }));
    }
  };

  // Delete EVERY extra copy in the currently-shown groups, keeping one of each
  // (prefers a published copy). One click instead of deleting them one by one.
  const deleteAllExtras = async () => {
    const groups = visible;
    const toDelete = [];
    groups.forEach((g) => {
      const qs = g.questions || [];
      if (qs.length < 2) return;
      const keep = qs.find((q) => q.status !== "draft") || qs[0]; // keep one (prefer published)
      qs.forEach((q) => { if (q._id !== keep._id) toDelete.push(q._id); });
    });
    if (!toDelete.length) return;
    if (!window.confirm(`Delete ${toDelete.length} extra copy(ies) across ${groups.length} group(s)? ONE copy of each question is kept. This cannot be undone.`)) return;
    setBulkBusy(true); setBulkProgress(0); setError("");
    const deletedIds = new Set();
    const BATCH = 8; // delete in small parallel batches
    try {
      for (let i = 0; i < toDelete.length; i += BATCH) {
        const slice = toDelete.slice(i, i + BATCH);
        const results = await Promise.allSettled(slice.map((id) => contentService.deleteQuestion(id)));
        results.forEach((r, k) => { if (r.status === "fulfilled") deletedIds.add(slice[k]); });
        setBulkProgress(Math.min(toDelete.length, i + slice.length));
      }
    } finally {
      setData((prev) => {
        if (!prev) return prev;
        const duplicates = prev.duplicates
          .map((g) => { const questions = g.questions.filter((q) => !deletedIds.has(q._id)); return { ...g, questions, count: questions.length }; })
          .filter((g) => g.questions.length > 1); // resolved groups drop off
        return { ...prev, duplicates, groups: duplicates.length, extras: duplicates.reduce((s, g) => s + (g.count - 1), 0) };
      });
      setBulkBusy(false);
      const failed = toDelete.length - deletedIds.size;
      if (failed) setError(`${deletedIds.size} deleted, ${failed} couldn't be deleted — click "Delete all extra copies" again to retry the rest.`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-3xl animate-scale-in card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Files className="h-5 w-5 text-brand-600" /> Duplicate Questions
          </h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => scan(scope || { subject: subjectId })} disabled={loading} className="btn-outline px-3 py-1.5 text-sm">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Rescan
            </button>
            <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
          </div>
        </div>

        {loading && !data ? (
          <Loading label="Scanning questions…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => scan(scope || { subject: subjectId })} />
        ) : data ? (
          <>
            {/* Scope banner — makes it clear what's being scanned */}
            {(scope || subjectId !== "all") && (
              <div className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 dark:bg-brand-900/20 dark:text-brand-300">
                Scanning duplicates only in: {scope ? scopeName || "this item" : defaultSubjectName || subjects.find((s) => s._id === subjectId)?.name || "this subject"}
              </div>
            )}

            {/* Subject picker (Content only) — scan one quiz subject or all */}
            {!scope && !hideSubjectPicker && (
              <div className="mb-3 flex items-center gap-2">
                <label className="text-sm font-semibold text-slate-600 dark:text-slate-300">Scan subject:</label>
                <select
                  className="input max-w-xs py-1.5 text-sm"
                  value={subjectId}
                  onChange={(e) => onSubjectChange(e.target.value)}
                >
                  <option value="all">All subjects (+ Test Series &amp; Practice)</option>
                  {subjects.map((s) => (
                    <option key={s._id} value={s._id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-3 flex flex-wrap gap-3 text-sm">
              <span className="rounded-lg bg-slate-100 px-3 py-1.5 dark:bg-slate-800">
                Scanned <b>{data.scanned}</b> questions
              </span>
              <span className="rounded-lg bg-slate-100 px-3 py-1.5 dark:bg-slate-800">
                <b>{data.groups}</b> duplicate group(s)
              </span>
              <span className="rounded-lg bg-rose-100 px-3 py-1.5 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                <b>{data.extras}</b> extra copies
              </span>
            </div>

            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              A question counts as a duplicate only when the <b>whole question</b> matches (text + all options). Duplicates
              are found <b>within</b> each container — Quiz per subject, Test Series and Practice separately.
            </p>

            {/* One-click cleanup: delete every extra copy, keep one of each. */}
            {visible.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={deleteAllExtras}
                  disabled={bulkBusy || loading}
                  className="btn-primary bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
                >
                  {bulkBusy
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting… {bulkProgress}</>
                    : <><Trash2 className="h-4 w-4" /> Delete all extra copies (keep one of each)</>}
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Removes every duplicate copy but keeps one of each{filter !== "All" ? ` in “${filter}”` : ""} (prefers a published copy).
                </span>
              </div>
            )}

            {/* Category tabs (Quiz / Test Series / Practice …) */}
            {categories.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setFilter(c)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      filter === c
                        ? "bg-brand-600 text-white"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}

            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-slate-500 dark:text-slate-400">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <p className="font-semibold">No duplicates found 🎉</p>
                <p className="text-sm">Every full question in this category is unique.</p>
              </div>
            ) : (
              <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
                {visible.map((g) => {
                  const gi = data.duplicates.indexOf(g);
                  const groupKey = `${g.category}-${gi}`;
                  const isOpen = expanded[groupKey];
                  return (
                    <div key={groupKey} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                          ×{g.count}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${CONTEXT_STYLE[g.category] || CONTEXT_STYLE.Uncategorized}`}>
                          {g.category}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{g.scopeName}</span>
                        <button
                          onClick={() => setExpanded((e) => ({ ...e, [groupKey]: !e[groupKey] }))}
                          className="ml-auto flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {isOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          {isOpen ? "Hide question" : "View question"}
                        </button>
                      </div>

                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        <MathText>{g.text}</MathText>
                      </p>

                      {/* Full question preview for confirmation — every detail */}
                      {isOpen && (
                        <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                          {g.image && <img src={g.image} alt="" className="mb-2 max-h-48 rounded-lg object-contain" />}

                          {/* Assertion & Reason */}
                          <AssertionReasonView q={g} />

                          {/* Table-based */}
                          <TableView q={g} />
                          <GraphView q={g} />

                          {/* Matching / pair columns */}
                          {(Array.isArray(g.columnA) && g.columnA.length > 0) || (Array.isArray(g.columnB) && g.columnB.length > 0) ? (
                            <div className="grid grid-cols-2 gap-3">
                              <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                                <p className="mb-1 text-[10px] font-semibold uppercase text-brand-600 dark:text-brand-400">Column A</p>
                                {(g.columnA || []).map((it, i) => (
                                  <div key={i} className="flex gap-1.5 text-xs">
                                    <b>{i + 1}.</b> <MathText>{it}</MathText>
                                  </div>
                                ))}
                              </div>
                              <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                                <p className="mb-1 text-[10px] font-semibold uppercase text-accent-600 dark:text-accent-400">Column B</p>
                                {(g.columnB || []).map((it, i) => (
                                  <div key={i} className="flex gap-1.5 text-xs">
                                    <b>{toRoman(i)}.</b> <MathText>{it}</MathText>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {/* Options */}
                          {(g.options || []).map((o, j) => (
                            <div
                              key={j}
                              className={`flex items-center gap-2 text-xs ${
                                j === g.correct ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-300"
                              }`}
                            >
                              <span className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${
                                j === g.correct ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-slate-600"
                              }`}>
                                {LETTERS[j]}
                              </span>
                              <MathText>{o}</MathText>
                              {j === g.correct && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                            </div>
                          ))}
                          <p className="pt-1 text-[11px] text-slate-400">Type: {g.type} · Difficulty: {g.difficulty}</p>
                        </div>
                      )}

                      {/* Each copy — keep one, delete the rest */}
                      <div className="mt-2 space-y-1.5">
                        {g.questions.map((q) => (
                          <div key={q._id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-slate-600 dark:text-slate-300">{q.location}</span>
                              {q.status === "draft" && <span className="text-amber-500">draft</span>}
                            </div>
                            <button
                              onClick={() => deleteOne(groupKey, q._id)}
                              disabled={deleting[q._id] || bulkBusy}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-900/30"
                            >
                              {deleting[q._id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}

        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="btn-outline">Close</button>
        </div>
      </div>
    </div>
  );
}
