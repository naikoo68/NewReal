import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Eye, EyeOff, X, CalendarClock, Users, Search, Upload, HelpCircle, ChevronRight, GraduationCap, Briefcase, Copy, Download, Sparkles, Globe, Library, Scale, Share2 } from "lucide-react";
import { testService, contentService, examService, aiService } from "../../services";
import { loadNav, saveNav } from "../../lib/navState";
import Badge from "../../components/ui/Badge";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";
import BulkUploadQuestions, { questionsToCsv } from "../../components/admin/BulkUploadQuestions";
import AiGenerate from "../../components/admin/AiGenerate";
import AiImport from "../../components/admin/AiImport";
import SubjectPlanEditor from "../../components/admin/SubjectPlanEditor";
import PickFromBank from "../../components/admin/PickFromBank";
import WeightageFill from "../../components/admin/WeightageFill";
import AutoBuildTest from "../../components/admin/AutoBuildTest";
import DuplicatesModal from "../../components/admin/DuplicatesModal";
import { Files, Maximize2, Minimize2, Loader2, CheckCircle2, Wand2 } from "lucide-react";
import QuestionFormModal from "../../components/admin/QuestionFormModal";
import QuestionView from "../../components/admin/QuestionView";
import QuestionTypeFilter from "../../components/admin/QuestionTypeFilter";
import QuestionStatusFilter, { filterByStatus } from "../../components/admin/QuestionStatusFilter";
import QuestionSubjectFilter, { filterBySubject } from "../../components/admin/QuestionSubjectFilter";
import { questionTypeKey, QUESTION_TYPE_LABELS } from "../../lib/questions";
import ManageTestQuestions from "../../components/admin/ManageTestQuestions";
import ShareTestModal from "../../components/admin/ShareTestModal";
import ExtendExplanationsModal from "../../components/admin/ExtendExplanationsModal";
import ExtendOneQuestionModal from "../../components/admin/ExtendOneQuestionModal";
import RegenerateAllModal from "../../components/admin/RegenerateAllModal";
import RegenerateOneModal from "../../components/admin/RegenerateOneModal";
import ScheduleQuestionModal from "../../components/admin/ScheduleQuestionModal";

const blank = { name: "", category: "Full-Length", marks: 100, duration: 60, schedule: "", status: "draft", difficulty: "Medium" };
const categories = ["Full-Length", "Subject-wise", "Chapter-wise", "Previous Year"];
// Subject names from a test's typed plan (for the "Add to subject" selectors).
const sectionsOf = (t) => (t?.subjectPlan || []).map((p) => p.subject).filter(Boolean);

const NAV_KEY = "mpm-admin-tests-nav"; // remembers drill-down position across refreshes

export default function AdminTests() {
  // Drill-down: exams → posts → tests. Restored from sessionStorage so a refresh
  // keeps you at the same level (e.g. inside a post) instead of jumping to Exams.
  const [view, setView] = useState(() => loadNav(NAV_KEY).view || "exams"); // exams | posts | tests
  const [exam, setExam] = useState(() => loadNav(NAV_KEY).exam || null);
  const [post, setPost] = useState(() => loadNav(NAV_KEY).post || null);
  const [list, setList] = useState([]); // exams or posts at the current level

  // Exam/Post add-edit modal
  const [epModal, setEpModal] = useState(null); // { type: "exam"|"post", mode, data }
  const [epForm, setEpForm] = useState({ name: "", description: "", order: 1 });
  const [epSaving, setEpSaving] = useState(false);

  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  // "Manage access" panel (per-user visibility & validity for a test)
  const [accessTest, setAccessTest] = useState(null);
  const [access, setAccess] = useState(null); // { visibleToAll, users: [...] }
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  // Bulk-upload-questions-to-a-test state
  const [bulkTest, setBulkTest] = useState(null);
  const [aiTest, setAiTest] = useState(null); // AI-generate questions for a test
  const [importTest, setImportTest] = useState(null); // import-from-web questions for a test
  const [bankTest, setBankTest] = useState(null); // manual pick-from-bank for a test
  const [weightTest, setWeightTest] = useState(null); // auto-fill by subject (weightage)
  const [autoTest, setAutoTest] = useState(null); // auto-build by subject/topic/type/difficulty blueprint
  const [dupTest, setDupTest] = useState(null); // find-duplicates within a test
  const [shareTest, setShareTest] = useState(null); // public share-link modal target
  const [extendTest, setExtendTest] = useState(null); // AI extend-explanations target
  const [extendingQId, setExtendingQId] = useState(null); // per-question extend in progress
  const [extendOneItem, setExtendOneItem] = useState(null); // per-question extend confirm modal target
  const [regenId] = useState(null); // legacy inline spinner id — regenerate now runs in RegenerateOneModal
  const [regenOneItem, setRegenOneItem] = useState(null); // per-question regenerate dialog target
  const [regenAllTest, setRegenAllTest] = useState(null); // bulk "regenerate all" modal target
  const [scheduleQ, setScheduleQ] = useState(null); // question to post/schedule to Facebook

  // Manual subject plan (typed) for the create/edit popup
  const [composition, setComposition] = useState([]);

  // Manage-questions state
  const [qTest, setQTest] = useState(null); // test whose questions we're editing
  const [tq, setTq] = useState([]); // its questions
  const [tqLoading, setTqLoading] = useState(false);
  const [tqModal, setTqModal] = useState(null); // { mode, data, forceSection }
  const [tqSaving, setTqSaving] = useState(false);
  const [viewQ, setViewQ] = useState(null); // single question preview
  const [viewFull, setViewFull] = useState(true); // single-question viewer opens full-screen (toggle to shrink)
  const [viewAllQ, setViewAllQ] = useState(false); // all questions preview
  const [studentView, setStudentView] = useState(true); // View All: defaults to student view (answers hidden)
  const [reopenAfterEdit, setReopenAfterEdit] = useState(null); // question _id to reopen in the preview after editing it there
  const [typeFilter, setTypeFilter] = useState([]); // View All: which question types to show ([] = all)
  const [statusFilter, setStatusFilter] = useState("all"); // View All: updated/not_updated/all
  const [subjectFilter, setSubjectFilter] = useState(""); // View All: which subject/section to show ("" = all)
  const [delProgress, setDelProgress] = useState(null); // real-time delete-by-type progress: { total, done }


  const openQuestions = async (t) => {
    setQTest(t);
    setTq([]);
    setTqLoading(true);
    try {
      setTq(await testService.getQuestions(t._id));
    } catch (e) {
      setError(e.message);
      setQTest(null);
    } finally {
      setTqLoading(false);
    }
  };

  const reloadTq = async () => {
    try { setTq(await testService.getQuestions(qTest._id)); } catch { /* ignore */ }
  };
  // Run the per-question extend once confirmed in the modal.
  const runExtendOne = async ({ fixOptions, extendQuestion, shuffleOptions } = {}) => {
    const item = extendOneItem;
    if (!item) return;
    setExtendingQId(item._id);
    try {
      const updated = await aiService.extendOne({ questionId: item._id, fixOptions, extendQuestion, shuffleOptions });
      setViewQ((prev) => (prev && prev._id === item._id ? { ...prev, ...updated } : prev));
      setExtendOneItem(null);
      await reloadTq();
    } catch (e) { setError(e.message); setExtendOneItem(null); }
    finally { setExtendingQId(null); }
  };
  // Regenerate ONE question: open the dialog (rebuild toggles + AI source/model);
  // the modal runs the request itself and hands back the updated fields.
  const regenerateQ = (item) => setRegenOneItem(item);

  // Apply a single-question regenerate result to the open preview + reload.
  const applyRegenerated = async (updated) => {
    const item = regenOneItem;
    if (item) setViewQ((prev) => (prev && prev._id === item._id ? { ...prev, ...updated } : prev));
    setRegenOneItem(null);
    await reloadTq();
  };

  // Copy a test's questions as CSV text to the clipboard.
  const copyCsv = async (questions) => {
    if (!questions?.length) return;
    try {
      await navigator.clipboard.writeText(questionsToCsv(questions));
      window.alert(`Copied ${questions.length} question(s) as CSV to the clipboard.`);
    } catch {
      window.alert("Couldn't access the clipboard — use “Download CSV” instead.");
    }
  };

  // Download a test's questions as a .csv file.
  const downloadCsv = (questions, name) => {
    if (!questions?.length) return;
    const url = URL.createObjectURL(new Blob([questionsToCsv(questions)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${String(name || "test").replace(/[^\w-]+/g, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const saveTestQuestion = async (payload) => {
    setTqSaving(true);
    try {
      if (tqModal.mode === "add") await testService.addQuestion(qTest._id, payload);
      else await contentService.updateQuestion(tqModal.data._id, payload);
      await reloadTq();
      load(); // refresh question counts in the table
      setTqModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setTqSaving(false);
    }
  };

  const removeTq = async (qid) => {
    if (!window.confirm("Delete this question from the test?")) return;
    try {
      await testService.deleteQuestion(qTest._id, qid);
      await reloadTq();
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  // Bulk-delete the "View all" questions matching the active TYPE filter (or
  // every question when no type is selected) — delete a whole type at once.
  const deleteByType = async () => {
    if (delProgress || !qTest) return;
    // Delete exactly what's currently SHOWN — respect the Type, Subject and
    // Status filters together so the count on the button matches the action.
    const targets = filterBySubject(
      filterByStatus(tq.filter((it) => !typeFilter.length || typeFilter.includes(questionTypeKey(it))), statusFilter),
      subjectFilter
    );
    const ids = targets.map((q) => q._id);
    if (!ids.length) return;
    const scope = [
      typeFilter.length ? typeFilter.map((t) => QUESTION_TYPE_LABELS[t] || t).join(", ") : "all types",
      subjectFilter ? `subject "${subjectFilter}"` : null,
      statusFilter === "updated" ? "updated only" : statusFilter === "not_updated" ? "not-updated only" : null,
    ].filter(Boolean).join(", ");
    if (!window.confirm(`Delete ${ids.length} question(s) (${scope}) from this test? This cannot be undone.`)) return;
    const before = tq.length;
    setDelProgress({ total: ids.length, done: 0 });
    try {
      let done = 0;
      for (const id of ids) {
        await testService.deleteQuestion(qTest._id, id);
        setDelProgress({ total: ids.length, done: ++done });
      }
      await reloadTq();
      load();
      setDelProgress({ total: ids.length, done: ids.length, finished: true, remaining: Math.max(0, before - ids.length) });
      setTimeout(() => setDelProgress(null), 5000);
    } catch (e) {
      setError(e.message);
      setDelProgress(null);
    }
  };

  const openAccess = async (t) => {
    setAccessTest(t);
    setAccess(null);
    setUserSearch("");
    setAccessLoading(true);
    try {
      setAccess(await testService.getAccess(t._id));
    } catch (e) {
      setError(e.message);
      setAccessTest(null);
    } finally {
      setAccessLoading(false);
    }
  };

  const saveAccess = async () => {
    if (!access) return;
    setAccessSaving(true);
    try {
      await testService.updateAccess(accessTest._id, {
        visibleToAll: access.visibleToAll,
        users: access.users.map((u) => ({ user: u._id, visible: u.visible, validUntil: u.validUntil })),
      });
      setAccessTest(null);
      setAccess(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setAccessSaving(false);
    }
  };

  const load = () => {
    setLoading(true);
    setError("");
    const req =
      view === "exams"
        ? examService.exams().then(setList)
        : view === "posts"
        ? examService.posts(exam._id).then(setList)
        : testService.adminList(post?._id).then(setTests);
    req.catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  // Reload whenever the drill-down level changes.
  useEffect(load, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember the current drill-down position so a page refresh restores it.
  useEffect(() => {
    saveNav(NAV_KEY, { view, exam, post });
  }, [view, exam, post]);

  // After editing a question opened from the single-question preview, reopen the
  // preview on that (now-reloaded, updated) question so you land back on it.
  useEffect(() => {
    if (!reopenAfterEdit) return;
    const q = (tq || []).find((x) => x._id === reopenAfterEdit);
    if (q) { setViewQ(q); setReopenAfterEdit(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tq]);

  // Navigation
  const openExam = (e) => { setExam(e); setPost(null); setView("posts"); };
  const openPost = (p) => { setPost(p); setView("tests"); };
  const goTo = (level) => setView(level);

  // Exam / Post add-edit
  const openEpAdd = () => {
    setEpForm({ name: "", description: "", order: 1 });
    setEpModal({ type: view === "exams" ? "exam" : "post", mode: "add" });
  };
  const openEpEdit = (item) => {
    setEpForm({ name: item.name, description: item.description || "", order: item.order || 1 });
    setEpModal({ type: view === "exams" ? "exam" : "post", mode: "edit", data: item });
  };
  const saveEp = async (e) => {
    e.preventDefault();
    setEpSaving(true);
    try {
      const { type, mode, data } = epModal;
      if (type === "exam") {
        if (mode === "add") await examService.createExam(epForm);
        else await examService.updateExam(data._id, epForm);
      } else {
        if (mode === "add") await examService.createPost({ ...epForm, exam: exam._id });
        else await examService.updatePost(data._id, epForm);
      }
      setEpModal(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setEpSaving(false);
    }
  };
  const removeEp = async (item) => {
    const isExam = view === "exams";
    if (!window.confirm(`Delete "${item.name}"? ${isExam ? "Its posts are removed and its tests detached." : "Its tests are detached."}`)) return;
    try {
      if (isExam) await examService.deleteExam(item._id);
      else await examService.deletePost(item._id);
      setList((l) => l.filter((x) => x._id !== item._id));
    } catch (e) {
      setError(e.message);
    }
  };

  const openCreate = () => {
    setForm(blank);
    setEditing(null);
    setComposition([]);
    setModal(true);
  };

  const openEdit = (t) => {
    setForm({
      name: t.name,
      category: t.category,
      marks: t.marks,
      duration: t.duration,
      difficulty: t.difficulty || "Medium",
      status: t.status,
      schedule: t.schedule ? new Date(t.schedule).toISOString().slice(0, 10) : "",
    });
    setComposition((t.subjectPlan || []).map((r) => ({ subject: r.subject || "", count: r.count ?? 0 })));
    setEditing(t);
    setModal(true);
  };

  const togglePublish = async (t) => {
    try {
      const res = await testService.togglePublish(t._id);
      setTests((list) => list.map((x) => (x._id === t._id ? { ...x, status: res.status } : x)));
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this test series?")) return;
    try {
      await testService.remove(id);
      setTests((list) => list.filter((x) => x._id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  // ---- Bulk delete of the current level (exams / posts / tests) ----
  const [selRows, setSelRows] = useState([]); // ticked row ids at the current level
  const [delRowBusy, setDelRowBusy] = useState(null); // { done, total } while deleting
  useEffect(() => { setSelRows([]); }, [view, exam?._id, post?._id]);
  const currentList = view === "tests" ? tests : list;
  const toggleRow = (id) => setSelRows((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allRowsSelected = currentList.length > 0 && selRows.length === currentList.length;
  const toggleAllRows = () => setSelRows(allRowsSelected ? [] : currentList.map((i) => i._id));
  const deleteSelectedRows = async () => {
    if (!selRows.length || delRowBusy) return;
    const noun = view === "exams" ? "exam" : view === "posts" ? "post" : "test";
    const total = selRows.length;
    if (!window.confirm(`Delete ${total} selected ${noun}${total === 1 ? "" : "s"}? ${view !== "tests" ? "Everything inside is removed/detached. " : ""}This cannot be undone.`)) return;
    setDelRowBusy({ done: 0, total });
    setError("");
    try {
      let done = 0;
      for (const id of selRows) {
        if (view === "exams") await examService.deleteExam(id);
        else if (view === "posts") await examService.deletePost(id);
        else await testService.remove(id);
        setDelRowBusy({ done: ++done, total });
      }
      const del = new Set(selRows);
      if (view === "tests") setTests((l) => l.filter((x) => !del.has(x._id)));
      else setList((l) => l.filter((x) => !del.has(x._id)));
      setSelRows([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setDelRowBusy(null);
    }
  };
  // Reusable toolbar shown above each level's list (a JSX element, not a nested
  // component, so it doesn't remount on every render).
  const bulkBar = (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-2 dark:border-slate-700">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={allRowsSelected} onChange={toggleAllRows} className="h-4 w-4 accent-brand-600" /> Select all
      </label>
      {(selRows.length > 0 || delRowBusy) && (
        delRowBusy ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Deleting {delRowBusy.done} of {delRowBusy.total}…
          </span>
        ) : (
          <>
            <span className="text-sm text-slate-500">{selRows.length} selected</span>
            <button onClick={deleteSelectedRows} className="btn-outline py-1.5 text-rose-600"><Trash2 className="h-4 w-4" /> Delete selected</button>
            <button onClick={() => setSelRows([])} className="text-sm text-slate-500 hover:underline">Clear</button>
          </>
        )
      )}
      <span className="ml-auto text-xs text-slate-400">Tick to delete several at once</span>
    </div>
  );

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Manual subject blueprint (typed) — saved as a plan/guide, no auto-pull.
      const subjectPlan = composition
        .filter((r) => r.subject?.trim())
        .map((r) => ({ subject: r.subject.trim(), count: parseInt(r.count, 10) || 0 }));
      const payload = { ...form, subjectPlan };
      if (!payload.schedule) delete payload.schedule;
      if (editing) {
        const updated = await testService.update(editing._id, payload);
        setTests((prev) => prev.map((x) => (x._id === editing._id ? { ...x, ...updated, questionCount: x.questionCount } : x)));
      } else {
        // New tests belong to the current exam + post. Add questions afterwards
        // (manually, from the bank / bulk / one-by-one).
        const created = await testService.create({ ...payload, exam: exam?._id, post: post?._id });
        setTests((prev) => [{ ...created, questionCount: 0 }, ...prev]);
      }
      setModal(false);
      setForm(blank);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const statusVariant = (s) => (s === "published" ? "brand" : s === "scheduled" ? "accent" : "neutral");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Test Series Management</h1>
          <p className="text-slate-500 dark:text-slate-400">Exam → Post → Category → Tests. Manage each level here.</p>
        </div>
        {view === "tests" ? (
          <button onClick={openCreate} className="btn-primary"><Plus className="h-4 w-4" /> Create Test</button>
        ) : (
          <button onClick={openEpAdd} className="btn-primary"><Plus className="h-4 w-4" /> {view === "exams" ? "Add Exam" : "Add Post"}</button>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="card px-4 py-3">
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <button onClick={() => goTo("exams")} className={`rounded px-2 py-1 font-medium ${view === "exams" ? "text-brand-600" : "text-slate-500 hover:text-brand-600"}`}>Exams</button>
          {exam && view !== "exams" && (<>
            <ChevronRight className="h-4 w-4 text-slate-400" />
            <button onClick={() => goTo("posts")} className={`rounded px-2 py-1 font-medium ${view === "posts" ? "text-brand-600" : "text-slate-500 hover:text-brand-600"}`}>{exam.name}</button>
          </>)}
          {post && view === "tests" && (<>
            <ChevronRight className="h-4 w-4 text-slate-400" />
            <span className="rounded px-2 py-1 font-medium text-brand-600">{post.name}</span>
          </>)}
        </nav>
      </div>

      {loading ? (
        <Loading label={`Loading ${view}...`} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : view !== "tests" ? (
        list.length === 0 ? (
          <EmptyState message={view === "exams" ? 'No exams yet. Click "Add Exam".' : 'No posts yet. Click "Add Post".'} />
        ) : (
          <div className="space-y-3">
            {bulkBar}
            {list.map((item) => (
              <div
                key={item._id}
                onClick={() => (view === "exams" ? openExam(item) : openPost(item))}
                className="card flex cursor-pointer items-center justify-between gap-3 p-4 transition hover:border-brand-300 dark:hover:border-brand-600"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <input type="checkbox" checked={selRows.includes(item._id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleRow(item._id)} className="h-4 w-4 flex-shrink-0 accent-brand-600" title="Select to delete" />
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                    {view === "exams" ? <GraduationCap className="h-5 w-5" /> : <Briefcase className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-slate-400">{view === "exams" ? `${item.posts ?? 0} posts` : `${item.tests ?? 0} tests`}</p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => (view === "exams" ? openExam(item) : openPost(item))} className="btn-outline py-2">Manage <ChevronRight className="h-4 w-4" /></button>
                  <button onClick={() => openEpEdit(item)} title="Edit" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => removeEp(item)} title="Delete" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : tests.length === 0 ? (
        <EmptyState message="No tests in this post yet. Click Create Test, or use Bulk Upload after creating one." />
      ) : (
        <div className="space-y-3">
          {bulkBar}
          <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800/60">
              <tr>
                <th className="w-8 px-3 py-3"><input type="checkbox" checked={allRowsSelected} onChange={toggleAllRows} className="h-4 w-4 accent-brand-600" /></th>
                <th className="px-5 py-3 font-semibold">Test Name</th>
                <th className="px-5 py-3 font-semibold">Category</th>
                <th className="px-5 py-3 font-semibold">Questions</th>
                <th className="px-5 py-3 font-semibold">Marks</th>
                <th className="px-5 py-3 font-semibold">Duration</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {tests.map((t) => (
                <tr key={t._id} onClick={() => openQuestions(t)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selRows.includes(t._id)} onChange={() => toggleRow(t._id)} className="h-4 w-4 accent-brand-600" />
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-left font-medium text-brand-600 dark:text-brand-400">
                      {t.name}
                    </span>
                  </td>
                  <td className="px-5 py-3">{t.category}</td>
                  <td className="px-5 py-3">{t.questionCount}</td>
                  <td className="px-5 py-3">{t.marks}</td>
                  <td className="px-5 py-3">{t.duration} min</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                      <span className={`text-[10px] font-semibold ${t.visibleToAll ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {t.visibleToAll ? "Visible to all" : "Restricted"}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => togglePublish(t)}
                        title={t.status === "published" ? "Unpublish" : "Publish"}
                        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        {t.status === "published" ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <button onClick={() => openQuestions(t)} title="Manage questions" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                        <HelpCircle className="h-4 w-4" />
                      </button>
                      <button onClick={() => setBulkTest(t)} title="Bulk upload questions" className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30">
                        <Upload className="h-4 w-4" />
                      </button>
                      <button onClick={() => setAiTest(t)} title="Generate questions with AI" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                        <Sparkles className="h-4 w-4" />
                      </button>
                      <button onClick={() => setImportTest(t)} title="Import questions from web" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                        <Globe className="h-4 w-4" />
                      </button>
                      <button onClick={() => setBankTest(t)} title="Add questions from quizzes / practice (hand-pick)" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                        <Library className="h-4 w-4" />
                      </button>
                      <button onClick={() => setWeightTest(t)} title="Add by subject (weightage) — auto-pull N questions per subject" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                        <Scale className="h-4 w-4" />
                      </button>
                      <button onClick={() => setAutoTest(t)} title="Auto-build — pick questions by subject, topic, type & difficulty" className="rounded-lg p-2 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/30">
                        <Wand2 className="h-4 w-4" />
                      </button>

                      <button onClick={() => setDupTest(t)} title="Find duplicate questions in this test" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                        <Files className="h-4 w-4" />
                      </button>
                      <button onClick={() => setShareTest(t)} title="Share public link (no login needed)" className={`rounded-lg p-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 ${t.publicShare ? "text-emerald-600" : "text-slate-500"}`}>
                        <Share2 className="h-4 w-4" />
                      </button>
                      <button onClick={() => openAccess(t)} title="Manage user access" className="rounded-lg p-2 text-accent-600 hover:bg-accent-50 dark:hover:bg-accent-900/30">
                        <Users className="h-4 w-4" />
                      </button>
                      <button onClick={() => openEdit(t)} title="Edit" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => remove(t._id)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Add / edit Exam or Post */}
      {epModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <form onSubmit={saveEp} className="my-8 w-full max-w-md animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{epModal.mode === "add" ? "Add" : "Edit"} {epModal.type === "exam" ? "Exam" : "Post"}</h3>
              <button type="button" onClick={() => setEpModal(null)}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">{epModal.type === "exam" ? "Exam name" : "Post name"}</label>
                <input required className="input" value={epForm.name} onChange={(e) => setEpForm({ ...epForm, name: e.target.value })} placeholder={epModal.type === "exam" ? "e.g. JKSSB" : "e.g. Finance Account Assistant"} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Description (optional)</label>
                <textarea rows={2} className="input resize-none" value={epForm.description} onChange={(e) => setEpForm({ ...epForm, description: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Order</label>
                <input type="number" className="input" value={epForm.order} onChange={(e) => setEpForm({ ...epForm, order: +e.target.value })} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEpModal(null)} className="btn-outline">Cancel</button>
              <button type="submit" disabled={epSaving} className="btn-primary">{epSaving ? "Saving..." : "Save"}</button>
            </div>
          </form>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-lg animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{editing ? "Edit Test Series" : "Create Test Series"}</h3>
              <button onClick={() => setModal(false)}><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={save} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Test Name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="e.g. JEE Main Full Mock 2" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input">
                    {categories.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Difficulty</label>
                  <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} className="input">
                    <option>Easy</option><option>Medium</option><option>Hard</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Marks</label>
                  <input type="number" value={form.marks} onChange={(e) => setForm({ ...form, marks: +e.target.value })} className="input" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Duration (min)</label>
                  <input type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: +e.target.value })} className="input" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Schedule Date</label>
                  <div className="relative">
                    <CalendarClock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input type="date" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} className="input pl-9" />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input">
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="published">Published</option>
                  </select>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <label className="mb-1 block text-sm font-semibold">Subjects &amp; questions per subject (optional)</label>
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                  Type your subjects and how many questions each — this is a plan/guide for the test. You add the actual
                  questions afterwards.
                </p>
                <SubjectPlanEditor rows={composition} onChange={setComposition} />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                After creating, add questions with <b>Add from Quizzes/Practice</b> (hand-pick), <b>Manage questions</b>
                (one by one), <b>Bulk upload</b>, <b>Generate with AI</b>, or <b>Import from Web</b> on the test row.
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModal(false)} className="btn-outline">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : editing ? "Save Changes" : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage user access modal */}
      {accessTest && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-lg animate-scale-in card p-6">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-bold">User Access</h3>
              <button type="button" onClick={() => setAccessTest(null)}><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{accessTest.name}</p>

            {accessLoading || !access ? (
              <Loading label="Loading users..." />
            ) : (
              <div className="space-y-4">
                {/* Visible-to-all master toggle */}
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div>
                    <p className="text-sm font-medium">Visible to everyone by default</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">When off, only users marked visible below can see this test.</p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={access.visibleToAll}
                    onChange={(e) => {
                      const on = e.target.checked;
                      // Reflect the master toggle on every user row (select / deselect all).
                      setAccess({ ...access, visibleToAll: on, users: access.users.map((u) => ({ ...u, visible: on })) });
                    }}
                  />
                </label>

                {access.users.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">No student accounts yet.</p>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search users..." className="input pl-9" />
                    </div>
                    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                      {access.users
                        .filter((u) => u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase()))
                        .map((u) => {
                          const i = access.users.indexOf(u);
                          return (
                            <div key={u._id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{u.name}</p>
                                  <p className="truncate text-xs text-slate-400">{u.email}</p>
                                </div>
                                <label className="inline-flex flex-shrink-0 cursor-pointer items-center gap-2 text-xs font-medium">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-accent-600"
                                    checked={u.visible}
                                    onChange={(e) => setAccess({ ...access, users: access.users.map((x, xi) => xi === i ? { ...x, visible: e.target.checked } : x) })}
                                  />
                                  {u.visible ? "Visible" : "Hidden"}
                                </label>
                              </div>
                              {u.visible && (
                                <div className="mt-2 flex items-center gap-2">
                                  <span className="text-xs text-slate-500 dark:text-slate-400">Valid until</span>
                                  <input
                                    type="date"
                                    className="input h-8 py-1 text-xs"
                                    value={u.validUntil ? new Date(u.validUntil).toISOString().slice(0, 10) : ""}
                                    onChange={(e) => setAccess({ ...access, users: access.users.map((x, xi) => xi === i ? { ...x, validUntil: e.target.value ? new Date(e.target.value).toISOString() : null } : x) })}
                                  />
                                  {u.validUntil ? (
                                    <button type="button" onClick={() => setAccess({ ...access, users: access.users.map((x, xi) => xi === i ? { ...x, validUntil: null } : x) })} className="text-xs text-slate-400 hover:text-rose-600">clear</button>
                                  ) : (
                                    <span className="text-xs text-slate-400">(no limit)</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </>
                )}

                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setAccessTest(null)} className="btn-outline">Cancel</button>
                  <button type="button" onClick={saveAccess} disabled={accessSaving} className="btn-primary">{accessSaving ? "Saving..." : "Save Access"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Public share-link modal */}
      {shareTest && (
        <ShareTestModal
          test={shareTest}
          onClose={() => setShareTest(null)}
          onUpdated={(patch) => {
            setShareTest((s) => (s ? { ...s, ...patch } : s));
            setTests((list) => list.map((x) => (x._id === shareTest._id ? { ...x, ...patch } : x)));
          }}
        />
      )}

      <ExtendExplanationsModal
        open={!!extendTest}
        target={{ testSeries: extendTest?._id }}
        title={`Extend all explanations${extendTest ? ` — ${extendTest.name}` : ""}`}
        onClose={() => setExtendTest(null)}
        onDone={() => { if (qTest) reloadTq(); }}
      />

      <ExtendOneQuestionModal
        open={!!extendOneItem}
        busy={!!extendingQId}
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
        open={!!regenAllTest}
        target={{ testSeries: regenAllTest?._id }}
        title={`Regenerate all${regenAllTest ? ` — ${regenAllTest.name}` : ""}`}
        onClose={() => setRegenAllTest(null)}
        onDone={() => { if (qTest) reloadTq(); }}
      />

      <ScheduleQuestionModal open={!!scheduleQ} question={scheduleQ} onClose={() => setScheduleQ(null)} />

      <BulkUploadQuestions
        open={!!bulkTest}
        title={`Bulk Upload Questions${bulkTest ? ` — ${bulkTest.name}${bulkTest._forceSection ? ` (${bulkTest._forceSection})` : ""}` : ""}`}
        sections={sectionsOf(bulkTest)}
        defaultSection={bulkTest?._forceSection && bulkTest._forceSection !== "__unassigned__" ? bulkTest._forceSection : ""}
        onClose={() => { setBulkTest(null); if (qTest) reloadTq(); }}
        onUpload={async (questions, opts = {}) => {
          const section = opts.section || (bulkTest?._forceSection && bulkTest._forceSection !== "__unassigned__" ? bulkTest._forceSection : "");
          if (opts.replace) {
            const existing = await testService.getQuestions(bulkTest._id);
            for (const q of existing) await testService.deleteQuestion(bulkTest._id, q._id);
          }
          const res = await contentService.bulkQuestions(questions, { testSeries: bulkTest._id, section });
          load(); // refresh question counts
          if (qTest) reloadTq();
          return res;
        }}
      />

      <AiGenerate
        open={!!aiTest}
        title={`Generate with AI${aiTest ? ` — ${aiTest.name}${aiTest._forceSection ? ` (${aiTest._forceSection})` : ""}` : ""}`}
        sections={sectionsOf(aiTest)}
        defaultSection={aiTest?._forceSection && aiTest._forceSection !== "__unassigned__" ? aiTest._forceSection : ""}
        onClose={() => { setAiTest(null); if (qTest) reloadTq(); }}
        onUpload={async (questions, opts = {}) => {
          const section = opts.section || (aiTest?._forceSection && aiTest._forceSection !== "__unassigned__" ? aiTest._forceSection : "");
          const res = await contentService.bulkQuestions(questions, { testSeries: aiTest._id, section });
          load(); // refresh question counts
          if (qTest) reloadTq();
          return res;
        }}
      />

      <AiImport
        open={!!importTest}
        title={`Import from Web${importTest ? ` — ${importTest.name}${importTest._forceSection ? ` (${importTest._forceSection})` : ""}` : ""}`}
        sections={sectionsOf(importTest)}
        defaultSection={importTest?._forceSection && importTest._forceSection !== "__unassigned__" ? importTest._forceSection : ""}
        onClose={() => { setImportTest(null); if (qTest) reloadTq(); }}
        onUpload={async (questions, opts = {}) => {
          const section = opts.section || (importTest?._forceSection && importTest._forceSection !== "__unassigned__" ? importTest._forceSection : "");
          const res = await contentService.bulkQuestions(questions, { testSeries: importTest._id, section });
          load();
          if (qTest) reloadTq();
          return res;
        }}
      />

      <PickFromBank
        open={!!bankTest}
        testId={bankTest?._id}
        plan={bankTest?.subjectPlan || []}
        defaultSection={bankTest?._forceSection && bankTest._forceSection !== "__unassigned__" ? bankTest._forceSection : ""}
        title={`Add from Quizzes / Practice${bankTest ? ` — ${bankTest.name}${bankTest._forceSection ? ` (${bankTest._forceSection})` : ""}` : ""}`}
        onClose={() => { setBankTest(null); if (qTest) reloadTq(); }}
        onDone={() => { load(); if (qTest) reloadTq(); }}
      />

      <WeightageFill
        open={!!weightTest}
        testId={weightTest?._id}
        includeQuizBank
        title={`Add by subject (weightage)${weightTest ? ` — ${weightTest.name}` : ""}`}
        onClose={() => setWeightTest(null)}
        onDone={() => load()}
      />

      <AutoBuildTest
        open={!!autoTest}
        testId={autoTest?._id}
        testName={autoTest?.name || ""}
        plan={autoTest?.subjectPlan || []}
        onClose={() => { setAutoTest(null); if (qTest) reloadTq(); }}
        onDone={() => { load(); if (qTest) reloadTq(); }}
      />

      <DuplicatesModal
        open={!!dupTest}
        scope={dupTest ? { testSeries: dupTest._id } : null}
        scopeName={dupTest?.name || ""}
        hideSubjectPicker
        onClose={() => { setDupTest(null); load(); if (qTest) reloadTq(); }}
      />

      {/* Manage questions modal */}
      {qTest && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-2xl animate-scale-in card p-6">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-bold">Questions</h3>
              <button onClick={() => setQTest(null)}><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{qTest.name}</p>

            <ManageTestQuestions
              qTest={qTest}
              tq={tq}
              tqLoading={tqLoading}
              onClose={() => setQTest(null)}
              onAddQuestion={(subject) => setTqModal({ mode: "add", data: null, forceSection: subject })}
              onEditQuestion={(item) => setTqModal({ mode: "edit", data: item })}
              onDeleteQuestion={removeTq}
              onDeleteSelected={async (ids, onProgress) => {
                let done = 0;
                for (const id of ids) {
                  await testService.deleteQuestion(qTest._id, id);
                  onProgress?.(++done); // real-time progress in the modal
                }
                await reloadTq();
                load();
              }}
              onViewQuestion={setViewQ}
              onViewAll={() => { setTypeFilter([]); setStatusFilter("all"); setSubjectFilter(""); setViewAllQ(true); }}
              onDuplicates={() => setDupTest(qTest)}
              onCopyCsv={copyCsv}
              onDownloadCsv={(qs) => downloadCsv(qs, qTest?.name || "test")}
              onBulkUpload={(subject) => { setBulkTest({ ...qTest, _forceSection: subject }); }}
              onAiGenerate={(subject) => { setAiTest({ ...qTest, _forceSection: subject }); }}
              onImportWeb={(subject) => { setImportTest({ ...qTest, _forceSection: subject }); }}
              onPickFromBank={(subject) => { setBankTest({ ...qTest, _forceSection: subject }); }}
              onExtendExplanations={() => setExtendTest(qTest)}
              onExtendQuestion={(item) => setExtendOneItem(item)}
              extendingId={extendingQId}
              onRegenerateQuestion={(item) => regenerateQ(item)}
              regeneratingId={regenId}
              onRegenerateAll={() => setRegenAllTest(qTest)}
            />
          </div>
        </div>
      )}
      {tqModal && (
        <QuestionFormModal
          key={tqModal.mode === "edit" ? tqModal.data?._id : "new-test-question"}
          question={tqModal.mode === "edit" ? tqModal.data : null}
          saving={tqSaving}
          sections={sectionsOf(qTest)}
          defaultSection={tqModal.forceSection && tqModal.forceSection !== "__unassigned__" ? tqModal.forceSection : ""}
          onClose={() => { setTqModal(null); setReopenAfterEdit(null); }}
          onSave={saveTestQuestion}
        />
      )}

      {/* View single test question */}
      {viewQ && (
        <div className={`fixed inset-0 z-[60] flex justify-center overflow-y-auto bg-black/50 ${viewFull ? "items-stretch p-0 sm:p-4" : "items-start p-4"}`} onClick={() => setViewQ(null)}>
          <div onClick={(e) => e.stopPropagation()} className={`card flex flex-col animate-scale-in ${viewFull ? "m-0 min-h-full w-full max-w-none rounded-none p-4 sm:min-h-0 sm:h-full sm:rounded-2xl sm:p-6" : "my-8 w-full max-w-2xl p-6"}`}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Question</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => setViewFull((v) => !v)} title={viewFull ? "Exit full screen" : "Full screen"} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                  {viewFull ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                </button>
                <button onClick={() => setViewQ(null)}><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className={viewFull ? "min-h-0 flex-1 overflow-y-auto" : ""}>
            <QuestionView q={viewQ} {...(() => { const L = tq; const i = L.findIndex((x) => x._id === viewQ._id); return { position: i >= 0 ? `${i + 1} / ${L.length}` : undefined, onPrev: i > 0 ? () => setViewQ(L[i - 1]) : undefined, onNext: i >= 0 && i < L.length - 1 ? () => setViewQ(L[i + 1]) : undefined }; })()} onRegenerate={() => regenerateQ(viewQ)} regenerating={regenId === viewQ._id} onExtend={() => setExtendOneItem(viewQ)} extending={extendingQId === viewQ._id} onSchedule={() => setScheduleQ(viewQ)} onEdit={() => { const q = viewQ; setReopenAfterEdit(q._id); setViewQ(null); setTqModal({ mode: "edit", data: q }); }} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={async () => { if (!window.confirm("Delete this question from the test?")) return; await testService.deleteQuestion(qTest._id, viewQ._id); setViewQ(null); await reloadTq(); load(); }} className="btn-outline mr-auto text-rose-600"><Trash2 className="h-4 w-4" /> Delete</button>
              <button onClick={() => setViewQ(null)} className="btn-primary">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* View all test questions */}
      {viewAllQ && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4" onClick={() => setViewAllQ(false)}>
          <div onClick={(e) => e.stopPropagation()} className="min-h-full w-full max-w-none animate-scale-in card m-0 rounded-none p-4 sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-bold">All questions{qTest ? ` — ${qTest.name}` : ""} ({tq.length})</h3>
              <div className="flex items-center gap-2">
                <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold dark:border-slate-700">
                  <button onClick={() => setStudentView(false)} className={`px-3 py-1.5 ${!studentView ? "bg-brand-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>Admin view</button>
                  <button onClick={() => setStudentView(true)} className={`px-3 py-1.5 ${studentView ? "bg-brand-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>Student view</button>
                </div>
                <button onClick={() => setViewAllQ(false)}><X className="h-5 w-5" /></button>
              </div>
            </div>
            {studentView && (
              <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                Student view — answers &amp; explanations are hidden. Use “Reveal answer” on any question to expose it.
              </p>
            )}
            <QuestionSubjectFilter questions={tq} selected={subjectFilter} onChange={(s) => { setSubjectFilter(s); setTypeFilter([]); setStatusFilter("all"); }} />
            <QuestionTypeFilter questions={filterBySubject(tq, subjectFilter)} selected={typeFilter} onChange={setTypeFilter} />
            <QuestionStatusFilter questions={filterBySubject(tq, subjectFilter).filter((it) => !typeFilter.length || typeFilter.includes(questionTypeKey(it)))} selected={statusFilter} onChange={setStatusFilter} />
            {!studentView && (() => {
              const shownCount = filterBySubject(filterByStatus(tq.filter((it) => !typeFilter.length || typeFilter.includes(questionTypeKey(it))), statusFilter), subjectFilter).length;
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
                  {!typeFilter.length && <span className="text-xs text-slate-400">Tip: pick a Type above to delete only that type.</span>}
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
              {filterBySubject(filterByStatus(tq, statusFilter), subjectFilter)
                .map((it, i) => ({ it, i }))
                .filter(({ it }) => !typeFilter.length || typeFilter.includes(questionTypeKey(it)))
                .map(({ it, i }) => (
                <div key={(studentView ? "s" : "a") + it._id} className="relative rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="absolute right-2 top-2 z-10 flex gap-1">
                    {!studentView && (
                      <>
                        <button onClick={() => { setViewAllQ(false); setTqModal({ mode: "edit", data: it }); }} title="Edit" className="rounded-lg bg-white p-1.5 text-brand-600 shadow hover:bg-brand-50 dark:bg-slate-800 dark:hover:bg-brand-900/30">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => removeTq(it._id)} title="Delete" className="rounded-lg bg-white p-1.5 text-rose-600 shadow hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-900/30">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                  <QuestionView q={it} index={i + 1} studentView={studentView} onRegenerate={() => regenerateQ(it)} regenerating={regenId === it._id} onExtend={() => setExtendOneItem(it)} extending={extendingQId === it._id} onSchedule={() => setScheduleQ(it)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
