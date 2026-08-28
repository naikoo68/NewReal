import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload, Plus, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, FileText, ZoomIn, ZoomOut, Sparkles, RotateCcw, Copy, Mail, Globe, Menu, Sun, Moon } from "lucide-react";
import ResumeDocument from "./ResumeDocument";
import CoverLetterDocument from "./CoverLetterDocument";
import { TEMPLATES, FONTS, fontCss, templateById } from "./resumeTemplates";
import { emptyResume, sampleResume, exportJson, importJson, atsScore, factories, SECTIONS, LANGS, listDocs, getCurrentId, loadDoc, saveDoc, createDoc, duplicateDoc, deleteDoc, keywordAnalysis, writingSuggestions } from "./resumeData";

// Standalone Resume Builder (route: /resume). Self-contained — its own shell,
// no app chrome. Data is a single JSON object autosaved to localStorage.
export default function ResumeBuilder() {
  // Initialise from the multi-document store (migrates the old single draft).
  const [docId, setDocId] = useState(() => getCurrentId() || createDoc(sampleResume(), "Sample Resume").id);
  const [resume, setResume] = useState(() => loadDoc(docId) || sampleResume());
  const [docs, setDocs] = useState(() => listDocs());
  const [zoom, setZoom] = useState(0.75);
  const [savedAt, setSavedAt] = useState(null);
  const [tab, setTab] = useState("content"); // content | design | cover | ats
  const [preview, setPreview] = useState("resume"); // which document the preview shows: resume | cover
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const [jdText, setJdText] = useState(""); // pasted job description for keyword matching
  const fileRef = useRef(null);
  const dragFrom = useRef(null); // index being dragged in the Sections reorder list

  // Autosave (debounced) into the current document.
  useEffect(() => {
    const t = setTimeout(() => { if (saveDoc(docId, resume)) { setSavedAt(Date.now()); setDocs(listDocs()); } }, 600);
    return () => clearTimeout(t);
  }, [resume, docId]);

  const tpl = templateById(resume.theme?.templateId);
  const ats = useMemo(() => atsScore(resume), [resume]);
  const writing = useMemo(() => writingSuggestions(resume), [resume]);
  const kw = useMemo(() => keywordAnalysis(resume, jdText), [resume, jdText]);

  // ---- update helpers ----------------------------------------------------
  const patch = (updater) => setResume((r) => { const n = structuredCloneSafe(r); updater(n); return n; });
  const setPersonal = (field, val) => patch((n) => { n.personal[field] = val; });
  const setTheme = (field, val) => patch((n) => { n.theme[field] = val; });
  const setField = (field, val) => patch((n) => { n[field] = val; });
  const addEntry = (section) => patch((n) => { n[section] = [...(n[section] || []), factories[section]()]; });
  const removeEntry = (section, id) => patch((n) => { n[section] = n[section].filter((e) => e.id !== id); });
  const setEntry = (section, id, field, val) => patch((n) => { n[section] = n[section].map((e) => (e.id === id ? { ...e, [field]: val } : e)); });
  const moveEntry = (section, id, dir) => patch((n) => {
    const arr = n[section]; const i = arr.findIndex((e) => e.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  });
  const setBullet = (section, id, idx, val) => patch((n) => { n[section] = n[section].map((e) => (e.id === id ? { ...e, bullets: e.bullets.map((b, k) => (k === idx ? val : b)) } : e)); });
  const addBullet = (section, id) => patch((n) => { n[section] = n[section].map((e) => (e.id === id ? { ...e, bullets: [...(e.bullets || []), ""] } : e)); });
  const removeBullet = (section, id, idx) => patch((n) => { n[section] = n[section].map((e) => (e.id === id ? { ...e, bullets: e.bullets.filter((_, k) => k !== idx) } : e)); });

  const toggleSection = (key) => patch((n) => { n.layout.hidden = { ...(n.layout.hidden || {}) }; n.layout.hidden[key] = !n.layout.hidden[key]; });
  const moveSection = (key, dir) => patch((n) => {
    const arr = n.layout.order.slice(); const i = arr.indexOf(key); const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]]; n.layout.order = arr;
  });

  const onPhoto = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setPersonal("photo", String(reader.result || "")); reader.readAsDataURL(file);
  };
  const onImport = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { setResume(await importJson(file)); } catch (err) { alert(err.message); } finally { e.target.value = ""; }
  };
  const printPdf = () => window.print();

  // ---- documents (create / switch / duplicate / delete) ------------------
  const switchDoc = (id) => { const r = loadDoc(id); if (r) { setDocId(id); setResume(r); setPreview("resume"); } };
  const newDoc = () => { const { id, resume: r } = createDoc(emptyResume(), "Untitled"); setDocId(id); setResume(r); setDocs(listDocs()); setPreview("resume"); };
  const duplicateCurrent = () => { const { id, resume: r } = duplicateDoc(resume); setDocId(id); setResume(r); setDocs(listDocs()); };
  const removeDoc = () => {
    if (!window.confirm("Delete this resume? This can't be undone.")) return;
    const next = deleteDoc(docId);
    const id = next || createDoc(emptyResume(), "Untitled").id;
    setDocId(id); setResume(loadDoc(id) || emptyResume()); setDocs(listDocs());
  };

  // Selecting a template applies its full look — layout + colour + serif/sans
  // font — so each of the presets is visibly distinct (not just a layout tweak).
  const applyTemplate = (t) => patch((n) => {
    n.theme.templateId = t.id;
    n.theme.accent = t.style.accent;
    n.theme.font = t.style.serif ? "Georgia" : "Inter";
  });

  // ---- dark / light toggle (this page is outside the app shell) ----------
  const toggleDark = () => setDark((d) => { const nd = !d; document.documentElement.classList.toggle("dark", nd); return nd; });

  // ---- drag-and-drop reordering of sections ------------------------------
  const onSectionDrop = (toKey) => patch((n) => {
    const arr = n.layout.order.slice();
    const from = dragFrom.current; const to = arr.indexOf(toKey);
    if (from == null || from < 0 || to < 0 || from === to) return;
    const [moved] = arr.splice(from, 1); arr.splice(to, 0, moved); n.layout.order = arr;
  });

  // Config-driven editors for the repeatable sections (keeps this file lean).
  const ARRAY_UI = {
    experience: { title: "Work Experience", fields: [["role", "Role"], ["company", "Company"], ["location", "Location"], ["start", "Start (e.g. 2021)"], ["end", "End"]], current: true, bullets: true },
    education: { title: "Education", fields: [["degree", "Degree"], ["school", "School"], ["location", "Location"], ["start", "Start"], ["end", "End"], ["score", "Score / GPA"], ["details", "Details"]] },
    skills: { title: "Skills", fields: [["name", "Skill"], ["level", "Level (optional)"]] },
    projects: { title: "Projects", fields: [["name", "Name"], ["link", "Link"], ["description", "Description"]], bullets: true },
    certifications: { title: "Certifications", fields: [["name", "Name"], ["issuer", "Issuer"], ["date", "Date"], ["link", "Link"]] },
    languages: { title: "Languages", fields: [["name", "Language"], ["level", "Level"]] },
    references: { title: "References", fields: [["name", "Name"], ["relation", "Relation"], ["contact", "Contact"]] },
    interests: { title: "Interests", fields: [["name", "Interest"]] },
  };

  const ArrayEditor = ({ section }) => {
    const cfg = ARRAY_UI[section];
    const list = resume[section] || [];
    return (
      <div className="space-y-2">
        {list.map((entry, i) => (
          <div key={entry.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            <div className="mb-1 flex items-center justify-end gap-1">
              <button type="button" onClick={() => moveEntry(section, entry.id, -1)} disabled={i === 0} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => moveEntry(section, entry.id, 1)} disabled={i === list.length - 1} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => removeEntry(section, entry.id)} className="rounded p-1 text-rose-500 hover:text-rose-700"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {cfg.fields.map(([f, label]) => <Field key={f} label={label} value={entry[f]} onChange={(v) => setEntry(section, entry.id, f, v)} />)}
            </div>
            {cfg.current && (
              <label className="mt-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={!!entry.current} onChange={(e) => setEntry(section, entry.id, "current", e.target.checked)} className="h-4 w-4 accent-brand-600" /> I currently work here
              </label>
            )}
            {cfg.bullets && (
              <div className="mt-2">
                <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Bullet points</span>
                {(entry.bullets || []).map((b, idx) => (
                  <div key={idx} className="mb-1 flex gap-1">
                    <input className="input !py-1 text-sm" value={b} onChange={(e) => setBullet(section, entry.id, idx, e.target.value)} placeholder="Started with an action verb; include a number." />
                    <button type="button" onClick={() => removeBullet(section, entry.id, idx)} className="rounded p-1 text-rose-500 hover:text-rose-700"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => addBullet(section, entry.id)} className="text-xs font-semibold text-brand-600 hover:underline">+ Add bullet</button>
              </div>
            )}
          </div>
        ))}
        <button type="button" onClick={() => addEntry(section)} className="btn-outline w-full text-sm"><Plus className="h-4 w-4" /> Add {cfg.title.replace(/s$/, "").toLowerCase()}</button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      {/* Print rules — only the A4 sheet prints, as selectable-text, A4 paged. */}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #resume-print-area, #resume-print-area * { visibility: visible !important; }
        #resume-print-area { position: absolute; left: 0; top: 0; width: 100%; transform: none !important; }
        #resume-print-area .resume-sheet { box-shadow: none !important; margin: 0 !important; }
        @page { size: A4; margin: 0; }
        html, body { background: #fff !important; }
      }
      .resume-sheet, .resume-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`}</style>

      {/* Top toolbar */}
      <header className="no-print sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <span className="flex items-center gap-2 font-extrabold text-slate-800 dark:text-slate-100"><FileText className="h-5 w-5 text-brand-600" /> Resume Builder</span>
        <select value={docId} onChange={(e) => switchDoc(e.target.value)} className="input !w-auto !py-1 text-xs" title="Switch resume">
          {docs.map((d) => <option key={d.id} value={d.id}>{d.name || "Untitled"}</option>)}
        </select>
        <button onClick={duplicateCurrent} className="btn-outline !p-2" title="Duplicate this resume"><Copy className="h-4 w-4" /></button>
        <button onClick={removeDoc} className="btn-outline !p-2" title="Delete this resume"><Trash2 className="h-4 w-4" /></button>
        <span className="text-xs text-slate-400">{savedAt ? "Saved" : "Autosaving…"}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} className="btn-outline !p-2" title="Zoom out"><ZoomOut className="h-4 w-4" /></button>
          <span className="w-10 text-center text-xs text-slate-500">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))} className="btn-outline !p-2" title="Zoom in"><ZoomIn className="h-4 w-4" /></button>
          <button onClick={toggleDark} className="btn-outline !p-2" title="Toggle dark / light">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
          <button onClick={() => fileRef.current?.click()} className="btn-outline text-sm"><Upload className="h-4 w-4" /> Import</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImport} />
          <button onClick={() => exportJson(resume)} className="btn-outline text-sm"><Download className="h-4 w-4" /> JSON</button>
          <button onClick={newDoc} className="btn-outline text-sm" title="Create a new blank resume"><Plus className="h-4 w-4" /> New</button>
          <button onClick={printPdf} className="btn-primary text-sm"><Download className="h-4 w-4" /> Download PDF</button>
        </div>
      </header>

      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Left: editor */}
        <div className="no-print space-y-3">
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm dark:border-slate-700">
            {["content", "design", "cover", "ats"].map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 font-semibold capitalize ${tab === t ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>{t === "ats" ? "ATS" : t}</button>
            ))}
          </div>

          {tab === "content" && (
            <div className="card space-y-4 p-4">
              {/* Personal */}
              <div>
                <h3 className="mb-2 font-bold">Personal Information</h3>
                <div className="mb-2 flex items-center gap-3">
                  {resume.personal.photo ? <img src={resume.personal.photo} alt="" className="h-14 w-14 rounded-full object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400 dark:bg-slate-800">Photo</div>}
                  <label className="btn-outline cursor-pointer text-sm"><Upload className="h-4 w-4" /> Upload photo<input type="file" accept="image/*" className="hidden" onChange={onPhoto} /></label>
                  {resume.personal.photo && <button onClick={() => setPersonal("photo", "")} className="text-xs text-rose-500 hover:underline">Remove</button>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Full name" value={resume.personal.fullName} onChange={(v) => setPersonal("fullName", v)} />
                  <Field label="Professional title" value={resume.personal.title} onChange={(v) => setPersonal("title", v)} />
                  <Field label="Email" value={resume.personal.email} onChange={(v) => setPersonal("email", v)} />
                  <Field label="Phone" value={resume.personal.phone} onChange={(v) => setPersonal("phone", v)} />
                  <Field label="Location" value={resume.personal.location} onChange={(v) => setPersonal("location", v)} />
                  <Field label="Website" value={resume.personal.website} onChange={(v) => setPersonal("website", v)} />
                  <Field label="LinkedIn" value={resume.personal.linkedin} onChange={(v) => setPersonal("linkedin", v)} />
                  <Field label="GitHub" value={resume.personal.github} onChange={(v) => setPersonal("github", v)} />
                </div>
              </div>
              {/* Summary */}
              <div>
                <h3 className="mb-1 font-bold">Profile Summary</h3>
                <textarea rows={4} className="input resize-y text-sm" value={resume.summary} onChange={(e) => setField("summary", e.target.value)} placeholder="2\u20133 sentences: who you are, key strengths, and a standout achievement." />
              </div>
              {/* Repeatable sections */}
              {["experience", "education", "skills", "projects", "certifications", "languages", "references", "interests"].map((sec) => (
                <div key={sec}>
                  <h3 className="mb-2 font-bold">{ARRAY_UI[sec].title}</h3>
                  {ArrayEditor({ section: sec })}
                </div>
              ))}
            </div>
          )}

          {tab === "design" && (
            <div className="card space-y-4 p-4">
              <div>
                <h3 className="mb-2 font-bold">Template <span className="font-normal text-slate-400">({TEMPLATES.length})</span></h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {TEMPLATES.map((t) => (
                    <button key={t.id} onClick={() => applyTemplate(t)} title={t.name} className={`overflow-hidden rounded-lg border text-left ${resume.theme.templateId === t.id ? "border-brand-500 ring-2 ring-brand-300" : "border-slate-200 dark:border-slate-700"}`}>
                      <TemplateThumb style={t.style} />
                      <span className="block truncate px-1 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">{t.name}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-400">Picking a template sets its colour &amp; font — tweak them below.</p>
              </div>
              <label className="flex items-center justify-between text-sm font-semibold">Accent colour
                <input type="color" value={resume.theme.accent} onChange={(e) => setTheme("accent", e.target.value)} className="h-8 w-12 rounded border" />
              </label>
              <label className="block text-sm font-semibold">Font
                <select className="input mt-1" value={resume.theme.font} onChange={(e) => setTheme("font", e.target.value)}>
                  {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold"><span className="inline-flex items-center gap-1"><Globe className="h-4 w-4" /> Resume language</span>
                <select className="input mt-1" value={resume.theme.language || "en"} onChange={(e) => setTheme("language", e.target.value)}>
                  {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-400">Translates section headings on the resume &amp; cover letter (right-to-left supported).</span>
              </label>
              <label className="block text-sm font-semibold">Text size
                <input type="range" min="0.85" max="1.2" step="0.05" value={resume.theme.fontScale} onChange={(e) => setTheme("fontScale", parseFloat(e.target.value))} className="w-full accent-brand-600" />
              </label>
              <div>
                <h3 className="mb-2 font-bold">Sections</h3>
                <p className="mb-2 text-xs text-slate-400">Reorder and show/hide sections.</p>
                <div className="space-y-1">
                  {resume.layout.order.map((key, i) => {
                    const label = (SECTIONS.find((s) => s.key === key) || {}).label || key;
                    const hiddenNow = resume.layout.hidden?.[key];
                    return (
                      <div key={key} draggable onDragStart={() => { dragFrom.current = i; }} onDragOver={(e) => e.preventDefault()} onDrop={() => onSectionDrop(key)} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-slate-700">
                        <Menu className="h-4 w-4 cursor-grab text-slate-300" title="Drag to reorder" />
                        <span className={`flex-1 ${hiddenNow ? "text-slate-400 line-through" : ""}`}>{label}</span>
                        <button onClick={() => moveSection(key, -1)} disabled={i === 0} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button onClick={() => moveSection(key, 1)} disabled={i === resume.layout.order.length - 1} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                        <button onClick={() => toggleSection(key)} className="rounded p-1 text-slate-500 hover:text-slate-800" title={hiddenNow ? "Show" : "Hide"}>{hiddenNow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === "cover" && (
            <div className="card space-y-3 p-4">
              <h3 className="font-bold">Cover Letter</h3>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={!!resume.coverLetter?.enabled} onChange={(e) => patch((n) => { n.coverLetter = { ...n.coverLetter, enabled: e.target.checked }; })} className="h-4 w-4 accent-brand-600" />
                Include a cover letter
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Recipient name" value={resume.coverLetter?.recipient} onChange={(v) => patch((n) => { n.coverLetter = { ...n.coverLetter, recipient: v }; })} />
                <Field label="Company" value={resume.coverLetter?.company} onChange={(v) => patch((n) => { n.coverLetter = { ...n.coverLetter, company: v }; })} />
              </div>
              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Body (blank lines separate paragraphs)</span>
                <textarea rows={12} className="input resize-y text-sm" value={resume.coverLetter?.body || ""} onChange={(e) => patch((n) => { n.coverLetter = { ...n.coverLetter, body: e.target.value }; })} placeholder={"I'm excited to apply for the [role] at [company]...\n\nIn my current role I [achievement with a number]...\n\nI'd welcome the chance to discuss how I can contribute."} />
              </label>
              <button onClick={() => setPreview("cover")} className="btn-outline text-sm"><Mail className="h-4 w-4" /> Preview cover letter</button>
            </div>
          )}

          {tab === "ats" && (
            <div className="card space-y-3 p-4">
              <div className="flex items-center gap-3">
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full" style={{ background: `conic-gradient(${ats.score >= 60 ? "#16a34a" : "#f59e0b"} ${ats.score * 3.6}deg, #e5e7eb 0)` }}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-lg font-extrabold dark:bg-slate-900">{ats.score}</span>
                </div>
                <div>
                  <p className="font-bold">ATS score: {ats.band}</p>
                  <p className="text-xs text-slate-500">Heuristic check of what recruiters &amp; parsers look for.</p>
                </div>
              </div>
              {ats.tips.length ? (
                <ul className="space-y-1 text-sm">
                  {ats.tips.map((t, i) => <li key={i} className="flex gap-2"><Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />{t}</li>)}
                </ul>
              ) : <p className="text-sm font-medium text-emerald-600">Looks great — no obvious gaps! \ud83c\udf89</p>}

              <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                <h4 className="mb-1 font-bold">Writing suggestions</h4>
                {writing.length ? (
                  <ul className="space-y-1 text-sm">
                    {writing.map((t, i) => <li key={i} className="flex gap-2"><Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-500" />{t}</li>)}
                  </ul>
                ) : <p className="text-sm text-emerald-600">No common writing issues spotted.</p>}
              </div>

              <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                <h4 className="mb-1 font-bold">Match to a job description</h4>
                <p className="mb-2 text-xs text-slate-400">Paste a job description to see which of its keywords already appear in your resume.</p>
                <textarea rows={5} className="input resize-y text-sm" value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="Paste the job description here…" />
                {kw.total > 0 && (
                  <div className="mt-2 space-y-2">
                    <p className="text-sm font-semibold">Keyword match: <span className={kw.pct >= 60 ? "text-emerald-600" : "text-amber-600"}>{kw.pct}%</span> <span className="font-normal text-slate-400">({kw.matched.length}/{kw.total})</span></p>
                    {kw.missing.length ? (
                      <div>
                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Missing keywords — weave in the relevant ones:</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {kw.missing.map((k) => <span key={k} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{k}</span>)}
                        </div>
                      </div>
                    ) : <p className="text-sm text-emerald-600">Great — all detected keywords are present!</p>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: live A4 preview */}
        <div className="overflow-auto">
          <div className="no-print mb-2 inline-flex rounded-lg border border-slate-200 p-0.5 text-sm dark:border-slate-700">
            {["resume", "cover"].map((v) => (
              <button key={v} onClick={() => setPreview(v)} className={`rounded-md px-3 py-1 font-semibold ${preview === v ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>{v === "resume" ? "Resume" : "Cover letter"}</button>
            ))}
          </div>
          <div id="resume-print-area">
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center", width: "210mm", margin: "0 auto" }}>
              {preview === "cover"
                ? <CoverLetterDocument resume={resume} accent={resume.theme.accent} fontFamily={fontCss(resume.theme.font)} fontScale={resume.theme.fontScale} lang={resume.theme.language} />
                : <ResumeDocument resume={resume} style={tpl.style} accent={resume.theme.accent} fontFamily={fontCss(resume.theme.font)} fontScale={resume.theme.fontScale} lang={resume.theme.language} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// structuredClone with a fallback for older browsers (keeps autosave safe).
function structuredCloneSafe(obj) {
  try { return structuredClone(obj); } catch { return JSON.parse(JSON.stringify(obj)); }
}

// A tiny schematic preview of a template so the picker is a real visual gallery
// (reflects the layout, accent colour, header alignment and section-title style).
function TemplateThumb({ style }) {
  const ac = style.accent || "#2563eb";
  const line = (w, c = "#d1d5db", mt = 2) => <div style={{ height: 2, width: w, background: c, marginTop: mt, borderRadius: 1 }} />;
  const titleBar = () => {
    if (style.titleStyle === "bar") return <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 3 }}><div style={{ width: 2, height: 5, background: ac }} /><div style={{ height: 2, width: "40%", background: ac, borderRadius: 1 }} /></div>;
    if (style.titleStyle === "underline") return <div style={{ marginTop: 3 }}><div style={{ height: 2, width: "40%", background: ac, borderRadius: 1 }} /><div style={{ height: 1, width: "100%", background: ac, marginTop: 1 }} /></div>;
    if (style.titleStyle === "caps") return <div style={{ height: 2, width: "50%", background: ac, marginTop: 3, borderRadius: 1 }} />;
    return <div style={{ height: 2, width: "40%", background: "#9ca3af", marginTop: 3, borderRadius: 1 }} />;
  };
  const wrap = { position: "relative", height: 60, background: "#fff", fontSize: 0 };
  if (style.columns === 2) {
    const side = (
      <div style={{ width: "34%", background: `${ac}22`, padding: 4, boxSizing: "border-box" }}>
        {style.showPhoto ? <div style={{ width: 12, height: 12, borderRadius: "50%", background: ac, margin: "0 auto 3px" }} /> : null}
        {line("80%", ac)}{line("60%")}{line("70%")}{line("50%")}
      </div>
    );
    const main = (
      <div style={{ flex: 1, padding: 4, boxSizing: "border-box" }}>
        <div style={{ height: 3, width: "70%", background: "#111827", borderRadius: 1 }} />
        <div style={{ height: 2, width: "45%", background: ac, marginTop: 2, borderRadius: 1 }} />
        {titleBar()}{line("95%")}{line("90%")}{line("80%")}
      </div>
    );
    return <div style={{ ...wrap, display: "flex", flexDirection: style.sidebar === "right" ? "row-reverse" : "row" }}>{side}{main}</div>;
  }
  const center = style.headerAlign === "center";
  return (
    <div style={{ ...wrap, padding: 5, boxSizing: "border-box" }}>
      <div style={{ height: 3, width: "60%", background: "#111827", borderRadius: 1, margin: center ? "0 auto" : undefined }} />
      <div style={{ height: 2, width: "35%", background: ac, marginTop: 2, borderRadius: 1, margin: center ? "2px auto 0" : undefined }} />
      {titleBar()}{line("95%")}{line("88%")}{line("92%")}{line("70%")}
    </div>
  );
}

// Module-scope input atom. MUST live outside the page component: if it were
// defined inside, it would get a new identity every render and React would
// remount the <input> on each keystroke, stealing focus after one character.
function Field({ label, value, onChange, type = "text", ...rest }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      <input type={type} className="input !py-1.5 text-sm" value={value || ""} onChange={(e) => onChange(e.target.value)} {...rest} />
    </label>
  );
}
