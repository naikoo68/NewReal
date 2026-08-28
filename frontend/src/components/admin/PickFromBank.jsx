import { useEffect, useState } from "react";
import { X, Library, Loader2, CheckCircle2, Eye, Maximize2, Minimize2 } from "lucide-react";
import { contentService, practiceService, testService } from "../../services";
import MathText from "../ui/MathText";
import QuestionView from "./QuestionView";

const LETTERS = ["A", "B", "C", "D"];
const CONTENT_FIELDS = ["text", "type", "options", "correct", "difficulty", "explanation", "optionExplanations", "columnA", "columnB", "tableRows", "graph", "assertion", "reason", "image"];
const cleanQ = (q) => {
  const o = {};
  CONTENT_FIELDS.forEach((k) => q[k] !== undefined && (o[k] = q[k]));
  o.status = "published";
  return o;
};

// Manually pick questions from existing Quizzes / Practice and copy them into a
// test. Drill down with the selects, tick the questions you want (across
// multiple quizzes), then "Add to test".
export default function PickFromBank({ open, onClose, testId, plan = [], title = "Add from Quizzes / Practice", onDone, practiceOnly = false, defaultSection = "" }) {
  const [tab, setTab] = useState(practiceOnly ? "practice" : "quiz"); // quiz | practice
  const [section, setSection] = useState(""); // subject to assign picked questions to
  const [questions, setQuestions] = useState([]);
  const [loadingQ, setLoadingQ] = useState(false);
  const [chosen, setChosen] = useState({}); // _id -> question object (persists across drilling)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [viewQ, setViewQ] = useState(null); // preview a question before picking
  const [full, setFull] = useState(true); // open full-screen by default (toggle to shrink)

  // Quiz drill
  const [subjects, setSubjects] = useState([]);
  const [topics, setTopics] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [sel, setSel] = useState({ subject: "", topic: "", session: "", quiz: "" });

  // Practice drill
  const [pKind, setPKind] = useState("quiz");
  const [pStreams, setPStreams] = useState([]);
  const [pSubjects, setPSubjects] = useState([]);
  const [pTopics, setPTopics] = useState([]);
  const [pItems, setPItems] = useState([]);
  const [pSel, setPSel] = useState({ stream: "", subject: "", topic: "", item: "" });

  useEffect(() => {
    if (!open) return;
    setTab(practiceOnly ? "practice" : "quiz");
    setChosen({});
    setQuestions([]);
    setMsg("");
    setSection(defaultSection || plan[0]?.subject || "");
    setSel({ subject: "", topic: "", session: "", quiz: "" });
    setPSel({ stream: "", subject: "", topic: "", item: "" });
    if (!practiceOnly) contentService.subjects().then(setSubjects).catch(() => setSubjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultSection]);

  useEffect(() => {
    if (!open || tab !== "practice") return;
    practiceService.adminStreams(pKind).then(setPStreams).catch(() => setPStreams([]));
    setPSel({ stream: "", subject: "", topic: "", item: "" });
    setPSubjects([]); setPTopics([]); setPItems([]); setQuestions([]);
  }, [open, tab, pKind]);

  if (!open) return null;

  const loadQuizQuestions = (quizId) => {
    setLoadingQ(true);
    contentService.quizQuestions(quizId).then(setQuestions).catch(() => setQuestions([])).finally(() => setLoadingQ(false));
  };
  const loadItemQuestions = (itemId) => {
    setLoadingQ(true);
    testService.getQuestions(itemId).then(setQuestions).catch(() => setQuestions([])).finally(() => setLoadingQ(false));
  };

  const toggle = (q) =>
    setChosen((c) => {
      const n = { ...c };
      if (n[q._id]) delete n[q._id];
      else n[q._id] = q;
      return n;
    });
  const selectAllVisible = () =>
    setChosen((c) => {
      const n = { ...c };
      questions.forEach((q) => (n[q._id] = q));
      return n;
    });
  // Deselect only the questions currently shown in this drill-down.
  const deselectAllVisible = () =>
    setChosen((c) => {
      const n = { ...c };
      questions.forEach((q) => delete n[q._id]);
      return n;
    });
  const clearAll = () => setChosen({}); // clear EVERY ticked question across all drill-downs

  const chosenCount = Object.keys(chosen).length;
  // How many of the currently-shown questions are ticked (drives Select/Deselect all).
  const shownSelectedCount = questions.reduce((k, q) => k + (chosen[q._id] ? 1 : 0), 0);
  const allShownSelected = questions.length > 0 && shownSelectedCount === questions.length;

  const add = async () => {
    if (!chosenCount) { setMsg("Tick at least one question."); return; }
    setBusy(true);
    setMsg("");
    try {
      const payload = Object.values(chosen).map(cleanQ);
      const res = await contentService.bulkQuestions(payload, { testSeries: testId, section: section || "" });
      const n = res?.inserted ?? 0;
      const skipped = (res?.requested ?? payload.length) - n;
      if (n > 0) {
        // Keep the picker OPEN so you can keep adding — clear only the ticked
        // set while preserving the current drill-down. This lets you add a
        // batch, then switch to another Topic/Subject/Quiz and add more into
        // the same test, instead of being kicked back to the test screen.
        setMsg(`✓ Added ${n} question(s) to the test${skipped > 0 ? ` (${skipped} skipped)` : ""}. Pick more (any topic/subject) and add again, or Close when done.`);
        setChosen({});
        onDone?.(n); // refresh the test's question count in the background
      } else {
        setMsg("No questions could be added — please try different questions.");
      }
    } catch (e) {
      setMsg(e.message || "Couldn't add questions.");
    } finally {
      setBusy(false);
    }
  };

  const Select = ({ value, onChange, placeholder, options, labelKey = "name" }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input py-1.5 text-sm">
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o._id} value={o._id}>{o[labelKey] || o.name || o.title}</option>)}
    </select>
  );

  return (
    <>
    <div className={`fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/50 ${full ? "items-stretch p-2 sm:p-4" : "items-start p-4"}`}>
      <div className={`card flex flex-col animate-scale-in p-6 ${full ? "m-0 h-full w-full max-w-none" : "my-8 w-full max-w-2xl"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Library className="h-5 w-5 text-brand-600" /> {title}</h3>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setFull((v) => !v)} title={full ? "Exit full screen" : "Full screen"} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              {full ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>
            <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Assign picked questions to a subject-section of this test */}
        <div className="mb-3 flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-600 dark:text-slate-300">Add to subject:</label>
          {plan.length > 0 ? (
            <select value={section} onChange={(e) => setSection(e.target.value)} className="input max-w-xs py-1.5 text-sm">
              {plan.map((p, i) => (
                <option key={i} value={p.subject}>
                  {p.subject}{p.count ? ` (plan: ${p.count})` : ""}
                </option>
              ))}
              <option value="">— No subject —</option>
            </select>
          ) : (
            <input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="Subject name (optional)"
              className="input max-w-xs py-1.5 text-sm"
            />
          )}
        </div>

        {/* Source tabs (hidden in practice-only mode — clients pick from their own) */}
        {!practiceOnly && (
          <div className="mb-3 flex gap-2">
            {["quiz", "practice"].map((t) => (
              <button key={t} onClick={() => { setTab(t); setQuestions([]); }}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === t ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                {t === "quiz" ? "From Quizzes" : "From Practice"}
              </button>
            ))}
          </div>
        )}

        {/* Drill-down selects */}
        {tab === "quiz" ? (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Select value={sel.subject} placeholder="Subject…" options={subjects}
              onChange={(v) => { setSel({ subject: v, topic: "", session: "", quiz: "" }); setQuestions([]); setTopics([]); setSessions([]); setQuizzes([]); if (v) contentService.topics(v).then(setTopics); }} />
            <Select value={sel.topic} placeholder="Topic…" options={topics} labelKey="title"
              onChange={(v) => { setSel((s) => ({ ...s, topic: v, session: "", quiz: "" })); setQuestions([]); setSessions([]); setQuizzes([]); if (v) contentService.sessions(v).then(setSessions); }} />
            <Select value={sel.session} placeholder="Session…" options={sessions} labelKey="title"
              onChange={(v) => { setSel((s) => ({ ...s, session: v, quiz: "" })); setQuestions([]); setQuizzes([]); if (v) contentService.quizzes(v).then(setQuizzes); }} />
            <Select value={sel.quiz} placeholder="Quiz…" options={quizzes} labelKey="title"
              onChange={(v) => { setSel((s) => ({ ...s, quiz: v })); if (v) loadQuizQuestions(v); else setQuestions([]); }} />
          </div>
        ) : (
          <div className="mb-3 space-y-2">
            <div className="flex gap-2">
              {["quiz", "test"].map((k) => (
                <button key={k} onClick={() => setPKind(k)}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold ${pKind === k ? "bg-accent-500 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                  {k === "quiz" ? "My Quiz" : "My Test"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={pSel.stream} placeholder="Stream…" options={pStreams}
                onChange={(v) => { setPSel({ stream: v, subject: "", topic: "", item: "" }); setQuestions([]); setPSubjects([]); setPTopics([]); setPItems([]); if (v) practiceService.adminSubjects(v).then(setPSubjects); }} />
              <Select value={pSel.subject} placeholder="Subject…" options={pSubjects}
                onChange={(v) => {
                  setPSel((s) => ({ ...s, subject: v, topic: "", item: "" })); setQuestions([]); setPTopics([]); setPItems([]);
                  if (v) { if (pKind === "quiz") practiceService.adminTopics(v).then(setPTopics); else practiceService.adminItems(v, "test").then(setPItems); }
                }} />
              {pKind === "quiz" && (
                <Select value={pSel.topic} placeholder="Topic…" options={pTopics}
                  onChange={(v) => { setPSel((s) => ({ ...s, topic: v, item: "" })); setQuestions([]); setPItems([]); if (v) practiceService.adminTopicItems(v).then(setPItems); }} />
              )}
              <Select value={pSel.item} placeholder="Quiz / Test…" options={pItems}
                onChange={(v) => { setPSel((s) => ({ ...s, item: v })); if (v) loadItemQuestions(v); else setQuestions([]); }} />
            </div>
          </div>
        )}

        {/* Questions with checkboxes */}
        <div className={`rounded-xl border border-slate-200 dark:border-slate-700 ${full ? "flex min-h-0 flex-1 flex-col" : ""}`}>
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
            <span className="font-semibold text-slate-500">{questions.length} question(s) here</span>
            {questions.length > 0 && (
              <div className="flex items-center gap-3">
                <button onClick={selectAllVisible} disabled={allShownSelected} className="font-semibold text-brand-600 hover:underline disabled:opacity-40 disabled:no-underline">Select all here</button>
                <button onClick={deselectAllVisible} disabled={shownSelectedCount === 0} className="font-semibold text-slate-500 hover:underline disabled:opacity-40 disabled:no-underline">Deselect all here</button>
              </div>
            )}
          </div>
          <div className={`space-y-1.5 overflow-y-auto p-2 ${full ? "min-h-0 flex-1" : "max-h-64"}`}>
            {loadingQ ? (
              <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
            ) : questions.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Pick a {tab === "quiz" ? "quiz" : "item"} above to see its questions.</p>
            ) : (
              questions.map((q) => (
                <div key={q._id} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                    <input type="checkbox" checked={!!chosen[q._id]} onChange={() => toggle(q)} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-brand-600" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-700 dark:text-slate-200"><MathText>{q.text}</MathText></span>
                      <span className="ml-2 text-slate-400">{q.type} · {q.difficulty} · Ans {LETTERS[q.correct] ?? "?"}</span>
                    </span>
                  </label>
                  <button type="button" onClick={() => setViewQ(q)} title="View full question" className="flex-shrink-0 rounded-lg p-1 text-slate-500 hover:bg-slate-200 hover:text-brand-600 dark:hover:bg-slate-700">
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {msg && <p className="mt-3 text-sm font-medium">{msg}</p>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            {chosenCount > 0 && (
              <>
                <CheckCircle2 className="h-4 w-4" /> {chosenCount} selected
                <button type="button" onClick={clearAll} className="font-medium text-slate-500 hover:underline dark:text-slate-400">Clear all</button>
              </>
            )}
          </span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-outline">Close</button>
            <button type="button" onClick={add} disabled={busy || !chosenCount} className="btn-primary">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Adding…</> : `Add ${chosenCount || ""} to Test`}
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* Full-question preview before picking (works for admins & clients). */}
    {viewQ && (
      <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setViewQ(null)}>
        <div onClick={(e) => e.stopPropagation()} className="my-8 w-full max-w-2xl animate-scale-in card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold">Question preview</h3>
            <button type="button" onClick={() => setViewQ(null)}><X className="h-5 w-5" /></button>
          </div>
          <QuestionView q={viewQ} {...(() => {
            const i = questions.findIndex((x) => x._id === viewQ._id);
            return {
              position: i >= 0 ? `${i + 1} / ${questions.length}` : undefined,
              onPrev: i > 0 ? () => setViewQ(questions[i - 1]) : undefined,
              onNext: i >= 0 && i < questions.length - 1 ? () => setViewQ(questions[i + 1]) : undefined,
            };
          })()} />
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => toggle(viewQ)} className={chosen[viewQ._id] ? "btn-primary" : "btn-outline"}>
              {chosen[viewQ._id] ? "✓ Selected — deselect" : "Select this question"}
            </button>
            <button type="button" onClick={() => setViewQ(null)} className="btn-outline">Close</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
