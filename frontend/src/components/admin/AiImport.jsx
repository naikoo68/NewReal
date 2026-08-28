import { useEffect, useRef, useState } from "react";
import { X, Globe, Download, CheckCircle2, AlertTriangle, Loader2, Server, KeyRound, FileText, Upload, Files, ScanText, Maximize2, Minimize2, Plus, Sparkles, ListChecks, Circle, Trash2 } from "lucide-react";
import { aiService, documentService } from "../../services";
import { useAuth } from "../../context/AuthContext";
import GraphView from "../ui/GraphView";

const LETTERS = ["A", "B", "C", "D"];
const BATCH = 50; // group the extracted questions into batches of this size for insertion
// Max questions per "Generate from source" run (generated in chunks; large
// batches just take longer). Matches the AI Generator.
const MAX_TOTAL = 500;

// Question types the "Generate from source" mode can produce.
const Q_TYPES = [
  { id: "mcq", label: "MCQ" },
  { id: "numericalmcq", label: "Numerical MCQ" },
  { id: "matching", label: "Matching" },
  { id: "statement", label: "Statements" },
  { id: "pair", label: "Pairs" },
  { id: "pairselect", label: "Pair select" },
  { id: "assertion", label: "Assertion & Reason" },
  { id: "table", label: "Table" },
  { id: "journal", label: "Journal Entry" },
  { id: "ledger", label: "Ledger Posting" },
  { id: "rearrange", label: "Sentence Rearrangement" },
];
const DIFFS = ["Easy", "Medium", "Hard"];

// Import questions from a saved document, a PDF (text or OCR), a web page, or
// pasted text. The AI extracts the questions present (it doesn't invent them);
// review, then insert — all at once or batch by batch.
export default function AiImport({ open, onClose, onUpload, title = "Import Questions (PDF, Web or Text)", sections = [], documents = false, defaultSection = "", allowNewTarget = false, newLeafLabel = "quiz", currentTargetName = "", existingItems = [] }) {
  const { user } = useAuth();
  const isClient = user?.role === "client" && user?.aiAccess;
  const canChooseSource = isClient && user?.aiAllowInbuilt !== false && user?.aiAllowSelf !== false;
  const [source, setSource] = useState(user?.aiMode === "self" ? "self" : "inbuilt"); // "inbuilt" | "self"
  const [task, setTask] = useState("extract"); // "extract" (pull existing) | "generate" (make new from source)
  // generate: type × difficulty count matrix (same as the AI Generator).
  // matrix[typeId] = { Easy, Medium, Hard }. Default: 5 medium MCQs.
  const [matrix, setMatrix] = useState({ mcq: { Easy: 0, Medium: 5, Hard: 0 } });
  const [notes, setNotes] = useState(""); // optional strong instructions (both tabs)
  // Stems already generated this session — sent so a "Generate more" batch never
  // repeats earlier questions (Generate-new mode, mirrors the AI Generator).
  const [avoidStems, setAvoidStems] = useState([]);
  // Optional topic/syllabus name for the "Generate from source" tab — enables
  // the covered / not-covered analysis (areas covered) after each batch.
  const [genTopic, setGenTopic] = useState("");
  const [coverage, setCoverage] = useState(null); // { covered:[], missing:[] }
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [syllabus, setSyllabus] = useState(null); // FIXED checklist so totals stay stable across batches
  const [destChoice, setDestChoice] = useState("current"); // "current" | "existing" | "new" — where a batch is inserted
  const [newName, setNewName] = useState("");
  const [existingId, setExistingId] = useState(""); // chosen existing quiz/test id when destChoice === "existing"
  const [status, setStatus] = useState(null);
  const [model, setModel] = useState("");
  const [section, setSection] = useState(defaultSection || sections[0] || "");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [textFull, setTextFull] = useState(false); // full-screen editor for the source text
  const [preview, setPreview] = useState([]);
  const [liveWave, setLiveWave] = useState({}); // in-progress job's per-bucket "have" counts { "type|difficulty": n }
  const [subtopics, setSubtopics] = useState(""); // optional — specific subtopics to spread the questions across
  const [numerical, setNumerical] = useState(false); // opt-in: also include numerical/calculation questions
  const [autoContinue, setAutoContinue] = useState(true); // resume across quota windows until the target is reached
  const [keepExtras, setKeepExtras] = useState(false); // keep everything even if a wave overshoots the requested count
  const [perSubtopic, setPerSubtopic] = useState(false); // run the grid's mix once per subtopic listed
  const [perSubRun, setPerSubRun] = useState(null); // live per-subtopic progress { i, n, name }
  const [perSubList, setPerSubList] = useState([]); // completed subtopics this run: [{ name, count }]
  const [stopping, setStopping] = useState(false); // user asked to stop the current generation
  const stopRef = useRef(false); // set when the user clicks Stop — breaks the wave/poll loop
  const jobIdRef = useRef(null); // id of the running background job (so Stop can cancel it)
  const runProducedRef = useRef(0); // how many questions the LAST runGenerate produced (for per-subtopic tally)
  const [detected, setDetected] = useState(0); // how many questions the source appears to contain
  const [busy, setBusy] = useState(false);
  const [busyMore, setBusyMore] = useState(false); // "Extract remaining" pass in progress
  const [inserting, setInserting] = useState(false);
  const [insertingIdx, setInsertingIdx] = useState(-1);
  const [msg, setMsg] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(null);
  const [pdfFile, setPdfFile] = useState(null);
  const [scanned, setScanned] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(null);
  const [docList, setDocList] = useState([]);
  const [docId, setDocId] = useState("");

  useEffect(() => {
    if (!open) return;
    setMsg("");
    setPreview([]);
    setDetected(0);
    setBusyMore(false);
    setDocId("");
    setPdfFile(null);
    setScanned(false);
    setAvoidStems([]);
    setGenTopic("");
    setCoverage(null);
    setCoverageLoading(false);
    setSyllabus(null);
    setDestChoice("current");
    setNewName("");
    setSubtopics("");
    setNumerical(false);
    setAutoContinue(true);
    setKeepExtras(false);
    setPerSubtopic(false);
    setPerSubRun(null);
    setPerSubList([]);
    setStopping(false);
    stopRef.current = false;
    jobIdRef.current = null;
    setSection(defaultSection || sections[0] || ""); // re-sync target subject on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultSection]);

  useEffect(() => {
    if (!open || !documents) return;
    documentService.list().then(setDocList).catch(() => setDocList([]));
  }, [open, documents]);

  useEffect(() => {
    if (!open) return;
    aiService
      .status(isClient ? source : undefined)
      .then((s) => { setStatus(s); setModel(s?.model || (s?.models && s.models[0]) || ""); })
      .catch(() => setStatus({ enabled: false }));
  }, [open, source, isClient]);

  if (!open) return null;

  // Read an uploaded file. PDFs use pdf.js (with an OCR fallback for scans);
  // Word/PowerPoint/Excel/CSV/text use lib/docs. The extracted text is appended
  // to the source box so you can then Extract or Generate from it.
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const name = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
    const nextLabel = task === "generate" ? "Generate Questions" : "Extract Questions";
    setPdfBusy(true);
    setPdfProgress(null);
    setScanned(false);
    setMsg(`Reading “${file.name}”…`);
    try {
      if (isPdf) {
        setPdfFile(file); // enables the OCR button for scanned PDFs
        const { extractPdfText, looksScanned } = await import("../../lib/pdf");
        let total = 0;
        const extracted = await extractPdfText(file, (page, t) => { total = t; setPdfProgress({ page, total: t }); });
        if (!extracted || looksScanned(extracted)) {
          setScanned(true);
          setMsg(`“${file.name}” looks like a SCANNED PDF — the pages are images, so only ${extracted ? "a header/stamp" : "no text"} could be read. Use “Read scanned PDF with OCR” below.`);
          return;
        }
        const combined = text.trim() ? `${text.trim()}\n\n${extracted}` : extracted;
        setText(combined);
        setMsg(`✓ Read ${total || "?"} page(s) from “${file.name}” — now click “${nextLabel}”.`);
      } else {
        setPdfFile(null); // OCR only applies to PDFs
        const { extractDocText } = await import("../../lib/docs");
        const extracted = (await extractDocText(file)).trim();
        if (!extracted) {
          setMsg(`Couldn't read any text from “${file.name}”. If it's a scanned/image file, save it as PDF and use OCR.`);
          return;
        }
        const combined = text.trim() ? `${text.trim()}\n\n${extracted}` : extracted;
        setText(combined);
        setMsg(`✓ Read “${file.name}” (${extracted.length.toLocaleString()} characters) — now click “${nextLabel}”.`);
      }
    } catch (err) {
      setMsg(`Couldn't read “${file.name}”: ${err.message}`);
    } finally {
      setPdfBusy(false);
    }
  };

  const runOcr = async () => {
    if (!pdfFile) return;
    setOcrBusy(true);
    setOcrProgress(null);
    setMsg(`Running OCR on “${pdfFile.name}”… this can take a while (downloads the OCR engine on first use).`);
    try {
      const { ocrPdfText } = await import("../../lib/pdf");
      let total = 0;
      const ocrText = await ocrPdfText(pdfFile, (page, t) => { total = t; setOcrProgress({ page, total: t }); });
      if (!ocrText) { setMsg("OCR couldn't read any text from this PDF."); return; }
      setText(ocrText);
      setScanned(false);
      setMsg(`✓ OCR read ${total} page(s) — review the text, then click “Extract Questions”. OCR isn't perfect.`);
    } catch (e) {
      setMsg(`OCR failed: ${e.message}`);
    } finally {
      setOcrBusy(false);
    }
  };

  const pickDoc = async (id) => {
    setDocId(id);
    if (!id) return;
    setMsg("Loading document…");
    try {
      const doc = await documentService.get(id);
      // Documents saved from the Word editor are HTML — strip tags to plain text
      // (block tags → line breaks, list items → bullets) before extracting.
      const raw = String(doc?.content || "");
      let body = raw;
      if (/<\/?[a-z][\s\S]*>/i.test(raw)) {
        const prepped = raw
          .replace(/<\s*br\s*\/?>/gi, "\n")
          .replace(/<li[^>]*>/gi, "\u2022 ")
          .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n");
        const el = document.createElement("div");
        el.innerHTML = prepped;
        body = (el.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
      } else {
        body = raw.trim();
      }
      if (!body) { setMsg("That document has no text to use."); return; }
      const combined = text.trim() ? `${text.trim()}\n\n${body}` : body;
      setText(combined);
      setMsg(`✓ Loaded “${doc.title}” — now click “Extract Questions”.`);
    } catch (e) {
      setMsg(e.message || "Couldn't load that document.");
    }
  };

  // De-dup key for merging a second ("Extract remaining") pass. Mirrors the
  // backend's content signature EXACTLY (normalised stem + sorted options +
  // sorted columns). We deliberately do NOT key on the source number: papers can
  // restart numbering per section, and a question can come back with/without a
  // number between passes — both let duplicates through and inflated a re-run
  // (e.g. 80 + re-added copies → 140). The signature is identical across passes.
  const dedupKey = (q) => {
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const stem = norm(q?.text).slice(0, 200);
    const opts = (Array.isArray(q?.options) ? q.options : []).map(norm).filter(Boolean).sort().join("|");
    const cols = [...(q?.columnA || []), ...(q?.columnB || [])].map(norm).filter(Boolean).sort().join("|");
    return `${stem}##${opts}##${cols}`;
  };

  // Run extraction. `append` = a "get the missed ones" pass: we send the
  // questions we already have so the AI skips them and returns ONLY the missing
  // ones, which are then merged into the preview (no duplicates).
  const runExtract = async (append = false) => {
    if (!url.trim() && !text.trim()) {
      setMsg("Add a PDF / document / URL, or paste the questions text.");
      return;
    }
    if (append) setBusyMore(true);
    else { setBusy(true); setPreview([]); setDetected(0); }
    setMsg(append ? "Looking for the questions that were missed…" : "Reading the source and extracting questions…");
    try {
      const { jobId, questionsDetected } = await aiService.extract({
        url: url.trim() || undefined,
        content: text.trim() || undefined,
        model: model || undefined,
        mode: isClient ? source : undefined,
        have: append ? preview : undefined,
        notes: notes.trim() || undefined,
      });
      if (!jobId) throw new Error("Could not start the import.");
      if (questionsDetected) setDetected(questionsDetected);
      if (questionsDetected && !append) setMsg(`Found ~${questionsDetected} question(s) — extracting…`);

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let done = false;
      for (let i = 0; i < 240 && !done; i++) {
        await sleep(2000);
        let s;
        try { s = await aiService.job(jobId); } catch { continue; }
        if (s.status === "done") {
          const qs = s.questions || [];
          if (append) {
            // Merge the newly-found (previously missed) questions, skipping dupes.
            const have = new Set(preview.map(dedupKey));
            const added = qs.filter((q) => !have.has(dedupKey(q)));
            const merged = [...preview, ...added];
            setPreview(merged);
            setMsg(
              added.length
                ? `✓ Found ${added.length} more question(s) — now ${merged.length}${questionsDetected ? ` of ~${questionsDetected}` : ""}. Review, then insert.`
                : "No additional questions found — the rest may not be in the source (try OCR or paste the missing part)."
            );
          } else {
            setPreview(qs);
            const shortNote =
              s.error === "quota" ? " (stopped early — quota reached; insert these, then click “Extract remaining”)"
              : s.error === "partial" ? " (a few couldn’t be read this pass — insert these, then click “Extract remaining”)"
              : "";
            setMsg(
              qs.length
                ? `✓ Extracted ${qs.length}${questionsDetected ? ` of ~${questionsDetected} detected` : ""} question(s)${shortNote}. Review below, then insert.`
                : "No questions found — try pasting the text, or use OCR for scanned PDFs."
            );
          }
          done = true;
        } else if (s.status === "error") {
          setMsg(s.error || "Import failed.");
          done = true;
        } else {
          setMsg(`Extracting… ${s.count || 0} question(s) so far (section ${s.chunksDone || 0}/${s.chunksTotal || "?"})`);
        }
      }
      if (!done) setMsg("Still working — the source is large. Try importing fewer questions at a time.");
    } catch (e) {
      setMsg(e.message || "Import failed.");
    } finally {
      if (append) setBusyMore(false);
      else setBusy(false);
    }
  };

  // Effective per-batch cap for THIS account (admin global limit or client plan).
  const maxPerBatch = status?.maxPerBatch || MAX_TOTAL;

  // ---- Generate: type × difficulty matrix (mirrors the AI Generator) ----
  const setCell = (type, diff, val) => {
    const n = Math.max(0, Math.min(maxPerBatch, parseInt(val, 10) || 0));
    setMatrix((m) => ({ ...m, [type]: { ...(m[type] || {}), [diff]: n } }));
  };
  const rowTotal = (type) => DIFFS.reduce((s, d) => s + (matrix[type]?.[d] || 0), 0);
  // Flatten the matrix into [{ type, difficulty, count }] entries with count>0.
  const buildPlan = () =>
    Q_TYPES.flatMap((t) =>
      DIFFS.map((d) => ({ type: t.id, difficulty: d, count: matrix[t.id]?.[d] || 0 })).filter((e) => e.count > 0)
    );
  const genTotal = Q_TYPES.reduce((s, t) => s + rowTotal(t.id), 0);

  // Live breakdown: how many questions of each type × difficulty have been
  // generated so far (from the accumulated preview), for the results grid below.
  const genCounts = {};
  for (const q of preview) {
    const k = `${q?.type || "mcq"}|${q?.difficulty || ""}`;
    genCounts[k] = (genCounts[k] || 0) + 1;
  }
  // Include the in-progress job's live per-bucket counts so the grid updates
  // WHILE generating (not only after the batch finishes and lands in preview).
  for (const k in liveWave) genCounts[k] = (genCounts[k] || 0) + (liveWave[k] || 0);

  // After a batch, summarise which areas of the SOURCE (the PDF / link / pasted
  // text) are now covered vs still missing. The checklist is built from the
  // source's own content, so no topic is required — but a typed Topic name is
  // used when there's no pasted text (e.g. a link-only run). Best-effort.
  const refreshCoverage = async (stems) => {
    const list = (stems || []).filter(Boolean);
    const srcText = text.trim();
    const t = genTopic.trim();
    // Need questions to classify, and SOMETHING to build the checklist from
    // (the source text, or a typed topic).
    if (!list.length || (!srcText && !t)) { setCoverage(null); return; }
    setCoverageLoading(true);
    try {
      const r = await aiService.coverageGaps({
        source: srcText || undefined, // build the checklist from the PDF/paste content
        topic: t || undefined,        // fallback when there's no pasted text
        questions: list.slice(0, 300),
        syllabus: syllabus || undefined,
        mode: isClient ? source : undefined,
      });
      if (!syllabus && Array.isArray(r?.syllabus) && r.syllabus.length) setSyllabus(r.syllabus);
      setCoverage({ covered: r?.covered || [], missing: r?.missing || [] });
    } catch {
      /* coverage is a nice-to-have — ignore failures */
    } finally {
      setCoverageLoading(false);
    }
  };

  // GENERATE mode: make NEW questions FROM the link/paragraph, using the exact
  // per-type × per-difficulty counts. Uses the same background job + polling.
  // `append` = "Generate more": keep the current preview and add a fresh batch
  // from the same source, avoiding everything already generated (via avoidStems).
  // `append` = "Generate more": keep the current preview and add a fresh batch.
  // `overrideSubtopics` (per-subtopic mode) focuses this run on ONE subtopic.
  const runGenerate = async (append = false, overrideSubtopics = null) => {
    if (!url.trim() && !text.trim()) {
      setMsg("Add a link or paste a paragraph to generate questions from.");
      return;
    }
    const plan = buildPlan();
    if (!plan.length) { setMsg("Set at least one question count in the grid below."); return; }
    if (genTotal > maxPerBatch) { setMsg(`Please keep the total to ${maxPerBatch} questions or fewer per run.`); return; }
    const target = genTotal;
    setBusy(true);
    setStopping(false);
    stopRef.current = false;
    jobIdRef.current = null;
    setLiveWave({});
    if (!append) { setPreview([]); setDetected(0); }

    // Per-type|difficulty tally across waves so each wave requests only the
    // REMAINING buckets (keeps the grid's distribution instead of regenerating
    // the whole plan every wave).
    const producedByBucket = {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Accumulate the avoid-list LOCALLY across waves (React state is async, so
    // relying on avoidStems would let the next wave repeat this wave's questions).
    let avoidLocal = Array.from(new Set([...(avoidStems || [])]));

    // Run ONE wave (start a job + poll to completion), append its questions.
    const runWave = async (isAppend, priorTotal = 0) => {
      const wavePlan = plan
        .map((b) => ({ ...b, count: Math.max(0, b.count - (producedByBucket[`${b.type}|${b.difficulty}`] || 0)) }))
        .filter((b) => b.count > 0);
      if (!wavePlan.length) return { produced: 0, done: true };
      let jobId, requested;
      try {
        ({ jobId, requested } = await aiService.generate({
          source: text.trim() || undefined,
          url: url.trim() || undefined,
          topic: genTopic.trim() || undefined, // optional — enables coverage analysis
          subtopics: (overrideSubtopics != null ? overrideSubtopics : subtopics).trim() || undefined,
          plan: wavePlan,
          notes: notes.trim() || undefined,
          numerical: numerical || undefined,
          model: model || undefined,
          avoid: avoidLocal, // don't repeat anything from earlier waves/batches
          mode: isClient ? source : undefined,
        }));
      } catch (e) { setMsg(e.message || "Generation failed."); return { produced: 0, errored: true }; }
      if (!jobId) { setMsg("Could not start generation."); return { produced: 0, errored: true }; }
      jobIdRef.current = jobId;
      if (requested && !isAppend && priorTotal === 0) setDetected(target);
      let done = false, result = { produced: 0, timedOut: true };
      for (let i = 0; i < 300 && !done; i++) {
        await sleep(2000);
        let s;
        try { s = await aiService.job(jobId); } catch { continue; }
        // Live per-type × per-difficulty progress WHILE the batch generates.
        if (Array.isArray(s.byBucket)) {
          const m = {};
          for (const b of s.byBucket) m[`${b.type}|${b.difficulty}`] = b.have;
          setLiveWave(m);
        }
        if (s.status === "done") {
          const qsAll = s.questions || [];
          // Trim to the remaining need so the total lands on the target exactly,
          // unless "Keep all generated" is on.
          const room = target > 0 ? Math.max(0, target - priorTotal) : qsAll.length;
          const qs = keepExtras ? qsAll : qsAll.slice(0, room);
          setPreview((prev) => (isAppend ? [...prev, ...qs] : qs));
          for (const q of qs) {
            const k = `${q?.type || "mcq"}|${q?.difficulty || "Medium"}`;
            producedByBucket[k] = (producedByBucket[k] || 0) + 1;
          }
          setLiveWave({}); // now counted via preview
          const batchStems = qs.map((q) => q.text).filter(Boolean);
          avoidLocal = Array.from(new Set([...avoidLocal, ...batchStems]));
          setAvoidStems(avoidLocal);
          refreshCoverage(avoidLocal);
          result = { produced: qs.length, requested, short: qs.length < requested, quota: s.error === "quota", cancelled: s.error === "cancelled" || stopRef.current };
          done = true;
        } else if (s.status === "error") {
          setMsg(s.error || "Generation failed."); result = { produced: 0, errored: true }; done = true;
        } else {
          const soFar = priorTotal + (s.count || 0);
          setMsg(stopRef.current ? `Stopping… keeping the ${soFar} generated so far` : `Generating… ${soFar} of ${target} ready (${Math.max(0, target - soFar)} to go)`);
        }
      }
      if (!done) setMsg("Still generating — this is taking longer than expected. Try a smaller batch.");
      return result;
    };

    const finalize = (res, producedTotal) => {
      if ((res?.errored || res?.timedOut) && producedTotal === 0) return;
      if (stopRef.current || res?.cancelled) { setMsg(`⏹ Stopped. Kept ${producedTotal} question(s) so far — review & Insert below, or Generate more.`); return; }
      const short = producedTotal < target;
      if (append && !autoContinue) {
        setMsg(`✓ Added ${producedTotal} more question(s).` + (short ? " (Some couldn't be generated — click “Generate more” to top up.)" : " No duplicates of the earlier questions. Review & Insert."));
        return;
      }
      if (res?.errored || res?.timedOut) {
        setMsg(`✓ Generated ${producedTotal} of ${target} question(s). The AI stopped before finishing — Insert these now, then use “Generate more” to top up.`);
        return;
      }
      let tail;
      if (!short) tail = " Review below, then Insert.";
      else if (res?.quota) tail = autoContinue ? " The free-tier quota kept limiting it — Insert these, then Generate more later for the rest." : " Stopped early — quota reached. Insert these, then generate the rest in a minute.";
      else tail = " (Some couldn't be generated — click “Generate more” to top up.)";
      setMsg(`✓ Generated ${producedTotal} of ${target} question(s).` + tail);
    };

    try {
      const autoLoop = autoContinue && !append; // manual "Generate more" stays a single wave
      const MAX_WAVES = 60, MAX_ZERO = 8, MIN_YIELD = 2, MAX_LOW = 4;
      setMsg(append ? `Generating ${target} more from your source (no duplicates)…` : `Starting generation of ${target} question(s)…`);
      let producedTotal = 0, firstWave = true, wave = 0, zeroWaves = 0, lowWaves = 0, last;
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        last = await runWave(firstWave ? append : true, producedTotal);
        producedTotal += last.produced || 0;
        firstWave = false;
        wave += 1;
        zeroWaves = (last.produced || 0) === 0 ? zeroWaves + 1 : 0;
        lowWaves = (last.produced || 0) < MIN_YIELD ? lowWaves + 1 : 0;
        const reached = producedTotal >= target;
        const dead = zeroWaves >= MAX_ZERO;
        const stalled = lowWaves >= MAX_LOW;
        const canContinue = autoLoop && !stopRef.current && !reached && !last.errored && !last.timedOut && !dead && !stalled && wave < MAX_WAVES;
        if (!canContinue) {
          if (autoLoop && !reached && !stopRef.current && !last.errored && !last.timedOut && (dead || stalled || wave >= MAX_WAVES)) {
            setMsg(`⏸ Auto-continue stopped at ${producedTotal} of ${target}. The free-tier quota looks exhausted, or some types couldn't be filled right now — Insert these, then use “Generate more” later.`);
          } else {
            finalize(last, producedTotal);
          }
          break;
        }
        // Interruptible wait for the per-minute limit to refill.
        const waitSec = (last.produced || 0) === 0 ? 60 : 40;
        for (let k = waitSec; k > 0 && !stopRef.current; k--) {
          setMsg(`Auto-continue: ${producedTotal} of ${target} so far${zeroWaves ? ` · ${zeroWaves} empty wave(s)` : ""}. Waiting ${k}s for the free-tier limit to reset… (press Stop to keep what you have)`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(1000);
        }
        if (stopRef.current) { finalize(last, producedTotal); break; }
      }
      runProducedRef.current = producedTotal;
    } catch (e) {
      setMsg(e.message || "Generation failed.");
    } finally {
      setBusy(false);
      setStopping(false);
      stopRef.current = false;
      jobIdRef.current = null;
    }
  };

  // "Per subtopic": run the grid's mix for EACH subtopic in the box, one at a
  // time. The preview accumulates and a live line shows which subtopic is running.
  const generatePerSubtopic = async () => {
    if (!url.trim() && !text.trim()) { setMsg("Add a link or paste a paragraph first."); return; }
    const subs = subtopics.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!subs.length) { setMsg("Add the subtopics in “Subtopics to cover” to generate per subtopic."); return; }
    if (genTotal <= 0) { setMsg("Set at least one question count in the grid below."); return; }
    if (genTotal > maxPerBatch) { setMsg(`Keep the PER-SUBTOPIC total to ${maxPerBatch} or fewer (it runs once per subtopic).`); return; }
    stopRef.current = false;
    setPerSubList([]);
    for (let idx = 0; idx < subs.length; idx++) {
      if (stopRef.current) break;
      setPerSubRun({ i: idx + 1, n: subs.length, name: subs[idx] });
      runProducedRef.current = 0;
      // First subtopic starts a fresh preview; later ones append (no duplicates).
      // eslint-disable-next-line no-await-in-loop
      await runGenerate(idx > 0, subs[idx]);
      setPerSubList((prev) => [...prev, { name: subs[idx], count: runProducedRef.current || 0 }]);
    }
    setPerSubRun(null);
  };

  // Stop a running generation — keep whatever was produced so far.
  const stop = () => {
    stopRef.current = true;
    setStopping(true);
    if (jobIdRef.current) aiService.cancelJob(jobIdRef.current).catch(() => {});
  };

  // Build the onUpload options. When "New {leaf}" is chosen we send newTarget so
  // the parent auto-creates it; after the first insert we flip back to "current"
  // so the remaining batches go into that just-created quiz/test.
  const makingNew = allowNewTarget && destChoice === "new";
  const usingExisting = allowNewTarget && destChoice === "existing";
  const existingName = existingItems.find((it) => it._id === existingId)?.name || "";
  const buildOpts = () => {
    if (makingNew) return { section, newTarget: { name: newName.trim() } };
    if (usingExisting) return { section, existingTargetId: existingId };
    return { section };
  };
  const destSuffix = () => (makingNew ? ` into new ${newLeafLabel} “${newName.trim()}”` : usingExisting ? ` into “${existingName}”` : "");
  const afterNewInsert = () => { if (makingNew) { setDestChoice("current"); setNewName(""); } };

  // Insert one batch of the extracted preview (removes them so they aren't
  // inserted twice), or use "Insert all".
  const insertBatch = async (items, idx) => {
    if (!items.length || insertingIdx !== -1 || inserting) return;
    if (makingNew && !newName.trim()) { setMsg(`Enter a name for the new ${newLeafLabel}.`); return; }
    if (usingExisting && !existingId) { setMsg(`Choose an existing ${newLeafLabel} to add these to.`); return; }
    setInsertingIdx(idx);
    setMsg("");
    try {
      const res = await onUpload(items, buildOpts());
      setPreview((prev) => prev.filter((q) => !items.includes(q)));
      setMsg(`✓ Inserted ${res?.inserted ?? items.length} question(s) from this batch${destSuffix()}.`);
      afterNewInsert();
    } catch (e) {
      setMsg(e.message || "Insert failed.");
    } finally {
      setInsertingIdx(-1);
    }
  };

  const insert = async () => {
    if (!preview.length) return;
    if (makingNew && !newName.trim()) { setMsg(`Enter a name for the new ${newLeafLabel}.`); return; }
    if (usingExisting && !existingId) { setMsg(`Choose an existing ${newLeafLabel} to add these to.`); return; }
    setInserting(true);
    setMsg("");
    try {
      const res = await onUpload(preview, buildOpts());
      setMsg(`✓ Inserted ${res?.inserted ?? preview.length} question(s)${destSuffix()}. Generate/extract the next batch, or click Close when you're done.`);
      setPreview([]);
      afterNewInsert();
      // Stay on this screen (keep the source + settings) so you can immediately
      // do the next batch. The modal never closes by itself after inserting;
      // use the Close button when you're finished.
    } catch (e) {
      setMsg(e.message || "Insert failed.");
    } finally {
      setInserting(false);
    }
  };

  const QuestionCard = ({ q, n }) => (
    <div className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
      <div className="flex items-center gap-2">
        <span className="rounded bg-brand-100 px-1.5 py-0.5 font-semibold uppercase text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{q.type}</span>
        <span className="text-slate-400">{q.difficulty}</span>
        <span className="ml-auto font-semibold text-emerald-600 dark:text-emerald-400">Ans: {LETTERS[q.correct] || "?"}</span>
      </div>
      <p className="mt-1 font-medium text-slate-700 dark:text-slate-200">{n}. {q.text}</p>
      <GraphView q={q} />
      <ul className="mt-1 grid grid-cols-2 gap-x-3 text-slate-500 dark:text-slate-400">
        {(q.options || []).map((o, j) => (
          <li key={j} className={j === q.correct ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""}>{LETTERS[j]}. {o}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4">
      {textFull && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-white p-4 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-lg font-bold"><FileText className="h-5 w-5 text-brand-600" /> Extracted or pasted text</h3>
            <div className="flex items-center gap-2">
              {text.trim() && (
                <button type="button" onClick={() => setText("")} disabled={busy} className="btn-outline !py-1 !text-xs text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" /> Clear text
                </button>
              )}
              <button type="button" onClick={() => setTextFull(false)} className="btn-outline !py-1 !text-xs">
                <Minimize2 className="h-3.5 w-3.5" /> Exit full screen
              </button>
            </div>
          </div>
          <textarea
            className="input min-h-0 flex-1 resize-none font-mono text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste or edit the questions text here…"
          />
          <p className="mt-1 text-xs text-slate-400">{text.trim().length.toLocaleString()} characters</p>
        </div>
      )}
      <div className="min-h-full w-full max-w-none animate-scale-in card m-0 rounded-none p-4 sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Globe className="h-5 w-5 text-brand-600" /> {title}</h3>
          <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        {canChooseSource && (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-semibold">API source for this import</label>
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
              <p className="mt-1">Add <code>AI_API_KEY</code> to the server environment to enable importing.</p>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              {documents ? <><b>Pick a saved document</b>, upload a <b>file</b> (PDF, Word, PPT, Excel, CSV, text), </> : <>Upload a <b>file</b> (PDF, Word, PPT, Excel, CSV, text), </>}
              paste a page link, <b>or</b> paste the questions text, then <b>Extract Questions</b>. Review the results and insert them.
              {typeof status?.keys === "number" && (
                <span className="ml-1 font-semibold text-emerald-600 dark:text-emerald-400"> {status.keys} API key{status.keys === 1 ? "" : "s"} active.</span>
              )}
              {status?.planName && (
                <span className="ml-1 font-semibold text-brand-600 dark:text-brand-300">
                  Plan: {status.planName} · up to {maxPerBatch}/batch{status?.remaining != null ? ` · ${status.remaining} left this window` : ""}.
                </span>
              )}
            </div>

            {/* Choose what to do with the link / paragraph. */}
            <div className="mb-3">
              <div className="inline-flex w-full overflow-hidden rounded-xl border border-slate-200 text-sm font-semibold dark:border-slate-700">
                <button type="button" onClick={() => setTask("extract")} className={`flex flex-1 items-center justify-center gap-2 px-3 py-2 ${task === "extract" ? "bg-brand-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>
                  <ScanText className="h-4 w-4" /> Extract existing
                </button>
                <button type="button" onClick={() => setTask("generate")} className={`flex flex-1 items-center justify-center gap-2 px-3 py-2 ${task === "generate" ? "bg-brand-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>
                  <Sparkles className="h-4 w-4" /> Generate new
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {task === "extract"
                  ? "Pulls the questions already present in the link/paragraph."
                  : "Creates NEW questions from the link/paragraph — you choose how many and which types."}
              </p>
            </div>

            {status?.models && status.models.length > 1 && (
              <div className="mb-3">
                <label className="mb-1 block text-sm font-semibold">AI model</label>
                <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                  {status.models.map((m) => <option key={m} value={m}>{m}</option>)}
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

            {documents && (
              <div className="mb-3">
                <label className="mb-1 flex items-center gap-1 text-sm font-semibold"><Files className="h-4 w-4 text-brand-600" /> Use a saved document</label>
                {docList.length ? (
                  <select className="input" value={docId} onChange={(e) => pickDoc(e.target.value)}>
                    <option value="">— Pick a document —</option>
                    {docList.map((d) => <option key={d._id} value={d._id}>{d.title}{d.pages ? ` (${d.pages}p)` : ""}</option>)}
                  </select>
                ) : (
                  <p className="text-xs text-slate-400">No saved documents yet — add some in Admin → Documents.</p>
                )}
                <div className="my-3 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /> or <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                </div>
              </div>
            )}

            <label className="mb-1 block text-sm font-semibold">Upload a document</label>
            <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 text-sm transition ${pdfBusy ? "border-brand-400 text-brand-600" : "border-slate-300 text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400"}`}>
              <input
                type="file"
                accept=".pdf,.docx,.pptx,.xlsx,.csv,.tsv,.txt,.md,.markdown,.json,.rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv"
                className="hidden"
                onChange={onFile}
                disabled={pdfBusy}
              />
              {pdfBusy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Reading{pdfProgress ? ` — page ${pdfProgress.page}/${pdfProgress.total}` : "…"}</>
              ) : (
                <><Upload className="h-4 w-4" /> Choose a file <span className="text-slate-400">— PDF, Word, PPT, Excel, CSV, text</span></>
              )}
            </label>
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
              <FileText className="h-3.5 w-3.5" /> PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), CSV & text read instantly. Scanned/image PDFs need OCR below.
            </p>

            {pdfFile && (
              <button type="button" onClick={runOcr} disabled={ocrBusy || pdfBusy}
                className={`mt-2 w-full ${scanned ? "btn-primary" : "btn-outline"}`}>
                {ocrBusy
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> OCR… page {ocrProgress?.page || 0}/{ocrProgress?.total || "?"}</>
                  : <><ScanText className="h-4 w-4" /> Read scanned PDF with OCR (slower)</>}
              </button>
            )}

            <div className="my-3 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /> or <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>

            <label className="mb-1 block text-sm font-semibold">Page or YouTube link (optional)</label>
            <input className="input" placeholder="https://example.com/quiz-page  or  https://youtu.be/… (transcript read automatically)" value={url} onChange={(e) => setUrl(e.target.value)} />
            <p className="mt-1 text-xs text-slate-400">Paste a web page or a YouTube video link (must have captions) — its text/transcript is read automatically.</p>

            <div className="mb-1 mt-3 flex items-center justify-between gap-2">
              <label className="block text-sm font-semibold">{task === "generate" ? "Paragraph / source text" : "Extracted or pasted text"}</label>
              <div className="flex items-center gap-2">
                {text.trim() && (
                  <button type="button" onClick={() => setText("")} disabled={busy} className="btn-outline !py-1 !text-xs text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" /> Clear text
                  </button>
                )}
                <button type="button" onClick={() => setTextFull(true)} className="btn-outline !py-1 !text-xs">
                  <Maximize2 className="h-3.5 w-3.5" /> Full screen
                </button>
              </div>
            </div>
            <textarea
              rows={8}
              className="input resize-y font-mono text-xs"
              placeholder={"PDF/document text appears here — or paste questions directly, e.g.\n1. What is the powerhouse of the cell?\nA) Nucleus  B) Mitochondria  C) Ribosome  D) Golgi\nAns: B"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {text.trim() && (
              <p className="mt-1 text-xs text-slate-400">{text.trim().length.toLocaleString()} characters ready.</p>
            )}

            {/* Strong optional instructions — followed exactly for both modes. */}
            <label className="mb-1 mt-3 block text-sm font-semibold">Instructions (optional — followed strictly)</label>
            <textarea
              rows={2}
              className="input resize-y"
              placeholder={task === "generate"
                ? 'e.g. "Only about the French Revolution", "Questions in Hindi", "Focus on dates & numbers", "Keep language simple"'
                : 'e.g. "Only keep General Knowledge questions", "Translate questions to English", "Fix obvious OCR typos"'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              Leave empty to use defaults. Anything you write here is treated as a top-priority instruction the AI must follow.
            </p>

            {task === "generate" && (
              <div className="mt-3">
                {/* Optional name — coverage is auto-built from the PDF/source
                    content, but a typed name helps for link-only runs. */}
                <label className="mb-1 block text-sm font-semibold">Topic / syllabus name <span className="font-normal text-slate-400">(optional — coverage is auto-read from your PDF/source)</span></label>
                <input
                  type="text"
                  value={genTopic}
                  onChange={(e) => setGenTopic(e.target.value)}
                  placeholder='Optional label for this source (e.g. "Chapter 3 — Macroeconomics")'
                  className="input mb-3"
                />

                {/* How many of each type × difficulty. Total = sum of all cells. */}
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-semibold">Questions by type &amp; difficulty</label>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${genTotal > maxPerBatch ? "bg-rose-100 text-rose-600 dark:bg-rose-900/30" : "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"}`}>
                    Total: {genTotal}
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
                <div className={`mt-2 flex items-center justify-between rounded-xl border px-4 py-2.5 ${genTotal > maxPerBatch ? "border-rose-300 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-900/20" : "border-brand-200 bg-brand-50 dark:border-brand-900/40 dark:bg-brand-900/20"}`}>
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Total questions</span>
                  <span className={`text-lg font-extrabold tabular-nums ${genTotal > maxPerBatch ? "text-rose-600 dark:text-rose-400" : "text-brand-600 dark:text-brand-300"}`}>
                    {genTotal} <span className="text-xs font-medium text-slate-400">/ {maxPerBatch}</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Set a count in any cell — e.g. 3 Easy MCQs + 2 Medium Matching. Leave cells at 0 to skip. Up to {maxPerBatch} per run.
                </p>
              </div>
            )}

            {/* Optional subtopics + generation controls (source generator parity). */}
            {task === "generate" && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-sm font-semibold">
                    Subtopics to cover <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <textarea
                    className="input mt-1 h-20"
                    placeholder="List the exact subtopics to spread the questions across, one per line or comma-separated. Leave empty to let the AI work them out from the source."
                    value={subtopics}
                    onChange={(e) => setSubtopics(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    The questions are spread across these subtopics, drawing the facts from your source material above.
                  </p>
                </div>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={numerical} onChange={(e) => setNumerical(e.target.checked)} />
                  <span>
                    <span className="font-semibold">Include numerical questions</span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      Also generate calculation/quantitative questions (off by default — most sources are conceptual).
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={autoContinue} onChange={(e) => setAutoContinue(e.target.checked)} />
                  <span>
                    <span className="font-semibold">Auto-continue until the target is reached</span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      Keep generating across free-tier limits (waiting out quota pauses) until the full count is made. Press Stop anytime.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={keepExtras} onChange={(e) => setKeepExtras(e.target.checked)} />
                  <span>
                    <span className="font-semibold">Keep all generated</span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      Keep every question even if a wave produces more than the requested count (don't trim to the exact total).
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={perSubtopic} onChange={(e) => setPerSubtopic(e.target.checked)} />
                  <span>
                    <span className="font-semibold">Generate per subtopic</span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      Run the grid's mix once FOR EACH subtopic listed above (instead of one combined batch). Needs subtopics filled in.
                    </span>
                  </span>
                </label>
                {(perSubRun || perSubList.length > 0) && (
                  <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-2.5 text-xs dark:border-brand-800 dark:bg-brand-900/20">
                    {perSubRun && (
                      <p className="flex items-center gap-1.5 font-semibold text-brand-700 dark:text-brand-300">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Subtopic {perSubRun.i} of {perSubRun.n}: {perSubRun.name}
                      </p>
                    )}
                    {perSubList.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-300">
                        {perSubList.map((p, i) => (
                          <li key={i} className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> {p.name}: {p.count} question(s)</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Live results breakdown — how many of each type × difficulty have
                been generated so far vs requested. Appears while generating and
                after each batch, mirroring the topic generator. */}
            {task === "generate" && (busy || preview.length > 0) && genTotal > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-semibold">Generated by type &amp; difficulty</label>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {Object.values(genCounts).reduce((a, b) => a + b, 0)} / {genTotal} generated
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
                      {Q_TYPES.filter((t) => rowTotal(t.id) > 0).map((t) => (
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
              </div>
            )}

            <button type="button" onClick={() => (task === "generate" ? (perSubtopic ? generatePerSubtopic() : runGenerate(false)) : runExtract(false))} disabled={busy || busyMore} className="btn-primary mt-4 w-full">
              {busy
                ? <><Loader2 className="h-4 w-4 animate-spin" /> {task === "generate" ? "Generating…" : "Extracting…"}</>
                : task === "generate"
                  ? <><Sparkles className="h-4 w-4" /> {perSubtopic ? "Generate per subtopic" : "Generate Questions"}</>
                  : <><Download className="h-4 w-4" /> Extract Questions</>}
            </button>
            {busy && task === "generate" && (
              <button type="button" onClick={stop} disabled={stopping} className="btn-outline mt-2 w-full">
                {stopping ? "Stopping…" : "Stop (keep what's generated so far)"}
              </button>
            )}

            {/* Generate-new mode: add another batch from the same source, with no
                repeats of what's already in the preview (mirrors the AI Generator). */}
            {task === "generate" && preview.length > 0 && (
              <button
                type="button"
                onClick={() => runGenerate(true)}
                disabled={busy || busyMore}
                className="btn-outline mt-2 w-full"
                title="Generate another batch from the same source — the AI avoids every question already generated above"
              >
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating more…</> : <><Sparkles className="h-4 w-4" /> Generate more from this source (no duplicates)</>}
              </button>
            )}

            {/* Covered vs still-uncovered areas of the topic (only when a Topic
                name is set on the Generate tab), refreshed after each batch. */}
            {task === "generate" && (coverage || coverageLoading) && (
              <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <ListChecks className="h-4 w-4 text-brand-600" /> Areas covered so far
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
                      <button type="button" onClick={() => setNotes((n) => `${n ? n + " " : ""}Focus on these uncovered areas: ${coverage.missing.join(", ")}.`)} className="btn-outline mt-3 text-xs">
                        <Sparkles className="h-3.5 w-3.5" /> Add uncovered areas to instructions → generate them next
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Where to save this batch: the current quiz/test, or a brand-new one. */}
            {allowNewTarget && preview.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="mb-2 text-sm font-semibold">Where should these {preview.length} question(s) go?</p>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="importdest" checked={destChoice === "current"} onChange={() => setDestChoice("current")} />
                  <span>Current {newLeafLabel}{currentTargetName ? <> — <b>{currentTargetName}</b></> : <span className="text-slate-400"> (the one selected)</span>}</span>
                </label>
                {existingItems.length > 0 && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="importdest" checked={destChoice === "existing"} onChange={() => setDestChoice("existing")} />
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
                  <input type="radio" name="importdest" checked={destChoice === "new"} onChange={() => setDestChoice("new")} />
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
                  Choose <b>New {newLeafLabel}</b> to auto-create it (under the same parent) and put this batch there — then generate/extract the next batch for the current one.
                </p>
              </div>
            )}

            {preview.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> {preview.length}{detected ? ` of ~${detected}` : ""} question(s) ready — insert each batch below, or all at once.
                  </p>
                  {task === "extract" && (url.trim() || text.trim()) && (
                    <button type="button" onClick={() => runExtract(true)} disabled={busy || busyMore || inserting || insertingIdx !== -1}
                      className="btn-outline !py-1 !text-xs"
                      title="Re-scan the same source and add only the questions that were missed (no duplicates)">
                      {busyMore
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding missed…</>
                        : <><Plus className="h-3.5 w-3.5" /> {detected && detected > preview.length ? `Extract remaining ${detected - preview.length}` : "Extract missed questions"}</>}
                    </button>
                  )}
                </div>
                {Array.from({ length: Math.ceil(preview.length / BATCH) }).map((_, bi) => {
                  const start = bi * BATCH;
                  const items = preview.slice(start, start + BATCH);
                  return (
                    <div key={bi} className="rounded-xl border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                        <span className="text-sm font-semibold">Batch {bi + 1} <span className="font-normal text-slate-400">· {items.length} question(s)</span></span>
                        <button type="button" onClick={() => insertBatch(items, bi)} disabled={insertingIdx !== -1 || inserting} className="btn-primary !py-1 !text-xs">
                          {insertingIdx === bi ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Inserting…</> : <>Insert these {items.length}</>}
                        </button>
                      </div>
                      <div className="max-h-56 space-y-2 overflow-y-auto p-2">
                        {items.map((q, j) => <QuestionCard key={j} q={q} n={start + j + 1} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {msg && <p className="mt-3 text-sm font-medium">{msg}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-outline">Close</button>
          {status?.enabled && preview.length > 0 && (
            <button type="button" onClick={insert} disabled={inserting || insertingIdx !== -1} className="btn-primary">
              {inserting ? <><Loader2 className="h-4 w-4 animate-spin" /> Inserting…</> : `Insert all ${preview.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
