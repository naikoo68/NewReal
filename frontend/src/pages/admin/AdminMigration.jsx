import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Loader2, ArrowRight } from "lucide-react";
import { practiceService, contentService, examService, testService } from "../../services";

// ---- Level definitions (cascading dropdowns) ----
// Each level: { key, label, load(parentId) → [{_id, name|title}], labelKey }
const L = {
  // My Quiz (practice) — down to the item
  pqStream: { key: "stream", label: "Stream…", load: () => practiceService.adminStreams("quiz") },
  pqSubject: { key: "subject", label: "Subject…", load: (v) => practiceService.adminSubjects(v) },
  pqTopic: { key: "topic", label: "Topic…", load: (v) => practiceService.adminTopics(v) },
  pqItem: { key: "item", label: "Quiz…", load: (v) => practiceService.adminTopicItems(v) },
  // My Test (practice) — item lives under a subject
  ptStream: { key: "stream", label: "Stream…", load: () => practiceService.adminStreams("test") },
  ptSubject: { key: "subject", label: "Subject…", load: (v) => practiceService.adminSubjects(v) },
  ptItem: { key: "item", label: "Test…", load: (v) => practiceService.adminItems(v, "test") },
  // Content (platform quizzes)
  cStream: { key: "stream", label: "Stream…", load: () => contentService.streams() },
  cSubject: { key: "subject", label: "Subject…", load: (v) => contentService.subjectsByStream(v) },
  cTopic: { key: "topic", label: "Topic…", load: (v) => contentService.topics(v), labelKey: "title" },
  cSession: { key: "session", label: "Session…", load: (v) => contentService.sessions(v), labelKey: "title" },
  cQuiz: { key: "quiz", label: "Quiz…", load: (v) => contentService.quizzes(v), labelKey: "title" },
  // Test Series (platform)
  exam: { key: "exam", label: "Exam…", load: () => examService.exams() },
  post: { key: "post", label: "Post…", load: (v) => examService.posts(v) },
  test: { key: "test", label: "Test…", load: (v) => testService.adminList(v) },
};

// ---- Flow config per (tab.type.variant) ----
// sourceKey/destKeys tell us which selected ids to read; migrate() calls the API.
function getFlow(key) {
  switch (key) {
    // QUIZ · Internal
    case "quiz.internal.myquiz":
      return {
        source: [L.pqStream, L.pqSubject, L.pqTopic, L.pqItem], sourceKey: "item",
        dest: [L.pqStream, L.pqSubject, L.pqTopic], destKeys: ["stream", "subject", "topic"],
        migrate: (s, d, copy) => practiceService.moveItem(s.item, { practiceStream: d.stream, practiceSubject: d.subject, practiceTopic: d.topic, copy }),
      };
    case "quiz.internal.content":
      return {
        source: [L.cStream, L.cSubject, L.cTopic, L.cSession, L.cQuiz], sourceKey: "quiz",
        dest: [L.cStream, L.cSubject, L.cTopic, L.cSession], destKeys: ["session"],
        migrate: (s, d, copy) => contentService.moveQuiz(s.quiz, { session: d.session, copy }),
      };
    // QUIZ · External
    case "quiz.external.toContent":
      return {
        source: [L.pqStream, L.pqSubject, L.pqTopic, L.pqItem], sourceKey: "item",
        dest: [L.cStream, L.cSubject, L.cTopic, L.cSession], destKeys: ["session"],
        migrate: (s, d, copy) => testService.toQuiz(s.item, { session: d.session, copy }),
      };
    case "quiz.external.toMyQuiz":
      return {
        source: [L.cStream, L.cSubject, L.cTopic, L.cSession, L.cQuiz], sourceKey: "quiz",
        dest: [L.pqStream, L.pqSubject, L.pqTopic], destKeys: ["stream", "subject", "topic"],
        migrate: (s, d, copy) => testService.quizToMyQuiz(s.quiz, { practiceStream: d.stream, practiceSubject: d.subject, practiceTopic: d.topic, copy }),
      };
    // TEST · Internal
    case "test.internal.mytest":
      return {
        source: [L.ptStream, L.ptSubject, L.ptItem], sourceKey: "item",
        dest: [L.ptStream, L.ptSubject], destKeys: ["stream", "subject"],
        migrate: (s, d, copy) => practiceService.moveItem(s.item, { practiceStream: d.stream, practiceSubject: d.subject, copy }),
      };
    case "test.internal.testseries":
      return {
        source: [L.exam, L.post, L.test], sourceKey: "test",
        dest: [L.exam, L.post], destKeys: ["exam", "post"],
        migrate: (s, d, copy) => testService.moveTestSeries(s.test, { exam: d.exam, post: d.post, copy }),
      };
    // TEST · External
    case "test.external.toSeries":
      return {
        source: [L.ptStream, L.ptSubject, L.ptItem], sourceKey: "item",
        dest: [L.exam, L.post], destKeys: ["exam", "post"],
        migrate: (s, d, copy) => testService.toTestSeries(s.item, { exam: d.exam, post: d.post, copy }),
      };
    case "test.external.toMyTest":
      return {
        source: [L.exam, L.post, L.test], sourceKey: "test",
        dest: [L.ptStream, L.ptSubject], destKeys: ["stream", "subject"],
        migrate: (s, d, copy) => testService.toMyTest(s.test, { practiceStream: d.stream, practiceSubject: d.subject, copy }),
      };
    default:
      return null;
  }
}

const VARIANTS = {
  "quiz.internal": [
    { key: "myquiz", label: "Within My Quiz (topic → topic)" },
    { key: "content", label: "Within Content (topic → topic)" },
  ],
  "quiz.external": [
    { key: "toContent", label: "My Quiz → Content" },
    { key: "toMyQuiz", label: "Content → My Quiz" },
  ],
  "test.internal": [
    { key: "mytest", label: "Within My Test (subject → subject)" },
    { key: "testseries", label: "Within Test Series (post → post)" },
  ],
  "test.external": [
    { key: "toSeries", label: "My Test → Test Series" },
    { key: "toMyTest", label: "Test Series → My Test" },
  ],
};

// Cascading dropdowns. Reports the full selection object up via onChange.
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

// Source picker: drill down with dropdowns, then multi-select the leaf items
// (checkboxes) so you can migrate several at once. Reports an array of ids.
function MultiSourcePicker({ levels, onChange }) {
  const drill = levels.slice(0, -1);
  const leaf = levels[levels.length - 1];
  const [dOpts, setDOpts] = useState([]);
  const [dSel, setDSel] = useState([]);
  const [leafOpts, setLeafOpts] = useState(null); // null = not loaded
  const [picked, setPicked] = useState([]);

  useEffect(() => {
    setDSel([]);
    setDOpts([]);
    setLeafOpts(null);
    setPicked([]);
    onChange?.([]);
    if (drill.length) drill[0].load().then((r) => setDOpts([r || []])).catch(() => setDOpts([[]]));
    else leaf.load().then((r) => setLeafOpts(r || [])).catch(() => setLeafOpts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels]);

  const pickDrill = (i, v) => {
    const ns = dSel.slice(0, i);
    ns[i] = v;
    setDSel(ns);
    setPicked([]);
    onChange?.([]);
    setLeafOpts(null);
    setDOpts((o) => o.slice(0, i + 1));
    const next = drill[i + 1];
    if (v && next) {
      next.load(v).then((r) => setDOpts((o) => { const c = o.slice(0, i + 1); c[i + 1] = r || []; return c; })).catch(() => {});
    } else if (v && !next) {
      leaf.load(v).then((r) => setLeafOpts(r || [])).catch(() => setLeafOpts([]));
    }
  };

  const toggle = (id) => setPicked((p) => {
    const n = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
    onChange?.(n);
    return n;
  });
  const allIds = (leafOpts || []).map((o) => String(o._id));
  const allChecked = allIds.length > 0 && picked.length === allIds.length;
  const toggleAll = () => setPicked(() => { const n = allChecked ? [] : allIds; onChange?.(n); return n; });

  return (
    <div className="space-y-2">
      {drill.map((lv, i) => (
        <select key={lv.key + i} value={dSel[i] || ""} disabled={i > 0 && !dSel[i - 1]} onChange={(e) => pickDrill(i, e.target.value)} className="input">
          <option value="">{lv.label}</option>
          {(dOpts[i] || []).map((o) => <option key={o._id} value={o._id}>{o[lv.labelKey || "name"] || o.name || o.title}</option>)}
        </select>
      ))}
      {leafOpts !== null && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700">
          {leafOpts.length === 0 ? (
            <p className="p-3 text-center text-xs text-slate-400">Nothing here.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 accent-brand-600" />
                Select all ({leafOpts.length})
              </label>
              <div className="max-h-52 space-y-1 overflow-y-auto p-2">
                {leafOpts.map((o) => (
                  <label key={o._id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={picked.includes(String(o._id))} onChange={() => toggle(String(o._id))} className="h-4 w-4 flex-shrink-0 accent-brand-600" />
                    <span className="min-w-0 flex-1 truncate">{o[leaf.labelKey || "name"] || o.name || o.title}</span>
                    {o.questionCount != null && <span className="flex-shrink-0 text-xs text-slate-400">{o.questionCount} Qs</span>}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {picked.length > 0 && <p className="text-xs font-medium text-brand-600">{picked.length} selected</p>}
    </div>
  );
}

export default function AdminMigration({ clientMode = false }) {
  const [tab, setTab] = useState("quiz"); // quiz | test
  const [type, setType] = useState("internal"); // internal | external
  // Clients only migrate within their own practice — internal, My Quiz/My Test.
  const filterV = (list) => (clientMode ? list.filter((v) => v.key === "myquiz" || v.key === "mytest") : list);
  const [variant, setVariant] = useState("myquiz");
  const [srcIds, setSrcIds] = useState([]); // multiple source items
  const [dst, setDst] = useState({});
  const [action, setAction] = useState("move"); // move | copy
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [nonce, setNonce] = useState(0); // bump to remount cascades (reset)

  const variantKey = `${tab}.${type}`;
  const variants = filterV(VARIANTS[variantKey] || []);

  // Default the variant whenever tab/type changes.
  useEffect(() => {
    setVariant((filterV(VARIANTS[`${tab}.${type}`] || []) [0] || { key: "" }).key);
    setSrcIds([]);
    setDst({});
    setMsg("");
    setOk(false);
  }, [tab, type]);

  const flowKey = `${tab}.${type}.${variant}`;
  const flow = useMemo(() => getFlow(flowKey), [flowKey]);

  const resetKey = `${flowKey}.${nonce}`;

  const migrate = async () => {
    if (!flow) return;
    if (!srcIds.length) { setMsg("Select at least one item to migrate."); setOk(false); return; }
    if (flow.destKeys.some((k) => !dst[k])) { setMsg("Choose the full destination."); setOk(false); return; }
    setBusy(true);
    setMsg("");
    let done = 0;
    let failed = 0;
    let lastErr = "";
    for (const id of srcIds) {
      try {
        await flow.migrate({ [flow.sourceKey]: id }, dst, action === "copy");
        done++;
      } catch (e) {
        failed++;
        lastErr = e.message || "failed";
      }
    }
    setBusy(false);
    const verb = action === "copy" ? "Copied" : "Moved";
    if (done && !failed) {
      setOk(true);
      setMsg(`✓ ${verb} ${done} item${done === 1 ? "" : "s"}.`);
      setSrcIds([]);
      setDst({});
      setNonce((n) => n + 1);
    } else if (done && failed) {
      setOk(false);
      setMsg(`${verb} ${done}, but ${failed} failed. ${lastErr}`);
      setNonce((n) => n + 1);
    } else {
      setOk(false);
      setMsg(lastErr || "Migration failed.");
    }
  };

  const Tab = ({ id, label, active, onClick }) => (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
        active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold">
          <ArrowRightLeft className="h-6 w-6 text-brand-600" /> Migration
        </h1>
        <p className="text-slate-500 dark:text-slate-400">
          {clientMode
            ? "Move or copy your quizzes and tests to another stream, subject or topic."
            : "Move a quiz or test to another place. Internal = within the same area; External = between Content and My Practice."}
        </p>
      </div>

      {/* Quiz / Test */}
      <div className="flex gap-2">
        <Tab id="quiz" label="Quiz" active={tab === "quiz"} onClick={() => setTab("quiz")} />
        <Tab id="test" label="Test" active={tab === "test"} onClick={() => setTab("test")} />
      </div>

      {/* Internal / External (clients: internal only) */}
      {!clientMode && (
        <div className="flex gap-2">
          <Tab id="internal" label="Internal migration" active={type === "internal"} onClick={() => setType("internal")} />
          <Tab id="external" label="External migration" active={type === "external"} onClick={() => setType("external")} />
        </div>
      )}

      {/* Variant (area or direction) */}
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => (
          <button
            key={v.key}
            onClick={() => { setVariant(v.key); setSrcIds([]); setDst({}); setMsg(""); setOk(false); }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              variant === v.key ? "bg-accent-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {flow && (
        <div className="card p-6">
          <div className="grid gap-6 md:grid-cols-[1fr,auto,1fr] md:items-start">
            {/* Source */}
            <div>
              <p className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Move these (tick one or more)</p>
              <MultiSourcePicker key={resetKey + "-src"} levels={flow.source} onChange={setSrcIds} />
            </div>

            <div className="hidden items-center justify-center pt-16 md:flex">
              <ArrowRight className="h-6 w-6 text-slate-400" />
            </div>

            {/* Destination */}
            <div>
              <p className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">To here</p>
              <Cascade key={resetKey + "-dst"} levels={flow.dest} onChange={setDst} />
            </div>
          </div>

          {msg && <p className={`mt-4 text-sm font-medium ${ok ? "text-emerald-600" : "text-rose-600"}`}>{msg}</p>}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            {/* Move vs Copy */}
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              {["move", "copy"].map((a) => (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  className={`px-4 py-1.5 text-sm font-semibold capitalize ${
                    action === a ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <button onClick={migrate} disabled={busy} className="btn-primary">
              {busy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {action === "copy" ? "Copying…" : "Moving…"}</>
              ) : (
                <><ArrowRightLeft className="h-4 w-4" /> {action === "copy" ? "Copy here" : "Move here"}</>
              )}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {action === "copy"
              ? "Copy: duplicates the questions into the destination and keeps the original."
              : "Move: relocates it to the destination (the original is moved, not duplicated)."}
          </p>
        </div>
      )}
    </div>
  );
}
