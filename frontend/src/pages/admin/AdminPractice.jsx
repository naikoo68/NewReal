import { useEffect, useState, useRef, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2, X, ChevronRight, GraduationCap, FolderOpen, ListChecks, FileStack, HelpCircle, Users, Search, Share2, ClipboardList, ArrowRightLeft, Send, Copy as CopyIcon } from "lucide-react";
import { practiceService, testService, contentService, aiService } from "../../services";
import { loadNav, saveNav } from "../../lib/navState";
import Badge from "../../components/ui/Badge";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";
import QuestionFormModal from "../../components/admin/QuestionFormModal";
import BulkUploadQuestions, { questionsToCsv } from "../../components/admin/BulkUploadQuestions";
import AiGenerate from "../../components/admin/AiGenerate";
import AiImport from "../../components/admin/AiImport";
import DuplicatesModal from "../../components/admin/DuplicatesModal";
import PaperFilesModal from "../../components/admin/PaperFilesModal";
import QuestionView from "../../components/admin/QuestionView";
import QuestionTypeFilter from "../../components/admin/QuestionTypeFilter";
import QuestionStatusFilter, { filterByStatus } from "../../components/admin/QuestionStatusFilter";
import QuestionSubjectFilter, { filterBySubject } from "../../components/admin/QuestionSubjectFilter";
import { questionTypeKey, QUESTION_TYPE_LABELS } from "../../lib/questions";
import AddToTestModal from "../../components/admin/AddToTestModal";
import PickFromBank from "../../components/admin/PickFromBank";
import AutoBuildTest from "../../components/admin/AutoBuildTest";
import ManageTestQuestions from "../../components/admin/ManageTestQuestions";
import SubjectPlanEditor from "../../components/admin/SubjectPlanEditor";
import ShareTestModal from "../../components/admin/ShareTestModal";
import ShareNodeModal from "../../components/admin/ShareNodeModal";
import ShareByEmailModal from "../../components/client/ShareByEmailModal";
import IncomingSharesInbox from "../../components/client/IncomingSharesInbox";
import ExtendExplanationsModal from "../../components/admin/ExtendExplanationsModal";
import ExtendOneQuestionModal from "../../components/admin/ExtendOneQuestionModal";
import RegenerateOneModal from "../../components/admin/RegenerateOneModal";
import RegenerateAllModal from "../../components/admin/RegenerateAllModal";
import ScheduleQuestionModal from "../../components/admin/ScheduleQuestionModal";
import MigrateQuizModal from "../../components/admin/MigrateQuizModal";
import MigrateTopicsModal from "../../components/admin/MigrateTopicsModal";
import MoveQuestionsModal from "../../components/admin/MoveQuestionsModal";
import { Files, ScanSearch, Loader2, Sparkles, Scissors, GitMerge, Maximize2, Minimize2, Save, CheckCircle2 } from "lucide-react";

// Question types offered per subtopic in the "Missing areas" sequential generator.
const GEN_TYPES = [
  { id: "mcq", label: "MCQ" },
  { id: "matching", label: "Matching" },
  { id: "statement", label: "Statement" },
  { id: "pair", label: "Pair" },
  { id: "pairselect", label: "Pair-select" },
  { id: "assertion", label: "Assertion" },
  { id: "table", label: "Table" },
];
const GEN_DIFFS = ["Easy", "Medium", "Hard"]; // difficulty levels per type

// Sum every type×level cell of a subtopic's mix.
const mixTotal = (row) => Object.values(row || {}).reduce((s, dm) => s + Object.values(dm || {}).reduce((a, v) => a + (parseInt(v, 10) || 0), 0), 0);

// Subject names from a practice item's typed plan (for "add to subject" tools).
const sectionsOf = (item) => (item?.subjectPlan || []).map((p) => p.subject).filter(Boolean);
// Normalize a chosen subject: "__unassigned__" means "no subject".
const normSection = (s) => (s && s !== "__unassigned__" ? s : "");

const KINDS = [
  { key: "quiz", label: "My Quiz", icon: ListChecks },
  { key: "test", label: "My Test", icon: FileStack },
  { key: "paper", label: "Previous Papers", icon: Files }, // built like a test (stream → subject → items), played like a quiz
];

// `clientMode` renders this same manager for a self-service CLIENT account:
// the backend scopes everything to that client's own content, so we just hide
// the per-student "Visibility" control (irrelevant — a client is the only
// viewer) and add a "Practice" button so they can take their own quizzes/tests.
// `fixedKind` locks this manager to a single practice kind (e.g. "paper") and
// hides the kind tab-bar — used to render "Previous Papers" as its own
// standalone page (admin sidebar item + client workspace tab) rather than a
// tab inside "My Practice".
export default function AdminPractice({ clientMode = false, fixedKind = "" }) {
  // Remember drill-down position across refreshes (separate keys for the admin
  // panel and the client workspace so they never clash; a fixed-kind page also
  // gets its own key so it never clobbers the main practice position).
  const NAV_KEY =
    (clientMode ? "mpm-client-practice-nav" : "mpm-admin-practice-nav") +
    (fixedKind ? `-${fixedKind}` : "");
  // The drill-down level lives in the URL (?v=subjects|topics|items) so the
  // phone/browser BACK button steps UP one level (Streams > Subject > Topic >
  // Quizzes) instead of leaving the page — each level is its own history entry.
  // (Mirrors the ?tab= pattern used in the client workspace.)
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("v") || "streams"; // streams | subjects | topics | items
  // Update ONLY the `v` param, preserving any others (e.g. the client
  // workspace's ?tab=build, which shares this URL) so we don't kick the client
  // back to another tab.
  const setView = (v, opts) => {
    const next = new URLSearchParams(searchParams);
    if (v && v !== "streams") next.set("v", v); else next.delete("v");
    setSearchParams(next, opts);
  };
  const [kind, setKind] = useState(() => {
    if (fixedKind) return fixedKind;
    // Previous Papers is now its own standalone page, so it's no longer a tab
    // here. Coerce a stale saved "paper" position back to a visible tab.
    const saved = loadNav(NAV_KEY).kind;
    return saved && saved !== "paper" ? saved : "quiz";
  });
  const [stream, setStream] = useState(() => loadNav(NAV_KEY).stream || null);
  const [subject, setSubject] = useState(() => loadNav(NAV_KEY).subject || null);
  const [topic, setTopic] = useState(() => loadNav(NAV_KEY).topic || null);

  // Level model per kind. My Quiz and Previous Papers have a 4th (topic) level;
  // My Test goes straight stream → subject → items. For Previous Papers the
  // levels are relabelled: subject = "Exam", topic = "Year", item = "Paper".
  const hasTopics = kind === "quiz" || kind === "paper";
  const L = kind === "paper"
    ? { subjectPl: "Exams", subjectAdd: "Add Exam", topicPl: "Years", topicAdd: "Add Year", itemPl: "Papers", itemAdd: "Add Paper", openTopics: "Open years", itemsWord: "papers", groupWord: "year" }
    : kind === "quiz"
    ? { subjectPl: "Subjects", subjectAdd: "Add Subject", topicPl: "Topics", topicAdd: "Add Topic", itemPl: "Quizzes", itemAdd: "Add Quiz", openTopics: "Open topics", itemsWord: "quizzes", groupWord: "topic" }
    : { subjectPl: "Subjects", subjectAdd: "Add Subject", topicPl: "Topics", topicAdd: "Add Topic", itemPl: "Tests", itemAdd: "Add Test", openTopics: "Open topics", itemsWord: "tests", groupWord: "subject" };
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // { type, mode, data }
  const [saving, setSaving] = useState(false);
  // Split a My-Quiz item / topic into quizzes of N. { kind:"quiz"|"topic", id, name, count }
  const [splitTarget, setSplitTarget] = useState(null);
  const [splitPer, setSplitPer] = useState(50);
  const [splitting, setSplitting] = useState(false);
  // Merge sibling My-Quiz items INTO one target item (inverse of split).
  const [mergeTarget, setMergeTarget] = useState(null); // the quiz item others merge into
  const [mergeIds, setMergeIds] = useState([]); // selected sibling quiz ids
  const [merging, setMerging] = useState(false);

  // Question management for one item
  const [qItem, setQItem] = useState(null);
  const [tq, setTq] = useState([]);
  const [tqLoading, setTqLoading] = useState(false);
  const [tqModal, setTqModal] = useState(null);
  const [tqSaving, setTqSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [aiTarget, setAiTarget] = useState(null); // {id,name} — after AI creates a new quiz/test, later batches target it
  const [otherTypesTopic, setOtherTypesTopic] = useState(false); // AI opened at TOPIC level to build other question types from ALL its quizzes
  // "Scan missing areas": analyse all quizzes in this topic for uncovered syllabus.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFull, setScanFull] = useState(false); // full-screen the Missing areas modal
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState("");
  const [scanMissing, setScanMissing] = useState([]);
  const [scanTopic, setScanTopic] = useState("");
  const [scanStems, setScanStems] = useState([]);
  const [scanResumed, setScanResumed] = useState(false); // showing a saved plan (not a fresh scan)
  // Per-subtopic sequential generation from the "missing areas" scan.
  const [scanCounts, setScanCounts] = useState({}); // subtopic index -> total question count
  const [scanTypes, setScanTypes] = useState({});   // subtopic index -> { type: { level: count } }
  const [openTypeRows, setOpenTypeRows] = useState(() => new Set()); // which rows show the type editor
  const [globalMix, setGlobalMix] = useState({});   // shared type×level mix set once for ALL subtopics
  const [mixOpen, setMixOpen] = useState(false);
  const [seqRunning, setSeqRunning] = useState(false);
  const [seqProgress, setSeqProgress] = useState({}); // subtopic name -> { status, count }
  const [seqLive, setSeqLive] = useState(null); // real-time view of the CURRENT subtopic's job: { subtopic, count, byBucket:[{type,difficulty,have,want}] }
  const [seqMsg, setSeqMsg] = useState("");
  const seqStopRef = useRef(false);
  const [gapPrefill, setGapPrefill] = useState(null); // {topic, subtopics, avoid} when generating from the scan gaps
  const [topicStems, setTopicStems] = useState([]); // stems of ALL quizzes in this topic → coverage panel scans the whole topic
  const [bankOpen, setBankOpen] = useState(false); // hand-pick questions from the bank
  const [autoOpen, setAutoOpen] = useState(false); // auto-build My Test from My Practice quizzes
  const [dupOpen, setDupOpen] = useState(false);
  const [dupScope, setDupScope] = useState({ params: null, name: "" }); // duplicate-scan target
  const [viewQ, setViewQ] = useState(null);
  const [viewFull, setViewFull] = useState(true); // single-question viewer opens full-screen (toggle to shrink)
  const [addToTestQ, setAddToTestQ] = useState(null); // question being copied into a test
  const [viewAll, setViewAll] = useState(false);
  const [studentView, setStudentView] = useState(true); // View All: defaults to student view (answers hidden)
  const [typeFilter, setTypeFilter] = useState([]); // View All: which question types to show ([] = all)
  const [statusFilter, setStatusFilter] = useState("all"); // View All: updated/not_updated/all
  const [subjectFilter, setSubjectFilter] = useState(""); // View All: which subject/section to show ("" = all)
  const [reopenAfterEdit, setReopenAfterEdit] = useState(null); // question _id to reopen in the preview after editing it there
  const [selQ, setSelQ] = useState(() => new Set()); // ticked questions to move (full-quiz view)
  const [delProgress, setDelProgress] = useState(null); // real-time delete-by-type progress: { total, done }
  const [moveModal, setMoveModal] = useState(null); // { ids } — open the destination picker to move these question ids
  const [shareItem, setShareItem] = useState(null); // public share-link modal target (tests)
  const [shareNode, setShareNode] = useState(null); // public share-link modal target for a stream/subject/topic → { node, level }
  const [shareEmailTarget, setShareEmailTarget] = useState(null); // account-to-account share (stream/subject/topic/item)
  const [migrateItem, setMigrateItem] = useState(null); // per-quiz migrate modal target (My Quiz)
  const [paperFilesItem, setPaperFilesItem] = useState(null); // Previous Papers: paper/answer-key PDF + info modal target
  const [selTopics, setSelTopics] = useState({}); // checkbox selection in the topics view (id -> true)
  const [migrateTopicsOpen, setMigrateTopicsOpen] = useState(false); // bulk-topic migrate modal
  const [sendSelectedOpen, setSendSelectedOpen] = useState(false); // bulk "Send selected" to another account
  const [delSelBusy, setDelSelBusy] = useState(null); // real-time bulk-delete progress: { done, total }
  const [extendItem, setExtendItem] = useState(null); // AI extend-explanations target
  const [extendingQId, setExtendingQId] = useState(null); // per-question extend in progress
  const [extendOneItem, setExtendOneItem] = useState(null); // per-question extend confirm modal target
  const [regenOneItem, setRegenOneItem] = useState(null); // per-question regenerate modal target
  const [regenAllItem, setRegenAllItem] = useState(null); // bulk "regenerate all" modal target
  const extendAbortRef = useRef(null); // AbortController for the single-question extend (Stop button)
  const [scheduleQ, setScheduleQ] = useState(null); // question to post/schedule to Facebook
  // Which subject a question-adding tool should target (set when opened from a
  // subject inside the manager). "" / "__unassigned__" means no subject.
  const [forceSection, setForceSection] = useState("");

  // Visibility management for one item
  const [access, setAccess] = useState(null); // { itemId, name, visibleToAll, users:[] }
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessSearch, setAccessSearch] = useState("");

  const load = (which) => {
    // The level (`view`) now comes from the URL, but the stream/subject/topic
    // objects come from state/sessionStorage. If a deep URL (e.g. ?v=items) is
    // opened without that context in memory — a fresh tab with empty
    // sessionStorage — fall back to the streams list instead of dereferencing a
    // null ._id.
    const missingContext =
      (which === "subjects" && !stream) ||
      (which === "topics" && !subject) ||
      (which === "items" && (hasTopics ? !topic : !subject));
    if (missingContext) {
      if (view !== "streams") setView("streams", { replace: true });
      which = "streams";
    }
    setLoading(true);
    setError("");
    const p =
      which === "streams" ? practiceService.adminStreams(kind)
      : which === "subjects" ? practiceService.adminSubjects(stream._id)
      : which === "topics" ? practiceService.adminTopics(subject._id)
      : hasTopics ? practiceService.adminTopicItems(topic._id)
      : practiceService.adminItems(subject._id, kind);
    p.then(setItems).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(view); /* eslint-disable-next-line */ }, [view, kind]);

  // After editing a question opened from the single-question preview, reopen the
  // preview on that (now-reloaded, updated) question so you land back on it.
  useEffect(() => {
    if (!reopenAfterEdit) return;
    const q = (tq || []).find((x) => x._id === reopenAfterEdit);
    if (q) { setViewQ(q); setReopenAfterEdit(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tq]);

  // Remember the current drill-down position so a page refresh restores it.
  useEffect(() => {
    saveNav(NAV_KEY, { kind, view, stream, subject, topic });
  }, [NAV_KEY, kind, view, stream, subject, topic]);

  // On first mount, restore the saved drill-down level into the URL (the
  // stream/subject/topic objects above are already restored from navState), so
  // a plain page refresh reopens where you were. `replace` avoids adding a
  // spurious history entry.
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    const saved = loadNav(NAV_KEY);
    if (!searchParams.get("v") && saved.view && saved.view !== "streams") {
      setView(saved.view, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openStream = (s) => { setStream(s); setSubject(null); setTopic(null); setView("subjects"); };
  // My Quiz drills into Topics; My Test Series goes straight to items.
  const openSubject = (s) => { setSubject(s); setTopic(null); setView(hasTopics ? "topics" : "items"); };
  const openTopic = (t) => { setTopic(t); setView("items"); };
  const goTo = (v) => setView(v);

  // NOTE: device/browser "Back" navigation is handled by the URL-based `view`
  // above (each drill level is a `?v=` history entry via setView), so a Back
  // press steps up one level and a refresh reopens the exact level in the URL.
  // A second, sentinel-based (history.pushState/popstate) back handler used to
  // live here; it fought the URL approach (double history entries + a popstate
  // handler that cleared stream/subject/topic), which made a refresh jump back
  // down to a stale deeper level. It has been removed — the URL is the single
  // source of truth.

  // Clear topic multi-select whenever we navigate.
  useEffect(() => { setSelTopics({}); }, [view, subject?._id, stream?._id, kind]);
  const toggleTopicSel = (id) => setSelTopics((s) => ({ ...s, [id]: !s[id] }));
  const selectedTopics = () => items.filter((it) => selTopics[it._id]).map((it) => ({ _id: it._id, name: it.name }));
  // The node level for the CURRENT view — used to send selected items to another
  // account (works for streams, subjects, topics and quizzes/tests alike).
  const nodeLevelForView = () => (view === "streams" ? "stream" : view === "subjects" ? "subject" : view === "topics" ? "topic" : "item");
  const selectedNodes = () => { const level = nodeLevelForView(); return items.filter((it) => selTopics[it._id]).map((it) => ({ level, id: it._id, name: it.name })); };
  const allTopicsSelected = items.length > 0 && items.every((it) => selTopics[it._id]);
  const toggleAllTopics = () => setSelTopics(allTopicsSelected ? {} : Object.fromEntries(items.map((it) => [it._id, true])));
  const selectedTopicCount = items.filter((it) => selTopics[it._id]).length;

  // ---- Entity CRUD ----
  const saveEntity = async (form) => {
    setSaving(true);
    try {
      const { type, mode, data } = modal;
      if (type === "stream") mode === "add" ? await practiceService.createStream({ ...form, kind }) : await practiceService.updateStream(data._id, form);
      else if (type === "subject") mode === "add" ? await practiceService.createSubject({ ...form, stream: stream._id }) : await practiceService.updateSubject(data._id, form);
      else if (type === "topic") mode === "add" ? await practiceService.createTopic({ ...form, subject: subject._id }) : await practiceService.updateTopic(data._id, form);
      else if (type === "item") {
        if (mode === "add") await practiceService.createItem({ ...form, practiceStream: stream._id, practiceSubject: subject._id, practiceTopic: topic?._id, practiceKind: kind });
        else await testService.update(data._id, form);
      }
      setModal(null);
      load(view);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const remove = async (type, id, label) => {
    if (!window.confirm(`Delete ${label}? This also deletes everything inside it. This cannot be undone.`)) return;
    try {
      if (type === "stream") await practiceService.deleteStream(id);
      else if (type === "subject") await practiceService.deleteSubject(id);
      else if (type === "topic") await practiceService.deleteTopic(id);
      else if (type === "item") await testService.remove(id);
      load(view);
    } catch (e) { setError(e.message); }
  };

  // Delete every ticked node at the current level (streams / subjects / topics /
  // quizzes) in one go, with a confirmation and real-time progress.
  const deleteSelectedNodes = async () => {
    const nodes = selectedNodes(); // [{ level, id, name }]
    if (!nodes.length || delSelBusy) return;
    const noun = { stream: "stream", subject: "subject", topic: "topic", item: kind === "test" ? "test" : "quiz" }[nodes[0].level] || "item";
    if (!window.confirm(`Delete ${nodes.length} ${noun}${nodes.length === 1 ? "" : "s"}? This also deletes everything inside them. This cannot be undone.`)) return;
    setDelSelBusy({ done: 0, total: nodes.length });
    setError("");
    try {
      let done = 0;
      for (const n of nodes) {
        if (n.level === "stream") await practiceService.deleteStream(n.id);
        else if (n.level === "subject") await practiceService.deleteSubject(n.id);
        else if (n.level === "topic") await practiceService.deleteTopic(n.id);
        else await testService.remove(n.id);
        setDelSelBusy({ done: ++done, total: nodes.length });
      }
      setSelTopics({});
      load(view);
    } catch (e) {
      setError(e.message);
    } finally {
      setDelSelBusy(null);
    }
  };

  // Split a My-Quiz item (or a whole topic) into quizzes of `splitPer` each.
  const doSplit = async () => {
    if (!splitTarget) return;
    const per = Math.max(1, parseInt(splitPer, 10) || 50);
    setSplitting(true);
    setError("");
    try {
      const res = splitTarget.kind === "topic"
        ? await practiceService.splitTopic(splitTarget.id, per)
        : await practiceService.splitItem(splitTarget.id, per);
      setSplitTarget(null);
      window.alert(res?.message || "Done.");
      load(view);
    } catch (e) {
      setError(e.message);
    } finally {
      setSplitting(false);
    }
  };

  // Merge the selected sibling quizzes INTO `mergeTarget` (moves their questions
  // in, then deletes the emptied source quizzes).
  const doMerge = async () => {
    if (!mergeTarget || !mergeIds.length) return;
    setMerging(true);
    setError("");
    try {
      const res = await practiceService.mergeItem(mergeTarget._id, mergeIds);
      setMergeTarget(null);
      setMergeIds([]);
      window.alert(res?.message || "Merged.");
      load(view);
    } catch (e) {
      setError(e.message);
    } finally {
      setMerging(false);
    }
  };

  // ---- Questions ----
  const openQuestions = (item) => {
    setQItem(item);
    setSelQ(new Set()); // fresh selection per quiz
    setTqLoading(true);
    testService.getQuestions(item._id).then(setTq).catch((e) => setError(e.message)).finally(() => setTqLoading(false));
  };
  const reloadTq = () => testService.getQuestions(qItem._id).then(setTq).catch(() => {});

  // ---- Move ticked questions to another quiz in the same topic --------------
  const toggleSelQ = (qid) => setSelQ((s) => { const n = new Set(s); if (n.has(qid)) n.delete(qid); else n.add(qid); return n; });

  // Open the destination picker (Stream → Subject → Topic → Quiz) to move the
  // given question ids anywhere in the My-Quiz hierarchy. Used by both the
  // checkbox "Move selected" and the by-type "Move these" flows.
  const openMove = (ids, mode = "move") => { const arr = [...ids]; if (arr.length) setMoveModal({ ids: arr, mode }); };
  const openCopy = (ids) => openMove(ids, "copy"); // duplicate selected questions into another quiz

  // Refresh after a successful move (from MoveQuestionsModal). The modal stays
  // open showing its moved/remaining summary; the user closes it with "Done".
  const afterMove = async () => {
    setSelQ(new Set());
    await reloadTq();
    load(view); // refresh both quizzes' question counts
  };

  // Saved "missing areas" plan — kept in the browser per topic so you can scan
  // once, close, and come back later to finish generating the subtopics (your
  // per-subtopic progress is remembered too). No re-scan / AI cost on resume.
  const scanStorageKey = (name) => `mstg.missingAreas:${name || scanTopic || "global"}`;
  const persistScan = (name, extra) => {
    const missing = extra?.missing || scanMissing;
    if (!missing.length) return;
    try {
      localStorage.setItem(scanStorageKey(name), JSON.stringify({
        topic: name || scanTopic,
        missing,
        counts: extra?.counts || scanCounts,
        types: scanTypes,
        globalMix,
        progress: seqProgress,
        savedAt: Date.now(),
      }));
    } catch { /* storage blocked/full — the in-memory plan still works this session */ }
  };

  // Fetch every quiz/test's stems (used so generation avoids existing questions).
  const gatherScanStems = async () => {
    try {
      const lists = await Promise.all((items || []).map((it) => testService.getQuestions(it._id).catch(() => [])));
      return lists.flat().map((q) => q?.text).filter(Boolean);
    } catch { return []; }
  };

  // The actual AI scan (also used by the "Re-scan" button).
  const runScan = async (topicName) => {
    setScanning(true); setScanErr(""); setScanMissing([]); setScanTopic(topicName); setScanStems([]);
    setScanCounts({}); setScanTypes({}); setOpenTypeRows(new Set()); setGlobalMix({}); setMixOpen(false); setSeqProgress({}); setSeqMsg(""); seqStopRef.current = false;
    setScanResumed(false);
    try {
      const stems = await gatherScanStems();
      setScanStems(stems);
      const r = await aiService.coverageGaps({ topic: topicName, questions: stems });
      const missing = Array.isArray(r?.missing) ? r.missing : [];
      setScanMissing(missing);
      // Default 10 questions per missing subtopic.
      const counts = Object.fromEntries(missing.map((_, i) => [i, 10]));
      setScanCounts(counts);
      persistScan(topicName, { missing, counts }); // save the fresh scan right away
    } catch (e) {
      setScanErr(e.message || "Scan failed.");
    } finally {
      setScanning(false);
    }
  };

  // Open "Missing areas": resume a saved plan for this topic if one exists (no AI
  // call), otherwise run a fresh scan.
  const scanMissingAreas = async () => {
    const topicName = (hasTopics ? topic : subject)?.name || "";
    setScanOpen(true); setScanFull(false); setScanErr(""); setSeqMsg(""); seqStopRef.current = false;
    let saved = null;
    try { const raw = localStorage.getItem(scanStorageKey(topicName)); saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
    if (saved && Array.isArray(saved.missing) && saved.missing.length) {
      setScanning(false);
      setScanResumed(true);
      setScanTopic(saved.topic || topicName);
      setScanMissing(saved.missing);
      setScanCounts(saved.counts || {});
      setScanTypes(saved.types || {});
      setGlobalMix(saved.globalMix || {});
      // A subtopic saved mid-generation ("working") is NOT running after a resume —
      // reset it to pending so it doesn't show a phantom, un-stoppable "generating…".
      const restored = {};
      Object.entries(saved.progress || {}).forEach(([k, v]) => { restored[k] = v && v.status === "working" ? { ...v, status: "pending" } : v; });
      setSeqProgress(restored);
      setOpenTypeRows(new Set()); setMixOpen(false);
      // Re-gather stems in the background so generation still avoids duplicates
      // (stems aren't persisted — they can be large).
      gatherScanStems().then(setScanStems);
      return;
    }
    await runScan(topicName);
  };

  // Keep the saved plan in sync as you tweak counts/types or generate subtopics,
  // so your progress survives closing the modal or reloading the page.
  useEffect(() => {
    if (!scanOpen || !scanMissing.length) return;
    persistScan(scanTopic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanOpen, scanMissing, scanCounts, scanTypes, globalMix, seqProgress]);

  // Fetch the stems of every quiz/test in the current topic so the generator's
  // coverage panel reflects the WHOLE topic (all quizzes), not just this one.
  const gatherTopicStems = async () => {
    try {
      const lists = await Promise.all((items || []).map((it) => testService.getQuestions(it._id).catch(() => [])));
      setTopicStems(lists.flat().map((q) => q?.text).filter(Boolean));
    } catch {
      setTopicStems([]);
    }
  };

  // Topic-level entry point for "other question types": open the generator with
  // ALL quizzes in this topic as the source (coverageQuestions) and a NEW quiz
  // as the destination, so the Convert / Generate-from-existing buttons work
  // across the whole topic in one place (beside Add Quiz).
  const openTopicOtherTypes = () => {
    setQItem(null);
    setAiTarget(null);
    setForceSection("");
    setGapPrefill(null);
    setOtherTypesTopic(true);
    setTopicStems([]);
    gatherTopicStems();
    setAiOpen(true);
  };

  // Open the generator pre-filled to build a NEW quiz covering the missing areas,
  // avoiding every question already made in this topic.
  const generateFromGaps = () => {
    setGapPrefill({ topic: scanTopic, subtopics: scanMissing.join(", "), avoid: scanStems });
    setTopicStems(scanStems); // coverage panel reflects the whole topic
    setQItem(null);
    setAiTarget(null);
    setForceSection("");
    setScanOpen(false);
    setAiOpen(true);
  };

  // Poll a generation job until done; honours the sequential-run cancel flag.
  // `onTick(s)` (optional) fires on every poll with the live job status
  // ({ count, byBucket, keyStats, … }) so the UI can show real-time progress.
  const pollGenJob = async (jobId, onTick) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let cancelSent = false;
    for (let i = 0; i < 240; i++) {
      await sleep(2000);
      if (seqStopRef.current && !cancelSent) { cancelSent = true; try { await aiService.cancelJob(jobId); } catch { /* keep polling for the partial */ } }
      let s;
      try { s = await aiService.job(jobId); } catch { continue; }
      try { onTick?.(s); } catch { /* live UI update must never break polling */ }
      if (s.status === "done") return s.questions || [];
      if (s.status === "error") throw new Error(s.error || "Generation failed.");
    }
    throw new Error("Generation timed out.");
  };

  // Generate questions for each missing subtopic ONE AT A TIME (in the study
  // order the scan returned): finish subtopic 1, then subtopic 2, and so on.
  // Everything is inserted into a single new quiz/test as it goes, avoiding
  // duplicates across subtopics and the questions already in the topic.
  // Core generator for ONE subtopic (index i): produces its type×level mix,
  // avoiding `avoidBase` stems + duplicates within the batch. Returns
  // { collected, lastErr }. Shared by the full run and the per-row button.
  const runSubtopic = async (i, avoidBase) => {
    const name = scanMissing[i];
    const chosen = scanTypes[i];
    const want = (() => {
      const b = [];
      if (chosen) {
        for (const [type, dm] of Object.entries(chosen)) {
          for (const [difficulty, v] of Object.entries(dm || {})) {
            const n = parseInt(v, 10) || 0;
            if (n > 0) b.push({ type, difficulty, count: n });
          }
        }
      }
      return b.length ? b : [{ type: "mcq", difficulty: "Medium", count: Math.max(0, parseInt(scanCounts[i], 10) || 0) }];
    })();
    const collected = [];
    // Distinct-question key includes type + columnA + assertion so structured
    // questions (which share an intro "text") don't wrongly collapse to ~0.
    const keyOf = (q) => `${q?.type || "mcq"}::${String(q?.text || "").trim().toLowerCase()}::${Array.isArray(q?.columnA) ? q.columnA.join("|").toLowerCase() : ""}::${String(q?.assertion || "").toLowerCase()}`;
    const seen = new Set();
    let rounds = 0, emptyRounds = 0, lastErr = "";
    while (rounds < 6 && emptyRounds < 2 && !seqStopRef.current) {
      const have = {};
      collected.forEach((q) => { const k = `${q.type || "mcq"}|${q.difficulty || "Medium"}`; have[k] = (have[k] || 0) + 1; });
      const plan = want
        .map((b) => ({ type: b.type, difficulty: b.difficulty, count: Math.max(0, b.count - (have[`${b.type}|${b.difficulty}`] || 0)) }))
        .filter((b) => b.count > 0);
      if (!plan.length) break;
      const body = {
        topic: scanTopic,
        plan,
        notes: `Write EVERY question ONLY about the subtopic "${name}" within "${scanTopic}". Do not drift to other subtopics.`,
        avoid: [...avoidBase, ...collected.map((q) => q.text)].filter(Boolean).slice(-400),
      };
      let got = [];
      const doneSoFar = collected.length; // questions from earlier rounds of THIS subtopic
      const onTick = (s) => setSeqLive({
        subtopic: name,
        count: doneSoFar + (s?.count || 0),
        byBucket: Array.isArray(s?.byBucket) ? s.byBucket : [],
      });
      try { const { jobId } = await aiService.generate(body); if (jobId) got = await pollGenJob(jobId, onTick); else lastErr = "Could not start generation."; }
      catch (e) { lastErr = e?.message || "Generation failed."; }
      const before = collected.length;
      for (const q of got) { const k = keyOf(q); if (String(q?.text || "").trim() && !seen.has(k)) { seen.add(k); collected.push(q); } }
      if (collected.length <= before) emptyRounds += 1; else emptyRounds = 0;
      rounds += 1;
    }
    return { collected, lastErr };
  };

  // Generate just ONE subtopic on demand (the per-row "Generate" button).
  const generateOne = async (i) => {
    const name = scanMissing[i];
    const cnt = scanTypes[i] ? mixTotal(scanTypes[i]) : (parseInt(scanCounts[i], 10) || 0);
    if (cnt <= 0) { setSeqMsg(`Set a question count for “${name}” first.`); return; }
    seqStopRef.current = false;
    setSeqRunning(true); // shows the "Cancel & keep" button while this single subtopic generates
    setSeqProgress((p) => ({ ...p, [name]: { status: "working", count: 0 } }));
    setSeqMsg("");
    try {
      const { collected, lastErr } = await runSubtopic(i, [...scanStems]);
      if (collected.length) {
        await saveAiBatch(collected, { newTarget: aiTarget ? undefined : { name: `${scanTopic} — gaps` }, topic: scanTopic, subtopics: name });
        setSeqProgress((p) => ({ ...p, [name]: { status: "done", count: collected.length } }));
        setSeqMsg(seqStopRef.current ? `Stopped — kept ${collected.length} question(s) for “${name}”.` : `Generated ${collected.length} question(s) for “${name}”.`);
      } else {
        setSeqProgress((p) => ({ ...p, [name]: { status: "failed", count: 0, err: lastErr || "No questions returned — rate-limited/quota, or mix too large." } }));
      }
    } catch (e) {
      setSeqProgress((p) => ({ ...p, [name]: { status: "failed", count: 0, err: e.message || "Generation failed." } }));
    } finally {
      setSeqRunning(false);
      setSeqLive(null);
    }
  };

  const generateSequential = async () => {
    const subs = scanMissing
      .map((name, i) => ({ name, i, count: (scanTypes[i] ? mixTotal(scanTypes[i]) : (parseInt(scanCounts[i], 10) || 0)) }))
      .filter((s) => s.count > 0);
    if (!subs.length) { setSeqMsg("Set a question count (e.g. 10) on at least one subtopic first."); return; }

    seqStopRef.current = false;
    setSeqRunning(true); setSeqMsg("");
    const prog = {}; subs.forEach((s) => (prog[s.name] = { status: "pending", count: 0 })); setSeqProgress({ ...prog });
    // Fresh target so the first insert creates a new quiz and later inserts append to it.
    setQItem(null); setAiTarget(null);
    const targetName = `${scanTopic} — gaps`;
    const doneStems = [...scanStems];
    let created = false, total = 0;

    try {
      for (const s of subs) {
        if (seqStopRef.current) break;
        prog[s.name].status = "working"; setSeqProgress({ ...prog });
        const { collected, lastErr } = await runSubtopic(s.i, doneStems);
        if (collected.length) {
          try {
            await saveAiBatch(collected, {
              newTarget: created ? undefined : { name: targetName },
              topic: scanTopic,
              subtopics: subs.map((x) => x.name).join(", "),
            });
            created = true;
            total += collected.length;
            doneStems.push(...collected.map((q) => q.text).filter(Boolean));
            prog[s.name] = { status: "done", count: collected.length };
          } catch (e) { prog[s.name] = { status: "failed", count: 0, err: e.message || "Insert failed." }; }
        } else {
          prog[s.name] = { status: "failed", count: 0, err: lastErr || "No questions returned — keys may be rate-limited/out of quota, or the mix is too large for the free tier." };
        }
        setSeqProgress({ ...prog });
      }
      const failed = Object.values(prog).filter((p) => p.status === "failed").length;
      const failNote = failed ? ` ${failed} subtopic(s) produced 0 (rate-limited/out of quota or too large a mix — try fewer questions or more working keys).` : "";
      setSeqMsg(seqStopRef.current
        ? `Stopped. Generated ${total} question(s) into “${targetName}” so far.${failNote}`
        : `Done — generated ${total} question(s) across ${subs.length} subtopic(s) into “${targetName}”.${failNote}`);
    } catch (e) {
      setSeqMsg(e.message || "Sequential generation failed.");
    } finally {
      setSeqRunning(false);
      seqStopRef.current = false;
      setSeqLive(null);
    }
  };

  const cancelSequential = () => { seqStopRef.current = true; setSeqMsg("Stopping after the current subtopic…"); };

  // Shared mix: set a type × level count once (no per-subtopic cap here — its
  // total becomes each subtopic's question count when applied).
  const setGlobalType = (type, diff, value) => setGlobalMix((prev) => {
    const row = { ...prev }; const cell = { ...(row[type] || {}) };
    let n = parseInt(value, 10); if (!Number.isFinite(n) || n < 0) n = 0;
    cell[diff] = n; row[type] = cell; return row;
  });
  // Copy the shared mix onto EVERY subtopic (its total = per-subtopic count).
  const applyMixToAll = () => {
    const total = mixTotal(globalMix);
    if (total <= 0) { setSeqMsg("Set at least one question in the mix above first."); return; }
    const clone = JSON.parse(JSON.stringify(globalMix));
    setScanTypes(Object.fromEntries(scanMissing.map((_, i) => [i, JSON.parse(JSON.stringify(clone))])));
    setScanCounts(Object.fromEntries(scanMissing.map((_, i) => [i, total])));
    setSeqMsg(`Applied ${total} question(s) per subtopic (same mix) to all ${scanMissing.length} subtopic(s).`);
  };

  // Set a type's count for a subtopic, clamped so the type totals never exceed
  // the subtopic's overall question count (the max the user chose).
  // Set the count for one type × level cell, clamped so the whole mix never
  // exceeds the subtopic's total (the max the user chose).
  const setSubType = (i, type, diff, value) => setScanTypes((prev) => {
    const cap = Math.max(0, parseInt(scanCounts[i], 10) || 0);
    const row = { ...(prev[i] || {}) };
    const cell = { ...(row[type] || {}) };
    const othersTotal = mixTotal(row) - (parseInt(cell[diff], 10) || 0);
    let n = parseInt(value, 10); if (!Number.isFinite(n) || n < 0) n = 0;
    n = Math.min(n, Math.max(0, cap - othersTotal));
    cell[diff] = n;
    row[type] = cell;
    return { ...prev, [i]: row };
  });
  // Open/close a subtopic's type editor. First open seeds it as "all Medium MCQ"
  // up to the chosen total, so it defaults to (e.g.) 50 Medium MCQ to redistribute.
  const toggleTypeRow = (i) => {
    setOpenTypeRows((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
    setScanTypes((prev) => (prev[i] ? prev : { ...prev, [i]: { mcq: { Medium: Math.max(0, parseInt(scanCounts[i], 10) || 0) } } }));
  };

  // Save an AI-generated / imported batch. When opts.newTarget = { name } is set
  // (the "New quiz/test" option in the modal) we CREATE a new practice item under
  // the current parent and insert the batch there; later batches then target it.
  // Otherwise the batch goes into the item currently open (qItem).
  const saveAiBatch = async (questions, opts = {}) => {
    const section = opts.section || normSection(forceSection);
    let itemId = opts.existingTargetId || aiTarget?.id || qItem?._id;
    if (opts.existingTargetId) {
      // Insert into a chosen EXISTING quiz/test; remember it so later batches append there too.
      const nm = (items || []).find((it) => it._id === opts.existingTargetId)?.name || "";
      setAiTarget({ id: opts.existingTargetId, name: nm });
    }
    if (opts.newTarget) {
      const name = String(opts.newTarget.name || "").trim();
      if (!name) throw new Error(`Enter a name for the new ${kind}.`);
      const created = await practiceService.createItem({
        name,
        practiceStream: stream?._id,
        practiceSubject: subject?._id,
        practiceTopic: hasTopics ? topic?._id : undefined,
        practiceKind: kind,
      });
      if (!created?._id) throw new Error(`Could not create the new ${kind}.`);
      itemId = created._id;
      setAiTarget({ id: itemId, name }); // subsequent batches target the new item
    }
    if (!itemId) throw new Error(`Choose an existing ${kind}, or “New ${kind}” and enter a name, to save these questions.`);
    const res = await contentService.bulkQuestions(questions, { testSeries: itemId, section });
    // Remember the topic/subtopics on this item so reopening the generator
    // pre-fills them and coverage can continue from where it left off.
    if (itemId && (opts.topic || opts.subtopics)) {
      practiceService
        .updateItem(itemId, { aiTopic: opts.topic || "", aiSubtopics: opts.subtopics || "" })
        .then((u) => {
          setItems((list) => list.map((x) => (x._id === itemId ? { ...x, aiTopic: u.aiTopic, aiSubtopics: u.aiSubtopics } : x)));
          setQItem((q) => (q && q._id === itemId ? { ...q, aiTopic: u.aiTopic, aiSubtopics: u.aiSubtopics } : q));
        })
        .catch(() => {});
    }
    if (itemId === qItem?._id) await reloadTq(); // refresh questions only when writing to the open item
    load("items"); // refresh the list so a newly-created quiz/test and updated counts show
    return res;
  };
  // Run the per-question extend once confirmed in the modal.
  const runExtendOne = async ({ fixOptions, extendQuestion, shuffleOptions, model, mode } = {}) => {
    const item = extendOneItem;
    if (!item) return;
    setExtendingQId(item._id);
    const controller = new AbortController();
    extendAbortRef.current = controller;
    try {
      const updated = await aiService.extendOne(
        { questionId: item._id, fixOptions, extendQuestion, shuffleOptions, model, mode },
        { signal: controller.signal }
      );
      setViewQ((prev) => (prev && prev._id === item._id ? { ...prev, ...updated } : prev));
      setExtendOneItem(null);
      await reloadTq();
    } catch (e) { if (!e?.aborted) setError(e.message); setExtendOneItem(null); }
    finally { extendAbortRef.current = null; setExtendingQId(null); }
  };
  // Apply a single-question regenerate result (from RegenerateOneModal) to the
  // open preview and reload the list.
  const applyRegenerated = async (updated) => {
    const item = regenOneItem;
    if (item) setViewQ((prev) => (prev && prev._id === item._id ? { ...prev, ...updated } : prev));
    setRegenOneItem(null);
    await reloadTq();
  };
  const saveTestQuestion = async (payload) => {
    setTqSaving(true);
    try {
      if (tqModal.mode === "add") await testService.addQuestion(qItem._id, payload);
      else await contentService.updateQuestion(tqModal.data._id, payload);
      setTqModal(null);
      await reloadTq();
      load("items");
    } catch (e) { setError(e.message); } finally { setTqSaving(false); }
  };
  const removeTq = async (qid) => {
    if (!window.confirm("Delete this question?")) return;
    await testService.deleteQuestion(qItem._id, qid);
    await reloadTq();
    load("items");
  };
  // Bulk-delete the "View all" questions matching the active TYPE filter (or
  // every question when no type is selected) — delete a whole type at once.
  const deleteByType = async () => {
    if (delProgress || !qItem) return;
    const targets = filterBySubject(tq, subjectFilter).filter((it) => !typeFilter.length || typeFilter.includes(questionTypeKey(it)));
    const ids = targets.map((q) => q._id);
    if (!ids.length) return;
    const label = typeFilter.length ? typeFilter.map((t) => QUESTION_TYPE_LABELS[t] || t).join(", ") : "all types";
    if (!window.confirm(`Delete ${ids.length} question(s) of type: ${label}? This cannot be undone.`)) return;
    const before = tq.length;
    setDelProgress({ total: ids.length, done: 0 });
    try {
      let done = 0;
      for (const id of ids) {
        await testService.deleteQuestion(qItem._id, id);
        setDelProgress({ total: ids.length, done: ++done });
      }
      await reloadTq();
      load("items");
      setDelProgress({ total: ids.length, done: ids.length, finished: true, remaining: Math.max(0, before - ids.length) });
      setTimeout(() => setDelProgress(null), 5000);
    } catch (e) {
      setError(e.message);
      setDelProgress(null);
    }
  };
  // CSV helpers now receive the exact list of questions to export.
  const copyCsv = async (list) => {
    if (!list?.length) return;
    try { await navigator.clipboard.writeText(questionsToCsv(list)); window.alert(`Copied ${list.length} question(s) as CSV.`); }
    catch { window.alert("Clipboard blocked — use Download CSV."); }
  };
  const downloadCsv = (list) => {
    if (!list?.length) return;
    const url = URL.createObjectURL(new Blob([questionsToCsv(list)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${String(qItem?.name || "questions").replace(/[^\w-]+/g, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ---- Visibility / access ----
  const openAccess = (item) => {
    testService.getAccess(item._id).then((a) => setAccess({ itemId: item._id, ...a })).catch((e) => setError(e.message));
  };
  const saveAccess = async () => {
    setAccessSaving(true);
    try {
      await testService.updateAccess(access.itemId, {
        visibleToAll: access.visibleToAll,
        users: access.users.map((u) => ({ user: u._id, visible: u.visible, validUntil: u.validUntil })),
      });
      setAccess(null);
      load("items");
    } catch (e) { setError(e.message); } finally { setAccessSaving(false); }
  };

  const H = view === "streams" ? { title: "Streams", add: "Add Stream", icon: GraduationCap }
    : view === "subjects" ? { title: `${L.subjectPl} in ${stream?.name || ""}`, add: L.subjectAdd, icon: FolderOpen }
    : view === "topics" ? { title: `${L.topicPl} in ${subject?.name || ""}`, add: L.topicAdd, icon: HelpCircle }
    : { title: `${L.itemPl} in ${(hasTopics ? topic : subject)?.name || ""}`, add: L.itemAdd, icon: kind === "quiz" ? ListChecks : kind === "paper" ? Files : FileStack };

  const addType = view === "streams" ? "stream" : view === "subjects" ? "subject" : view === "topics" ? "topic" : "item";

  return (
    <div className="space-y-5">
      {/* Content other accounts shared with you — Accept saves an owned copy */}
      <IncomingSharesInbox onAccepted={() => load(view)} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">My Practice</h1>
          <p className="text-slate-500 dark:text-slate-400">
            {clientMode
              ? "Build your own quizzes and tests, then practice them. This content is private to you."
              : "Hidden by default — grant access per student. Adding content here never notifies anyone."}
          </p>
        </div>
        <button
          onClick={() => {
            setDupScope(subject ? { params: { practiceSubject: subject._id }, name: subject.name } : { params: null, name: "" });
            setDupOpen(true);
          }}
          className="btn-outline"
          title={subject ? `Scan duplicates in ${subject.name}` : "Scan practice questions for duplicates"}
        >
          <Files className="h-4 w-4" /> Find Duplicates{subject ? ` — ${subject.name}` : ""}
        </button>
        {subject && kind === "quiz" && (
          <button
            onClick={() => {
              setDupScope({ params: { practiceSubject: subject._id, pool: true }, name: `All topics in ${subject.name}` });
              setDupOpen(true);
            }}
            className="btn-outline"
            title={`Scan for the same question repeated across ALL topics of ${subject.name}`}
          >
            <Files className="h-4 w-4" /> Duplicates across all topics
          </button>
        )}
      </div>

      {/* Kind tabs — hidden on a fixed-kind standalone page (e.g. Previous
          Papers). Otherwise Previous Papers is its own section, so only the
          My Quiz / My Test tabs are shown here. */}
      {!fixedKind && (
      <div className="flex flex-wrap gap-2">
        {KINDS.filter((k) => k.key !== "paper").map((k) => (
          <button
            key={k.key}
            onClick={() => { setKind(k.key); setStream(null); setSubject(null); setTopic(null); setView("streams"); }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${kind === k.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}
          >
            <k.icon className="h-4 w-4" /> {k.label}
          </button>
        ))}
      </div>
      )}

      {/* Breadcrumb */}
      <div className="card px-4 py-3">
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <button onClick={() => goTo("streams")} className={`rounded px-2 py-1 font-medium ${view === "streams" ? "text-brand-600" : "text-slate-500 hover:text-brand-600"}`}>Streams</button>
          {stream && view !== "streams" && (<>
            <ChevronRight className="h-4 w-4 text-slate-400" />
            <button onClick={() => goTo("subjects")} className={`rounded px-2 py-1 font-medium ${view === "subjects" ? "text-brand-600" : "text-slate-500 hover:text-brand-600"}`}>{stream.name}</button>
          </>)}
          {subject && (view === "topics" || view === "items") && (<>
            <ChevronRight className="h-4 w-4 text-slate-400" />
            <button onClick={() => goTo(hasTopics ? "topics" : "items")} className={`rounded px-2 py-1 font-medium ${view === "topics" ? "text-brand-600" : "text-slate-500 hover:text-brand-600"}`}>{subject.name}</button>
          </>)}
          {topic && view === "items" && hasTopics && (<>
            <ChevronRight className="h-4 w-4 text-slate-400" />
            <span className="rounded px-2 py-1 font-medium text-brand-600">{topic.name}</span>
          </>)}
        </nav>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold"><H.icon className="h-5 w-5 text-brand-600" /> {H.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {view === "items" && (hasTopics ? topic : subject) && (
            <button
              onClick={scanMissingAreas}
              className="btn-outline text-brand-600"
              title={items.length > 0
                ? `Scan all ${L.itemsWord} here for syllabus areas not yet covered`
                : `Scan this ${L.groupWord}'s syllabus for areas to cover (works even before you add any ${L.itemsWord})`}
            >
              <ScanSearch className="h-4 w-4" /> Scan Missing Areas
            </button>
          )}
          {view === "items" && (hasTopics ? topic : subject) && items.length > 0 && (
            <button
              onClick={openTopicOtherTypes}
              className="btn-outline text-brand-600"
              title={`Make other question types (assertion, statements, matching, pairs) from ALL ${L.itemsWord} in this ${L.groupWord}`}
            >
              <Sparkles className="h-4 w-4" /> Other question types
            </button>
          )}
          <button onClick={() => setModal({ type: addType, mode: "add", data: {} })} className="btn-primary">
            <Plus className="h-4 w-4" /> {H.add}
          </button>
        </div>
      </div>

      {/* Bulk-migrate topics: tick topics, then move them all to another subject */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={allTopicsSelected} onChange={toggleAllTopics} className="h-4 w-4 accent-brand-600" />
            Select all
          </label>
          {selectedTopicCount > 0 && (
            <>
              <span className="text-sm text-slate-500">{selectedTopicCount} selected</span>
              {view === "topics" && (
                <button onClick={() => setMigrateTopicsOpen(true)} className="btn-primary py-1.5 text-xs">
                  <ArrowRightLeft className="h-3.5 w-3.5" /> Migrate selected
                </button>
              )}
              <button onClick={() => setSendSelectedOpen(true)} disabled={!!delSelBusy} className="btn-outline py-1.5 text-xs text-emerald-600 disabled:opacity-50">
                <Send className="h-3.5 w-3.5" /> Send selected
              </button>
              <button onClick={deleteSelectedNodes} disabled={!!delSelBusy} className="btn-outline py-1.5 text-xs text-rose-600 disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" /> {delSelBusy ? `Deleting ${delSelBusy.done}/${delSelBusy.total}…` : "Delete selected"}
              </button>
              <button onClick={() => setSelTopics({})} className="btn-ghost py-1.5 text-xs">Clear</button>
            </>
          )}
          <span className="ml-auto text-xs text-slate-400">Tick items to delete, send{view === "topics" ? " or move" : ""} several at once</span>
        </div>
      )}

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={() => load(view)} /> : items.length === 0 ? (
        <EmptyState message={`Nothing here yet. Use "${H.add}".`} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item._id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <input
                  type="checkbox"
                  checked={!!selTopics[item._id]}
                  onChange={() => toggleTopicSel(item._id)}
                  className="mt-1 h-4 w-4 flex-shrink-0 accent-brand-600"
                  title={view === "topics" ? "Select to send or move" : "Select to send"}
                />
                <button
                  onClick={() => (view === "streams" ? openStream(item) : view === "subjects" ? openSubject(item) : view === "topics" ? openTopic(item) : openQuestions(item))}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="font-bold">{item.name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {view === "streams" && `${item.subjects ?? 0} ${L.subjectPl.toLowerCase()}`}
                    {view === "subjects" && (hasTopics ? L.openTopics : `${item.items ?? 0} tests`)}
                    {view === "topics" && `${item.items ?? 0} ${L.itemsWord}`}
                    {view === "items" && `${item.questionCount ?? 0} questions · ${item.visibleToAll ? "Visible to all" : "Hidden by default"}`}
                  </p>
                </button>
                <div className="flex flex-shrink-0 gap-1">
                  {view === "subjects" && (
                    <button
                      onClick={() => { setDupScope({ params: { practiceSubject: item._id }, name: item.name }); setDupOpen(true); }}
                      title={`Find duplicates in ${item.name}`}
                      className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30"
                    >
                      <Files className="h-4 w-4" />
                    </button>
                  )}
                  {view === "topics" && (
                    <button
                      onClick={() => { setSplitPer(50); setSplitTarget({ kind: "topic", id: item._id, name: item.name, count: null }); }}
                      title="Split this topic's questions into quizzes of N"
                      className="rounded-lg p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                    >
                      <Scissors className="h-4 w-4" />
                    </button>
                  )}
                  {view !== "items" && (
                    <button onClick={() => setShareNode({ node: item, level: view === "streams" ? "stream" : view === "subjects" ? "subject" : "topic" })} title="Share a public link to this whole stream/subject/topic (anyone can open & take everything under it — no login)" className={`rounded-lg p-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 ${item.publicShare ? "text-emerald-600" : "text-slate-500 hover:text-emerald-600 dark:text-slate-400"}`}><Share2 className="h-4 w-4" /></button>
                  )}
                  {view !== "items" && (
                    <button onClick={() => setShareEmailTarget({ level: view === "streams" ? "stream" : view === "subjects" ? "subject" : "topic", id: item._id, name: item.name })} title="Send to another user by email (they must have an account)" className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"><Send className="h-4 w-4" /></button>
                  )}
                  {view !== "items" && (
                    <button onClick={() => setModal({ type: view === "streams" ? "stream" : view === "subjects" ? "subject" : "topic", mode: "edit", data: item })} className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30"><Pencil className="h-4 w-4" /></button>
                  )}
                  <button onClick={() => remove(view === "streams" ? "stream" : view === "subjects" ? "subject" : view === "topics" ? "topic" : "item", item._id, item.name)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              {view === "items" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => openQuestions(item)} className="btn-outline py-1.5 text-xs"><HelpCircle className="h-3.5 w-3.5" /> Questions</button>
                  {kind === "paper" && (
                    <button onClick={() => setPaperFilesItem(item)} className="btn-outline py-1.5 text-xs text-brand-600" title="Upload the question-paper PDF, answer-key PDF and additional information"><Files className="h-3.5 w-3.5" /> Paper files</button>
                  )}
                  {kind === "quiz" && (
                    <button onClick={() => setMigrateItem(item)} className="btn-outline py-1.5 text-xs" title="Move or copy this quiz (My Quiz → My Quiz, or My Quiz → Content)"><ArrowRightLeft className="h-3.5 w-3.5" /> Migrate</button>
                  )}
                  {kind === "quiz" && (
                    <button onClick={() => { setSplitPer(50); setSplitTarget({ kind: "quiz", id: item._id, name: item.name, count: item.questionCount ?? null }); }} className="btn-outline py-1.5 text-xs text-indigo-600" title="Split this quiz into quizzes of N (Quiz 1, Quiz 2, …)"><Scissors className="h-3.5 w-3.5" /> Split</button>
                  )}
                  {kind === "quiz" && (
                    <button onClick={() => { setMergeIds([]); setMergeTarget(item); }} className="btn-outline py-1.5 text-xs text-indigo-600" title="Merge other quizzes in this topic into this one"><GitMerge className="h-3.5 w-3.5" /> Merge</button>
                  )}
                  {/* Public share link (no login needed) — for My Quiz AND My Test */}
                  <button onClick={() => setShareItem(item)} className={`btn-outline py-1.5 text-xs ${item.publicShare ? "text-emerald-600" : ""}`} title="Share a public link (anyone with the link can take this — no login/account needed)"><Share2 className="h-3.5 w-3.5" /> Share link</button>
                  {/* Account-to-account: send to another registered user by email */}
                  <button onClick={() => setShareEmailTarget({ level: "item", id: item._id, name: item.name })} className="btn-outline py-1.5 text-xs text-emerald-600" title="Send to another user by email (they must have an account)"><Send className="h-3.5 w-3.5" /> Send to user</button>
                  {!clientMode && (
                    <button onClick={() => openAccess(item)} className="btn-outline py-1.5 text-xs"><Users className="h-3.5 w-3.5" /> Visibility</button>
                  )}
                  <button onClick={() => { setDupScope({ params: { testSeries: item._id }, name: item.name }); setDupOpen(true); }} className="btn-outline py-1.5 text-xs"><Files className="h-3.5 w-3.5" /> Duplicates</button>
                  <button onClick={() => setModal({ type: "item", mode: "edit", data: item })} className="btn-outline py-1.5 text-xs"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Split a My-Quiz item / topic into quizzes of N */}
      {splitTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={splitting ? undefined : () => setSplitTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md animate-scale-in card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold"><Scissors className="h-5 w-5 text-indigo-600" /> Split into quizzes</h3>
              <button type="button" onClick={() => setSplitTarget(null)} disabled={splitting}><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
              {splitTarget.kind === "topic"
                ? <>Split all questions in the topic <b>“{splitTarget.name}”</b> into quizzes named Quiz 1, Quiz 2, …</>
                : <>Split the quiz <b>“{splitTarget.name}”</b>{splitTarget.count != null ? <> ({splitTarget.count} questions)</> : null} — it keeps its name and first chunk; the rest go into new quizzes numbered after your existing ones (e.g. splitting “Quiz 2” adds Quiz 3, Quiz 4, …).</>}
            </p>
            <label className="mb-1 block text-sm font-semibold">Questions per quiz</label>
            <input type="number" min={1} max={500} value={splitPer} onChange={(e) => setSplitPer(e.target.value)} className="input" autoFocus />
            {splitTarget.count != null && (
              <p className="mt-1 text-xs text-slate-400">
                {splitTarget.count} questions ÷ {Math.max(1, parseInt(splitPer, 10) || 1)} = about {Math.ceil((splitTarget.count || 0) / Math.max(1, parseInt(splitPer, 10) || 1))} quiz(zes).
              </p>
            )}
            {splitTarget.kind === "topic" && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                This reorganises the whole topic: all its questions move into fresh Quiz 1…N, and the topic's old quizzes are replaced.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setSplitTarget(null)} disabled={splitting} className="btn-outline">Cancel</button>
              <button type="button" onClick={doSplit} disabled={splitting} className="btn-primary">
                {splitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Splitting…</> : <><Scissors className="h-4 w-4" /> Split</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge sibling My-Quiz items into one */}
      {mergeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={merging ? undefined : () => setMergeTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md animate-scale-in card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold"><GitMerge className="h-5 w-5 text-indigo-600" /> Merge into “{mergeTarget.name}”</h3>
              <button type="button" onClick={() => setMergeTarget(null)} disabled={merging}><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
              Pick other quizzes in this topic to merge into <b>“{mergeTarget.name}”</b>. Their questions move in and the emptied quizzes are deleted.
            </p>
            {(() => {
              const others = items.filter((it) => it._id !== mergeTarget._id);
              if (!others.length) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">There are no other quizzes in this topic to merge.</p>;
              const otherIds = others.map((o) => o._id);
              const allSelected = otherIds.every((id) => mergeIds.includes(id));
              return (
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border-b border-slate-200 px-2 py-1.5 font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={allSelected} onChange={() => setMergeIds(allSelected ? [] : otherIds)} />
                    <span className="text-sm">Select all <span className="text-slate-400">· {others.length}</span></span>
                  </label>
                  {others.map((it) => (
                    <label key={it._id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={mergeIds.includes(it._id)} onChange={() => setMergeIds((s) => (s.includes(it._id) ? s.filter((x) => x !== it._id) : [...s, it._id]))} />
                      <span className="text-sm">{it.name} <span className="text-slate-400">· {it.questionCount ?? 0} q</span></span>
                    </label>
                  ))}
                </div>
              );
            })()}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setMergeTarget(null)} disabled={merging} className="btn-outline">Cancel</button>
              <button type="button" onClick={doMerge} disabled={merging || !mergeIds.length} className="btn-primary">
                {merging ? <><Loader2 className="h-4 w-4 animate-spin" /> Merging…</> : <><GitMerge className="h-4 w-4" /> Merge{mergeIds.length ? ` ${mergeIds.length}` : ""}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Entity form modal */}
      {modal && <EntityForm type={modal.type} data={modal.data} kind={kind} saving={saving} onClose={() => setModal(null)} onSave={saveEntity} />}

      {/* Questions modal */}
      {qItem && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setQItem(null)}>
          <div onClick={(e) => e.stopPropagation()} className="my-8 w-full max-w-2xl animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Questions — {qItem.name}</h3>
              <button onClick={() => setQItem(null)}><X className="h-5 w-5" /></button>
            </div>

            <ManageTestQuestions
              qTest={qItem}
              tq={tq}
              tqLoading={tqLoading}
              onClose={() => setQItem(null)}
              onAddQuestion={(subject) => setTqModal({ mode: "add", data: null, forceSection: subject })}
              onEditQuestion={(item) => setTqModal({ mode: "edit", data: item })}
              onDeleteQuestion={removeTq}
              onDeleteSelected={async (ids, onProgress) => {
                let done = 0;
                for (const id of ids) {
                  await testService.deleteQuestion(qItem._id, id);
                  onProgress?.(++done); // report real-time progress to the modal
                }
                await reloadTq();
                load("items");
              }}
              onViewQuestion={setViewQ}
              onViewAll={() => { setTypeFilter([]); setStatusFilter("all"); setSubjectFilter(""); setViewAll(true); }}
              onDuplicates={() => { setDupScope({ params: { testSeries: qItem._id }, name: qItem.name }); setDupOpen(true); }}
              onCopyCsv={copyCsv}
              onDownloadCsv={downloadCsv}
              onBulkUpload={(subject) => { setForceSection(subject); setBulkOpen(true); }}
              onAiGenerate={(subject) => { setForceSection(subject); setAiTarget(null); setGapPrefill(null); setTopicStems([]); gatherTopicStems(); setAiOpen(true); }}
              onImportWeb={(subject) => { setForceSection(subject); setAiTarget(null); setImportOpen(true); }}
              onPickFromBank={(subject) => { setForceSection(subject); setBankOpen(true); }}
              onAutoBuild={() => setAutoOpen(true)}
              onExtendExplanations={() => setExtendItem(qItem)}
              onExtendQuestion={(item) => setExtendOneItem(item)}
              extendingId={extendingQId}
              onRegenerateQuestion={(item) => setRegenOneItem(item)}
              regeneratingId={null}
              onRegenerateAll={() => setRegenAllItem(qItem)}
            />
          </div>
        </div>
      )}

      {tqModal && (
        <QuestionFormModal
          key={tqModal.mode === "edit" ? tqModal.data?._id : "new"}
          question={tqModal.mode === "edit" ? tqModal.data : null}
          saving={tqSaving}
          sections={sectionsOf(qItem)}
          defaultSection={normSection(tqModal.forceSection)}
          onClose={() => { setTqModal(null); setReopenAfterEdit(null); }}
          onSave={saveTestQuestion}
        />
      )}

      {viewQ && (
        <div className={`fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/50 ${viewFull ? "items-stretch p-0 sm:p-4" : "items-start p-4"}`} onClick={() => setViewQ(null)}>
          <div onClick={(e) => e.stopPropagation()} className={`card flex flex-col animate-scale-in ${viewFull ? "m-0 min-h-full w-full max-w-none rounded-none p-4 sm:min-h-0 sm:h-full sm:rounded-2xl sm:p-6" : "my-8 w-full max-w-2xl p-6"}`}>
            <div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold">Question</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => setViewFull((v) => !v)} title={viewFull ? "Exit full screen" : "Full screen"} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                  {viewFull ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                </button>
                <button onClick={() => setViewQ(null)}><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className={viewFull ? "min-h-0 flex-1 overflow-y-auto" : ""}>
            <QuestionView q={viewQ} {...(() => { const L = tq; const i = L.findIndex((x) => x._id === viewQ._id); return { position: i >= 0 ? `${i + 1} / ${L.length}` : undefined, onPrev: i > 0 ? () => setViewQ(L[i - 1]) : undefined, onNext: i >= 0 && i < L.length - 1 ? () => setViewQ(L[i + 1]) : undefined }; })()} onRegenerate={() => setRegenOneItem(viewQ)} regenerating={false} onExtend={() => setExtendOneItem(viewQ)} extending={extendingQId === viewQ._id} onSchedule={clientMode ? undefined : () => setScheduleQ(viewQ)} onEdit={() => { const q = viewQ; setReopenAfterEdit(q._id); setViewQ(null); setTqModal({ mode: "edit", data: q }); }} />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={async () => { if (!window.confirm("Delete this question?")) return; await testService.deleteQuestion(qItem._id, viewQ._id); setViewQ(null); await reloadTq(); load("items"); }} className="btn-outline mr-auto text-rose-600"><Trash2 className="h-4 w-4" /> Delete</button>
              <button onClick={() => setAddToTestQ(viewQ)} className="btn-outline"><ClipboardList className="h-4 w-4" /> Add to test</button>
              <button onClick={() => setViewQ(null)} className="btn-outline">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Copy the viewed question into a chosen test */}
      {addToTestQ && (
        <AddToTestModal question={addToTestQ} clientMode={clientMode} onClose={() => setAddToTestQ(null)} />
      )}

      {/* Move selected / by-type questions to ANY quiz (Stream → Subject → Topic → Quiz) */}
      {moveModal && qItem && (
        <MoveQuestionsModal
          open
          sourceId={qItem._id}
          questionIds={moveModal.ids}
          mode={moveModal.mode}
          onClose={() => setMoveModal(null)}
          onMoved={afterMove}
        />
      )}

      {/* View all questions (with edit/delete per question) */}
      {viewAll && qItem && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4" onClick={() => setViewAll(false)}>
          <div onClick={(e) => e.stopPropagation()} className="min-h-full w-full max-w-none animate-scale-in card m-0 rounded-none p-4 sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-bold">All questions — {qItem.name} ({tq.length})</h3>
              <div className="flex items-center gap-2">
                <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold dark:border-slate-700">
                  <button onClick={() => setStudentView(false)} className={`px-3 py-1.5 ${!studentView ? "bg-brand-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>Admin view</button>
                  <button onClick={() => setStudentView(true)} className={`px-3 py-1.5 ${studentView ? "bg-brand-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>Student view</button>
                </div>
                <button onClick={() => setViewAll(false)}><X className="h-5 w-5" /></button>
              </div>
            </div>
            {studentView && (
              <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                Student view — answers &amp; explanations are hidden. Use “Reveal answer” on any question to expose it.
              </p>
            )}
            {/* Tick questions (Admin view) and move them into another quiz in this topic. */}
            {!studentView && tq.length > 0 && (() => {
              // "Select all" respects the active TYPE filter: it selects every
              // VISIBLE (filtered) question at once, so you can grab a whole type.
              const visible = filterBySubject(tq, subjectFilter).filter((it) => !typeFilter.length || typeFilter.includes(questionTypeKey(it)));
              const allSel = visible.length > 0 && visible.every((it) => selQ.has(it._id));
              return (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800/60">
                  <button type="button" onClick={() => setSelQ(allSel ? new Set() : new Set(visible.map((it) => it._id)))} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">{allSel ? "Clear all" : `Select all${typeFilter.length ? ` (${visible.length})` : ""}`}</button>
                  <span className="text-slate-500 dark:text-slate-400">{selQ.size} selected</span>
                  <span className="ml-auto flex items-center gap-2">
                    <button type="button" onClick={() => openCopy(selQ)} disabled={!selQ.size} className="btn-outline py-1 text-xs disabled:opacity-50" title="Duplicate the selected questions into another quiz (originals stay here)">
                      <CopyIcon className="h-3.5 w-3.5" /> Copy selected…
                    </button>
                    <button type="button" onClick={() => openMove(selQ)} disabled={!selQ.size} className="btn-primary py-1 text-xs disabled:opacity-50">
                      <ArrowRightLeft className="h-3.5 w-3.5" /> Move selected…
                    </button>
                  </span>
                </div>
              );
            })()}
            <QuestionSubjectFilter questions={tq} selected={subjectFilter} onChange={(s) => { setSubjectFilter(s); setTypeFilter([]); setStatusFilter("all"); }} />
            <QuestionTypeFilter questions={filterBySubject(tq, subjectFilter)} selected={typeFilter} onChange={setTypeFilter} />
            <QuestionStatusFilter questions={filterBySubject(tq, subjectFilter).filter((it) => !typeFilter.length || typeFilter.includes(questionTypeKey(it)))} selected={statusFilter} onChange={setStatusFilter} />
            {!studentView && (() => {
              const shownCount = filterByStatus(filterBySubject(tq, subjectFilter).filter((it) => !typeFilter.length || typeFilter.includes(questionTypeKey(it))), statusFilter).length;
              if (!shownCount) return null;
              return (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button onClick={deleteByType} disabled={!!delProgress} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/50 dark:hover:bg-rose-900/20">
                    <Trash2 className="h-3.5 w-3.5" />
                    {delProgress
                      ? `Deleting ${delProgress.done}/${delProgress.total}…`
                      : typeFilter.length
                      ? `Delete these ${shownCount} (${typeFilter.map((t) => QUESTION_TYPE_LABELS[t] || t).join(", ")})`
                      : `Delete all ${shownCount}`}
                  </button>
                  <button
                    onClick={() => openMove(filterBySubject(tq, subjectFilter).filter((it) => !typeFilter.length || typeFilter.includes(questionTypeKey(it))).map((q) => q._id))}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 dark:border-brand-900/50 dark:hover:bg-brand-900/20"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" /> {typeFilter.length ? `Move these ${shownCount}…` : `Move all ${shownCount}…`}
                  </button>
                  <button
                    onClick={() => openCopy(filterBySubject(tq, subjectFilter).filter((it) => !typeFilter.length || typeFilter.includes(questionTypeKey(it))).map((q) => q._id))}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 dark:border-brand-900/50 dark:hover:bg-brand-900/20"
                    title="Duplicate these questions into another quiz (originals stay here)"
                  >
                    <CopyIcon className="h-3.5 w-3.5" /> {typeFilter.length ? `Copy these ${shownCount}…` : `Copy all ${shownCount}…`}
                  </button>
                  {!typeFilter.length && <span className="text-xs text-slate-400">Tip: pick a Type above to delete/move/copy only that type.</span>}
                </div>
              );
            })()}
            {!studentView && delProgress && (
              <p className={`mb-3 flex items-center gap-1.5 text-xs font-medium ${delProgress.finished ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>
                {delProgress.finished
                  ? <><CheckCircle2 className="h-3.5 w-3.5" /> Deleted {delProgress.done}{delProgress.remaining != null ? ` • ${delProgress.remaining} remaining` : ""}</>
                  : <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting {delProgress.done} of {delProgress.total}…</>}
              </p>
            )}
            <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
              {filterByStatus(filterBySubject(tq, subjectFilter), statusFilter)
                .map((it, i) => ({ it, i }))
                .filter(({ it }) => !typeFilter.length || typeFilter.includes(questionTypeKey(it)))
                .map(({ it, i }) => (
                <div key={(studentView ? "s" : "a") + it._id} className="relative rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
                    {!studentView && <input type="checkbox" checked={selQ.has(it._id)} onChange={() => toggleSelQ(it._id)} title="Select to move" className="mr-1 h-4 w-4 accent-brand-600" />}
                    <button onClick={() => setAddToTestQ(it)} title="Add to test" className="rounded-lg bg-white p-1.5 text-emerald-600 shadow hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-900/30"><ClipboardList className="h-4 w-4" /></button>
                    {!studentView && (
                      <>
                        <button onClick={() => { setViewAll(false); setTqModal({ mode: "edit", data: it }); }} title="Edit" className="rounded-lg bg-white p-1.5 text-brand-600 shadow hover:bg-brand-50 dark:bg-slate-800 dark:hover:bg-brand-900/30"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => removeTq(it._id)} title="Delete" className="rounded-lg bg-white p-1.5 text-rose-600 shadow hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
                      </>
                    )}
                  </div>
                  <QuestionView q={it} index={i + 1} studentView={studentView} onRegenerate={() => setRegenOneItem(it)} regenerating={false} onExtend={() => setExtendOneItem(it)} extending={extendingQId === it._id} onSchedule={clientMode ? undefined : () => setScheduleQ(it)} />
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end"><button onClick={() => setViewAll(false)} className="btn-outline">Close</button></div>
          </div>
        </div>
      )}

      <PickFromBank
        open={bankOpen}
        testId={qItem?._id}
        plan={qItem?.subjectPlan || []}
        practiceOnly={clientMode}
        defaultSection={normSection(forceSection)}
        title={`Hand-pick questions — ${qItem?.name || ""}${normSection(forceSection) ? ` (${normSection(forceSection)})` : ""}`}
        onClose={() => { setBankOpen(false); setForceSection(""); }}
        onDone={async () => { await reloadTq(); load(view); }}
      />

      <AutoBuildTest
        open={autoOpen}
        testId={qItem?._id}
        testName={qItem?.name || ""}
        plan={qItem?.subjectPlan || []}
        practice
        onClose={() => setAutoOpen(false)}
        onDone={async () => { await reloadTq(); load(view); }}
      />

      <BulkUploadQuestions
        open={bulkOpen}
        sections={sectionsOf(qItem)}
        defaultSection={normSection(forceSection)}
        title={`Bulk Upload — ${qItem?.name || ""}${normSection(forceSection) ? ` (${normSection(forceSection)})` : ""}`}
        onClose={() => { setBulkOpen(false); setForceSection(""); }}
        onUpload={async (questions, opts = {}) => {
          const section = opts.section || normSection(forceSection);
          if (opts.replace) {
            const existing = await testService.getQuestions(qItem._id);
            for (const q of existing) await testService.deleteQuestion(qItem._id, q._id);
          }
          const res = await contentService.bulkQuestions(questions, { testSeries: qItem._id, section });
          await reloadTq();
          load("items");
          return res;
        }}
      />

      <AiGenerate
        open={aiOpen}
        sections={sectionsOf(qItem)}
        defaultSection={normSection(forceSection)}
        title={`Generate with AI — ${qItem?.name || (gapPrefill ? `new ${kind} (missing areas)` : (otherTypesTopic ? "other question types (all quizzes)" : ""))}${normSection(forceSection) ? ` (${normSection(forceSection)})` : ""}`}
        onClose={() => { setAiOpen(false); setForceSection(""); setGapPrefill(null); setOtherTypesTopic(false); }}
        allowNewTarget
        newLeafLabel={kind}
        currentTargetName={aiTarget?.name || qItem?.name || ""}
        existingItems={(items || []).filter((it) => it._id !== qItem?._id).map((it) => ({ _id: it._id, name: it.name, questionCount: it.questionCount }))}
        existingQuestions={otherTypesTopic ? [] : (gapPrefill ? gapPrefill.avoid : tq)}
        defaultTopic={gapPrefill ? gapPrefill.topic : (qItem?.aiTopic || (kind === "quiz" ? topic : subject)?.name || "")}
        defaultSubtopics={gapPrefill ? gapPrefill.subtopics : (qItem?.aiSubtopics || "")}
        defaultDest={(gapPrefill || otherTypesTopic) ? "new" : "current"}
        coverageQuestions={topicStems}
        onUpload={(questions, opts = {}) => saveAiBatch(questions, opts)}
      />

      <AiImport
        open={importOpen}
        sections={sectionsOf(qItem)}
        defaultSection={normSection(forceSection)}
        title={`Import from Web — ${qItem?.name || ""}${normSection(forceSection) ? ` (${normSection(forceSection)})` : ""}`}
        onClose={() => { setImportOpen(false); setForceSection(""); }}
        allowNewTarget
        newLeafLabel={kind}
        currentTargetName={aiTarget?.name || qItem?.name || ""}
        existingItems={(items || []).filter((it) => it._id !== qItem?._id).map((it) => ({ _id: it._id, name: it.name, questionCount: it.questionCount }))}
        onUpload={(questions, opts = {}) => saveAiBatch(questions, opts)}
      />

      {/* Scan missing areas — coverage report across all quizzes/tests in this topic */}
      {scanOpen && (
        <div className={`fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/50 ${scanFull ? "items-stretch p-2 sm:p-4" : "items-start p-4"}`} onClick={() => setScanOpen(false)}>
          <div className={`card flex flex-col p-6 ${scanFull ? "m-0 h-full w-full max-w-none" : "my-8 max-h-[calc(100vh-4rem)] w-full max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold">
                <ScanSearch className="h-5 w-5 text-brand-600" /> Missing areas{scanTopic ? ` — ${scanTopic}` : ""}
              </h3>
              <div className="flex items-center gap-1">
                <button onClick={() => setScanFull((v) => !v)} title={scanFull ? "Exit full screen" : "Full screen"} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                  {scanFull ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                </button>
                <button onClick={() => setScanOpen(false)} title="Close"><X className="h-5 w-5" /></button>
              </div>
            </div>

            {scanning ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Scanning {items.length} {kind === "quiz" ? "quiz(zes)" : "test(s)"} for uncovered subtopics…
              </p>
            ) : scanErr ? (
              <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{scanErr}</div>
            ) : scanMissing.length === 0 ? (
              <p className="text-sm text-slate-500">No obvious gaps found — the {scanStems.length} question(s) here already cover the topic broadly.</p>
            ) : (
              <>
                {scanResumed && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                    <Save className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>Resumed your <b>saved plan</b> for this topic — your list and progress were kept. Use <b>Re-scan</b> below to refresh the gaps.</span>
                  </div>
                )}
                <p className="mb-2 text-sm text-slate-500">
                  These subtopics are <b>not yet covered</b> (in study order). Set the question mix <b>once</b> below and apply it to every subtopic — they're generated <b>one subtopic at a time</b> into a new {kind}. This list is <b>saved automatically</b>, so you can close it and finish later.
                </p>

                {/* Shared question mix — set the type × level counts once, apply to all subtopics. */}
                <div className="mb-2 rounded-xl border border-brand-200 bg-brand-50/40 dark:border-brand-900/40 dark:bg-brand-900/10">
                  <button onClick={() => setMixOpen((o) => !o)} className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold">
                    <span>Question mix for all subtopics{mixTotal(globalMix) > 0 ? ` — ${mixTotal(globalMix)}/subtopic` : ""}</span>
                    <span className="text-slate-400">{mixOpen ? "▾" : "▸"}</span>
                  </button>
                  {mixOpen && (
                    <div className="px-3 pb-3">
                      <div className="grid grid-cols-[1fr_repeat(3,3rem)] items-center gap-x-2 gap-y-1">
                        <span />
                        {GEN_DIFFS.map((d) => <span key={d} className="text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400">{d}</span>)}
                        {GEN_TYPES.map((t) => (
                          <Fragment key={t.id}>
                            <span className="text-xs text-slate-600 dark:text-slate-300">{t.label}</span>
                            {GEN_DIFFS.map((d) => (
                              <input key={d} type="number" min="0" value={globalMix[t.id]?.[d] ?? 0} onChange={(e) => setGlobalType(t.id, d, e.target.value)} className="input !w-12 py-0.5 text-center text-xs" />
                            ))}
                          </Fragment>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">Total <b>{mixTotal(globalMix)}</b> questions per subtopic</span>
                        <button onClick={applyMixToAll} className="btn-primary py-1 text-xs"><Sparkles className="h-3.5 w-3.5" /> Apply to all {scanMissing.length} subtopics</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className={`space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-slate-700 ${scanFull ? "min-h-0 flex-1" : "max-h-72"}`}>
                  {scanMissing.map((m, i) => {
                    const st = seqProgress[m];
                    const cap = Math.max(0, parseInt(scanCounts[i], 10) || 0);
                    const row = scanTypes[i] || {};
                    const alloc = mixTotal(row);
                    const customized = alloc > 0;
                    return (
                      <div key={i} className="border-b border-slate-100 py-1 last:border-0 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                          <span className="text-brand-500">•</span>
                          <span className="flex-1 text-sm">{m}</span>
                          {st?.status === "working" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> generating…</span>
                          ) : (
                            <>
                              {st?.status === "done" && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">✓ {st.count}</span>}
                              {st?.status === "failed" && <span title={st.err} className="cursor-help text-xs font-semibold text-rose-600 dark:text-rose-400">✗ 0</span>}
                              <input
                                type="number" min="0"
                                value={scanCounts[i] ?? 10}
                                onChange={(e) => setScanCounts((c) => ({ ...c, [i]: e.target.value }))}
                                disabled={seqRunning}
                                title="Total questions for this subtopic (max for the type mix)"
                                className="input !w-14 py-1 text-xs"
                              />
                              <button onClick={() => toggleTypeRow(i)} className={`rounded-lg border px-2 py-1 text-xs font-medium ${customized ? "border-brand-500 text-brand-600" : "border-slate-200 text-slate-500 dark:border-slate-700"}`} title="Choose how many of each question type (MCQ, matching, …)">
                                Types{customized ? ` (${alloc})` : ""}
                              </button>
                              <button onClick={() => generateOne(i)} disabled={seqRunning} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50" title="Generate this subtopic now">
                                <Sparkles className="h-3.5 w-3.5" /> {st?.status === "done" || st?.status === "failed" ? "Again" : "Generate"}
                              </button>
                            </>
                          )}
                        </div>
                        {st?.status !== "working" && openTypeRows.has(i) && (
                          <div className="ml-4 mt-1 rounded-lg border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-700 dark:bg-slate-800/40">
                            <div className="mb-1.5 flex items-center justify-between text-xs">
                              <span className="text-slate-500 dark:text-slate-400">Split up to <b>{cap}</b> across types</span>
                              <span className={alloc > cap ? "font-semibold text-rose-600" : "text-slate-500 dark:text-slate-400"}>allocated {alloc} · {Math.max(0, cap - alloc)} left</span>
                            </div>
                            <div className="grid grid-cols-[1fr_repeat(3,3rem)] items-center gap-x-2 gap-y-1">
                              <span />
                              {GEN_DIFFS.map((d) => <span key={d} className="text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400">{d}</span>)}
                              {GEN_TYPES.map((t) => (
                                <Fragment key={t.id}>
                                  <span className="text-xs text-slate-600 dark:text-slate-300">{t.label}</span>
                                  {GEN_DIFFS.map((d) => (
                                    <input
                                      key={d}
                                      type="number" min="0" max={cap}
                                      value={row[t.id]?.[d] ?? 0}
                                      onChange={(e) => setSubType(i, t.id, d, e.target.value)}
                                      className="input !w-12 py-0.5 text-center text-xs"
                                    />
                                  ))}
                                </Fragment>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {scanMissing.length > 0 && (() => {
                  const perSub = (i) => (scanTypes[i] ? mixTotal(scanTypes[i]) : (parseInt(scanCounts[i], 10) || 0));
                  const req = scanMissing.reduce((a, _, i) => a + perSub(i), 0);
                  const gen = Object.values(seqProgress).reduce((a, p) => a + (p.count || 0), 0);
                  const doneN = Object.values(seqProgress).filter((p) => p.status === "done" || p.status === "failed").length;
                  const activeSubs = scanMissing.filter((_, i) => perSub(i) > 0).length;
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-800/40">
                      <span>Total requested: <b>{req}</b></span>
                      <span>Generated so far: <b className="text-emerald-600 dark:text-emerald-400">{gen}</b></span>
                      <span>Subtopics done: <b>{doneN}</b> / {activeSubs}</span>
                    </div>
                  );
                })()}
                {seqLive && (
                  <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs dark:border-brand-900/40 dark:bg-brand-900/10">
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold text-brand-700 dark:text-brand-300">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Now generating: {seqLive.subtopic}
                      <span className="font-normal text-slate-500 dark:text-slate-400">· {seqLive.count} question(s) so far</span>
                    </p>
                    {seqLive.byBucket?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {seqLive.byBucket.map((b, k) => (
                          <span key={k} className={`rounded-full border px-2 py-0.5 ${(b.have || 0) >= (b.want || 0) ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>
                            {(QUESTION_TYPE_LABELS[b.type] || b.type)} · {b.difficulty}: <b>{b.have || 0}</b>/{b.want || 0}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {seqMsg && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{seqMsg}</p>}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {seqRunning ? (
                    <button onClick={cancelSequential} className="btn-outline !text-rose-600 dark:!text-rose-400"><X className="h-4 w-4" /> Cancel &amp; keep</button>
                  ) : (
                    <>
                      <button onClick={() => { persistScan(scanTopic); setSeqMsg("Saved — you can close this and reopen \u201cMissing areas\u201d for this topic any time to resume the list and your progress."); }} className="btn-outline" title="Save this list & progress so you can finish it later"><Save className="h-4 w-4" /> Save</button>
                      <button onClick={() => runScan(scanTopic)} className="btn-outline" title="Scan again for fresh gaps (replaces the saved list)"><ScanSearch className="h-4 w-4" /> Re-scan</button>
                      <button onClick={() => setScanCounts(Object.fromEntries(scanMissing.map((_, i) => [i, 10])))} className="btn-outline">Set all to 10</button>
                      <button onClick={() => { try { navigator.clipboard?.writeText(scanMissing.join(", ")); } catch { /* ignore */ } }} className="btn-outline">Copy list</button>
                      <button onClick={generateFromGaps} className="btn-outline"><Sparkles className="h-4 w-4" /> All-in-one</button>
                      <button onClick={generateSequential} className="btn-primary"><Sparkles className="h-4 w-4" /> Generate per subtopic</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <DuplicatesModal
        open={dupOpen}
        onClose={() => setDupOpen(false)}
        defaultCategory={kind === "quiz" ? "Practice Quiz" : "Practice Test"}
        scope={dupScope.params}
        scopeName={dupScope.name}
        hideSubjectPicker
      />

      {/* Per-quiz migrate modal (My Quiz → My Quiz, or My Quiz → Content) */}
      {migrateItem && (
        <MigrateQuizModal
          quiz={migrateItem}
          clientMode={clientMode}
          onClose={() => setMigrateItem(null)}
          onDone={() => load("items")}
        />
      )}

      {paperFilesItem && (
        <PaperFilesModal
          item={paperFilesItem}
          onClose={() => setPaperFilesItem(null)}
          onSaved={() => { setPaperFilesItem(null); load("items"); }}
        />
      )}

      {/* Bulk-migrate selected topics to another subject */}
      {migrateTopicsOpen && (
        <MigrateTopicsModal
          topics={selectedTopics()}
          onClose={() => setMigrateTopicsOpen(false)}
          onDone={() => { setSelTopics({}); load("topics"); }}
        />
      )}

      {/* Public share-link modal (My Test / Client Test) */}
      {shareEmailTarget && <ShareByEmailModal target={shareEmailTarget} onClose={() => setShareEmailTarget(null)} />}

      {/* Bulk "Send selected": share all ticked streams/subjects/topics/items to another account */}
      {sendSelectedOpen && (
        <ShareByEmailModal
          targets={selectedNodes()}
          onClose={() => setSendSelectedOpen(false)}
        />
      )}

      {shareNode && (
        <ShareNodeModal
          node={shareNode.node}
          level={shareNode.level}
          onClose={() => setShareNode(null)}
          onUpdated={(patch) => {
            setShareNode((s) => (s ? { ...s, node: { ...s.node, ...patch } } : s));
            setItems((list) => list.map((x) => (x._id === shareNode.node._id ? { ...x, ...patch } : x)));
          }}
        />
      )}
      {shareItem && (
        <ShareTestModal
          test={shareItem}
          onClose={() => setShareItem(null)}
          onUpdated={(patch) => {
            setShareItem((s) => (s ? { ...s, ...patch } : s));
            setItems((list) => list.map((x) => (x._id === shareItem._id ? { ...x, ...patch } : x)));
          }}
        />
      )}

      <ExtendExplanationsModal
        open={!!extendItem}
        target={{ testSeries: extendItem?._id }}
        title={`Extend all explanations${extendItem ? ` — ${extendItem.name}` : ""}`}
        onClose={() => setExtendItem(null)}
        onDone={() => { if (qItem) reloadTq(); }}
      />

      <ExtendOneQuestionModal
        open={!!extendOneItem}
        busy={!!extendingQId}
        modelPicker
        onStop={() => extendAbortRef.current?.abort()}
        onCancel={() => setExtendOneItem(null)}
        onConfirm={runExtendOne}
      />

      <RegenerateOneModal
        open={!!regenOneItem}
        question={regenOneItem}
        onClose={() => setRegenOneItem(null)}
        onDone={applyRegenerated}
      />

      <RegenerateAllModal
        open={!!regenAllItem}
        target={{ testSeries: regenAllItem?._id }}
        title={`Regenerate all${regenAllItem ? ` — ${regenAllItem.name}` : ""}`}
        onClose={() => setRegenAllItem(null)}
        onDone={() => { if (qItem) reloadTq(); }}
      />

      {!clientMode && <ScheduleQuestionModal open={!!scheduleQ} question={scheduleQ} onClose={() => setScheduleQ(null)} />}

      {/* Visibility modal */}
      {access && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setAccess(null)}>
          <div onClick={(e) => e.stopPropagation()} className="my-8 w-full max-w-lg animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Visibility — {access.name}</h3>
              <button onClick={() => setAccess(null)}><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <input type="checkbox" checked={access.visibleToAll} onChange={(e) => setAccess({ ...access, visibleToAll: e.target.checked })} className="h-4 w-4 accent-brand-600" />
              <span className="text-sm font-semibold">Visible to everyone</span>
            </label>
            {!access.visibleToAll && (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input className="input pl-9" placeholder="Search students…" value={accessSearch} onChange={(e) => setAccessSearch(e.target.value)} />
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {access.users
                    .filter((u) => (u.name + u.email).toLowerCase().includes(accessSearch.toLowerCase()))
                    .map((u) => (
                      <label key={u._id} className="flex items-center gap-2 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <input
                          type="checkbox"
                          checked={u.visible}
                          onChange={(e) => setAccess({ ...access, users: access.users.map((x) => (x._id === u._id ? { ...x, visible: e.target.checked } : x)) })}
                          className="h-4 w-4 accent-brand-600"
                        />
                        <span className="min-w-0"><span className="text-sm font-medium">{u.name}</span> <span className="text-xs text-slate-400">{u.email}</span></span>
                      </label>
                    ))}
                </div>
              </>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setAccess(null)} className="btn-outline">Cancel</button>
              <button onClick={saveAccess} disabled={accessSaving} className="btn-primary">{accessSaving ? "Saving…" : "Save visibility"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Small add/edit form for stream / subject / item.
function EntityForm({ type, data, kind, saving, onClose, onSave }) {
  const [form, setForm] = useState(() =>
    type === "item"
      ? { name: data.name || "", duration: data.duration || 15, marks: data.marks || 0, difficulty: data.difficulty || "Medium" }
      : { name: data.name || "", description: data.description || "" }
  );
  // Manual subject blueprint for TEST items (subject name + planned count).
  const [composition, setComposition] = useState(() =>
    (data.subjectPlan || []).map((r) => ({ subject: r.subject || "", count: r.count ?? 0 }))
  );
  // Tests AND Previous Papers support a per-subject question plan (subject +
  // planned count) so their Questions modal shows per-subject progress.
  const isTestItem = type === "item" && (kind === "test" || kind === "paper");
  // Previous Papers relabels the levels: subject = Exam, topic = Year, item = Paper.
  const title = type === "item"
    ? (kind === "quiz" ? "Quiz" : kind === "paper" ? "Paper" : "Test")
    : type === "stream" ? "Stream"
    : type === "topic" ? (kind === "paper" ? "Year" : "Topic")
    : (kind === "paper" ? "Exam" : "Subject");

  const submit = (e) => {
    e.preventDefault();
    const payload = { ...form };
    if (isTestItem) {
      payload.subjectPlan = composition
        .filter((r) => r.subject?.trim())
        .map((r) => ({ subject: r.subject.trim(), count: parseInt(r.count, 10) || 0 }));
    }
    onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="my-8 w-full max-w-md animate-scale-in card p-6">
        <div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold">{data._id ? "Edit" : "Add"} {title}</h3><button type="button" onClick={onClose}><X className="h-5 w-5" /></button></div>
        <div className="space-y-4">
          <div><label className="mb-1.5 block text-sm font-medium">Name</label><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          {type !== "item" ? (
            <div><label className="mb-1.5 block text-sm font-medium">Description (optional)</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Duration (min)</label><input type="number" className="input" value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Marks</label><input type="number" className="input" value={form.marks} onChange={(e) => setForm({ ...form, marks: Number(e.target.value) })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Difficulty</label><select className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}><option>Easy</option><option>Medium</option><option>Hard</option></select></div>
            </div>
          )}
          {isTestItem && (
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <label className="mb-1 block text-sm font-semibold">Subjects &amp; questions per subject (optional)</label>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                Type your subjects and how many questions each. Afterwards, tap the {title.toLowerCase()} → tap a subject to add
                questions (up to its limit).
              </p>
              <SubjectPlanEditor rows={composition} onChange={setComposition} />
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="btn-outline">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save"}</button></div>
      </form>
    </div>
  );
}
