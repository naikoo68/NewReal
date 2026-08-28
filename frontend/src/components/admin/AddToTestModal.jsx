import { useEffect, useMemo, useState } from "react";
import { X, Loader2, CheckCircle2, ClipboardList } from "lucide-react";
import { testService, practiceService } from "../../services";
import { Loading, ErrorState } from "../ui/AsyncState";

// Question fields copied when adding an existing question into a test.
// (Ids / timestamps / relations are intentionally omitted so a fresh copy is
// created inside the target test.)
const COPY_FIELDS = [
  "type", "text", "options", "correct", "optionExplanations", "explanation",
  "difficulty", "columnA", "columnB", "assertion", "reason", "tableRows",
  "graph", "image", "status",
];

const gid = (x) => (x && x._id ? String(x._id) : "none");
const gname = (x) => (x && x.name ? x.name : "Uncategorized");

// Distinct { id, name } list for one grouping level (keeps first-seen name).
function uniqueBy(rows, keyFn, nameFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, nameFn(r)); }
  return [...m.entries()].map(([id, name]) => ({ id, name }));
}

// Lets an admin (or a self-service client) add ONE existing question into a
// test, drilling down the SAME hierarchy used elsewhere:
//   • Test Series : Exam → Post → Test → (sub-subject / section)
//   • My Test     : Stream → Subject → Test → (sub-subject / section)
// The admin chooses the destination type (Test Series / My Test); a client
// (`clientMode`) can only add to their OWN My Test. The backend enforces the
// per-subject question limit.
export default function AddToTestModal({ question, onClose, clientMode = false }) {
  const [target, setTarget] = useState(clientMode ? "mytest" : "series"); // series | mytest
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aId, setAId] = useState(""); // Exam / Stream
  const [bId, setBId] = useState(""); // Post / Subject
  const [testId, setTestId] = useState("");
  const [section, setSection] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Grouping accessors differ by destination type.
  const isSeries = target === "series";
  const first = (t) => (isSeries ? t.exam : t.stream);
  const second = (t) => (isSeries ? t.post : t.subject);
  const labels = isSeries
    ? { a: "Exam", b: "Post", test: "Test series" }
    : { a: "Stream", b: "Subject", test: "My Test" };

  // (Re)load the list whenever the destination type changes; reset selections.
  useEffect(() => {
    setLoading(true);
    setError("");
    setAId(""); setBId(""); setTestId(""); setSection("");
    const loader = isSeries
      ? testService.adminList().then((rows) => (Array.isArray(rows) ? rows : []))
      : practiceService.myItems().then((rows) => (Array.isArray(rows) ? rows : []).filter((r) => r.kind === "test"));
    loader
      .then((rows) => setTests(rows))
      .catch((e) => setError(e.message || "Could not load tests."))
      .finally(() => setLoading(false));
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const levelA = useMemo(() => uniqueBy(tests, (t) => gid(first(t)), (t) => gname(first(t))), [tests, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const levelB = useMemo(
    () => uniqueBy(tests.filter((t) => gid(first(t)) === aId), (t) => gid(second(t)), (t) => gname(second(t))),
    [tests, aId, target] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const testOpts = useMemo(
    () => tests.filter((t) => gid(first(t)) === aId && gid(second(t)) === bId),
    [tests, aId, bId, target] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const selected = tests.find((t) => t._id === testId);
  const sections = Array.isArray(selected?.subjectPlan)
    ? selected.subjectPlan.map((p) => p.subject).filter(Boolean)
    : [];

  const add = async () => {
    if (!testId) { setError("Choose a test to add this question to."); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {};
      for (const f of COPY_FIELDS) if (question?.[f] !== undefined) payload[f] = question[f];
      if (section) payload.section = section;
      await testService.addQuestion(testId, payload);
      setDone(true);
      setTimeout(onClose, 1100);
    } catch (e) {
      setError(e?.message || "Could not add the question to that test.");
    } finally {
      setSaving(false);
    }
  };

  const kindLabel = isSeries ? "test series" : clientMode ? "tests" : "my tests";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-12 w-full max-w-md animate-scale-in card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <ClipboardList className="h-5 w-5 text-brand-600" /> Add question to a test
          </h3>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-2 py-8 text-emerald-600">
            <CheckCircle2 className="h-10 w-10" />
            <p className="font-semibold">Added to the test.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Admin picks the destination TYPE; clients only ever use My Test. */}
            {!clientMode && (
              <div className="flex gap-2">
                <button onClick={() => setTarget("series")} className={`flex-1 ${isSeries ? "btn-primary" : "btn-outline"}`}>
                  Add to Test Series
                </button>
                <button onClick={() => setTarget("mytest")} className={`flex-1 ${!isSeries ? "btn-primary" : "btn-outline"}`}>
                  Add to My Test
                </button>
              </div>
            )}

            {loading ? (
              <Loading label="Loading tests..." />
            ) : error && !tests.length ? (
              <ErrorState message={error} />
            ) : !tests.length ? (
              <p className="py-6 text-center text-sm text-slate-500">No {kindLabel} found. Create one first, then add questions to it.</p>
            ) : (
              <>
                {/* Level 1: Exam / Stream */}
                <div>
                  <label className="mb-1 block text-sm font-medium">{labels.a}</label>
                  <select className="input" value={aId} onChange={(e) => { setAId(e.target.value); setBId(""); setTestId(""); setSection(""); }}>
                    <option value="">— Select {labels.a.toLowerCase()} —</option>
                    {levelA.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>

                {/* Level 2: Post / Subject */}
                {aId && (
                  <div>
                    <label className="mb-1 block text-sm font-medium">{labels.b}</label>
                    <select className="input" value={bId} onChange={(e) => { setBId(e.target.value); setTestId(""); setSection(""); }}>
                      <option value="">— Select {labels.b.toLowerCase()} —</option>
                      {levelB.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                )}

                {/* Level 3: Test */}
                {aId && bId && (
                  <div>
                    <label className="mb-1 block text-sm font-medium">{labels.test}</label>
                    <select className="input" value={testId} onChange={(e) => { setTestId(e.target.value); setSection(""); }}>
                      <option value="">— Select test —</option>
                      {testOpts.map((t) => (
                        <option key={t._id} value={t._id}>
                          {t.name}{t.questionCount != null ? ` (${t.questionCount} Qs)` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Level 4: sub-subject / section (optional) */}
                {testId && sections.length > 0 && (
                  <div>
                    <label className="mb-1 block text-sm font-medium">Sub-subject / section <span className="font-normal text-slate-400">(optional)</span></label>
                    <select className="input" value={section} onChange={(e) => setSection(e.target.value)}>
                      <option value="">— No specific sub-subject —</option>
                      {sections.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-slate-400">Each sub-subject has a question limit; adding beyond it will be blocked.</p>
                  </div>
                )}

                {error && <p className="text-sm text-rose-600">{error}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={onClose} className="btn-outline">Cancel</button>
                  <button onClick={add} disabled={saving || !testId} className="btn-primary">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                    {saving ? "Adding…" : "Add to test"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
