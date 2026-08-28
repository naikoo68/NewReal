import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, X, ChevronRight, GraduationCap, BookOpen, Users2, FileText, Upload, ExternalLink, Loader2 } from "lucide-react";
import { studyService, uploadService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

const VIEW_TYPE = { institutions: "institution", subjects: "subject", classes: "class", files: "file" };

export default function AdminStudyMaterial() {
  const [view, setView] = useState("institutions"); // institutions | subjects | classes | files
  const [institution, setInstitution] = useState(null);
  const [subject, setSubject] = useState(null);
  const [smClass, setSmClass] = useState(null);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // { type, mode, data }
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loaders = {
    institutions: () => studyService.institutions(),
    subjects: () => studyService.subjects(institution._id),
    classes: () => studyService.classes(subject._id),
    files: () => studyService.files(smClass._id),
  };

  const load = useCallback((which) => {
    setLoading(true);
    setError("");
    loaders[which]()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institution, subject, smClass]);

  useEffect(() => { load(view); /* eslint-disable-next-line */ }, [view]);

  // Navigation
  const openInstitution = (i) => { setInstitution(i); setSubject(null); setSmClass(null); setView("subjects"); };
  const openSubject = (s) => { setSubject(s); setSmClass(null); setView("classes"); };
  const openClass = (c) => { setSmClass(c); setView("files"); };
  const goTo = (level) => setView(level);

  const emptyForm = (type) => {
    if (type === "institution") return { name: "", kind: "University", description: "", order: 1 };
    if (type === "file") return { title: "", url: "", fileType: "", description: "", order: 1 };
    return { name: "", order: 1 };
  };
  const openAdd = () => { const t = VIEW_TYPE[view]; setForm(emptyForm(t)); setModal({ type: t, mode: "add" }); };
  const openEdit = (item) => {
    const t = VIEW_TYPE[view];
    setForm(t === "file"
      ? { title: item.title, url: item.url, fileType: item.fileType || "", description: item.description || "", order: item.order || 1 }
      : t === "institution"
      ? { name: item.name, kind: item.kind || "University", description: item.description || "", order: item.order || 1 }
      : { name: item.name, order: item.order || 1 });
    setModal({ type: t, mode: "edit", data: item });
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const res = await uploadService.file(file);
      setForm((f) => ({ ...f, url: res.url, fileType: res.format || file.name.split(".").pop(), title: f.title || file.name.replace(/\.[^.]+$/, "") }));
    } catch (err) {
      setError(err.message || "Upload failed (is Cloudinary configured?)");
    } finally {
      setUploading(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { type, mode, data } = modal;
      if (type === "institution") {
        mode === "add" ? await studyService.createInstitution(form) : await studyService.updateInstitution(data._id, form);
      } else if (type === "subject") {
        mode === "add" ? await studyService.createSubject({ ...form, institution: institution._id }) : await studyService.updateSubject(data._id, form);
      } else if (type === "class") {
        mode === "add" ? await studyService.createClass({ ...form, institution: institution._id, subject: subject._id }) : await studyService.updateClass(data._id, form);
      } else if (type === "file") {
        if (!form.url) { setError("Please upload a file or paste a link."); setSaving(false); return; }
        const payload = { ...form, institution: institution._id, subject: subject._id, smClass: smClass._id };
        mode === "add" ? await studyService.createFile(payload) : await studyService.updateFile(data._id, payload);
      }
      setModal(null);
      load(view);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item) => {
    const label = item.name || item.title;
    if (!window.confirm(`Delete "${label}"? This also removes everything inside it.`)) return;
    try {
      const t = VIEW_TYPE[view];
      if (t === "institution") await studyService.deleteInstitution(item._id);
      else if (t === "subject") await studyService.deleteSubject(item._id);
      else if (t === "class") await studyService.deleteClass(item._id);
      else await studyService.deleteFile(item._id);
      setItems((l) => l.filter((x) => x._id !== item._id));
    } catch (e) {
      setError(e.message);
    }
  };

  const headings = {
    institutions: { title: "Universities & Schools", add: "Add University / School", icon: GraduationCap },
    subjects: { title: `Subjects in ${institution?.name || ""}`, add: "Add Subject", icon: BookOpen },
    classes: { title: `Classes in ${subject?.name || ""}`, add: "Add Class", icon: Users2 },
    files: { title: `Files in ${smClass?.name || ""}`, add: "Add File", icon: FileText },
  };
  const H = headings[view];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Study Material</h1>
          <p className="text-slate-500 dark:text-slate-400">University/School → Subject → Class → Files. Upload notes, PDFs and resources.</p>
        </div>
        <button onClick={openAdd} className="btn-primary"><Plus className="h-4 w-4" /> {H.add}</button>
      </div>

      {/* Breadcrumb */}
      <div className="card px-4 py-3">
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <button onClick={() => goTo("institutions")} className={`rounded px-2 py-1 font-medium ${view === "institutions" ? "text-brand-600" : "text-slate-500 hover:text-brand-600"}`}>Institutions</button>
          {institution && view !== "institutions" && (<>
            <ChevronRight className="h-4 w-4 text-slate-400" />
            <button onClick={() => goTo("subjects")} className={`rounded px-2 py-1 font-medium ${view === "subjects" ? "text-brand-600" : "text-slate-500 hover:text-brand-600"}`}>{institution.name}</button>
          </>)}
          {subject && (view === "classes" || view === "files") && (<>
            <ChevronRight className="h-4 w-4 text-slate-400" />
            <button onClick={() => goTo("classes")} className={`rounded px-2 py-1 font-medium ${view === "classes" ? "text-brand-600" : "text-slate-500 hover:text-brand-600"}`}>{subject.name}</button>
          </>)}
          {smClass && view === "files" && (<>
            <ChevronRight className="h-4 w-4 text-slate-400" />
            <span className="rounded px-2 py-1 font-medium text-brand-600">{smClass.name}</span>
          </>)}
        </nav>
      </div>

      {loading ? (
        <Loading label={`Loading ${view}...`} />
      ) : error && !modal ? (
        <ErrorState message={error} onRetry={() => load(view)} />
      ) : items.length === 0 ? (
        <EmptyState message={`Nothing here yet. Click "${H.add}".`} />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item._id} className="card flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                  <H.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{item.name || item.title}</p>
                  <p className="text-xs text-slate-400">
                    {view === "institutions" && `${item.kind} · ${item.subjects ?? 0} subjects`}
                    {view === "subjects" && `${item.classes ?? 0} classes`}
                    {view === "classes" && `${item.files ?? 0} files`}
                    {view === "files" && (item.fileType ? item.fileType.toUpperCase() : "File")}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                {view === "files" ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="btn-outline py-2">Open <ExternalLink className="h-4 w-4" /></a>
                ) : (
                  <button onClick={() => (view === "institutions" ? openInstitution(item) : view === "subjects" ? openSubject(item) : openClass(item))} className="btn-outline py-2">
                    Manage <ChevronRight className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => openEdit(item)} title="Edit" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove(item)} title="Delete" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <form onSubmit={save} className="my-8 w-full max-w-md animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{modal.mode === "add" ? "Add" : "Edit"} {modal.type === "class" ? "Class" : modal.type === "institution" ? "University / School" : modal.type === "subject" ? "Subject" : "File"}</h3>
              <button type="button" onClick={() => setModal(null)}><X className="h-5 w-5" /></button>
            </div>
            {error && modal && <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</div>}

            <div className="space-y-4">
              {modal.type === "institution" && (
                <>
                  <Field label="Name"><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Delhi University" /></Field>
                  <Field label="Type">
                    <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                      <option value="University">University</option><option value="School">School</option>
                    </select>
                  </Field>
                  <Field label="Description (optional)"><textarea rows={2} className="input resize-none" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                </>
              )}

              {(modal.type === "subject" || modal.type === "class") && (
                <Field label={modal.type === "subject" ? "Subject name" : "Class name"}>
                  <input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={modal.type === "subject" ? "e.g. Mathematics" : "e.g. Class 10 / Semester 1"} />
                </Field>
              )}

              {modal.type === "file" && (
                <>
                  <Field label="Title"><input required className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Chapter 1 Notes" /></Field>
                  <Field label="Upload file (PDF, doc, image…)">
                    <label className="btn-outline w-full cursor-pointer justify-center">
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploading ? "Uploading…" : "Choose file"}
                      <input type="file" className="hidden" onChange={onUpload} disabled={uploading} />
                    </label>
                  </Field>
                  <Field label="…or paste a link (Google Drive, etc.)">
                    <input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." />
                  </Field>
                  {form.url && (
                    <a href={form.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" /> Preview attached file
                    </a>
                  )}
                  <Field label="Description (optional)"><textarea rows={2} className="input resize-none" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                </>
              )}

              <Field label="Order"><input type="number" className="input" value={form.order} onChange={(e) => setForm({ ...form, order: +e.target.value })} /></Field>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-outline">Cancel</button>
              <button type="submit" disabled={saving || uploading} className="btn-primary">{saving ? "Saving..." : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
