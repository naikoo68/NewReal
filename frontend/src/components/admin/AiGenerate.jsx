import { useEffect, useRef, useState } from "react";
import { X, Sparkles, Wand2, CheckCircle2, AlertTriangle, Loader2, Server, KeyRound, ListChecks, Circle, Square, Bookmark, Trash2, Globe } from "lucide-react";
import { aiService } from "../../services";
import { useAuth } from "../../context/AuthContext";
import GraphView from "../ui/GraphView";
import VizView from "../ui/VizView";

const TYPE_OPTIONS = [
  { id: "mcq", label: "MCQ" },
  { id: "numericalmcq", label: "Numerical MCQ" },
  { id: "assertion", label: "Assertion & Reason" },
  { id: "statement", label: "Statement-based" },
  { id: "matching", label: "Matching" },
  { id: "pair", label: "Pair (count)" },
  { id: "pairselect", label: "Pair-select" },
  { id: "table", label: "Table-based" },
  { id: "journal", label: "Journal Entry" },
  { id: "ledger", label: "Ledger Posting" },
  { id: "rearrange", label: "Sentence Rearrangement" },
  { id: "diagram", label: "Diagram" },
];

const LETTERS = ["A", "B", "C", "D"];
const DIFFS = ["Easy", "Medium", "Hard"];
// Max questions per generation. You can type any count in the grid up to this
// total (they're generated in chunks, so larger batches just take longer).
const MAX_TOTAL = 500;

// Reusable "Generate with AI" modal. Mirrors BulkUploadQuestions:
// `onUpload(questions)` should return a promise (e.g. { inserted }). The AI
// only PREVIEWS questions here — nothing is saved until the admin clicks Insert.
// Detects "current affairs" topics the AI cannot reliably answer from memory —
// current office-holders, latest/recent events, or a recent/near-future year.
// An AI model has a knowledge cut-off, so for these it tends to return general
// theory or outdated names. When detected (and no Source link is given) we warn
// the user to paste a source so questions are built from verified material.
const CURRENT_AFFAIRS_RE =
  /\b(current(ly)?|latest|recent(ly)?|as of|up[- ]?to[- ]?date|incumbent|present[- ]?day|this (year|month)|in the news|ongoing|20(2[3-9]|3\d))\b/i;
function looksLikeCurrentAffairs(text) {
  return CURRENT_AFFAIRS_RE.test(String(text || ""));
}

export default function AiGenerate({ open, onClose, onUpload, title = "Generate Questions with AI", sections = [], existingQuestions = [], defaultSection = "", allowNewTarget = false, newLeafLabel = "quiz", currentTargetName = "", existingItems = [], defaultTopic = "", defaultSubtopics = "", defaultDest = "current", coverageQuestions = [] }) {
  const { user } = useAuth();
  // Clients granted BOTH sources may pick which one this generation uses.
  const isClient = user?.role === "client" && user?.aiAccess;
  const canChooseSource = isClient && user?.aiAllowInbuilt !== false && user?.aiAllowSelf !== false;
  const [source, setSource] = useState(user?.aiMode === "self" ? "self" : "inbuilt"); // "inbuilt" | "self"
  const [status, setStatus] = useState(null); // { enabled, model, models: [] }
  // Stems already generated/inserted this session — sent so a repeat batch never
  // duplicates earlier questions. Seeded from any existing questions passed in.
  const [avoidStems, setAvoidStems] = useState(() => (existingQuestions || []).map((q) => (typeof q === "string" ? q : q?.text)).filter(Boolean));
  const [model, setModel] = useState("");
  const [section, setSection] = useState(defaultSection || sections[0] || ""); // subject to tag generated questions
  const [topic, setTopic] = useState("");
  const [subtopics, setSubtopics] = useState(""); // optional — specific subtopics to cover in the topic
  const [url, setUrl] = useState(""); // optional source link (web page or YouTube)
  const [research, setResearch] = useState(false); // auto-research the web for current-affairs facts before generating
  // matrix[typeId] = { Easy, Medium, Hard } counts. Default: 5 medium MCQs.
  const [matrix, setMatrix] = useState({ mcq: { Easy: 0, Medium: 5, Hard: 0 } });
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false); // user asked to stop the current generation
  const [autoContinue, setAutoContinue] = useState(true); // ON by default: resume across quota windows until the full count is reached, then stop
  const [keepExtras, setKeepExtras] = useState(false); // if a wave produces more than the target, keep ALL of them instead of trimming to the exact count
  const [numerical, setNumerical] = useState(false); // when ON, EVERY generated question is numerical/calculation-based (default off)
  const [perSubtopic, setPerSubtopic] = useState(false); // when ON, the grid counts are generated FOR EACH subtopic (looped), not as a whole-batch total
  const [perSubRun, setPerSubRun] = useState(null); // live per-subtopic progress { i, n, name }
  const [perSubList, setPerSubList] = useState([]); // completed subtopics this run: [{ name, count }]
  const jobIdRef = useRef(null); // id of the running background job (so Stop can cancel it)
  const runProducedRef = useRef(0); // how many questions the LAST generate() run produced (for per-subtopic tallying)
  const stopRef = useRef(false); // set when the user clicks Stop — breaks/short-circuits the poll loop
  const pendingDoneRef = useRef([]); // subtopics queued (via "Use selected") to hide after the next Generate
  const [inserting, setInserting] = useState(false);
  const [msg, setMsg] = useState("");
  const [keyStats, setKeyStats] = useState(null); // live per-key activity this run { label: {requests,ok,limited,error,questions} }
  const [liveWave, setLiveWave] = useState({}); // in-progress wave's per-bucket "have" counts { "type|difficulty": n }
  const [destChoice, setDestChoice] = useState("current"); // "current" | "existing" | "new" (where the batch is inserted)
  const [newName, setNewName] = useState("");
  const [existingId, setExistingId] = useState(""); // chosen existing quiz/test id when destChoice === "existing"
  const [inferring, setInferring] = useState(false); // detecting the topic from a quiz's existing questions
  const [coverage, setCoverage] = useState(null); // { covered:[], missing:[] } — refreshed after each batch
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [syllabus, setSyllabus] = useState(null); // FIXED checklist for this session so coverage totals stay stable
  // A saved "to-do" list of subtopics for THIS quiz/test, kept in the browser so
  // you can jot down the areas still missing and come back later to generate them
  // one at a time. Persisted per target (falls back to the topic name).
  const [plan, setPlan] = useState([]); // [{ text, done, src }] aggregated from all saved plans
  const [selected, setSelected] = useState(() => new Set()); // ticked subtopics to add to "Subtopics to cover"
  const planKey = `mstg.subtopicPlan:${currentTargetName || defaultTopic || "global"}`;
  // Read EVERY saved subtopic — this quiz/test's own plan PLUS anything saved from
  // the "Missing areas" scans — so you can pick from all of them here. Deduped by
  // text; each item remembers which store it came from (src) for removal.
  const readAllSaved = () => {
    const out = []; const seen = new Set();
    // Subtopics already generated HERE are hidden — they "disappear" from the list
    // once their questions are made. Tracked per target in localStorage.
    let doneSet = new Set();
    try { const d = JSON.parse(localStorage.getItem(`mstg.doneSubtopics:${planKey}`) || "[]"); if (Array.isArray(d)) doneSet = new Set(d.map((t) => String(t).toLowerCase())); } catch { /* ignore */ }
    const add = (text, done, src) => {
      const t = String(text || "").trim(); if (!t) return;
      const k = t.toLowerCase(); if (seen.has(k) || doneSet.has(k)) return; seen.add(k);
      out.push({ text: t, done: !!done, src });
    };
    // Only show subtopics for the CURRENT topic — this target's own saved plan
    // plus any Missing-areas scan whose topic matches — so saving a new topic's
    // subtopics never leaves the previous topic's subtopics showing here.
    const wantTopic = String(topic || defaultTopic || "").trim().toLowerCase();
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) { const kk = localStorage.key(i); if (kk && (kk.startsWith("mstg.subtopicPlan:") || kk.startsWith("mstg.missingAreas:"))) keys.push(kk); }
      keys.sort((a, b) => (a === planKey ? -1 : b === planKey ? 1 : 0)); // this target's own plan first
      for (const key of keys) {
        const rawV = localStorage.getItem(key); if (!rawV) continue;
        if (key.startsWith("mstg.subtopicPlan:")) {
          if (key !== planKey) continue; // only THIS quiz/test's own saved plan
          const arr = JSON.parse(rawV); if (Array.isArray(arr)) arr.forEach((p) => add(p?.text, p?.done, key));
        } else {
          const obj = JSON.parse(rawV);
          const t = String(obj?.topic || key.slice("mstg.missingAreas:".length)).trim().toLowerCase();
          if (!wantTopic || t !== wantTopic) continue; // only the CURRENT topic's scan, never other topics
          const prog = obj?.progress || {};
          (obj?.missing || []).forEach((m) => add(m, prog?.[m]?.status === "done", key));
        }
      }
    } catch { /* ignore malformed entries */ }
    return out;
  };

  // Mark subtopics as done so they DISAPPEAR from the Saved-subtopics list (per
  // target). Called after their questions have been generated.
  const markSubtopicsDone = (texts) => {
    const key = `mstg.doneSubtopics:${planKey}`;
    let done = [];
    try { done = JSON.parse(localStorage.getItem(key) || "[]"); if (!Array.isArray(done)) done = []; } catch { done = []; }
    const set = new Set(done.map((t) => String(t).toLowerCase()));
    (texts || []).forEach((t) => { const s = String(t || "").trim().toLowerCase(); if (s) set.add(s); });
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* storage blocked/full */ }
    setSelected((sel) => { const n = new Set(sel); (texts || []).forEach((t) => n.delete(String(t || "").toLowerCase())); return n; });
    setPlan(readAllSaved());
  };

  // Clear the whole saved-subtopics list for this view: drop this target's own
  // plan and hide the current topic's Missing-areas subtopics (via the done
  // overlay, so the Missing-areas modal's own data isn't destroyed).
  const clearAllSubtopics = () => {
    if (!plan.length) return;
    if (!window.confirm(`Clear all ${plan.length} saved subtopic(s) from this list?`)) return;
    try { localStorage.removeItem(planKey); } catch { /* ignore */ }
    markSubtopicsDone(plan.map((p) => p.text)); // hides Missing-areas-sourced ones too + refreshes
    setMsg("Cleared the saved subtopics for this topic.");
  };

  useEffect(() => {
    if (!open) return;
    setMsg("");
    setPreview([]);
    setCoverage(null);
    setCoverageLoading(false);
    setSyllabus(null);
    setPerSubtopic(false); // default unchecked each time the modal opens
    setResearch(false); // auto-research off by default each open
    setPerSubRun(null);
    setPerSubList([]);
    // Pick a sensible default destination: inside a quiz → that quiz; at topic
    // level with existing quizzes → let the user pick one (default to the first)
    // so they can add to "Quiz 1"; otherwise → new.
    setDestChoice(
      !allowNewTarget ? "current"
        : currentTargetName ? (defaultDest === "new" ? "new" : "current")
        : (existingItems.length ? "existing" : "new")
    );
    setNewName("");
    setExistingId(existingItems[0]?._id || "");
    setSection(defaultSection || sections[0] || ""); // re-sync target subject on open
    // Pre-fill the topic/subtopics REMEMBERED on this quiz/test (saved on a
    // previous generation), so reopening it days later shows what it was built
    // from and lets you continue the same syllabus.
    setTopic(defaultTopic || "");
    setSubtopics(defaultSubtopics || "");
    // Seed the "already covered" list from the target's CURRENT questions so a
    // fresh batch continues from the uncovered subtopics instead of repeating
    // what was generated in an earlier session (true batch-to-batch continuation).
    setAvoidStems((existingQuestions || []).map((q) => (typeof q === "string" ? q : q?.text)).filter(Boolean));
    // If this quiz already has questions but NO remembered topic (it was built
    // before topics were saved), infer the topic from the questions so the field
    // isn't blank. Fills only if the user hasn't typed anything.
    const stems = (existingQuestions || []).slice(0, 40);
    if (!(defaultTopic || "").trim() && stems.length) {
      setInferring(true);
      aiService
        .inferTopic({ questions: stems, mode: isClient ? source : undefined })
        .then((r) => { if (r?.topic) setTopic((t) => (t.trim() ? t : r.topic)); })
        .catch(() => {})
        .finally(() => setInferring(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultSection, defaultTopic, defaultSubtopics]);

  // (Re)load status for the chosen source so the model list / active-key count
  // reflect that pool. Clients pass their source; admins always use built-in.
  useEffect(() => {
    if (!open) return;
    aiService
      .status(isClient ? source : undefined)
      .then((s) => {
        setStatus(s);
        setModel(s?.model || (s?.models && s.models[0]) || "");
      })
      .catch(() => setStatus({ enabled: false }));
  }, [open, source, isClient]);

  // Load ALL saved subtopics (this target's plan + every Missing-areas scan) on open.
  useEffect(() => {
    if (!open) return;
    setPlan(readAllSaved());
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, topic]);

  if (!open) return null;

  // Effective per-batch cap for THIS account — the admin's global limit or the
  // client's assigned plan (reported by /ai/status). Falls back to the default.
  const maxPerBatch = status?.maxPerBatch || MAX_TOTAL;

  // Update a single cell of the type × difficulty matrix (clamped 0–maxPerBatch).
  const setCell = (type, diff, val) => {
    const n = Math.max(0, Math.min(maxPerBatch, parseInt(val, 10) || 0));
    setMatrix((m) => ({ ...m, [type]: { ...(m[type] || {}), [diff]: n } }));
  };
  const rowTotal = (type) => DIFFS.reduce((s, d) => s + (matrix[type]?.[d] || 0), 0);
  // Flatten the matrix into [{ type, difficulty, count }] entries with count>0.
  const buildPlan = () =>
    TYPE_OPTIONS.flatMap((t) =>
      DIFFS.map((d) => ({ type: t.id, difficulty: d, count: matrix[t.id]?.[d] || 0 })).filter((e) => e.count > 0)
    );
  const total = TYPE_OPTIONS.reduce((s, t) => s + rowTotal(t.id), 0);

  // "Generated so far" per type × difficulty for the results breakdown grid:
  // completed waves are counted from the preview, plus the in-progress wave's
  // live per-bucket counts (from the job status). Keyed "type|difficulty".
  const genCounts = {};
  for (const q of preview) {
    const k = `${q?.type || "mcq"}|${q?.difficulty || "Medium"}`;
    genCounts[k] = (genCounts[k] || 0) + 1;
  }
  for (const k in liveWave) genCounts[k] = (genCounts[k] || 0) + (liveWave[k] || 0);

  // Turn the free-text "Subtopics to cover" box into a clean list of items, so
  // coverage can track EXACTLY the subtopics you typed (e.g. "Skull",
  // "vertebral column", …) instead of an AI-invented syllabus. Handles a leading
  // "Header:-" label, bullets, commas, semicolons, newlines and sentence dots.
  const parseManualSubtopics = (text) => {
    let t = String(text || "").trim();
    t = t.replace(/^[^\n:]{0,80}:-?\s*/, ""); // drop a leading "Header :-" label
    return Array.from(new Set(
      t.split(/[\n•;,]+|\.\s+/)
        .map((s) => s.replace(/^[\s\-–—•*.]+/, "").replace(/[\s.]+$/, "").replace(/\s+/g, " ").trim())
        .filter((s) => s.length >= 2)
    )).slice(0, 60);
  };

  // After a batch, summarise which syllabus subtopics are now covered vs still
  // missing — cumulative across the quiz's existing questions plus everything
  // generated in this session. Best-effort (one small AI call); silent on error.
  const refreshCoverage = async (stems) => {
    const t = topic.trim();
    // Merge the whole topic's existing questions (all its quizzes) with this
    // session's generated ones, so coverage reflects the ENTIRE topic, not just
    // the current quiz.
    const topicStems = (coverageQuestions || []).map((q) => (typeof q === "string" ? q : q?.text)).filter(Boolean);
    const list = Array.from(new Set([...topicStems, ...(stems || []).filter(Boolean)]));
    if (!t || !list.length) { setCoverage(null); return; }
    setCoverageLoading(true);
    try {
      // If YOU typed subtopics, track coverage against EXACTLY those (they win
      // over any AI-generated syllabus). Otherwise use the fixed AI checklist,
      // passed back so later batches classify the SAME list (covered grows,
      // missing shrinks against a constant total).
      const manual = parseManualSubtopics(subtopics);
      const useSyllabus = syllabus || (manual.length ? manual : undefined);
      const r = await aiService.coverageGaps({ topic: t, questions: list.slice(0, 300), syllabus: useSyllabus, mode: isClient ? source : undefined });
      if (!syllabus) {
        if (manual.length) setSyllabus(manual);
        else if (Array.isArray(r?.syllabus) && r.syllabus.length) setSyllabus(r.syllabus);
      }
      setCoverage({ covered: r?.covered || [], missing: r?.missing || [] });
    } catch {
      /* coverage is a nice-to-have — ignore failures */
    } finally {
      setCoverageLoading(false);
    }
  };

  // `append` = "Generate more": keep the current preview and add a fresh batch
  // on the same topic, avoiding everything already generated. With Auto-continue
  // on, the main Generate runs in WAVES — after a wave is cut short (free-tier
  // quota / shortfall) it waits ~60s for the limit to reset and generates the
  // remainder, repeating until the full count is reached or you press Stop.
  // Serialize the existing questions (whole topic + this quiz) into source text
  // the AI can reshape (A) or use as source material (B) for other question types.
  const serializeExisting = () => {
    const pool = [...(coverageQuestions || []), ...(existingQuestions || [])];
    const seen = new Set();
    const parts = [];
    for (const q of pool) {
      const text = typeof q === "string" ? q : q?.text;
      if (!text) continue;
      const key = String(text).trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (typeof q === "string") { parts.push(`Q: ${text}`); continue; }
      const opts = Array.isArray(q.options) ? q.options : [];
      const ans = Number.isInteger(q.correct) && opts[q.correct] != null ? opts[q.correct] : "";
      let s = `Q: ${text}`;
      if (opts.length) s += `\nOptions: ${opts.join(" | ")}`;
      if (ans) s += `\nAnswer: ${ans}`;
      if (q.explanation) s += `\nExplanation: ${String(q.explanation).slice(0, 400)}`;
      parts.push(s);
    }
    return parts.join("\n\n");
  };

  // Two buttons: (A) reshape=true recasts existing MCQ facts into the chosen
  // types; (B) reshape=false writes fresh questions of those types from the same
  // material (avoiding duplicates). Both use the type counts set in the grid and
  // flow into the SAME preview → choose → insert.
  const generateFromExisting = (reshape) => {
    const src = serializeExisting();
    if (!src) { setMsg("No existing questions found to build from — generate some MCQs first."); return; }
    generate(false, null, { sourceText: src, reshape });
  };

  const generate = async (append = false, overrideSubtopics = null, extra = {}) => {
    if (!topic.trim() && !url.trim() && !extra.sourceText) { setMsg("Enter a topic/syllabus, or paste a source link (web page or YouTube video)."); return; }
    // Current-affairs safeguard: the AI can't reliably recall current office-holders,
    // latest appointments or recent events. If the topic looks like current affairs
    // and no Source link/material is provided, confirm before generating from memory.
    if (!append && !extra.sourceText && !url.trim() && !research && looksLikeCurrentAffairs(topic)) {
      const ok = window.confirm(
        "This looks like a CURRENT-AFFAIRS topic (current office-holders, latest/recent events, or a recent year).\n\n" +
        "The AI's knowledge has a cut-off date, so it CANNOT reliably know current facts — it may return general theory or outdated names.\n\n" +
        "For accurate results, click Cancel and paste a Source link (an article or official page URL) in the box below, then generate — the AI will build the questions from that verified material.\n\n" +
        "Generate anyway without a source?"
      );
      if (!ok) { setMsg("Tip: paste a Source link (web page URL) below so the AI builds accurate current-affairs questions from verified material."); return; }
    }
    const plan = buildPlan();
    if (!plan.length) { setMsg("Set at least one question count in the grid below."); return; }
    if (total > maxPerBatch) { setMsg(`Please keep the total to ${maxPerBatch} questions or fewer per batch.`); return; }
    setBusy(true);
    setStopping(false);
    stopRef.current = false;
    jobIdRef.current = null;
    setKeyStats(null);
    setLiveWave({});
    if (!append) setPreview([]);
    // Track how many of each type|difficulty bucket we've produced across waves,
    // so each auto-continue wave requests only the REMAINING buckets (keeping the
    // grid's distribution instead of re-generating the whole plan every wave).
    const producedByBucket = {};

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Accumulate the avoid-list LOCALLY across waves — React state updates are
    // async, so relying on avoidStems would let the next wave repeat this wave's
    // questions. We still mirror it into state for later manual "Generate more".
    // Seed the avoid-list with EVERY existing question in the whole topic (all
    // its quizzes) — passed in via coverageQuestions — not just the current
    // quiz, so a repeat generation in a topic that already has several quizzes
    // (e.g. 4 quizzes / 200 questions) produces genuinely NEW questions instead
    // of duplicating ones that already exist elsewhere in the topic.
    const topicStems = (coverageQuestions || []).map((q) => (typeof q === "string" ? q : q?.text)).filter(Boolean);
    let avoidLocal = Array.from(new Set([...(avoidStems || []), ...topicStems]));

    // Run ONE wave (start job + poll to completion). Appends its questions to the
    // preview and returns how it ended so the loop can decide to auto-continue.
    const runWave = async (isAppend, priorTotal = 0, target = 0) => {
      // Request ONLY the buckets still short of the grid (subtract what earlier
      // waves already produced), so the per-type/difficulty distribution is
      // filled exactly instead of over-generating some buckets.
      const wavePlan = plan
        .map((b) => ({ ...b, count: Math.max(0, b.count - (producedByBucket[`${b.type}|${b.difficulty}`] || 0)) }))
        .filter((b) => b.count > 0);
      if (!wavePlan.length) return { produced: 0, done: true };
      let jobId, requested;
      try {
        ({ jobId, requested } = await aiService.generate({
          topic: topic.trim(),
          // A per-subtopic "Generate" button passes the single subtopic to focus
          // on; otherwise use whatever is typed in the Subtopics box.
          subtopics: (overrideSubtopics != null ? overrideSubtopics : subtopics).trim() || undefined,
          url: url.trim() || undefined,
          plan: wavePlan,
          notes: notes.trim(),
          numerical: numerical || undefined, // include calculation-based numerical questions only when ticked
          model: model || undefined,
          avoid: avoidLocal, // don't repeat anything from earlier waves/batches
          mode: isClient ? source : undefined,
          source: extra.sourceText || undefined, // existing questions as material (from-existing modes)
          reshape: extra.reshape || undefined,   // true = recast existing MCQs into the chosen types
          research: (research && !url.trim() && !extra.sourceText) || undefined, // auto-fetch current web facts
        }));
      } catch (e) { setMsg(e.message || "Generation failed."); return { produced: 0, errored: true }; }
      if (!jobId) { setMsg("Could not start generation."); return { produced: 0, errored: true }; }
      jobIdRef.current = jobId;
      let done = false, result = { produced: 0, timedOut: true };
      for (let i = 0; i < 300 && !done; i++) {
        await sleep(2000);
        let s;
        try { s = await aiService.job(jobId); } catch { continue; }
        if (s.keyStats && Object.keys(s.keyStats).length) setKeyStats(s.keyStats);
        if (Array.isArray(s.byBucket)) {
          const m = {};
          for (const b of s.byBucket) m[`${b.type}|${b.difficulty}`] = b.have;
          setLiveWave(m);
        }
        if (s.status === "done") {
          const qsAll = s.questions || [];
          // Cap this wave to the REMAINING needed so the total lands on the target
          // exactly — each wave requests the full plan, so without this the last
          // wave overshoots (e.g. 472 for a target of 400).
          const room = target > 0 ? Math.max(0, target - priorTotal) : qsAll.length;
          // "Keep all generated" → keep the whole wave even if it overshoots the
          // target; otherwise trim so the total lands on the requested count exactly.
          const qs = keepExtras ? qsAll : qsAll.slice(0, room);
          setPreview((prev) => (isAppend ? [...prev, ...qs] : qs));
          // Fold this wave's kept questions into the cross-wave bucket tally, and
          // clear the in-progress overlay (they're now counted via the preview).
          for (const q of qs) {
            const k = `${q?.type || "mcq"}|${q?.difficulty || "Medium"}`;
            producedByBucket[k] = (producedByBucket[k] || 0) + 1;
          }
          setLiveWave({});
          const batchStems = qs.map((q) => q.text).filter(Boolean);
          avoidLocal = Array.from(new Set([...avoidLocal, ...batchStems]));
          setAvoidStems(avoidLocal);
          refreshCoverage(avoidLocal);
          result = { produced: qs.length, requested, model: s.model, short: qs.length < requested, quota: s.error === "quota", cancelled: s.error === "cancelled" || stopRef.current };
          done = true;
        } else if (s.status === "error") {
          setMsg(s.error || "Generation failed."); result = { produced: 0, errored: true }; done = true;
        } else {
          // Show the CUMULATIVE progress toward the overall target (prior waves +
          // this wave's live count), so it climbs 71 → … → target instead of
          // resetting to "0 of 500" each wave.
          const soFar = priorTotal + (s.count || 0);
          setMsg(stopRef.current ? `Stopping… keeping the ${soFar} generated so far` : `Generating… ${soFar} of ${target || requested} ready (${Math.max(0, (target || requested) - soFar)} to go)`);
        }
      }
      if (!done) setMsg("Still generating — this is taking longer than expected. Please try a smaller batch.");
      return result;
    };

    // Final summary once the loop ends.
    const finalize = (res, producedTotal, target) => {
      // Only leave the wave's own hard error / timeout message when we produced
      // NOTHING at all. If earlier waves already made questions, never surface a
      // scary "no usable questions" error over a full preview — summarise what we
      // have so the user can still insert it.
      if ((res?.errored || res?.timedOut) && producedTotal === 0) return;
      const model = res?.model ? ` with ${res.model}` : "";
      if (stopRef.current || res?.cancelled) { setMsg(`⏹ Stopped. Kept ${producedTotal} question(s) so far${model} — review & Insert below, or Generate more.`); return; }
      const short = producedTotal < target;
      if (append && !autoContinue) {
        setMsg(`✓ Added ${producedTotal} more question(s)${model}.` + (short ? " (Some couldn't be generated — click “Generate more” to top up.)" : " No duplicates of the earlier questions. Review & Insert."));
        return;
      }
      // A wave errored/timed out but earlier waves DID produce questions — report
      // the partial success instead of the failure.
      if (res?.errored || res?.timedOut) {
        setMsg(`✓ Generated ${producedTotal} of ${target} question(s)${model}. The AI stopped before finishing the rest — Insert these now, then use “Generate more” to top up (it often works on another try or with a fuller model).`);
        return;
      }
      let tail;
      if (!short) tail = " Review below, then Insert.";
      else if (res?.quota) tail = autoContinue ? " The free-tier quota kept limiting it — Insert these, then Generate more later for the rest." : " Stopped early — Gemini free-tier quota was reached. Insert these, then generate the rest in a minute.";
      else tail = " (Some couldn't be generated — click “Generate more” to top up.)";
      setMsg(`✓ Generated ${producedTotal} of ${target} question(s)${model}.` + tail);
    };

    try {
      const target = total;
      const autoLoop = autoContinue && !append; // manual "Generate more" stays a single wave
      const MAX_WAVES = 60; // very high cap so a big target can grind through many quota windows
      const MAX_ZERO = 8;   // consecutive EMPTY waves before we conclude the quota is truly dead
      const MIN_YIELD = 2;  // a wave adding 0–1 questions is "barely progressing"
      const MAX_LOW = 4;    // consecutive barely-progressing waves → a bucket the model just can't fill (e.g. Assertion & Reason); stop instead of spinning forever
      setMsg(append ? `Generating ${total} more from this topic (no duplicates)…` : `Starting generation of ${total} question(s)…`);
      let producedTotal = 0;
      let firstWave = true;
      let wave = 0;
      let zeroWaves = 0; // consecutive waves that produced nothing (rate-limited)
      let lowWaves = 0;  // consecutive waves that produced almost nothing (a type the model keeps failing)
      let last;
      while (true) {
        last = await runWave(firstWave ? append : true, producedTotal, target);
        producedTotal += last.produced || 0;
        firstWave = false;
        wave += 1;
        zeroWaves = (last.produced || 0) === 0 ? zeroWaves + 1 : 0; // reset the moment a wave produces anything
        lowWaves = (last.produced || 0) < MIN_YIELD ? lowWaves + 1 : 0; // reset once a wave makes real progress
        const reached = producedTotal >= target;
        // Keep going through empty/small waves (waiting out the per-minute limit).
        // Give up when the quota is clearly dead (many EMPTY waves), when a type
        // can't be filled (many BARELY-progressing waves — e.g. the model keeps
        // failing to make valid Assertion & Reason), or at the safety cap — so it
        // stops gracefully instead of spinning forever a few short of the target.
        const dead = zeroWaves >= MAX_ZERO;
        const stalled = lowWaves >= MAX_LOW;
        const canContinue = autoLoop && !stopRef.current && !reached && !last.errored && !last.timedOut && !dead && !stalled && wave < MAX_WAVES;
        if (!canContinue) {
          if (autoLoop && !reached && !stopRef.current && !last.errored && !last.timedOut && (dead || stalled || wave >= MAX_WAVES)) {
            if (stalled && !dead) {
              // Name the type(s) still short so the user knows what to retry.
              const shortTypes = [...new Set(
                plan
                  .filter((b) => (producedByBucket[`${b.type}|${b.difficulty}`] || 0) < b.count)
                  .map((b) => TYPE_OPTIONS.find((t) => t.id === b.type)?.label || b.type)
              )];
              setMsg(`⏸ Auto-continue stopped at ${producedTotal} of ${target}. The AI couldn't generate more ${shortTypes.join(", ")} on this topic (these types are the hardest for it). Insert these ${producedTotal} now, then use “Generate more” to retry the rest — it often succeeds on another try or with a fuller model.`);
            } else {
              setMsg(`⏸ Auto-continue stopped at ${producedTotal} of ${target}. The free-tier quota looks exhausted right now (many empty tries in a row) — Insert these, then Generate more later (the daily quota resets), or add keys from other Google accounts for more.`);
            }
          } else {
            finalize(last, producedTotal, target);
          }
          break;
        }
        // Interruptible wait for the per-minute limit to refill (a touch longer
        // after an empty wave so the window has time to reset).
        const waitSec = (last.produced || 0) === 0 ? 60 : 40;
        for (let k = waitSec; k > 0 && !stopRef.current; k--) {
          setMsg(`Auto-continue: ${producedTotal} of ${target} so far${zeroWaves ? ` · ${zeroWaves} empty wave(s)` : ""}. Waiting ${k}s for the free-tier limit to reset… (press Stop to keep what you have)`);
          await sleep(1000);
        }
        if (stopRef.current) { finalize(last, producedTotal, target); break; }
      }
      // Once a subtopic's questions are made, hide it from the Saved list. A
      // per-subtopic Generate marks that one; "Use selected" + Generate marks the
      // ticked set. (Nothing is hidden if the topic box was typed manually.)
      if (producedTotal > 0 && !stopRef.current) {
        if (overrideSubtopics != null) markSubtopicsDone([overrideSubtopics]);
        else if (!append && pendingDoneRef.current.length) { markSubtopicsDone(pendingDoneRef.current); pendingDoneRef.current = []; }
      }
      runProducedRef.current = producedTotal; // expose this run's count for per-subtopic tallying
    } catch (e) {
      setMsg(e.message || "Generation failed.");
    } finally {
      setBusy(false);
      setStopping(false);
      stopRef.current = false;
      jobIdRef.current = null;
    }
  };

  // ---- Saved subtopics (this target's plan + Missing-areas scans) ----------
  // Save subtopics (typed box or uncovered list) to THIS target's own plan.
  const addToPlan = (items) => {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(planKey) || "[]"); if (!Array.isArray(arr)) arr = []; } catch { arr = []; }
    const seen = new Set(arr.map((p) => String(p?.text || "").trim().toLowerCase()));
    const adds = (items || []).map((t) => String(t).trim()).filter((t) => t && !seen.has(t.toLowerCase())).map((t) => ({ text: t, done: false }));
    if (adds.length) { try { localStorage.setItem(planKey, JSON.stringify([...arr, ...adds])); } catch { /* storage blocked/full */ } }
    setPlan(readAllSaved());
    setMsg(adds.length ? `Saved ${adds.length} subtopic(s) — tick the ones you want below and click "Add selected".` : "Those subtopics are already saved.");
  };
  // Remove a saved subtopic from its own store. (Only offered for this modal's own
  // plan items; Missing-areas items are managed in that modal to keep it in sync.)
  const removeFromPlan = (item) => {
    try {
      if (item.src?.startsWith("mstg.subtopicPlan:")) {
        const arr = JSON.parse(localStorage.getItem(item.src) || "[]");
        localStorage.setItem(item.src, JSON.stringify((Array.isArray(arr) ? arr : []).filter((p) => String(p?.text || "").trim().toLowerCase() !== item.text.toLowerCase())));
      }
    } catch { /* ignore */ }
    setSelected((s) => { const n = new Set(s); n.delete(item.text.toLowerCase()); return n; });
    setPlan(readAllSaved());
  };
  const toggleSelect = (text) => setSelected((s) => { const n = new Set(s); const k = text.toLowerCase(); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allSelected = plan.length > 0 && plan.every((p) => selected.has(p.text.toLowerCase()));
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(plan.map((p) => p.text.toLowerCase())));
  // Put the ticked subtopics into the "Subtopics to cover" box (merged, deduped).
  const addSelectedToSubtopics = () => {
    const picks = plan.filter((p) => selected.has(p.text.toLowerCase())).map((p) => p.text);
    if (!picks.length) { setMsg("Tick the subtopics you want first, then click \"Use selected\"."); return; }
    // REPLACE the box with exactly the ticked subtopics — so generation focuses on
    // only these. (Appending kept whatever was already there, which is why picking
    // one still generated across all the subtopics still sitting in the box.)
    setSubtopics(picks.join(", "));
    pendingDoneRef.current = picks; // hide these from the list once the next Generate finishes
    setMsg(`"Subtopics to cover" now holds only your ${picks.length} selected subtopic(s) — Generate will focus on just these, and they'll drop off the list once done.`);
  };
  // Generate a batch focused on ONE saved subtopic (uses the type/difficulty grid).
  // Generate a focused subtopic / uncovered batch and APPEND it to whatever is
  // already in the preview (so the previous batch isn't wiped) — deduped against
  // it. Manually-typed subtopics still take precedence for the main Generate.
  const generateSubtopic = (text) => { setSubtopics(text); generate(true, text); };

  // "Per subtopic" mode: generate the grid's mix for EACH subtopic in the
  // "Subtopics to cover" box, one at a time (each subtopic is a focused run that
  // reuses the normal generator, so it stays within the per-batch cap). The
  // preview accumulates across subtopics and a live line shows the progress.
  const generatePerSubtopic = async () => {
    if (!topic.trim() && !url.trim()) { setMsg("Enter a topic/syllabus (or a source link) first."); return; }
    const subs = subtopics.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!subs.length) { setMsg("Add the subtopics in “Subtopics to cover” (or pick from Saved) to generate per subtopic."); return; }
    if (total <= 0) { setMsg("Set at least one question count in the grid below."); return; }
    if (total > maxPerBatch) { setMsg(`Keep the PER-SUBTOPIC total to ${maxPerBatch} or fewer (it runs once per subtopic).`); return; }
    stopRef.current = false;
    setPerSubList([]);
    for (let idx = 0; idx < subs.length; idx++) {
      if (stopRef.current) break;
      setPerSubRun({ i: idx + 1, n: subs.length, name: subs[idx] });
      runProducedRef.current = 0;
      // First subtopic starts a fresh preview; later ones append (no duplicates).
      // eslint-disable-next-line no-await-in-loop
      await generate(idx > 0, subs[idx]);
      // Record how many THIS subtopic produced, for the live per-subtopic tally.
      const made = runProducedRef.current || 0;
      setPerSubList((prev) => [...prev, { name: subs[idx], count: made }]);
    }
    setPerSubRun(null);
  };

  // Stop the current generation. Tells the server to cancel the background job;
  // the poll loop then finalizes with whatever was produced so far, so the
  // partial batch still shows up for review/insert.
  const stop = async () => {
    stopRef.current = true;
    setStopping(true);
    setMsg("Stopping…");
    try {
      if (jobIdRef.current) await aiService.cancelJob(jobIdRef.current);
    } catch {
      /* best-effort — the poll loop still winds down on the next finalize */
    }
  };

  const insert = async () => {
    if (!preview.length) return;
    const makingNew = allowNewTarget && destChoice === "new";
    const usingExisting = allowNewTarget && destChoice === "existing";
    if (makingNew && !newName.trim()) { setMsg(`Enter a name for the new ${newLeafLabel}.`); return; }
    if (usingExisting && !existingId) { setMsg(`Choose an existing ${newLeafLabel} to add these to.`); return; }
    const existingName = existingItems.find((it) => it._id === existingId)?.name || "";
    setInserting(true);
    setMsg("");
    try {
      const opts = { section, topic: topic.trim(), subtopics: subtopics.trim() };
      if (makingNew) opts.newTarget = { name: newName.trim() };
      else if (usingExisting) opts.existingTargetId = existingId;
      const res = await onUpload(preview, opts);
      const where = makingNew ? ` into new ${newLeafLabel} “${newName.trim()}”` : usingExisting ? ` into “${existingName}”` : "";
      setMsg(`✓ Inserted ${res?.inserted ?? preview.length} question(s)${where}. Generate the next batch, or click Close when you're done.`);
      setPreview([]);
      setNewName("");
      // Keep the chosen destination so the next batch appends to the same place.
      // (After creating a NEW one, switch to "current" — it's now the active target.)
      if (makingNew) setDestChoice("current");
      // Stay on this screen (keep the topic + settings) so you can immediately
      // generate the next batch — no duplicates. The modal never closes by
      // itself after inserting; use the Close button when you're finished.
    } catch (e) {
      setMsg(e.message || "Insert failed.");
    } finally {
      setInserting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4">
      <div className="min-h-full w-full max-w-none animate-scale-in card m-0 rounded-none p-4 sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Sparkles className="h-5 w-5 text-brand-600" /> {title}
          </h3>
          <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        {/* Per-generation API source (clients allowed both pools). Kept above the
            "not configured" notice so you can always switch to the other source. */}
        {canChooseSource && (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-semibold">API source for this generation</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSource("inbuilt")}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${source === "inbuilt" ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300" : "border-slate-200 text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:text-slate-300"}`}>
                <Server className="h-4 w-4" /> Built-in APIs
              </button>
              <button type="button" onClick={() => setSource("self")}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${source === "self" ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300" : "border-slate-200 text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:text-slate-300"}`}>
                <KeyRound className="h-4 w-4" /> My own APIs
              </button>
            </div>
          </div>
        )}

        {status && !status.enabled ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> AI is not available</p>
            {isClient ? (
              <p className="mt-1">
                {source === "self"
                  ? "You haven't added any API keys yet. Add keys in the AI tab under \u201cMy own APIs\u201d"
                  : "Built-in AI isn't available right now"}
                {canChooseSource ? ", or switch source above." : ". Please contact the administrator."}
              </p>
            ) : (
              <p className="mt-1">
                Ask your admin to add <code>AI_API_KEY</code> (and optionally <code>AI_BASE_URL</code>,
                <code> AI_MODEL</code>) to the server environment, then redeploy. The key stays on the
                server and is never exposed to the browser.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              Describe a topic and the AI drafts questions in your app's format. Nothing is saved
              until you review and click <b>Insert</b>.
              {typeof status?.keys === "number" && (
                <span className="ml-1 font-semibold text-emerald-600 dark:text-emerald-400">
                  {status.keys} API key{status.keys === 1 ? "" : "s"} active.
                </span>
              )}
              {status?.planName && (
                <span className="ml-1 font-semibold text-brand-600 dark:text-brand-300">
                  Plan: {status.planName} · up to {maxPerBatch}/batch{status?.remaining != null ? ` · ${status.remaining} left this window` : ""}.
                </span>
              )}
            </div>

            {status?.models && status.models.length > 1 && (
              <div className="mb-3">
                <label className="mb-1 block text-sm font-semibold">AI model</label>
                <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                  {status.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}

            {sections.length > 0 && (
              <div className="mb-3">
                <label className="mb-1 block text-sm font-semibold">Add to subject</label>
                <select className="input" value={section} onChange={(e) => setSection(e.target.value)}>
                  <option value="">— No subject —</option>
                  {sections.map((s, i) => <option key={i} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            {avoidStems.length > 0 && preview.length === 0 && (
              <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                This {newLeafLabel} already has <b>{avoidStems.length}</b> question(s). Keep the same topic and click <b>Generate</b> — the next batch <b>continues from the uncovered subtopics</b> and won't repeat what's already here.
              </div>
            )}

            <label className="mb-1 block text-sm font-semibold">
              Topic / syllabus
              {inferring && <span className="ml-2 text-xs font-normal text-slate-400">detecting from existing questions…</span>}
            </label>
            <textarea
              rows={2}
              className="input resize-y"
              placeholder={`e.g. "Newton's Laws of Motion for Class 11 Physics" or "Indian Constitution — Fundamental Rights"`}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />

            <label className="mb-1 mt-3 block text-sm font-semibold">
              Subtopics to cover <span className="font-normal text-slate-400">(optional — one per line or comma-separated)</span>
            </label>
            <textarea
              rows={2}
              className="input resize-y"
              placeholder={`e.g. Monsoon mechanism, El Niño & La Niña, Western disturbances, Jet streams, Cyclones, Rainfall distribution, Climatic regions`}
              value={subtopics}
              onChange={(e) => setSubtopics(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              List the exact subtopics you want questions spread across. Leave empty and the AI works out the subtopics itself to cover the whole syllabus.
            </p>
            {subtopics.trim() && (
              <button type="button" onClick={() => addToPlan(subtopics.split(/[\n,]+/))} className="btn-outline mt-2 text-xs">
                <Bookmark className="h-3.5 w-3.5" /> Save these subtopics to my plan
              </button>
            )}

            {/* Saved subtopics — from THIS quiz/test's plan AND every "Missing areas"
                scan you saved. Tick the ones you want and add them to "Subtopics to
                cover", or generate any single one on its own. */}
            {plan.length > 0 && (
              <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-900/40 dark:bg-brand-900/10">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Bookmark className="h-4 w-4 text-brand-600" /> Saved subtopics
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{plan.length}</span>
                  </p>
                  <div className="flex items-center gap-3 text-xs">
                    <button type="button" onClick={clearAllSubtopics} className="font-semibold text-rose-600 hover:underline dark:text-rose-400">Clear list</button>
                    <button type="button" onClick={toggleSelectAll} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">{allSelected ? "Untick all" : "Select all"}</button>
                    <button type="button" onClick={addSelectedToSubtopics} className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-1 font-semibold text-white transition hover:bg-brand-700"><ListChecks className="h-3.5 w-3.5" /> Use selected ({selected.size})</button>
                  </div>
                </div>
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Tick the subtopics you need and click <b>Use selected</b> — this sets "Subtopics to cover" to <b>only</b> those, so Generate focuses on just them (it replaces whatever is in the box). Or hit <b>Generate</b> on a single row to do that one now. Saved on this device.</p>
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {plan.map((p, i) => {
                    const sel = selected.has(p.text.toLowerCase());
                    return (
                      <li key={i} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-xs dark:bg-slate-900/50">
                        <input type="checkbox" checked={sel} onChange={() => toggleSelect(p.text)} className="h-4 w-4 flex-shrink-0 accent-brand-600" />
                        <span className={`flex-1 ${p.done ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>{p.text}{p.done && <span className="ml-1 text-emerald-500">✓</span>}</span>
                        <button type="button" onClick={() => generateSubtopic(p.text)} disabled={busy} className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-brand-600 px-2 py-1 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50">
                          <Wand2 className="h-3 w-3" /> Generate
                        </button>
                        {p.src && p.src.startsWith("mstg.subtopicPlan:") && (
                          <button type="button" onClick={() => removeFromPlan(p)} title="Remove from plan" className="flex-shrink-0 text-slate-400 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <label className="mb-1 mt-3 block text-sm font-semibold">
              Source link <span className="font-normal text-slate-400">(optional — web page or YouTube video)</span>
            </label>
            <input
              type="url"
              className="input"
              placeholder="https://…  (article URL, or a YouTube link — its transcript is read automatically)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              Paste a web page or a <b>YouTube video</b> link and the AI bases the questions on its content/transcript
              (the video must have captions). Leave empty to generate purely from the topic above.
            </p>
            {looksLikeCurrentAffairs(topic) && !url.trim() && !research && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>
                  This looks like a <b>current-affairs</b> topic. The AI's knowledge has a cut-off date, so it can't reliably
                  know <b>current office-holders, latest appointments or recent events</b> — it may return general theory or
                  outdated facts. Either paste a <b>Source link</b> above, or tick <b>Auto-research the web</b> below and the
                  AI will fetch up-to-date facts and build the questions from them.
                </span>
              </div>
            )}
            {/* Auto-research the web: fetch current facts for the topic before generating. */}
            <label className={`mt-3 flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs transition ${research ? "border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-900/20" : "border-slate-200 dark:border-slate-700"} ${url.trim() ? "pointer-events-none opacity-50" : ""}`}>
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={research && !url.trim()}
                disabled={!!url.trim()}
                onChange={(e) => setResearch(e.target.checked)}
              />
              <span className="text-slate-700 dark:text-slate-200">
                <span className="flex items-center gap-1.5 font-semibold"><Globe className="h-3.5 w-3.5" /> Auto-research the web</span>
                <span className="mt-0.5 block text-slate-500 dark:text-slate-400">
                  The AI first searches the web (free Wikipedia, or your configured search provider) and builds the questions
                  from what it finds — best for <b>current affairs</b>. A little slower. {url.trim() ? "(Disabled while a Source link is set.)" : ""}
                </span>
              </span>
            </label>

            {/* How many of each type × difficulty. Total = sum of all cells. */}
            <div className="mt-3 flex items-center justify-between">
              <label className="block text-sm font-semibold">Questions by type &amp; difficulty</label>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${total > maxPerBatch ? "bg-rose-100 text-rose-600 dark:bg-rose-900/30" : "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"}`}>
                Total: {total}
              </span>
            </div>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[380px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                    {DIFFS.map((d) => (
                      <th key={d} className="px-2 py-2 text-center font-semibold">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TYPE_OPTIONS.map((t) => (
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
            {/* Total summary below the grid */}
            <div className={`mt-2 flex items-center justify-between rounded-xl border px-4 py-2.5 ${total > maxPerBatch ? "border-rose-300 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-900/20" : "border-brand-200 bg-brand-50 dark:border-brand-900/40 dark:bg-brand-900/20"}`}>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Total questions</span>
              <span className={`text-lg font-extrabold tabular-nums ${total > maxPerBatch ? "text-rose-600 dark:text-rose-400" : "text-brand-600 dark:text-brand-300"}`}>
                {total} <span className="text-xs font-medium text-slate-400">/ {maxPerBatch}</span>
              </span>
            </div>

            {perSubRun && (
              <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs dark:border-brand-900/40 dark:bg-brand-900/10">
                <p className="flex flex-wrap items-center gap-1.5 font-semibold text-brand-700 dark:text-brand-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Per subtopic — {perSubRun.i} of {perSubRun.n}
                  <span className="font-normal text-slate-500 dark:text-slate-400">· {preview.length} generated so far (target {total * perSubRun.n})</span>
                </p>
                {(() => {
                  const doneSum = perSubList.reduce((a, s) => a + (s.count || 0), 0);
                  const currentLive = Math.max(0, preview.length - doneSum); // questions made for the subtopic in progress
                  return (
                    <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
                      {perSubList.map((s, k) => (
                        <li key={k} className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" /> <span className="flex-1 truncate">{s.name}</span> <b>{s.count}</b>
                        </li>
                      ))}
                      <li className="flex items-center gap-1.5 text-brand-700 dark:text-brand-300">
                        <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" /> <span className="flex-1 truncate">{perSubRun.name}</span> <b>{currentLive}</b> / {total}
                      </li>
                    </ul>
                  );
                })()}
              </div>
            )}
            {!perSubRun && perSubList.length > 0 && (
              <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs dark:border-emerald-900/40 dark:bg-emerald-900/10">
                <p className="mb-1 font-semibold text-emerald-700 dark:text-emerald-300">Generated per subtopic:</p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                  {perSubList.map((s, k) => (
                    <li key={k} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" /> <span className="flex-1 truncate">{s.name}</span> <b>{s.count}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Live results breakdown — how many of each type × difficulty have
                been generated so far vs requested. Appears while generating and
                after a batch completes. */}
            {(busy || preview.length > 0) && total > 0 && (
              <>
                <div className="mt-3 flex items-center justify-between">
                  <label className="block text-sm font-semibold">Generated by type &amp; difficulty</label>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {Object.values(genCounts).reduce((a, b) => a + b, 0)} / {perSubtopic ? total * (subtopics.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).length || 1) : total} generated
                  </span>
                </div>
                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full min-w-[380px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                        <th className="px-3 py-2 text-left font-semibold">Type</th>
                        {DIFFS.map((d) => (
                          <th key={d} className="px-2 py-2 text-center font-semibold">{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {TYPE_OPTIONS.filter((t) => rowTotal(t.id) > 0).map((t) => (
                        <tr key={t.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                          <td className="px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200">{t.label}</td>
                          {DIFFS.map((d) => {
                            const want = matrix[t.id]?.[d] || 0;
                            const have = Math.min(genCounts[`${t.id}|${d}`] || 0, want || 0);
                            const doneCell = want > 0 && have >= want;
                            return (
                              <td key={d} className="px-2 py-1.5 text-center tabular-nums">
                                {want > 0 ? (
                                  <span className={`font-semibold ${doneCell ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-300"}`}>
                                    {have}/{want}
                                  </span>
                                ) : (
                                  <span className="text-slate-300 dark:text-slate-600">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <p className="mt-1 text-xs text-slate-400">
              Set a count in any cell — e.g. 3 Easy MCQs + 2 Medium Matching. Leave cells at 0 to skip.
              Up to {maxPerBatch} per batch (generated in the background in smaller groups). After a batch, use <b>Generate more</b> to add another set with no repeats.
            </p>

            <label className="mb-1 mt-3 block text-sm font-semibold">Instructions (optional — followed strictly)</label>
            <textarea
              rows={2}
              className="input resize-y"
              placeholder='e.g. "Questions in Hindi", "Focus on numerical problems", "Only NCERT Class 10 syllabus", "Keep language simple"'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              Leave empty to use defaults. Anything you write here is treated as a top-priority instruction the AI must follow for every question.
            </p>

            <label className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={autoContinue} onChange={(e) => setAutoContinue(e.target.checked)} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-brand-600" />
              <span><b>Auto-continue</b> until the full count is generated <b>(on by default)</b>. If the per-minute free-tier limit stops a wave partway (e.g. 35 of 50), it waits for the limit to reset and <b>resumes from where it left off</b> — asking only for the questions still remaining — then <b>stops exactly at {total || "the target"}</b>. No restart from 0, no duplicates, no overshoot. Press <b>Stop</b> to end early, or untick for a single quick batch.</span>
            </label>

            <label className="mt-2 flex items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={keepExtras} onChange={(e) => setKeepExtras(e.target.checked)} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-brand-600" />
              <span><b>Keep all generated</b> — if a wave produces more than the {total || "target"} you asked for, keep them all instead of trimming to the exact count. Leave unticked to keep exactly {total || "the target"} (extras are dropped).</span>
            </label>

            <label className="mt-2 flex items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={numerical} onChange={(e) => setNumerical(e.target.checked)} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-brand-600" />
              <span><b>Make all questions numerical</b> — when ticked, EVERY generated question is calculation-based (solved with a formula/arithmetic, numeric options). Off by default — leave unticked to keep questions conceptual/factual only.</span>
            </label>

            <label className="mt-2 flex items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={perSubtopic} onChange={(e) => setPerSubtopic(e.target.checked)} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-brand-600" />
              <span>
                <b>Generate this many per subtopic</b> — the counts above are produced for EACH subtopic in “Subtopics to cover” (looped one at a time). Off by default (the counts are the total for the whole batch).
                {perSubtopic && (() => {
                  const n = subtopics.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).length;
                  return (
                    <span className="mt-1 block font-semibold text-brand-600 dark:text-brand-300">
                      {n ? `${total} × ${n} subtopic(s) = ${total * n} question(s) total` : "Add subtopics in “Subtopics to cover” above first."}
                    </span>
                  );
                })()}
              </span>
            </label>

            <button
              type="button"
              onClick={() => (perSubtopic ? generatePerSubtopic() : generate(false))}
              disabled={busy || !!perSubRun}
              className="btn-primary mt-2 w-full"
            >
              {(busy || perSubRun) ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Wand2 className="h-4 w-4" /> {perSubtopic ? "Generate per subtopic" : "Generate"}</>}
            </button>

            {(busy || perSubRun) && (
              <button
                type="button"
                onClick={stop}
                disabled={stopping}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-900/20"
                title="Stop generating — keeps the questions already produced so you can insert them"
              >
                {stopping ? <><Loader2 className="h-4 w-4 animate-spin" /> Stopping…</> : <><Square className="h-4 w-4" /> Stop generating</>}
              </button>
            )}

            {preview.length > 0 && (
              <button
                type="button"
                onClick={() => generate(true)}
                disabled={busy}
                className="btn-outline mt-2 w-full"
                title="Generate another batch on the same topic — the AI avoids every question already generated above"
              >
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating more…</> : <><Sparkles className="h-4 w-4" /> Generate more from this topic (no duplicates)</>}
              </button>
            )}

            {(existingQuestions.length > 0 || coverageQuestions.length > 0) && (
              <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-xs font-semibold">Make other question types from your existing questions</p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Set the counts for the types you want in the grid above (Assertion, Statements, Matching, Pair, Pair-select…), then choose:
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => generateFromExisting(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50">
                    <Wand2 className="h-3.5 w-3.5" /> Convert existing → these types
                  </button>
                  <button type="button" disabled={busy} onClick={() => generateFromExisting(false)} className="btn-outline text-xs">
                    <Sparkles className="h-3.5 w-3.5" /> Generate new of these types (from existing)
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  <b>Convert</b> = recast the same facts into the new formats. <b>Generate new</b> = fresh questions on the same content, avoiding duplicates. Both appear in the preview below to review &amp; insert (your original MCQs are untouched).
                </p>
              </div>
            )}

            {preview.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> {preview.length} question(s) ready to insert
                </p>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                  {preview.map((q, i) => (
                    <div key={i} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-brand-100 px-1.5 py-0.5 font-semibold uppercase text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{q.type}</span>
                        <span className="text-slate-400">{q.difficulty}</span>
                        <span className="ml-auto font-semibold text-emerald-600 dark:text-emerald-400">Ans: {LETTERS[q.correct] || "?"}</span>
                      </div>
                      <p className="mt-1 font-medium text-slate-700 dark:text-slate-200">{i + 1}. {q.text}</p>
                      <GraphView q={q} />
                      <VizView q={q} />
                      <ul className="mt-1 grid grid-cols-2 gap-x-3 text-slate-500 dark:text-slate-400">
                        {(q.options || []).map((o, j) => (
                          <li key={j} className={j === q.correct ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""}>
                            {LETTERS[j]}. {o}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Covered vs still-uncovered subtopics, refreshed after each batch. */}
            {(coverage || coverageLoading) && (
              <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <ListChecks className="h-4 w-4 text-brand-600" /> Syllabus coverage so far
                  {coverageLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                </p>
                {coverage && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Covered ({coverage.covered.length})</p>
                        {coverage.covered.length ? (
                          <ul className="max-h-44 space-y-1 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">
                            {coverage.covered.map((c, i) => (
                              <li key={i} className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />{c}</li>
                            ))}
                          </ul>
                        ) : <p className="text-xs text-slate-400">—</p>}
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Not yet covered ({coverage.missing.length})</p>
                        {coverage.missing.length ? (
                          <ul className="max-h-44 space-y-1 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">
                            {coverage.missing.map((c, i) => (
                              <li key={i} className="flex gap-1.5"><Circle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />{c}</li>
                            ))}
                          </ul>
                        ) : <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">All covered 🎉</p>}
                      </div>
                    </div>
                    {coverage.missing.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => generateSubtopic(coverage.missing.join(", "))} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50">
                          <Sparkles className="h-3.5 w-3.5" /> Generate the uncovered topics now
                        </button>
                        <button type="button" onClick={() => setSubtopics(coverage.missing.join(", "))} className="btn-outline text-xs">
                          <Sparkles className="h-3.5 w-3.5" /> Put uncovered ones in Subtopics
                        </button>
                        <button type="button" onClick={() => addToPlan(coverage.missing)} className="btn-outline text-xs">
                          <Bookmark className="h-3.5 w-3.5" /> Save uncovered to my plan
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Where to save this batch: the current quiz/test, or a brand-new one. */}
            {allowNewTarget && preview.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="mb-2 text-sm font-semibold">Where should these {preview.length} question(s) go?</p>
                {currentTargetName && (
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="aidest" checked={destChoice === "current"} onChange={() => setDestChoice("current")} />
                    <span>Current {newLeafLabel} — <b>{currentTargetName}</b></span>
                  </label>
                )}
                {existingItems.length > 0 && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="aidest" checked={destChoice === "existing"} onChange={() => setDestChoice("existing")} />
                    <span className="flex-shrink-0">Existing {newLeafLabel}:</span>
                    <select
                      value={existingId}
                      onFocus={() => setDestChoice("existing")}
                      onChange={(e) => { setExistingId(e.target.value); setDestChoice("existing"); }}
                      className="input !py-1"
                    >
                      <option value="">Choose a {newLeafLabel}…</option>
                      {existingItems.map((it) => <option key={it._id} value={it._id}>{it.name}{it.questionCount != null ? ` (${it.questionCount})` : ""}</option>)}
                    </select>
                  </label>
                )}
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="aidest" checked={destChoice === "new"} onChange={() => setDestChoice("new")} />
                  <span className="flex-shrink-0">New {newLeafLabel}:</span>
                  <input
                    type="text"
                    value={newName}
                    onFocus={() => setDestChoice("new")}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={`New ${newLeafLabel} name`}
                    className="input !py-1"
                  />
                </label>
                <p className="mt-1 text-xs text-slate-400">
                  Choose <b>New {newLeafLabel}</b> to auto-create it (under the same parent) and put this batch there — then click <b>Generate</b> again for the next batch.
                </p>
              </div>
            )}
          </>
        )}

        {msg && <p className="mt-3 text-sm font-medium">{msg}</p>}

        {/* Live per-key activity for this run — see every key working in real time. */}
        {keyStats && Object.keys(keyStats).length > 0 && (
          <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Keys working this run ({Object.keys(keyStats).length}) · {Object.values(keyStats).reduce((a, s) => a + (s.requests || 0), 0)} requests · {Object.values(keyStats).reduce((a, s) => a + (s.questions || 0), 0)} questions
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {Object.entries(keyStats).sort((a, b) => (b[1].requests || 0) - (a[1].requests || 0)).map(([label, s]) => (
                <div key={label} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">{label}</span>
                  <span className="flex flex-shrink-0 items-center gap-2 whitespace-nowrap">
                    <span className="text-slate-500 dark:text-slate-400">{s.requests || 0} req</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{s.questions || 0} Q</span>
                    {s.limited > 0 && <span className="text-amber-600 dark:text-amber-400">{s.limited} limited</span>}
                    {s.error > 0 && <span className="text-rose-600 dark:text-rose-400">{s.error} err</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-outline">Close</button>
          {status?.enabled && preview.length > 0 && (
            <button type="button" onClick={insert} disabled={inserting} className="btn-primary">
              {inserting ? <><Loader2 className="h-4 w-4 animate-spin" /> Inserting…</> : `Insert ${preview.length} Question(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
