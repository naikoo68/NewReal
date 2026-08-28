import { useEffect, useState } from "react";
import { X, Scale, Loader2, Plus, Trash2 } from "lucide-react";
import { contentService, practiceService, testService } from "../../services";

// "Give weightage": add subjects and how many questions each, then auto-pull
// that many RANDOM questions per subject from the existing bank into the test.
//   - includeQuizBank: also offer the platform Quiz subjects (admins).
//   - Practice ("My Quiz / My Test") subjects are always offered, scoped by the
//     backend to the caller (a client sees only their own).
export default function WeightageFill({
  open,
  onClose,
  testId,
  includeQuizBank = false,
  onDone,
  title = "Add by subject (weightage)",
}) {
  const [quizSubjects, setQuizSubjects] = useState([]);
  const [practiceSubjects, setPracticeSubjects] = useState([]);
  const [rows, setRows] = useState([{ value: "", count: 10 }]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setRows([{ value: "", count: 10 }]);
    setMsg("");
    setLoading(true);
    const jobs = [
      practiceService.allSubjects().then(setPracticeSubjects).catch(() => setPracticeSubjects([])),
    ];
    if (includeQuizBank) jobs.push(contentService.subjects().then(setQuizSubjects).catch(() => setQuizSubjects([])));
    Promise.all(jobs).finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const setRow = (i, patch) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { value: "", count: 10 }]);
  const removeRow = (i) => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));

  const submit = async () => {
    const quizPlan = [];
    const practicePlan = [];
    for (const r of rows) {
      const count = parseInt(r.count, 10) || 0;
      if (!r.value || count <= 0) continue;
      const [src, id] = r.value.split(":");
      if (src === "quiz") {
        const s = quizSubjects.find((x) => String(x._id) === id);
        quizPlan.push({ subject: id, count, section: s?.name || "" });
      } else {
        const s = practiceSubjects.find((x) => String(x._id) === id);
        practicePlan.push({ practiceSubject: id, count, section: s?.name || "" });
      }
    }
    if (!quizPlan.length && !practicePlan.length) {
      setMsg("Choose at least one subject and a question count.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const res = await testService.populate(testId, { quizPlan, practicePlan });
      const n = res?.inserted ?? 0;
      setMsg(n ? `✓ Added ${n} question(s) to the test.` : "No questions were found for those subjects.");
      if (n) {
        onDone?.(n);
        setTimeout(onClose, 1000);
      }
    } catch (e) {
      setMsg(e.message || "Couldn't add questions.");
    } finally {
      setBusy(false);
    }
  };

  const noSubjects = !loading && quizSubjects.length === 0 && practiceSubjects.length === 0;

  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-lg animate-scale-in card p-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Scale className="h-5 w-5 text-brand-600" /> {title}
          </h3>
          <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Choose a subject and how many questions to include. We pull that many random questions from your existing{" "}
          {includeQuizBank ? "quizzes / practice" : "quizzes"} into this test — set the weightage per subject.
        </p>

        {loading ? (
          <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
        ) : noSubjects ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
            No subjects with questions found yet. Build some quizzes first, then come back.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={r.value}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                  className="input flex-1 py-1.5 text-sm"
                >
                  <option value="">Choose a subject…</option>
                  {includeQuizBank && quizSubjects.length > 0 && (
                    <optgroup label="Quiz subjects">
                      {quizSubjects.map((s) => (
                        <option key={s._id} value={`quiz:${s._id}`}>{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {practiceSubjects.length > 0 && (
                    <optgroup label="My Practice subjects">
                      {practiceSubjects.map((s) => (
                        <option key={s._id} value={`practice:${s._id}`}>
                          {s.name}
                          {s.stream ? ` · ${s.stream}` : ""}
                          {s.kind ? ` (${s.kind === "quiz" ? "My Quiz" : "My Test"})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <input
                  type="number"
                  min="1"
                  value={r.count}
                  onChange={(e) => setRow(i, { count: e.target.value })}
                  className="input w-20 py-1.5 text-sm"
                  title="How many questions"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="flex-shrink-0 rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addRow} className="btn-outline w-full py-1.5 text-sm">
              <Plus className="h-4 w-4" /> Add subject
            </button>
          </div>
        )}

        {msg && <p className="mt-3 text-sm font-medium">{msg}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-outline">Close</button>
          <button type="button" onClick={submit} disabled={busy || loading || noSubjects} className="btn-primary">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Adding…</> : "Add questions"}
          </button>
        </div>
      </div>
    </div>
  );
}
