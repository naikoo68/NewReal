import { useState } from "react";
import { Plus, Trash2, X, Image as ImageIcon, Upload, Loader2, Eraser, FileText, Wand2, LayoutGrid } from "lucide-react";
import { uploadService, aiService } from "../../services";
import { parseQuestionsCsv } from "./BulkUploadQuestions";
import VizView from "../ui/VizView";

// Roman numerals for Column B labels (I, II, III, IV…)
function toRomanLite(n) {
  const m = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let r = "";
  for (const [s, v] of m) while (n >= v) { r += s; n -= v; }
  return r;
}

export const emptyQuestion = {
  type: "mcq",
  text: "",
  options: ["", "", "", ""],
  optionExplanations: ["", "", "", ""],
  correct: 0,
  columnA: ["", "", "", ""],
  columnB: ["", "", "", ""],
  tableRows: [["", ""], ["", ""]],
  assertion: "",
  reason: "",
  difficulty: "Easy",
  explanation: "",
  status: "published",
  image: "",
  viz: null,
};

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

// Reusable Add/Edit question modal supporting simple MCQs and matching MCQs.
// `question` = existing data (edit) or null (add). `onSave(payload)` receives a
// clean payload (the parent attaches context like quiz/testSeries + calls the API).
export default function QuestionFormModal({ question, saving, onClose, onSave, sections = [], defaultSection = "" }) {
  const data = question || emptyQuestion;
  const [form, setForm] = useState(() => ({
    section: data.section || defaultSection || "",
    type: data.type || "mcq",
    text: data.text || "",
    options: data.options && data.options.length ? [...data.options] : ["", "", "", ""],
    optionExplanations: data.optionExplanations && data.optionExplanations.length ? [...data.optionExplanations] : ["", "", "", ""],
    correct: data.correct ?? 0,
    columnA: data.columnA && data.columnA.length ? [...data.columnA] : ["", "", "", ""],
    columnB: data.columnB && data.columnB.length ? [...data.columnB] : ["", "", "", ""],
    tableRows: Array.isArray(data.tableRows) && data.tableRows.length ? data.tableRows.map((r) => [...r]) : [["", ""], ["", ""]],
    assertion: data.assertion || "",
    reason: data.reason || "",
    difficulty: data.difficulty || "Easy",
    explanation: data.explanation || "",
    status: data.status || "published",
    image: data.image || "",
    viz: data.viz || null,
  }));

  const [imgUploading, setImgUploading] = useState(false);
  const [imgErr, setImgErr] = useState("");
  // Diagram ("viz") builder state: a prompt → AI spec, plus manual JSON editing.
  const [vizPrompt, setVizPrompt] = useState("");
  const [vizBusy, setVizBusy] = useState(false);
  const [vizErr, setVizErr] = useState("");
  const [vizJson, setVizJson] = useState(() => (data.viz ? JSON.stringify(data.viz, null, 2) : ""));
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvErr, setCsvErr] = useState("");

  // Blank out all the question fields (keeps the current type & status) so you
  // can re-enter fresh data. Saving still UPDATES the same question.
  const clearFields = () => setForm((f) => ({ ...emptyQuestion, type: f.type, status: f.status }));

  const onCsvFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(file);
    e.target.value = "";
  };

  // Parse a single CSV row and load it into the form, replacing the current
  // fields. Saving still updates THIS question — nothing is created or deleted.
  const applyCsv = () => {
    setCsvErr("");
    const { rows, errors } = parseQuestionsCsv(csvText);
    if (!rows.length) { setCsvErr(errors[0] || "No valid question found in the CSV."); return; }
    const r = rows[0];
    setForm((f) => ({
      ...f,
      type: r.type || "mcq",
      text: r.text || "",
      image: r.image || "",
      options: Array.isArray(r.options) && r.options.length === 4 ? [...r.options] : ["", "", "", ""],
      optionExplanations: Array.isArray(r.optionExplanations) && r.optionExplanations.length ? [...r.optionExplanations] : ["", "", "", ""],
      correct: r.correct ?? 0,
      columnA: Array.isArray(r.columnA) && r.columnA.length ? [...r.columnA] : ["", "", "", ""],
      columnB: Array.isArray(r.columnB) && r.columnB.length ? [...r.columnB] : ["", "", "", ""],
      tableRows: Array.isArray(r.tableRows) && r.tableRows.length ? r.tableRows.map((x) => [...x]) : [["", ""], ["", ""]],
      assertion: r.assertion || "",
      reason: r.reason || "",
      difficulty: r.difficulty || "Medium",
      explanation: r.explanation || "",
    }));
    setCsvOpen(false);
    setCsvText("");
  };

  // Upload a chosen image file to Cloudinary and fill in the URL automatically.
  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgErr("");
    setImgUploading(true);
    try {
      const res = await uploadService.file(file);
      setForm((f) => ({ ...f, image: res.url }));
    } catch (err) {
      setImgErr(err.message || "Upload failed");
    } finally {
      setImgUploading(false);
      e.target.value = "";
    }
  };

  // Diagram question: generate a Visualization-Studio spec from a prompt (reuses
  // the /api/ai/visualize endpoint that powers the Studio), preview it, and store
  // it on the question. The admin can also paste/edit the spec JSON by hand.
  const generateViz = async () => {
    if (!vizPrompt.trim()) { setVizErr("Describe the diagram you want, e.g. \u201cbar chart of yearly exports\u201d."); return; }
    setVizErr("");
    setVizBusy(true);
    try {
      const res = await aiService.visualize(vizPrompt.trim());
      if (!res?.spec) throw new Error("No diagram returned — try rephrasing the prompt.");
      setForm((f) => ({ ...f, viz: res.spec }));
      setVizJson(JSON.stringify(res.spec, null, 2));
    } catch (err) {
      setVizErr(err.message || "Couldn't generate the diagram.");
    } finally {
      setVizBusy(false);
    }
  };

  // Apply hand-edited JSON to the live diagram (validates it's parseable).
  const applyVizJson = () => {
    setVizErr("");
    const t = vizJson.trim();
    if (!t) { setForm((f) => ({ ...f, viz: null })); return; }
    try {
      const spec = JSON.parse(t);
      if (!spec || typeof spec !== "object") throw new Error("Spec must be a JSON object.");
      setForm((f) => ({ ...f, viz: spec }));
    } catch {
      setVizErr("That isn't valid JSON. Check the spec and try again.");
    }
  };

  const submit = (e) => {
    e.preventDefault();
    const base = {
      type: form.type || "mcq",
      text: form.text,
      image: form.image,
      difficulty: form.difficulty,
      explanation: form.explanation,
      // Correct option is covered by the main detailed explanation, so its
      // per-option note is always cleared; only the other three carry a brief.
      optionExplanations: (form.optionExplanations || []).map((x, i) => (i === form.correct ? "" : (x || "").trim())),
      status: form.status,
      section: form.section || "",
      // Diagram spec — only carried for diagram questions (null clears it otherwise).
      viz: form.type === "diagram" ? (form.viz || null) : null,
    };
    let payload;
    if (form.type === "matching") {
      payload = {
        ...base,
        columnA: (form.columnA || []).filter((x) => x.trim()),
        columnB: (form.columnB || []).filter((x) => x.trim()),
        options: form.options,
        correct: form.correct,
      };
    } else if (form.type === "statement" || form.type === "rearrange") {
      payload = {
        ...base,
        columnA: (form.columnA || []).map((x) => (x || "").trim()).filter(Boolean),
        columnB: [],
        options: form.options,
        correct: form.correct,
      };
    } else if (form.type === "pair" || form.type === "pairselect") {
      // Keep the two sides aligned: drop only rows where BOTH sides are empty.
      const n = Math.max(form.columnA.length, form.columnB.length);
      const rows = [];
      for (let i = 0; i < n; i++) {
        const a = (form.columnA[i] || "").trim();
        const b = (form.columnB[i] || "").trim();
        if (a || b) rows.push([a, b]);
      }
      payload = {
        ...base,
        columnA: rows.map((r) => r[0]),
        columnB: rows.map((r) => r[1]),
        options: form.options,
        correct: form.correct,
      };
    } else if (form.type === "table") {
      // Trim cells and drop rows that are entirely empty.
      const table = (form.tableRows || [])
        .map((r) => r.map((c) => (c || "").trim()))
        .filter((r) => r.some((c) => c !== ""));
      payload = { ...base, tableRows: table, options: form.options, correct: form.correct };
    } else if (form.type === "assertion") {
      payload = {
        ...base,
        text: (form.text || "").trim() || "In the following question, a statement of Assertion (A) is followed by a statement of Reason (R). Select the correct option:",
        assertion: (form.assertion || "").trim(),
        reason: (form.reason || "").trim(),
        options: form.options,
        correct: form.correct,
      };
    } else {
      payload = { ...base, options: form.options, correct: form.correct };
    }
    onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4">
      <form onSubmit={submit} className="min-h-full w-full max-w-none animate-scale-in card m-0 rounded-none p-4 sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{question ? "Edit" : "Add"} Question</h3>
          <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-4 dark:border-slate-700">
          <button type="button" onClick={clearFields} className="btn-outline py-2"><Eraser className="h-4 w-4" /> Clear fields</button>
          <button type="button" onClick={() => setCsvOpen((v) => !v)} className="btn-outline py-2"><FileText className="h-4 w-4" /> Import from CSV</button>
          <span className="text-xs text-slate-400">Enter new data — Save keeps the same question.</span>
        </div>

        {csvOpen && (
          <div className="mb-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Paste <b>one</b> question row (same format as bulk upload; only the first row is used). It fills the fields below — <b>Save still updates this question</b>.</p>
            <textarea rows={3} className="input resize-y font-mono text-xs" value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={'e.g. "What is 2+2?",3,4,5,6,B,Easy,"2+2 equals 4"'} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="btn-outline cursor-pointer py-1.5 text-xs"><FileText className="h-3.5 w-3.5" /> Choose CSV file<input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onCsvFile} /></label>
              <button type="button" onClick={applyCsv} className="btn-primary py-1.5 text-xs">Fill fields from CSV</button>
              {csvErr && <span className="text-xs text-rose-600">{csvErr}</span>}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {sections.length > 0 && (
            <Field label="Subject (section of this test)">
              <select className="input" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })}>
                <option value="">— No subject —</option>
                {sections.map((s, i) => <option key={i} value={s}>{s}</option>)}
              </select>
            </Field>
          )}
          <Field label="Question Type">
            <select
              className="input"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="mcq">Multiple Choice (4 options)</option>
              <option value="matching">Matching (left ↔ right)</option>
              <option value="statement">Statement-based (numbered statements)</option>
              <option value="pair">Pair-matching (how many pairs correct)</option>
              <option value="pairselect">Pair-select (which pairs correct — 1 only, 1 &amp; 2…)</option>
              <option value="image">Image / Diagram-based</option>
              <option value="table">Table-based</option>
              <option value="assertion">Assertion &amp; Reason</option>
              <option value="journal">Journal Entry</option>
              <option value="ledger">Ledger Posting (T-account)</option>
              <option value="rearrange">Sentence Rearrangement</option>
              <option value="diagram">Diagram (Visualization Studio chart)</option>
            </select>
          </Field>

          <Field label={form.type === "assertion" ? "Directive line (optional)" : ["statement", "pair", "pairselect", "table", "rearrange"].includes(form.type) ? "Intro / directive line" : "Question Text"}>
            <textarea required={form.type !== "assertion"} rows={2} className="input resize-none" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder={form.type === "statement" ? "Consider the following statements:" : form.type === "pair" || form.type === "pairselect" ? "Consider the following pairs (Item — Description):" : form.type === "table" ? "Study the table below and answer:" : form.type === "assertion" ? "Leave blank for the standard directive, or write your own" : form.type === "journal" ? "Journalise the transaction, e.g. Purchased goods for cash 5,000 — enter the 4 candidate journal entries as the options below" : form.type === "ledger" ? "State the transactions/entries and the task, e.g. Prepare the Cash A/c — enter the 4 candidate ledger (T-account) tables as the options below" : form.type === "rearrange" ? "Rearrange the following sentences to form a meaningful paragraph:" : "Use $...$ for equations, e.g. Solve $x^2+2x-3=0$"} />
            <p className="mt-1 text-xs text-slate-400">{["statement", "pair", "pairselect", "rearrange"].includes(form.type) ? "The numbered list you add below appears under this line, followed by the closing question automatically." : form.type === "table" ? "The table you build below appears under this line." : form.type === "assertion" ? "If left blank, a standard Assertion–Reason directive is used automatically." : "Tip: wrap maths in dollar signs to render equations."}</p>
          </Field>

          <Field label={form.type === "image" ? "Image / Diagram (required for this type)" : "Image (optional)"}>
            <div className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 dark:border-slate-700">
              <ImageIcon className="h-4 w-4 text-slate-400" />
              <input className="w-full bg-transparent py-2.5 text-sm focus:outline-none" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="Upload below, or paste an image link" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className={`btn-outline cursor-pointer py-2 ${imgUploading ? "pointer-events-none opacity-60" : ""}`}>
                {imgUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {imgUploading ? "Uploading…" : "Upload image"}
                <input type="file" accept="image/*" className="hidden" onChange={onPickImage} disabled={imgUploading} />
              </label>
              {form.image && (
                <>
                  <img src={form.image} alt="preview" className="h-12 w-12 rounded-lg border border-slate-200 object-cover dark:border-slate-700" />
                  <button type="button" onClick={() => setForm({ ...form, image: "" })} className="text-xs font-medium text-rose-600 hover:underline">Remove</button>
                </>
              )}
            </div>
            {imgErr && <p className="mt-1 text-xs text-rose-600">{imgErr}</p>}
            <p className="mt-1 text-xs text-slate-400">Pick a file from your device — it uploads to Cloudinary and fills the link automatically.</p>
          </Field>

          {form.type === "diagram" && (
            <Field label="Diagram (required for this type)">
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                Describe the chart/diagram and generate it with AI (same engine as the Visualization Studio), or paste a spec below. The student answers by reading this diagram, so make your question text refer to it.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="input flex-1"
                  value={vizPrompt}
                  onChange={(e) => setVizPrompt(e.target.value)}
                  placeholder='e.g. "bar chart: exports 2019=120, 2020=90, 2021=150, 2022=170" or "flowchart of the water cycle"'
                />
                <button type="button" onClick={generateViz} disabled={vizBusy} className="btn-primary py-2 disabled:opacity-50">
                  {vizBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Wand2 className="h-4 w-4" /> Generate diagram</>}
                </button>
              </div>
              {vizErr && <p className="mt-1 text-xs text-rose-600">{vizErr}</p>}

              {form.viz && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400"><LayoutGrid className="h-3.5 w-3.5" /> Preview</span>
                    <button type="button" onClick={() => { setForm((f) => ({ ...f, viz: null })); setVizJson(""); }} className="text-xs font-medium text-rose-600 hover:underline">Remove diagram</button>
                  </div>
                  <VizView q={{ viz: form.viz }} />
                </div>
              )}

              <details className="mt-3 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <summary className="cursor-pointer text-xs font-semibold text-slate-500 dark:text-slate-400">Edit spec JSON (advanced)</summary>
                <textarea
                  rows={6}
                  className="input mt-2 resize-y font-mono text-xs"
                  value={vizJson}
                  onChange={(e) => setVizJson(e.target.value)}
                  placeholder={'{"type":"bar","title":"Exports","labels":["2019","2020"],"series":[{"name":"Exports","data":[120,90]}]}'}
                />
                <button type="button" onClick={applyVizJson} className="btn-outline mt-2 py-1.5 text-xs">Apply JSON to diagram</button>
              </details>
            </Field>
          )}

          {form.type === "assertion" && (
            <>
              <Field label="Assertion (A)">
                <textarea required rows={2} className="input resize-none" value={form.assertion} onChange={(e) => setForm({ ...form, assertion: e.target.value })} placeholder="Statement of Assertion (A)…" />
              </Field>
              <Field label="Reason (R)">
                <textarea required rows={2} className="input resize-none" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Statement of Reason (R)…" />
              </Field>
              <p className="-mt-1 text-xs text-slate-400">Now enter the four options below (e.g. "Both A and R are true and R is the correct explanation of A") and tick the correct one.</p>
            </>
          )}

          {(form.type === "statement" || form.type === "rearrange") && (
            <Field label={form.type === "rearrange" ? "Sentences (shown in their own boxes as I, II, III, IV)" : "Statements (shown numbered 1, 2, 3…)"}>
              <div className="space-y-2">
                {form.columnA.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{form.type === "rearrange" ? (["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][i] || i + 1) : i + 1}</span>
                    <input className="input" value={item} onChange={(e) => setForm({ ...form, columnA: form.columnA.map((x, xi) => (xi === i ? e.target.value : x)) })} placeholder={form.type === "rearrange" ? `Sentence ${i + 1}` : `Statement ${i + 1}`} />
                    <button type="button" onClick={() => setForm({ ...form, columnA: form.columnA.filter((_, xi) => xi !== i) })} className="flex-shrink-0 rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/30" disabled={form.columnA.length <= 2}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setForm({ ...form, columnA: [...form.columnA, ""] })} className="btn-outline py-2"><Plus className="h-4 w-4" /> {form.type === "rearrange" ? "Add sentence" : "Add statement"}</button>
              </div>
            </Field>
          )}

          {(form.type === "pair" || form.type === "pairselect") && (
            <Field label="Pairs (shown numbered 1, 2, 3… as Left — Right)">
              <div className="space-y-2">
                {form.columnA.map((left, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{i + 1}</span>
                    <input className="input" value={left} onChange={(e) => setForm((f) => ({ ...f, columnA: f.columnA.map((x, xi) => (xi === i ? e.target.value : x)) }))} placeholder="Left (e.g. Item)" />
                    <span className="flex-shrink-0 text-slate-400">—</span>
                    <input className="input" value={form.columnB[i] || ""} onChange={(e) => setForm((f) => { const cb = [...f.columnB]; while (cb.length < f.columnA.length) cb.push(""); cb[i] = e.target.value; return { ...f, columnB: cb }; })} placeholder="Right (e.g. Description)" />
                    <button type="button" onClick={() => setForm((f) => ({ ...f, columnA: f.columnA.filter((_, xi) => xi !== i), columnB: f.columnB.filter((_, xi) => xi !== i) }))} className="flex-shrink-0 rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/30" disabled={form.columnA.length <= 2}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setForm({ ...form, columnA: [...form.columnA, ""], columnB: [...form.columnB, ""] })} className="btn-outline py-2"><Plus className="h-4 w-4" /> Add pair</button>
              </div>
            </Field>
          )}

          {form.type === "table" && (
            <Field label="Table (first row = header — add any number of rows & columns)">
              <div className="overflow-x-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                <table className="border-collapse">
                  <tbody>
                    {form.tableRows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c} className="p-1">
                            <input
                              className={`input min-w-[92px] py-1.5 text-sm ${r === 0 ? "font-semibold" : ""}`}
                              value={cell}
                              onChange={(e) => setForm((f) => { const t = f.tableRows.map((rr) => [...rr]); t[r][c] = e.target.value; return { ...f, tableRows: t }; })}
                              placeholder={r === 0 ? `Header ${c + 1}` : `Row ${r} · Col ${c + 1}`}
                            />
                          </td>
                        ))}
                        <td className="p-1">
                          <button type="button" title="Remove row" onClick={() => setForm((f) => ({ ...f, tableRows: f.tableRows.filter((_, ri) => ri !== r) }))} disabled={form.tableRows.length <= 1} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => setForm((f) => ({ ...f, tableRows: [...f.tableRows, new Array(f.tableRows[0]?.length || 2).fill("")] }))} className="btn-outline py-2"><Plus className="h-4 w-4" /> Add row</button>
                <button type="button" onClick={() => setForm((f) => ({ ...f, tableRows: f.tableRows.map((rr) => [...rr, ""]) }))} className="btn-outline py-2"><Plus className="h-4 w-4" /> Add column</button>
                <button type="button" onClick={() => setForm((f) => ((f.tableRows[0]?.length || 0) > 1 ? { ...f, tableRows: f.tableRows.map((rr) => rr.slice(0, -1)) } : f))} className="btn-outline py-2" disabled={(form.tableRows[0]?.length || 0) <= 1}><Trash2 className="h-4 w-4" /> Remove column</button>
              </div>
              <p className="mt-1 text-xs text-slate-400">The table auto-sizes to the rows and columns you add. The first row is shown as the header.</p>
            </Field>
          )}

          {form.type === "matching" && (
            <>
              <Field label="Column A (items — shown numbered 1, 2, 3…)">
                <div className="space-y-2">
                  {form.columnA.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{i + 1}</span>
                      <input className="input" value={item} onChange={(e) => setForm({ ...form, columnA: form.columnA.map((x, xi) => xi === i ? e.target.value : x) })} placeholder={`Column A item ${i + 1}`} />
                      <button type="button" onClick={() => setForm({ ...form, columnA: form.columnA.filter((_, xi) => xi !== i) })} className="flex-shrink-0 rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/30" disabled={form.columnA.length <= 2}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setForm({ ...form, columnA: [...form.columnA, ""] })} className="btn-outline py-2"><Plus className="h-4 w-4" /> Add to Column A</button>
                </div>
              </Field>
              <Field label="Column B (items — shown as Roman numerals I, II, III…)">
                <div className="space-y-2">
                  {form.columnB.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-accent-100 text-xs font-bold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">{toRomanLite(i + 1)}</span>
                      <input className="input" value={item} onChange={(e) => setForm({ ...form, columnB: form.columnB.map((x, xi) => xi === i ? e.target.value : x) })} placeholder={`Column B item ${toRomanLite(i + 1)}`} />
                      <button type="button" onClick={() => setForm({ ...form, columnB: form.columnB.filter((_, xi) => xi !== i) })} className="flex-shrink-0 rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/30" disabled={form.columnB.length <= 2}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setForm({ ...form, columnB: [...form.columnB, ""] })} className="btn-outline py-2"><Plus className="h-4 w-4" /> Add to Column B</button>
                </div>
              </Field>
            </>
          )}

          <Field label={form.type === "matching" ? "Answer options (a–d) — select the correct sequence" : "Options (select the correct one)"}>
            {form.type === "matching" && (
              <p className="mb-2 text-xs text-slate-400">Write each option as a sequence, e.g. <b>1-III, 2-I, 3-IV, 4-II</b>. Tick the correct one.</p>
            )}
            <div className="space-y-2.5">
              {form.options.map((opt, i) => {
                const isCorrect = form.correct === i;
                return (
                  <div key={i} className="rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                      <input type="radio" name="correct" checked={isCorrect} onChange={() => setForm({ ...form, correct: i })} className="h-4 w-4 text-brand-600" />
                      <input required className="input" value={opt} onChange={(e) => { const o = [...form.options]; o[i] = e.target.value; setForm({ ...form, options: o }); }} placeholder={form.type === "matching" ? `Option ${String.fromCharCode(97 + i)}  (e.g. 1-III, 2-I, 3-IV, 4-II)` : `Option ${String.fromCharCode(65 + i)}`} />
                    </div>
                    {isCorrect ? (
                      <p className="mt-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">✓ Correct answer — write its detailed explanation in the "Explanation" box below.</p>
                    ) : (
                      <input
                        className="input mt-1.5 border-dashed py-2 text-xs"
                        value={form.optionExplanations[i] || ""}
                        onChange={(e) => { const o = [...form.optionExplanations]; o[i] = e.target.value; setForm({ ...form, optionExplanations: o }); }}
                        placeholder={`Brief note: why (${String.fromCharCode(65 + i)}) is wrong (optional)`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">The correct option is explained in detail in the main "Explanation" box below. Each of the other three options can have a brief note that appears when a student selects it.</p>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Difficulty">
              <select className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                <option>Easy</option><option>Medium</option><option>Hard</option>
              </select>
            </Field>
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="published">Published</option><option value="draft">Draft</option>
              </select>
            </Field>
          </div>
          <Field label="Explanation / Solution (detailed — explains the correct answer)"><textarea rows={3} className="input resize-none" value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} placeholder="Explain in detail why the correct option is right…" /></Field>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-outline">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
