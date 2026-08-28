import { useEffect, useRef, useState } from "react";
import {
  X, Upload, FileText, Sparkles, Loader2, CheckCircle2, AlertTriangle, Plus, Trash2,
  ListChecks, Circle, Layers,
} from "lucide-react";
import { aiService } from "../../services";
import { useAuth } from "../../context/AuthContext";

// The question types the generator can produce (same set as the AI Generator).
const Q_TYPES = [
  { id: "mcq", label: "MCQ" },
  { id: "matching", label: "Matching" },
  { id: "statement", label: "Statements" },
  { id: "pair", label: "Pairs" },
  { id: "pairselect", label: "Pair select" },
  { id: "assertion", label: "Assertion & Reason" },
  { id: "table", label: "Table" },
];

// PDF → Topics: upload a PDF (or paste text), auto-detect its units/chapters,
// create one topic per unit under the chosen subject, generate questions spread
// across those units, then insert them (auto-creating a quiz under each topic).
//
// `adapter` (from AdminAiStudio) knows how to create a topic + a quiz for the
// chosen destination (My Quiz practice OR Content quiz):
//   adapter.createTopic(sel, name)                 -> topicId
//   adapter.prepareContainer(sel, topicId, unit)   -> container (session id / topic id)
//   adapter.createQuiz(sel, container, quizName)   -> bulkQuestions context
//   adapter.bulk(questions, context)               -> { inserted }
// `sel` is the current Stream/Subject selection; `subjectName` is for display.
const DIFFS = ["Easy", "Medium", "Hard"];

export default function AiPdfTopics({ open, onClose, adapter, sel, subjectName = "", label = "quiz" }) {
  const { user } = useAuth();
  const isClient = user?.role === "client" && user?.aiAccess;
  const canChooseSource = isClient && user?.aiAllowInbuilt !== false && user?.aiAllowSelf !== false;
  const [apiSource, setApiSource] = useState(user?.aiMode === "self" ? "self" : "inbuilt");
  const fileRef = useRef(null);

  const [status, setStatus] = useState(null);
  const [text, setText] = useState("");          // extracted / pasted source text
  const [pdfName, setPdfName] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(null);

  const [units, setUnits] = useState([]);         // detected units (editable)
  const [detecting, setDetecting] = useState(false);
  // Per-topic question mix: matrix[typeId] = { Easy, Medium, Hard }. Default 20 medium MCQs.
  const [matrix, setMatrix] = useState({ mcq: { Easy: 0, Medium: 20, Hard: 0 } });
  const [quizSize, setQuizSize] = useState(50); // questions per quiz at insert time
  const [includeExisting, setIncludeExisting] = useState(true); // also copy questions already in the PDF

  const [generating, setGenerating] = useState(false);
  const [stopping, setStopping] = useState(false); // user asked to cancel the current run
  const stopRef = useRef(false);                   // set on Cancel — breaks the per-topic loop
  const jobIdRef = useRef(null);                   // current background job, so Cancel can stop it
  const lastJobErrorRef = useRef("");              // last job's error code (e.g. "quota") — drives wait-and-retry
  const [results, setResults] = useState([]);     // [{ unit, questions:[], status, count }]
  const [coverage, setCoverage] = useState(null); // { covered:[], missing:[] }
  const [inserting, setInserting] = useState(false);
  const [msg, setMsg] = useState("");

  // Cancel the running generation. Stops the current background job and breaks
  // the per-topic loop; everything generated so far stays in `results` for
  // review/Insert (nothing is thrown away).
  const cancel = async () => {
    stopRef.current = true;
    setStopping(true);
    setMsg("Cancelling… keeping everything generated so far.");
    try { if (jobIdRef.current) await aiService.cancelJob(jobIdRef.current); } catch { /* best-effort */ }
  };

  const maxPerBatch = status?.maxPerBatch || 50;

  useEffect(() => {
    if (!open) return;
    setText(""); setPdfName(""); setUnits([]); setResults([]); setCoverage(null); setMsg("");
    setMatrix({ mcq: { Easy: 0, Medium: 20, Hard: 0 } }); setQuizSize(50); setIncludeExisting(true); setGenerating(false); setInserting(false);
    setStopping(false); stopRef.current = false; jobIdRef.current = null;
    aiService.status(isClient ? apiSource : undefined).then(setStatus).catch(() => setStatus(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---- Type × difficulty matrix helpers (mirrors the AI Generator) ----
  const setCell = (type, diff, val) => {
    const n = Math.max(0, Math.min(maxPerBatch, parseInt(val, 10) || 0));
    setMatrix((m) => ({ ...m, [type]: { ...(m[type] || {}), [diff]: n } }));
  };
  const rowTotal = (type) => DIFFS.reduce((s, d) => s + (matrix[type]?.[d] || 0), 0);
  const perTopicTotal = Q_TYPES.reduce((s, t) => s + rowTotal(t.id), 0);
  const buildPlan = () =>
    Q_TYPES.flatMap((t) =>
      DIFFS.map((d) => ({ type: t.id, difficulty: d, count: matrix[t.id]?.[d] || 0 })).filter((e) => e.count > 0)
    );

  // ---- Read an uploaded PDF (or Word/PPT/etc) into the source text ----
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfName(file.name); setPdfBusy(true); setMsg(""); setPdfProgress(null);
    try {
      const name = file.name.toLowerCase();
      const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
      if (isPdf) {
        const { extractPdfText } = await import("../../lib/pdf");
        const extracted = await extractPdfText(file, (page, total) => setPdfProgress({ page, total }));
        setText((extracted || "").trim());
      } else {
        const { extractDocText } = await import("../../lib/docs");
        const extracted = await extractDocText(file);
        setText((extracted || "").trim());
      }
    } catch (err) {
      setMsg(err.message || "Could not read that file. Paste the text instead.");
    } finally {
      setPdfBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // ---- Detect units/chapters from the source ----
  const detectUnits = async () => {
    if (!text.trim()) { setMsg("Upload a PDF or paste some text first."); return; }
    setDetecting(true); setMsg(""); setUnits([]);
    try {
      const r = await aiService.outlineUnits({ source: text.trim(), mode: isClient ? apiSource : undefined });
      const list = Array.isArray(r?.units) ? r.units : [];
      if (!list.length) { setMsg("No clear units were detected. Add them manually below, or paste more text."); }
      setUnits(list.map((name) => ({ name })));
    } catch (err) {
      setMsg(err.message || "Could not detect units.");
    } finally {
      setDetecting(false);
    }
  };

  const setUnitName = (i, v) => setUnits((u) => u.map((x, k) => (k === i ? { ...x, name: v } : x)));
  const addUnit = () => setUnits((u) => [...u, { name: "" }]);
  const removeUnit = (i) => setUnits((u) => u.filter((_, k) => k !== i));

  // ---- Generate questions for every unit (sequentially, from the PDF) ----
  const pollJob = async (jobId) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let cancelSent = false;
    for (let i = 0; i < 240; i++) {
      await sleep(2000);
      // If the user hit Cancel, tell the server to stop this job once; the
      // backend then finalizes as "done" with whatever it produced so far,
      // which this loop returns just like a normal completion.
      if (stopRef.current && !cancelSent) {
        cancelSent = true;
        try { await aiService.cancelJob(jobId); } catch { /* keep polling for the partial */ }
      }
      let s;
      try { s = await aiService.job(jobId); } catch { continue; }
      if (s.status === "done") { lastJobErrorRef.current = s.error || ""; return s.questions || []; }
      if (s.status === "error") throw new Error(s.error || "Generation failed.");
    }
    throw new Error("Generation timed out.");
  };

  // De-duplicate by normalized stem when merging batches for a topic.
  const normStem = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
  const mergeUnique = (arr, incoming) => {
    const seen = new Set(arr.map((q) => normStem(q.text)));
    for (const q of incoming || []) {
      const k = normStem(q.text);
      if (k && !seen.has(k)) { seen.add(k); arr.push(q); }
    }
    return arr;
  };

  // One generation job for a unit. Pass a `plan` (type×difficulty mix) OR a
  // plain `count` (used for top-up rounds), plus `avoid` stems to prevent repeats.
  const genOnce = async (unit, { plan, count, avoid }) => {
    const body = {
      source: text.trim(),
      topic: unit,
      notes: `Write the questions ONLY about "${unit}" as covered in the source material.`,
      mode: isClient ? apiSource : undefined,
    };
    if (plan) body.plan = plan; else body.count = count;
    if (avoid && avoid.length) body.avoid = avoid.slice(-300);
    const { jobId } = await aiService.generate(body);
    if (!jobId) throw new Error("Could not start generation.");
    jobIdRef.current = jobId; // so Cancel can stop this job
    try { return await pollJob(jobId); } finally { jobIdRef.current = null; }
  };

  // Extract the EXISTING questions already present in the PDF, then file each
  // under its best-matching unit. Returns an array (per unit) of question lists.
  const extractExistingByUnit = async (unitNames) => {
    const grouped = unitNames.map(() => []);
    setMsg("Reading questions already in the PDF…");
    const { jobId } = await aiService.extract({ content: text.trim(), mode: isClient ? apiSource : undefined });
    if (!jobId) return { grouped, extracted: 0, unfiled: 0 };
    const existing = await pollJob(jobId);
    if (!existing.length) return { grouped, extracted: 0, unfiled: 0 };
    setMsg(`Filing ${existing.length} existing question(s) under the right topics…`);
    let assign = [];
    try {
      const r = await aiService.classifyUnits({ units: unitNames, questions: existing.map((q) => q.text), mode: isClient ? apiSource : undefined });
      assign = r?.assign || [];
    } catch { /* if classification fails, everything is unfiled */ }
    let unfiled = 0;
    existing.forEach((q, idx) => {
      const u = (assign[idx] || 0) - 1;
      if (u >= 0 && u < unitNames.length) grouped[u].push(q); else unfiled += 1;
    });
    return { grouped, extracted: existing.length, unfiled };
  };

  const generateAll = async () => {
    const clean = units.map((u) => u.name.trim()).filter(Boolean);
    if (!clean.length) { setMsg("Add at least one unit/topic."); return; }
    if (!text.trim()) { setMsg("Upload a PDF or paste text first."); return; }
    const plan = buildPlan();
    const requested = perTopicTotal;
    const wantGenerate = plan.length > 0;
    if (!wantGenerate && !includeExisting) { setMsg("Set question counts above, or tick “Also copy questions already in the PDF”."); return; }
    if (wantGenerate && perTopicTotal > maxPerBatch) { setMsg(`Keep each topic to ${maxPerBatch} questions or fewer.`); return; }
    const MAX_TOPUP_ROUNDS = 6; // extra passes to fill any shortfall per topic
    setGenerating(true); setStopping(false); stopRef.current = false; setMsg(""); setCoverage(null);
    // A topic is auto-CREATED under the subject for each unit as we go, so the
    // topics appear immediately (even before questions are inserted).
    const out = clean.map((unit) => ({ unit, questions: [], status: "pending", count: 0, requested: wantGenerate ? requested : 0, topicId: null }));
    setResults(out.slice());
    try {
      // 0) Copy any questions ALREADY in the PDF and file them under each unit.
      let grouped = clean.map(() => []);
      let extractInfo = { extracted: 0, unfiled: 0 };
      if (includeExisting) {
        try {
          const r = await extractExistingByUnit(clean);
          grouped = r.grouped;
          extractInfo = { extracted: r.extracted, unfiled: r.unfiled };
        } catch { /* extraction is best-effort — continue with generation */ }
      }

      for (let i = 0; i < clean.length; i++) {
        if (stopRef.current) break; // cancelled — keep the topics already built
        const unit = clean[i];
        out[i].status = "working"; setResults(out.slice());
        try {
          // 1) Auto-create the topic under the subject.
          if (!out[i].topicId) out[i].topicId = await adapter.createTopic(sel, unit);

          // 2) Seed with the existing PDF questions filed under this unit (verbatim).
          const collected = [];
          mergeUnique(collected, grouped[i]);
          out[i].count = collected.length; setResults(out.slice());

          // 3) Generate NEW questions to reach the target (if a count was set).
          if (wantGenerate && collected.length < requested) {
            setMsg(`Generating for “${unit}” (${i + 1}/${clean.length})…`);
            // First pass uses the full type/difficulty mix only when nothing was
            // seeded; otherwise fill the shortfall by count (avoiding duplicates).
            if (collected.length === 0) {
              mergeUnique(collected, await genOnce(unit, { plan, avoid: [] }));
              out[i].count = collected.length; setResults(out.slice());
            }
            let round = 0;
            let emptyWaits = 0;
            const MAX_EMPTY = 6; // per-minute rate-limit waits before giving up on this topic
            while (collected.length < requested && round < MAX_TOPUP_ROUNDS && !stopRef.current) {
              const shortfall = requested - collected.length;
              setMsg(`Topping up “${unit}” — ${collected.length}/${requested} (round ${round + 1})…`);
              const before = collected.length;
              let more = [];
              try {
                more = await genOnce(unit, { count: shortfall, avoid: collected.map((q) => q.text).filter(Boolean) });
              } catch { /* keep what we have */ }
              mergeUnique(collected, more);
              out[i].count = collected.length; setResults(out.slice());
              if (collected.length <= before) {
                // No new questions this round. If it was a per-minute rate limit,
                // wait ~60s for the window to reset and retry (don't burn a round);
                // otherwise the unit is out of distinct questions — stop.
                if (lastJobErrorRef.current === "quota" && emptyWaits < MAX_EMPTY && !stopRef.current) {
                  emptyWaits += 1;
                  for (let k = 60; k > 0 && !stopRef.current; k--) { setMsg(`“${unit}” hit the per-minute limit — waiting ${k}s, then retrying (${collected.length}/${requested})…`); await new Promise((res) => setTimeout(res, 1000)); }
                  continue;
                }
                break;
              }
              emptyWaits = 0;
              round += 1;
            }
          }

          out[i].questions = collected;
          out[i].count = collected.length;
          out[i].status = "done";
        } catch (err) {
          out[i].status = "error"; out[i].error = err.message || "Failed";
        }
        setResults(out.slice());
      }
      const total = out.reduce((s, r) => s + r.count, 0);
      const madeTopics = out.filter((r) => r.topicId).length;
      const short = out.filter((r) => r.status === "done" && r.requested && r.count < r.requested);
      const copied = extractInfo.extracted ? ` Copied ${extractInfo.extracted} question(s) already in the PDF${extractInfo.unfiled ? ` (${extractInfo.unfiled} didn't match a topic and were skipped)` : ""}.` : "";
      if (stopRef.current) {
        const doneTopics = out.filter((r) => r.count > 0).length;
        setMsg(`⏹ Cancelled — kept ${total} question(s) across ${doneTopics} topic(s) generated so far.${copied} Review below and click Insert to save them.`);
      } else {
        setMsg(
          `✓ Created ${madeTopics} topic(s), ${total} question(s) total.${copied}` +
          (short.length ? ` ${short.length} topic(s) came up short — click “Top up short topics” to try again.` : " Review below, then click Insert.")
        );
      }
      // Overall coverage against the PDF (areas covered vs not).
      refreshCoverage(out.flatMap((r) => r.questions.map((q) => q.text)).filter(Boolean));
    } catch (err) {
      setMsg(err.message || "Generation failed.");
    } finally {
      setGenerating(false);
      setStopping(false);
      stopRef.current = false;
      jobIdRef.current = null;
    }
  };

  // Retry ONLY the topics that fell short of their target (avoiding duplicates).
  const topUpShort = async () => {
    const out = results.slice();
    const shortIdx = out.map((r, i) => (r.status === "done" && r.count < (r.requested || 0) ? i : -1)).filter((i) => i >= 0);
    if (!shortIdx.length) { setMsg("All topics are already at their target."); return; }
    setGenerating(true); setStopping(false); stopRef.current = false; setMsg("");
    const MAX_TOPUP_ROUNDS = 6;
    try {
      for (const i of shortIdx) {
        if (stopRef.current) break; // cancelled — keep what's collected
        const r = out[i];
        const requested = r.requested || 0;
        const collected = r.questions.slice();
        out[i].status = "working"; setResults(out.slice());
        let round = 0;
        let emptyWaits = 0;
        const MAX_EMPTY = 6;
        while (collected.length < requested && round < MAX_TOPUP_ROUNDS && !stopRef.current) {
          const shortfall = requested - collected.length;
          setMsg(`Topping up “${r.unit}” — ${collected.length}/${requested} (round ${round + 1})…`);
          const before = collected.length;
          let more = [];
          try {
            more = await genOnce(r.unit, { count: shortfall, avoid: collected.map((q) => q.text).filter(Boolean) });
          } catch { /* keep what we have */ }
          mergeUnique(collected, more);
          out[i].questions = collected; out[i].count = collected.length; setResults(out.slice());
          if (collected.length <= before) {
            // Rate-limited? wait ~60s and retry; otherwise the unit is exhausted — stop.
            if (lastJobErrorRef.current === "quota" && emptyWaits < MAX_EMPTY && !stopRef.current) {
              emptyWaits += 1;
              for (let k = 60; k > 0 && !stopRef.current; k--) { setMsg(`“${r.unit}” hit the per-minute limit — waiting ${k}s, then retrying (${collected.length}/${requested})…`); await new Promise((res) => setTimeout(res, 1000)); }
              continue;
            }
            break;
          }
          emptyWaits = 0;
          round += 1;
        }
        out[i].status = "done"; setResults(out.slice());
      }
      const stillShort = out.filter((r) => r.status === "done" && r.count < (r.requested || 0));
      const total = out.reduce((s, r) => s + r.count, 0);
      setMsg(
        `✓ Now ${total} question(s) total.` +
        (stillShort.length ? ` ${stillShort.length} topic(s) still short — the AI likely can't produce more distinct questions for those units (or the daily quota is spent). You can Insert what you have.` : " All topics reached their target. Review, then Insert.")
      );
    } catch (err) {
      setMsg(err.message || "Top-up failed.");
    } finally {
      setGenerating(false);
      setStopping(false);
      stopRef.current = false;
      jobIdRef.current = null;
    }
  };

  // Regenerate the missing questions for ONE topic (the per-row button), e.g. a
  // topic short by 30. Same persistent fill loop as Top-up, scoped to one unit.
  const topUpOne = async (idx) => {
    const out = results.slice();
    const r = out[idx];
    if (!r || r.status === "working" || generating || inserting) return;
    const requested = r.requested || 0;
    if (requested && r.count >= requested) { setMsg(`“${r.unit}” is already at its target.`); return; }
    setGenerating(true); setStopping(false); stopRef.current = false; setMsg("");
    const MAX_TOPUP_ROUNDS = 6;
    const MAX_EMPTY = 6;
    try {
      const collected = r.questions.slice();
      out[idx].status = "working"; setResults(out.slice());
      let round = 0;
      let emptyWaits = 0;
      while (collected.length < requested && round < MAX_TOPUP_ROUNDS && !stopRef.current) {
        const shortfall = requested - collected.length;
        setMsg(`Regenerating missing for “${r.unit}” — ${collected.length}/${requested} (round ${round + 1})…`);
        const before = collected.length;
        let more = [];
        try { more = await genOnce(r.unit, { count: shortfall, avoid: collected.map((q) => q.text).filter(Boolean) }); } catch { /* keep what we have */ }
        mergeUnique(collected, more);
        out[idx].questions = collected; out[idx].count = collected.length; setResults(out.slice());
        if (collected.length <= before) {
          if (lastJobErrorRef.current === "quota" && emptyWaits < MAX_EMPTY && !stopRef.current) {
            emptyWaits += 1;
            for (let k = 60; k > 0 && !stopRef.current; k--) { setMsg(`“${r.unit}” hit the per-minute limit — waiting ${k}s, then retrying (${collected.length}/${requested})…`); await new Promise((res) => setTimeout(res, 1000)); }
            continue;
          }
          break;
        }
        emptyWaits = 0;
        round += 1;
      }
      out[idx].status = "done"; setResults(out.slice());
      const got = out[idx].count;
      setMsg(got >= requested ? `✓ “${r.unit}” reached ${got}/${requested}.` : `“${r.unit}” is now ${got}/${requested} — still short (the AI may be out of distinct questions, or the quota is spent).`);
    } catch (err) {
      setMsg(err.message || "Regenerate failed.");
      out[idx].status = "done"; setResults(out.slice());
    } finally {
      setGenerating(false); setStopping(false); stopRef.current = false; jobIdRef.current = null;
    }
  };

  const refreshCoverage = async (stems) => {
    if (!stems.length) { setCoverage(null); return; }
    try {
      const r = await aiService.coverageGaps({ source: text.trim(), questions: stems.slice(0, 300), mode: isClient ? apiSource : undefined });
      setCoverage({ covered: r?.covered || [], missing: r?.missing || [] });
    } catch { /* best-effort */ }
  };

  // ---- Insert: create a topic (+ quiz) per unit and save its questions ----
  const insertAll = async () => {
    const ready = results.filter((r) => r.questions.length);
    if (!ready.length) { setMsg("Nothing to insert yet — generate first."); return; }
    setInserting(true); setMsg("");
    const QUIZ_SIZE = Math.max(1, parseInt(quizSize, 10) || 50); // questions per quiz
    let topics = 0, quizzes = 0, inserted = 0;
    try {
      for (const r of ready) {
        // Reuse the topic created during generation; create it now if missing.
        const topicId = r.topicId || (await adapter.createTopic(sel, r.unit));
        if (!topicId) throw new Error(`Could not create topic “${r.unit}”.`);
        r.topicId = topicId;
        // One container (a Session for content; the topic itself for practice).
        const container = await adapter.prepareContainer(sel, topicId, r.unit);
        // Split this topic's questions into chunks of 50 → Quiz 1, Quiz 2, …
        const chunks = [];
        for (let i = 0; i < r.questions.length; i += QUIZ_SIZE) chunks.push(r.questions.slice(i, i + QUIZ_SIZE));
        for (let k = 0; k < chunks.length; k++) {
          const context = await adapter.createQuiz(sel, container, `Quiz ${k + 1}`);
          const res = await adapter.bulk(chunks[k], context);
          inserted += res?.inserted ?? chunks[k].length;
          quizzes += 1;
        }
        topics += 1;
        r.status = "inserted"; r.quizzes = chunks.length; setResults((x) => x.slice());
      }
      setMsg(`✓ Created ${topics} topic(s) with ${quizzes} quiz(zes) (up to ${QUIZ_SIZE} each) and inserted ${inserted} question(s). Open Content/My Practice to see them.`);
    } catch (err) {
      setMsg(err.message || "Insert failed.");
    } finally {
      setInserting(false);
    }
  };

  if (!open) return null;

  const totalToGenerate = units.filter((u) => u.name.trim()).length * perTopicTotal;
  const generatedTotal = results.reduce((s, r) => s + r.count, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={inserting || generating ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-8 w-full max-w-2xl animate-scale-in card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Layers className="h-5 w-5 text-brand-600" /> PDF → Topics {subjectName ? <span className="text-slate-400">· {subjectName}</span> : null}
          </h3>
          <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Upload a PDF — the AI detects its units/chapters, creates a topic for each under this subject, generates
          questions per topic, and splits them into quizzes (Quiz 1, Quiz 2, …) of the size you choose.
        </p>

        {canChooseSource && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setApiSource("inbuilt")} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${apiSource === "inbuilt" ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20" : "border-slate-200 text-slate-600 dark:border-slate-700"}`}>Built-in APIs</button>
            <button type="button" onClick={() => setApiSource("self")} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${apiSource === "self" ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20" : "border-slate-200 text-slate-600 dark:border-slate-700"}`}>My own APIs</button>
          </div>
        )}

        {/* Step 1 — source */}
        <label className="mb-1 block text-sm font-semibold">1. Upload PDF / document</label>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`btn-outline cursor-pointer text-sm ${pdfBusy ? "pointer-events-none opacity-60" : ""}`}>
            {pdfBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</> : <><Upload className="h-4 w-4" /> Choose file</>}
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt" className="hidden" onChange={handleFile} disabled={pdfBusy} />
          </label>
          {pdfName && <span className="inline-flex items-center gap-1 text-sm text-slate-500"><FileText className="h-4 w-4" /> {pdfName}</span>}
          {pdfProgress && <span className="text-xs text-slate-400">page {pdfProgress.page}/{pdfProgress.total}</span>}
        </div>
        <textarea
          className="input mt-2 resize-y font-mono text-xs"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="…or paste the source text here"
        />
        {text.trim() && <p className="mt-1 text-xs text-slate-400">{text.trim().length.toLocaleString()} characters ready</p>}

        {/* Step 2 — detect units */}
        <div className="mt-4 flex items-center justify-between">
          <label className="block text-sm font-semibold">2. Units / topics detected</label>
          <button type="button" onClick={detectUnits} disabled={detecting || pdfBusy || !text.trim()} className="btn-outline !py-1 text-xs">
            {detecting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Detecting…</> : <><Sparkles className="h-3.5 w-3.5" /> Detect units from PDF</>}
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {units.length === 0 && <p className="text-xs text-slate-400">No units yet — click “Detect units”, or add them manually.</p>}
          {units.map((u, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-slate-400">{i + 1}.</span>
              <input className="input !py-1 text-sm" value={u.name} onChange={(e) => setUnitName(i, e.target.value)} placeholder={`Topic ${i + 1} name`} />
              <button type="button" onClick={() => removeUnit(i)} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" onClick={addUnit} className="btn-outline !py-1 text-xs"><Plus className="h-3.5 w-3.5" /> Add topic</button>
        </div>

        {/* Step 3 — question mix per topic (type × difficulty) */}
        {units.some((u) => u.name.trim()) && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-semibold">3. Questions per topic (by type &amp; difficulty)</label>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${perTopicTotal > maxPerBatch ? "bg-rose-100 text-rose-600 dark:bg-rose-900/30" : "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"}`}>
                {perTopicTotal} / topic
              </span>
            </div>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[360px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                    {DIFFS.map((d) => <th key={d} className="px-2 py-2 text-center font-semibold">{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Q_TYPES.map((t) => (
                    <tr key={t.id} className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${rowTotal(t.id) > 0 ? "bg-brand-50/40 dark:bg-brand-900/10" : ""}`}>
                      <td className="px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200">{t.label}</td>
                      {DIFFS.map((d) => (
                        <td key={d} className="px-2 py-1.5 text-center">
                          <input
                            type="number"
                            min={0}
                            max={maxPerBatch}
                            value={matrix[t.id]?.[d] || 0}
                            onChange={(e) => setCell(t.id, d, e.target.value)}
                            className="w-14 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-sm dark:border-slate-700 dark:bg-slate-900"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Set a count in any cell (e.g. 30 Medium MCQ + 10 Matching). Up to {maxPerBatch} per topic · total ≈ {totalToGenerate} across all topics.
            </p>

            {/* How to split each topic's questions into quizzes on insert. */}
            <div className="mt-3">
              <label className="mb-1 block text-sm font-semibold">Questions per quiz</label>
              <input type="number" min={1} max={500} value={quizSize} onChange={(e) => setQuizSize(e.target.value)} className="input sm:max-w-[200px]" />
              <p className="mt-1 text-xs text-slate-400">
                Each topic's questions are split into quizzes of this size (Quiz 1, Quiz 2, …).
                {perTopicTotal > 0 && (
                  <> With {perTopicTotal}/topic ÷ {Math.max(1, parseInt(quizSize, 10) || 1)} = about {Math.ceil(perTopicTotal / Math.max(1, parseInt(quizSize, 10) || 1))} quiz(zes) per topic.</>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Copy existing questions option */}
        {units.some((u) => u.name.trim()) && (
          <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={includeExisting} onChange={(e) => setIncludeExisting(e.target.checked)} />
            <span>
              <span className="font-medium">Also copy questions already in the PDF</span>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                If the PDF already contains questions, they're extracted verbatim and filed under the matching topic. New questions are then generated to reach each topic's target. Leave the grid above at 0 to <b>only</b> copy existing questions.
              </span>
            </span>
          </label>
        )}

        {/* Step 4 — generate (with Cancel that keeps whatever is generated so far) */}
        {units.some((u) => u.name.trim()) && (
          generating ? (
            <div className="mt-3 flex gap-2">
              <button type="button" disabled className="btn-primary w-full opacity-80">
                <Loader2 className="h-4 w-4 animate-spin" /> Working…
              </button>
              <button type="button" onClick={cancel} disabled={stopping} className="btn-outline shrink-0 text-rose-600">
                {stopping ? <><Loader2 className="h-4 w-4 animate-spin" /> Cancelling…</> : <><X className="h-4 w-4" /> Cancel &amp; keep</>}
              </button>
            </div>
          ) : (
            <button type="button" onClick={generateAll} disabled={inserting || !status?.enabled} className="btn-primary mt-3 w-full">
              <Sparkles className="h-4 w-4" /> Create topics &amp; build questions
            </button>
          )
        )}

        {/* Per-topic results */}
        {results.length > 0 && (
          <div className="mt-4 space-y-1.5 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-1 text-sm font-semibold">Per-topic questions ({generatedTotal} total)</p>
            {results.some((r) => r.status === "done" && r.requested && r.count < r.requested) && (
              <button type="button" onClick={topUpShort} disabled={generating || inserting} className="btn-outline mb-2 w-full text-amber-600">
                {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Topping up…</> : <><Sparkles className="h-4 w-4" /> Top up short topics</>}
              </button>
            )}
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-slate-600 dark:text-slate-300">{r.unit}</span>
                <span className="flex-shrink-0 font-semibold">
                  {r.status === "working" && <Loader2 className="inline h-3.5 w-3.5 animate-spin text-brand-500" />}
                  {r.status === "pending" && <span className="text-slate-400">queued</span>}
                  {r.status === "done" && (
                    <span className={r.requested && r.count < r.requested ? "text-amber-600" : "text-emerald-600"}>
                      {r.count}{r.requested && r.count < r.requested ? ` / ${r.requested}` : ""} questions
                    </span>
                  )}
                  {r.status === "inserted" && <span className="text-emerald-600">✓ {r.count} in {r.quizzes || 1} quiz{(r.quizzes || 1) > 1 ? "zes" : ""}</span>}
                  {r.status === "error" && <span className="text-rose-600">{r.error || "failed"}</span>}
                  {r.status === "done" && r.requested && r.count < r.requested && (
                    <button
                      type="button"
                      onClick={() => topUpOne(i)}
                      disabled={generating || inserting}
                      title={`Regenerate the missing ${r.requested - r.count} question(s) for “${r.unit}”`}
                      className="ml-2 inline-flex items-center gap-1 rounded-md border border-amber-300 px-1.5 py-0.5 text-xs font-semibold text-amber-600 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900/20"
                    >
                      <Sparkles className="h-3 w-3" /> +{r.requested - r.count}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Coverage vs the PDF */}
        {coverage && (
          <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4 text-brand-600" /> Areas covered from this PDF</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-600">Covered ({coverage.covered.length})</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">
                  {coverage.covered.map((c, i) => <li key={i} className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />{c}</li>)}
                  {!coverage.covered.length && <li className="text-slate-400">—</li>}
                </ul>
              </div>
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-600">Not yet covered ({coverage.missing.length})</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">
                  {coverage.missing.map((c, i) => <li key={i} className="flex gap-1.5"><Circle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />{c}</li>)}
                  {!coverage.missing.length && <li className="font-medium text-emerald-600">All covered 🎉</li>}
                </ul>
              </div>
            </div>
          </div>
        )}

        {msg && <p className={`mt-3 text-sm font-medium ${msg.startsWith("✓") ? "text-emerald-600" : "text-slate-600 dark:text-slate-300"}`}>{msg}</p>}

        {/* Step 5 — insert */}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline">Close</button>
          {generatedTotal > 0 && (
            <button type="button" onClick={insertAll} disabled={inserting || generating} className="btn-primary">
              {inserting ? <><Loader2 className="h-4 w-4 animate-spin" /> Inserting…</> : <>Create topics &amp; insert {generatedTotal}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
