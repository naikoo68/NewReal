import { useState } from "react";
import { Plus, Pencil, Trash2, Eye, X, Search, ChevronRight, Copy, Download, Clock, Upload, Sparkles, Globe, Library, Wand2, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";
import { Files } from "lucide-react";
import { questionDateText, searchQuestions } from "../../lib/questions";
import Badge from "../ui/Badge";
import { Loading, EmptyState } from "../ui/AsyncState";

/**
 * ManageTestQuestions — the modal content shown when you tap a test name.
 * If the test has subjects (subjectPlan), it shows a subject-based navigation:
 *   1) Subject list with progress bars (tap to drill in)
 *   2) Inside a subject: that subject's questions + ALL add options (manual, bulk,
 *      AI, import, bank) — each respects the subject's question limit.
 * If no subjects are defined, it shows a flat question list (original behavior).
 */
export default function ManageTestQuestions({
  qTest,
  tq,
  tqLoading,
  onClose,
  onAddQuestion,
  onEditQuestion,
  onDeleteQuestion,
  onDeleteSelected,
  onViewQuestion,
  onViewAll,
  onDuplicates,
  onCopyCsv,
  onDownloadCsv,
  onBulkUpload,
  onAiGenerate,
  onImportWeb,
  onPickFromBank,
  onAutoBuild,
  onExtendExplanations,
  onExtendQuestion,
  extendingId,
  onRegenerateQuestion,
  regeneratingId,
  onRegenerateAll,
}) {
  const [activeSubject, setActiveSubject] = useState(null);
  const [quickSubject, setQuickSubject] = useState(""); // subject-list "Quick add" target
  const [selectedTq, setSelectedTq] = useState([]);
  const [tqSearch, setTqSearch] = useState("");
  // Real-time progress while bulk-deleting selected questions.
  const [delProgress, setDelProgress] = useState(null); // { total, done, finished? } | null

  const toggleTqSelect = (id) => setSelectedTq((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const hasSubjects = qTest.subjectPlan?.length > 0;

  // Filter questions by active subject
  const subjectQuestions = activeSubject === "__unassigned__"
    ? tq.filter((q) => !q.section)
    : activeSubject
    ? tq.filter((q) => (q.section || "") === activeSubject)
    : tq;

  const filteredTq = searchQuestions(subjectQuestions, tqSearch) || subjectQuestions;

  // Calculate limit info for the active subject
  const plan = activeSubject && activeSubject !== "__unassigned__"
    ? (qTest.subjectPlan || []).find((p) => p.subject === activeSubject)
    : null;
  const subjectAdded = subjectQuestions.length;
  const subjectPlanned = plan?.count || 0;
  const subjectRemaining = subjectPlanned > 0 ? Math.max(0, subjectPlanned - subjectAdded) : Infinity;
  const isSubjectFull = subjectPlanned > 0 && subjectRemaining <= 0;

  const allSelected = subjectQuestions.length > 0 && selectedTq.length === subjectQuestions.length;
  const toggleAll = () => setSelectedTq(allSelected ? [] : subjectQuestions.map((x) => x._id));

  const handleDeleteSelected = async () => {
    if (!selectedTq.length || delProgress) return;
    const total = selectedTq.length;
    if (!window.confirm(`Delete ${total} selected question(s)? This cannot be undone.`)) return;
    setDelProgress({ total, done: 0 });
    try {
      // The parent reports progress after each question is deleted.
      await onDeleteSelected(selectedTq, (done) => setDelProgress({ total, done }));
      setDelProgress({ total, done: total, finished: true });
      setSelectedTq([]);
      setTimeout(() => setDelProgress(null), 3000);
    } catch {
      setDelProgress(null);
    }
  };

  // SUBJECT LIST VIEW
  if (hasSubjects && !activeSubject && !tqLoading) {
    return (
      <>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Tap a subject to manage its questions</p>

        {/* Quick add — add questions to ANY subject WITHOUT drilling in first.
            Pick the target subject, then choose how to add. Mirrors the add
            options inside a subject; Auto-build is test-wide (no subject). */}
        {(() => {
          const planSubjects = (qTest.subjectPlan || []).map((p) => p.subject).filter(Boolean);
          if (!planSubjects.length) return null;
          const target = quickSubject || planSubjects[0];
          const tPlan = (qTest.subjectPlan || []).find((p) => p.subject === target);
          const tAdded = tq.filter((q) => (q.section || "") === target).length;
          const tRemaining = tPlan?.count > 0 ? Math.max(0, tPlan.count - tAdded) : null;
          return (
            <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-900/50 dark:bg-brand-900/10">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Quick add to</span>
                <select
                  value={target}
                  onChange={(e) => setQuickSubject(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                >
                  {planSubjects.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {tRemaining != null && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tRemaining === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
                    {tRemaining === 0 ? "Complete" : `${tRemaining} remaining`}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => onAddQuestion(target)} className="btn-primary py-1.5 text-xs"><Plus className="h-3.5 w-3.5" /> Add Manually</button>
                <button onClick={() => onBulkUpload(target)} className="btn-outline py-1.5 text-xs"><Upload className="h-3.5 w-3.5" /> Bulk Upload</button>
                <button onClick={() => onAiGenerate(target)} className="btn-outline py-1.5 text-xs"><Sparkles className="h-3.5 w-3.5" /> AI Generate</button>
                <button onClick={() => onImportWeb(target)} className="btn-outline py-1.5 text-xs"><Globe className="h-3.5 w-3.5" /> Import from Web</button>
                <button onClick={() => onPickFromBank(target)} className="btn-outline py-1.5 text-xs"><Library className="h-3.5 w-3.5" /> Pick from Quizzes</button>
                {onAutoBuild && (
                  <button onClick={() => onAutoBuild(target)} className="btn-outline py-1.5 text-xs text-violet-600"><Wand2 className="h-3.5 w-3.5" /> Auto-build</button>
                )}
              </div>
            </div>
          );
        })()}

        <div className="mt-3 space-y-2">
          {(qTest.subjectPlan || []).map((p, i) => {
            const added = tq.filter((q) => (q.section || "") === p.subject).length;
            const planned = p.count || 0;
            const remaining = Math.max(0, planned - added);
            const isFull = planned > 0 && remaining === 0;
            return (
              <button
                key={i}
                onClick={() => { setActiveSubject(p.subject); setSelectedTq([]); setTqSearch(""); }}
                className="w-full rounded-xl border border-slate-200 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:hover:border-brand-600 dark:hover:bg-brand-900/20"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{p.subject}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {planned > 0 ? `${added} / ${planned} questions` : `${added} questions added`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {planned > 0 && (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isFull ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
                        {isFull ? "Complete" : `${remaining} remaining`}
                      </span>
                    )}
                    <ChevronRight className="h-5 w-5 text-slate-400" />
                  </div>
                </div>
                {planned > 0 && (
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className={`h-full rounded-full transition-all ${isFull ? "bg-emerald-500" : "bg-brand-500"}`}
                      style={{ width: `${Math.min(100, Math.round((added / planned) * 100))}%` }}
                    />
                  </div>
                )}
              </button>
            );
          })}
          {tq.some((q) => !q.section) && (
            <button
              onClick={() => { setActiveSubject("__unassigned__"); setSelectedTq([]); setTqSearch(""); }}
              className="w-full rounded-xl border border-dashed border-slate-300 p-4 text-left transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:hover:border-slate-500 dark:hover:bg-slate-800/50"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-500 dark:text-slate-400">Unassigned</p>
                  <p className="mt-1 text-xs text-slate-400">{tq.filter((q) => !q.section).length} questions (no subject)</p>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </div>
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Total: {tq.length} question{tq.length !== 1 ? "s" : ""}
            {qTest.subjectPlan.reduce((s, p) => s + (p.count || 0), 0) > 0 && (
              <> / {qTest.subjectPlan.reduce((s, p) => s + (p.count || 0), 0)} planned</>
            )}
          </span>
          <div className="flex flex-wrap gap-2">
            {tq.length > 0 && onExtendExplanations && (
              <button onClick={onExtendExplanations} className="btn-outline py-1.5 text-xs text-brand-600" title="AI: make all explanations detailed for this test">
                <Wand2 className="h-3.5 w-3.5" /> Extend Explanations
              </button>
            )}
            {tq.length > 0 && onRegenerateAll && (
              <button onClick={onRegenerateAll} className="btn-outline py-1.5 text-xs text-violet-600" title="AI: regenerate every question's options/answer (reshuffles pair/matching Column B)">
                <RefreshCw className="h-3.5 w-3.5" /> Regenerate All
              </button>
            )}
            {tq.length > 0 && (
              <button onClick={onViewAll} className="btn-outline py-1.5 text-xs">
                <Eye className="h-3.5 w-3.5" /> View All
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="btn-outline">Close</button>
        </div>
      </>
    );
  }

  // QUESTION LIST VIEW (inside a subject, or flat when no subjects defined)
  return (
    <>
      {/* Subject breadcrumb */}
      {hasSubjects && activeSubject && (
        <div className="mb-3 flex items-center gap-1 text-sm">
          <button onClick={() => { setActiveSubject(null); setSelectedTq([]); setTqSearch(""); }} className="rounded px-2 py-1 font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
            All Subjects
          </button>
          <ChevronRight className="h-4 w-4 text-slate-400" />
          <span className="rounded px-2 py-1 font-medium text-slate-700 dark:text-slate-200">
            {activeSubject === "__unassigned__" ? "Unassigned" : activeSubject}
          </span>
        </div>
      )}

      {/* Subject progress bar */}
      {activeSubject && activeSubject !== "__unassigned__" && plan && subjectPlanned > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{activeSubject}</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isSubjectFull ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
              {subjectAdded} / {subjectPlanned} {isSubjectFull ? "(Full)" : `(${subjectRemaining} remaining)`}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className={`h-full rounded-full transition-all ${isSubjectFull ? "bg-emerald-500" : "bg-brand-500"}`}
              style={{ width: `${Math.min(100, Math.round((subjectAdded / subjectPlanned) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* Action buttons — ALL ways to add questions to this subject */}
      <div className="mb-4 flex flex-wrap gap-2">
        {subjectQuestions.length > 0 && (
          <>
            <button onClick={onViewAll} className="btn-outline"><Eye className="h-4 w-4" /> View All</button>
            <button onClick={() => onCopyCsv(selectedTq.length ? subjectQuestions.filter((q) => selectedTq.includes(q._id)) : subjectQuestions)} className="btn-outline">
              <Copy className="h-4 w-4" /> Copy CSV{selectedTq.length ? ` (${selectedTq.length})` : ""}
            </button>
            <button onClick={() => onDownloadCsv(selectedTq.length ? subjectQuestions.filter((q) => selectedTq.includes(q._id)) : subjectQuestions)} className="btn-outline">
              <Download className="h-4 w-4" /> CSV{selectedTq.length ? ` (${selectedTq.length})` : ""}
            </button>
            <button onClick={onDuplicates} className="btn-outline"><Files className="h-4 w-4" /> Duplicates</button>
            {onExtendExplanations && (
              <button onClick={onExtendExplanations} className="btn-outline text-brand-600" title="AI: make all explanations detailed for this test"><Wand2 className="h-4 w-4" /> Extend Explanations</button>
            )}
            {onRegenerateAll && (
              <button onClick={onRegenerateAll} className="btn-outline text-violet-600" title="AI: regenerate every question's options/answer (reshuffles pair/matching Column B)"><RefreshCw className="h-4 w-4" /> Regenerate All</button>
            )}
          </>
        )}
      </div>

      {/* Add questions toolbar */}
      {isSubjectFull ? (
        <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          Subject full — {subjectPlanned}/{subjectPlanned} questions added
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Add questions</span>
            {activeSubject && subjectPlanned > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {subjectRemaining} remaining
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onAddQuestion(activeSubject)} className="btn-primary py-2 text-sm">
              <Plus className="h-4 w-4" /> Add Manually
            </button>
            <button onClick={() => onBulkUpload(activeSubject)} className="btn-outline py-2 text-sm">
              <Upload className="h-4 w-4" /> Bulk Upload
            </button>
            <button onClick={() => onAiGenerate(activeSubject)} className="btn-outline py-2 text-sm">
              <Sparkles className="h-4 w-4" /> AI Generate
            </button>
            <button onClick={() => onImportWeb(activeSubject)} className="btn-outline py-2 text-sm">
              <Globe className="h-4 w-4" /> Import from Web
            </button>
            <button onClick={() => onPickFromBank(activeSubject)} className="btn-outline py-2 text-sm">
              <Library className="h-4 w-4" /> Pick from Quizzes
            </button>
            {onAutoBuild && (
              <button onClick={() => onAutoBuild(activeSubject)} className="btn-outline py-2 text-sm text-violet-600">
                <Wand2 className="h-4 w-4" /> Auto-build
              </button>
            )}
          </div>
        </div>
      )}

      {tqLoading ? (
        <Loading label="Loading questions..." />
      ) : subjectQuestions.length === 0 ? (
        <EmptyState message={isSubjectFull ? "This subject has reached its question limit." : "No questions yet. Add one, or use Bulk Upload."} />
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
            <input value={tqSearch} onChange={(e) => setTqSearch(e.target.value)} placeholder="Search questions..." className="w-full bg-transparent text-sm outline-none" />
            {tqSearch && <button onClick={() => setTqSearch("")} className="flex-shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-brand-600" /> Select all
            </label>
            {tqSearch && filteredTq.length !== subjectQuestions.length && <span className="text-sm font-medium text-slate-500">{filteredTq.length} match{filteredTq.length === 1 ? "" : "es"}</span>}
            {delProgress ? (
              <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${delProgress.finished ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>
                {delProgress.finished ? (
                  <><CheckCircle2 className="h-4 w-4" /> Deleted {delProgress.total} question{delProgress.total === 1 ? "" : "s"} — done</>
                ) : (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Deleting {delProgress.done} of {delProgress.total}…</>
                )}
              </span>
            ) : selectedTq.length > 0 && (
              <>
                <span className="text-sm text-slate-500">{selectedTq.length} selected</span>
                <button onClick={handleDeleteSelected} className="btn-outline py-1.5 text-rose-600"><Trash2 className="h-4 w-4" /> Delete</button>
                <button onClick={() => setSelectedTq([])} className="text-sm text-slate-500 hover:underline">Clear</button>
              </>
            )}
          </div>
          {tqSearch && filteredTq.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700">No matches.</p>
          )}
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {filteredTq.map((item, i) => (
              <div key={item._id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex min-w-0 items-start gap-2">
                  <input type="checkbox" checked={selectedTq.includes(item._id)} onChange={() => toggleTqSelect(item._id)} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-brand-600" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium"><span className="text-slate-400">Q{i + 1}.</span> {item.text}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {item._match != null && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{item._match}%</span>}
                      {item.section && !activeSubject && <Badge variant="accent">{item.section}</Badge>}
                      <Badge variant={item.type === "matching" ? "accent" : "brand"}>{item.type === "matching" ? "Matching" : item.type || "MCQ"}</Badge>
                      <Badge variant={item.difficulty}>{item.difficulty}</Badge>
                      {item.correct !== undefined && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Ans: {String.fromCharCode(65 + item.correct)}</span>}
                      {questionDateText(item) && <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" /> {questionDateText(item)}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  {onExtendQuestion && (
                    <button onClick={() => onExtendQuestion(item)} disabled={extendingId === item._id} title="Extend this explanation with AI" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:hover:bg-brand-900/30">
                      {extendingId === item._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    </button>
                  )}
                  {onRegenerateQuestion && (
                    <button onClick={() => onRegenerateQuestion(item)} disabled={regeneratingId === item._id} title="Regenerate options/answer to fit the question (reshuffles pair/matching columns)" className="rounded-lg p-2 text-violet-600 hover:bg-violet-50 disabled:opacity-50 dark:hover:bg-violet-900/30">
                      {regeneratingId === item._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </button>
                  )}
                  <button onClick={() => onViewQuestion(item)} title="View" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"><Eye className="h-4 w-4" /></button>
                  <button onClick={() => onEditQuestion(item)} title="Edit" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => onDeleteQuestion(item._id)} title="Delete" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-6 flex justify-end">
        <button onClick={() => activeSubject ? setActiveSubject(null) : onClose()} className="btn-outline">
          {activeSubject ? "Back to Subjects" : "Close"}
        </button>
      </div>
    </>
  );
}
