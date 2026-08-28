import { useEffect, useState } from "react";
import { Trash2, Check, Star, X, CheckCircle2, XCircle, ChevronRight, Pencil } from "lucide-react";
import { feedbackService, contentService } from "../../services";
import Badge from "../../components/ui/Badge";
import MathText from "../../components/ui/MathText";
import OptionContent from "../../components/ui/OptionContent";
import StatementPairView from "../../components/ui/StatementPairView";
import TableView from "../../components/ui/TableView";
import GraphView from "../../components/ui/GraphView";
import AssertionReasonView from "../../components/ui/AssertionReasonView";
import QuestionFormModal from "../../components/admin/QuestionFormModal";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

const toRoman = (n) => ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][n] || n + 1;

export default function AdminFeedback() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false); // edit the referenced question
  const [savingQ, setSavingQ] = useState(false);
  const [savedQ, setSavedQ] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    feedbackService.list().then((d) => setItems(d.items || [])).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const open = async (f) => {
    setSelected(f);
    if (!f.read) {
      try { await feedbackService.toggleRead(f._id, true); setItems((l) => l.map((x) => (x._id === f._id ? { ...x, read: true } : x))); } catch { /* ignore */ }
    }
  };
  const toggleRead = async (f) => {
    try {
      const r = await feedbackService.toggleRead(f._id, !f.read);
      setItems((l) => l.map((x) => (x._id === f._id ? { ...x, read: r.read } : x)));
    } catch (e) { setError(e.message); }
  };
  const remove = async (f) => {
    if (!window.confirm("Delete this feedback?")) return;
    try {
      await feedbackService.remove(f._id);
      setItems((l) => l.filter((x) => x._id !== f._id));
      if (selected?._id === f._id) setSelected(null);
    } catch (e) { setError(e.message); }
  };

  const saveQuestion = async (payload) => {
    if (!selected?.questionId) return;
    setSavingQ(true);
    try {
      await contentService.updateQuestion(selected.questionId, payload);
      // Reflect the edit in the open snapshot so the admin sees it immediately.
      const updatedSnap = { ...(selected.question || {}), ...payload };
      setSelected((s) => ({ ...s, question: updatedSnap, questionText: payload.text }));
      setItems((l) => l.map((x) => (x._id === selected._id ? { ...x, question: updatedSnap, questionText: payload.text } : x)));
      setEditing(false);
      setSavedQ(true);
      setTimeout(() => setSavedQ(false), 2500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingQ(false);
    }
  };

  const ctxVariant = (c) => (c === "question" ? "accent" : "brand");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Feedback</h1>
          <p className="text-slate-500 dark:text-slate-400">Tap a feedback to see the full question, the sender and their note.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {items.filter((f) => !f.read).length} new
        </span>
      </div>

      {loading ? (
        <Loading label="Loading feedback..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState message="No feedback yet." />
      ) : (
        <div className="space-y-3">
          {items.map((f) => (
            <button
              key={f._id}
              onClick={() => open(f)}
              className={`card flex w-full items-center justify-between gap-3 p-4 text-left transition hover:ring-2 hover:ring-brand-300 ${f.read ? "opacity-70" : ""}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={ctxVariant(f.context)}>{f.context}</Badge>
                  {f.rating ? <span className="flex items-center gap-0.5 text-xs text-amber-500">{f.rating}<Star className="h-3 w-3 fill-current" /></span> : null}
                  {f.source ? <span className="truncate text-xs text-slate-400">{f.source}</span> : null}
                  {f.questionNumber ? <span className="text-xs font-semibold text-slate-500">Q#{f.questionNumber}</span> : null}
                  {!f.read && <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">NEW</span>}
                </div>
                <p className="mt-1 truncate text-sm">{f.message}</p>
                <p className="mt-1 text-xs text-slate-400">{f.name}{f.email ? ` · ${f.email}` : ""} · {new Date(f.createdAt).toLocaleString()}</p>
              </div>
              <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-400" />
            </button>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div onClick={(e) => e.stopPropagation()} className="my-8 w-full max-w-2xl animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Feedback details</h3>
              <button onClick={() => setSelected(null)}><X className="h-5 w-5" /></button>
            </div>

            {/* Meta */}
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={ctxVariant(selected.context)}>{selected.context}</Badge>
              {selected.source && <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium dark:bg-slate-800">{selected.source}</span>}
              {selected.questionNumber ? <span className="text-xs font-semibold text-slate-500">Question #{selected.questionNumber}</span> : null}
              {selected.rating ? <span className="flex items-center gap-0.5 text-amber-500">{selected.rating}<Star className="h-4 w-4 fill-current" /></span> : null}
            </div>

            {/* Sender */}
            <div className="mb-4 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
              <p className="text-xs font-semibold uppercase text-slate-400">From</p>
              <p className="font-medium">{selected.name || "Guest"}</p>
              {selected.email && <a href={`mailto:${selected.email}`} className="text-brand-600 hover:underline dark:text-brand-400">{selected.email}</a>}
              <p className="mt-1 text-xs text-slate-400">{new Date(selected.createdAt).toLocaleString()}</p>
            </div>

            {/* The note / reason */}
            <div className="mb-4 rounded-xl bg-brand-50 p-3 dark:bg-brand-900/20">
              <p className="text-xs font-semibold uppercase text-brand-600 dark:text-brand-400">Reason / note</p>
              <p className="mt-1 text-sm">{selected.message}</p>
            </div>

            {/* The full question */}
            {(selected.question || selected.questionText) && (
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase text-slate-400">Question</p>
                  {selected.questionId && (
                    <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300">
                      <Pencil className="h-3.5 w-3.5" /> Edit question
                    </button>
                  )}
                </div>
                {savedQ && (
                  <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Question updated successfully.</p>
                )}
                <p className="font-semibold"><MathText>{selected.question?.text || selected.questionText}</MathText></p>

                {selected.question?.type === "matching" && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                      <p className="mb-1 text-xs font-semibold uppercase text-brand-600 dark:text-brand-400">Column A</p>
                      {(selected.question.columnA || []).map((it, k) => (
                        <div key={k} className="flex gap-1.5 text-sm"><span className="font-bold">{k + 1}.</span> <MathText>{it}</MathText></div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                      <p className="mb-1 text-xs font-semibold uppercase text-accent-600 dark:text-accent-400">Column B</p>
                      {(selected.question.columnB || []).map((it, k) => (
                        <div key={k} className="flex gap-1.5 text-sm"><span className="font-bold">{toRoman(k)}.</span> <MathText>{it}</MathText></div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.question && <StatementPairView q={selected.question} />}
                {selected.question && <TableView q={selected.question} />}
                {selected.question && <GraphView q={selected.question} />}
                {selected.question && <AssertionReasonView q={selected.question} />}

                {selected.question?.options && (
                  <div className="mt-3 space-y-2">
                    {selected.question.options.map((opt, idx) => {
                      const isCorrect = idx === selected.question.correct;
                      const isChosen = idx === selected.question.chosen;
                      let cls = "flex items-center gap-2 rounded-lg px-3 py-2 text-sm ";
                      if (isCorrect) cls += "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
                      else if (isChosen) cls += "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
                      else cls += "text-slate-500 dark:text-slate-400";
                      return (
                        <div key={idx} className={cls}>
                          {isCorrect ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : isChosen ? <XCircle className="h-4 w-4 flex-shrink-0" /> : <span className="h-4 w-4" />}
                          <span className="font-bold">({String.fromCharCode(97 + idx)})</span>
                          <OptionContent>{opt}</OptionContent>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selected.details && <p className="mt-3 text-xs text-slate-500">{selected.details}</p>}
                {selected.question?.explanation && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    <span className="font-semibold">Explanation: </span><MathText>{selected.question.explanation}</MathText>
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              {selected.questionId && (
                <button onClick={() => setEditing(true)} className="btn-outline text-brand-600"><Pencil className="h-4 w-4" /> Edit question</button>
              )}
              <button onClick={() => toggleRead(selected)} className="btn-outline"><Check className="h-4 w-4" /> Mark {selected.read ? "unread" : "read"}</button>
              <button onClick={() => remove(selected)} className="btn-outline text-rose-600"><Trash2 className="h-4 w-4" /> Delete</button>
              <button onClick={() => setSelected(null)} className="btn-primary">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit the question referenced by this feedback */}
      {editing && selected && (
        <QuestionFormModal
          question={selected.question || { text: selected.questionText }}
          saving={savingQ}
          onClose={() => setEditing(false)}
          onSave={saveQuestion}
        />
      )}
    </div>
  );
}
