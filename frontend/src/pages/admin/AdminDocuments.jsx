import { useEffect, useState, useRef } from "react";
import { FileText, Upload, Plus, Pencil, Trash2, X, Loader2, Save, Download, ScanText, Maximize2, Minimize2, Copy, Check, Wand2, Eraser, Eye, Pencil as PencilIcon, FileDown, Type, PenLine } from "lucide-react";
import katex from "katex";
import { documentService, aiService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";
import { questionsToCsv } from "../../components/admin/BulkUploadQuestions";
import RichText from "../../components/ui/RichText";
import RichEditor from "../../components/ui/RichEditor";

// Is this string HTML (from the Word editor) rather than plain text?
const isHtml = (s) => /<\/?[a-z][\s\S]*>/i.test(String(s || ""));

// Convert the Word-editor HTML back to plain text for the AI/Clean/CSV pipeline
// (which all work on plain text). Block tags become line breaks; list items get
// a bullet. Plain-text input passes through unchanged.
function htmlToText(html) {
  const s = String(html || "");
  if (!isHtml(s)) return s;
  const prepped = s
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\u2022 ")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n");
  const el = document.createElement("div");
  el.innerHTML = prepped;
  return (el.textContent || el.innerText || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// --- PDF export helpers: turn the raw document text into formatted HTML
// (headings → bold, **bold**, and $…$ math via KaTeX) for the print window. ---
const escapeHtml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inlineToHtml(text) {
  const regex = /\$\$([^$]+)\$\$|\$([^$]+)\$|<u>([\s\S]*?)<\/u>|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|==([^=\n]+)==|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    if (m[1] != null || m[2] != null) {
      try { out += katex.renderToString(m[1] ?? m[2], { throwOnError: false, displayMode: m[1] != null }); }
      catch { out += escapeHtml(m[0]); }
    } else if (m[3] != null) {
      out += `<u>${escapeHtml(m[3])}</u>`;
    } else if (m[4] != null || m[5] != null) {
      out += `<strong>${escapeHtml(m[4] ?? m[5])}</strong>`;
    } else if (m[6] != null) {
      out += `<del>${escapeHtml(m[6])}</del>`;
    } else if (m[7] != null) {
      out += `<mark>${escapeHtml(m[7])}</mark>`;
    } else {
      out += `<em>${escapeHtml(m[8] ?? m[9])}</em>`;
    }
    last = regex.lastIndex;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}

function contentToHtml(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*<!--\s*pagebreak\s*-->\s*$/i.test(line)) return '<div class="pb"></div>';
      const h = line.match(/^\s*(#{1,6})\s*(.+?)\s*$/);
      if (h) return `<p class="h h${h[1].length}">${inlineToHtml(h[2])}</p>`;
      const b = line.match(/^\s*[-*]\s+(.*)$/);
      if (b) return `<p class="li">&bull; ${inlineToHtml(b[1])}</p>`;
      if (line.trim() === "") return '<div class="sp"></div>';
      return `<p>${inlineToHtml(line)}</p>`;
    })
    .join("\n");
}

// --- "Copy for Word" helpers: like the PDF export above, but emit MathML for
// the math instead of KaTeX's visual HTML. Word 365, OneNote and Google Docs
// convert pasted MathML into their OWN editable equations — so copying a
// document and pasting there turns "$x^2$" into a real equation (not literal
// LaTeX text). Plain-text apps (Notes, etc.) receive the raw text instead. ---

// Pull out the bare <math>…</math> (MathML) that KaTeX embeds in its output.
function latexToMathML(latex, displayMode) {
  try {
    const html = katex.renderToString(latex, { throwOnError: false, displayMode });
    const m = html.match(/<math[\s\S]*?<\/math>/i);
    return m ? m[0] : escapeHtml(latex);
  } catch {
    return escapeHtml(latex);
  }
}

// Inline formatter that renders $…$/$$…$$ as MathML (bold/italic/etc. as HTML tags).
function inlineToMathmlHtml(text) {
  const regex = /\$\$([^$]+)\$\$|\$([^$]+)\$|<u>([\s\S]*?)<\/u>|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|==([^=\n]+)==|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    if (m[1] != null || m[2] != null) {
      out += latexToMathML(m[1] ?? m[2], m[1] != null);
    } else if (m[3] != null) {
      out += `<u>${escapeHtml(m[3])}</u>`;
    } else if (m[4] != null || m[5] != null) {
      out += `<strong>${escapeHtml(m[4] ?? m[5])}</strong>`;
    } else if (m[6] != null) {
      out += `<del>${escapeHtml(m[6])}</del>`;
    } else if (m[7] != null) {
      out += `<mark>${escapeHtml(m[7])}</mark>`;
    } else {
      out += `<em>${escapeHtml(m[8] ?? m[9])}</em>`;
    }
    last = regex.lastIndex;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}

// Whole document → rich HTML (headings/lists/formatting + MathML) for the clipboard.
function contentToMathmlHtml(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*<!--\s*pagebreak\s*-->\s*$/i.test(line)) return "<br/>";
      const h = line.match(/^\s*(#{1,6})\s*(.+?)\s*$/);
      if (h) { const lvl = Math.min(h[1].length, 6); return `<h${lvl}>${inlineToMathmlHtml(h[2])}</h${lvl}>`; }
      const b = line.match(/^\s*[-*]\s+(.*)$/);
      if (b) return `<p style="margin:0 0 0 1.2em">&bull; ${inlineToMathmlHtml(b[1])}</p>`;
      if (line.trim() === "") return "<p>&nbsp;</p>";
      return `<p>${inlineToMathmlHtml(line)}</p>`;
    })
    .join("");
}

const LETTERS = ["A", "B", "C", "D"];
const COL_A = ["1", "2", "3", "4", "5", "6", "7", "8"];
const COL_B = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const CLOSING = {
  statement: "Which of the statement(s) given above is/are correct?",
  pair: "How many of the above pairs are correctly matched?",
  pairselect: "Which of the pairs given above is/are correctly matched?",
};

// Format ONE extracted question as clean, answer-free text, respecting its type
// (matching / pair / pairselect / statement / assertion / table / mcq).
function formatQuestionText(q, idx) {
  const clean = (s) => String(s == null ? "" : s).trim();
  const opts = (q.options || []).map(clean).filter(Boolean);
  const optionLines = opts.map((o, j) => `${LETTERS[j] || j + 1}) ${o}`);
  const lines = [`${idx + 1}. ${clean(q.text)}`];
  const A = (q.columnA || []).map(clean).filter(Boolean);
  const B = (q.columnB || []).map(clean).filter(Boolean);

  switch (q.type) {
    case "assertion":
      if (clean(q.assertion)) lines.push(`Assertion (A): ${clean(q.assertion)}`);
      if (clean(q.reason)) lines.push(`Reason (R): ${clean(q.reason)}`);
      break;
    case "statement":
      A.forEach((s, j) => lines.push(`${j + 1}. ${s}`));
      lines.push(CLOSING.statement);
      break;
    case "pair":
    case "pairselect": {
      const n = Math.max(A.length, B.length);
      for (let j = 0; j < n; j++) lines.push(`${j + 1}. ${A[j] || ""} — ${B[j] || ""}`);
      lines.push(CLOSING[q.type]);
      break;
    }
    case "matching":
      lines.push("Column A:");
      A.forEach((x, j) => lines.push(`   ${COL_A[j] || j + 1}. ${x}`));
      lines.push("Column B:");
      B.forEach((x, j) => lines.push(`   ${COL_B[j] || j + 1}. ${x}`));
      break;
    case "table":
      (q.tableRows || []).forEach((row) => lines.push(`   ${Array.isArray(row) ? row.join(" | ") : clean(row)}`));
      break;
    default:
      break;
  }
  lines.push(...optionLines);
  return lines.join("\n");
}

// One-click, offline text cleaner for extracted / OCR'd exam papers. Strips the
// boilerplate that scanned government PDFs carry — file numbers, eOffice stamps,
// "(Set-A)", "[P.T.O.]", page markers, board headers — while keeping the actual
// questions. Runs entirely in the browser (no AI / no network).
const JUNK_LINE_PATTERNS = [
  /^file\s*no\b/i,                                 // File No. JKSSB-COEOEXAM(UT)/…
  /generated\s+from\s+e?-?\s*office/i,             // Generated from eOffice by …
  /\bcomputer\s*no\b/i,                            // (Computer No. 7593614)
  /service\s+selection\s+board/i,                  // …SERVICE SELECTION BOARD…
  /outside\s+sec(?:retariat|tt)\b/i,               // (OUTSIDE SECTT)
  /\bproject\s+manager\b/i,                        // …, PROJECT MANAGER, …
  /^\(?\s*set\s*[-–]?\s*[a-z]\s*\)?[\s.)\]]*$/i,    // (Set-A) on its own line
  /^\s*page\s*\d+/i,                               // Page 3
  /^[[(]\s*\d{1,4}\s*[\])]$/,                       // (15)  [15]  page markers
  /^\s*\d{3,}(?:\s*[/\\]\s*\w+){2,}/,               // 8233675/2026/0/0 Clerical Hall JKSSB
  /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/,               // 08/06/2026 date stamps
];

function cleanExtractedText(raw) {
  const original = String(raw || "");
  if (!original.trim()) return { text: original, removed: 0 };
  // First scrub stamps that sit INLINE on the same line as real content.
  const scrubbed = original
    .replace(/\[[^\]\n]*\bP\.?\s*T\.?\s*O\.?[^\]\n]*\]/gi, " ")  // [P.T.O.15]
    .replace(/\(\s*computer\s*no\.?[^)\n]*\)/gi, " ")            // (Computer No. …)
    .replace(/\(\s*set\s*[-–]?\s*[a-z]\s*\)/gi, " ")            // (Set-A)
    .replace(/\bP\.?\s*T\.?\s*O\.?\b/gi, " ");                   // stray P.T.O.
  let removed = 0;
  const kept = scrubbed.split(/\r?\n/).filter((line) => {
    const t = line.trim();
    if (!t) return true; // keep blanks now; collapse runs later
    if (JUNK_LINE_PATTERNS.some((re) => re.test(t))) { removed++; return false; }
    return true;
  });
  const text = kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")   // trailing whitespace
    .replace(/\n{3,}/g, "\n\n")   // collapse blank-line runs
    .trim();
  return { text, removed };
}

// Inline-math toolbar: LaTeX snippets render via KaTeX inside $…$; plain symbols
// are inserted as-is. See MathText ($…$ inline, $$…$$ block).
const MATH_BTNS = [
  { t: "$ $", ins: ["$", "$"], title: "Wrap selection in inline math" },
  { t: "x²", ins: ["$x^{2}$"] },
  { t: "xₙ", ins: ["$x_{n}$"] },
  { t: "a⁄b", ins: ["$\\frac{a}{b}$"] },
  { t: "√", ins: ["$\\sqrt{x}$"] },
  { t: "×", ins: ["×"] },
  { t: "÷", ins: ["÷"] },
  { t: "π", ins: ["π"] },
  { t: "≤", ins: ["≤"] },
  { t: "≥", ins: ["≥"] },
  { t: "≠", ins: ["≠"] },
  { t: "°", ins: ["°"] },
  { t: "→", ins: ["→"] },
];

// Word-like text-formatting buttons. `wrap` surrounds the selection; `line`
// prefixes the current line. All produce plain-text markers that the Render
// view and PDF export format (and that stay compatible with Convert/Copy/Clean).
const FORMAT_BTNS = [
  { t: "B", title: "Bold", wrap: ["**", "**"], cls: "font-bold" },
  { t: "I", title: "Italic", wrap: ["*", "*"], cls: "italic" },
  { t: "U", title: "Underline", wrap: ["<u>", "</u>"], cls: "underline" },
  { t: "S", title: "Strikethrough", wrap: ["~~", "~~"], cls: "line-through" },
  { t: "Mark", title: "Highlight", wrap: ["==", "=="], cls: "bg-yellow-200 text-slate-900" },
  { t: "H1", title: "Heading 1", line: "# " },
  { t: "H2", title: "Heading 2", line: "## " },
  { t: "H3", title: "Heading 3", line: "### " },
  { t: "• List", title: "Bullet list", line: "- " },
  { t: "1. List", title: "Numbered list", line: "1. " },
  { t: "⤶ Page", title: "Page break — start a new A4 page", wrap: ["\n\n<!-- pagebreak -->\n\n", ""] },
];

const blank = { id: null, title: "", content: "", sourceName: "", pages: 0 };

export default function AdminDocuments() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null); // null | { ...blank }
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(null); // { page, total }
  const [pdfFile, setPdfFile] = useState(null); // kept so OCR can re-read a scanned PDF
  const [scanned, setScanned] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedRich, setCopiedRich] = useState(false);
  const [showMath, setShowMath] = useState(false);
  const [preview, setPreview] = useState(false); // render $…$ math in its actual form (plain-text mode)
  const [docMode, setDocMode] = useState("rich"); // "rich" (Word editor) | "text" (plain text)
  const [richFailed, setRichFailed] = useState(false); // Quill couldn't load → use plain text
  const [seedKey, setSeedKey] = useState(0); // bump to push programmatic content into the Word editor
  const [converting, setConverting] = useState(""); // "" | "text" | "csv"
  const [convertMsg, setConvertMsg] = useState("");
  const taRef = useRef(null);

  const bumpSeed = () => setSeedKey((k) => k + 1);
  const useRich = docMode === "rich" && !richFailed;
  const contentText = editor ? htmlToText(editor.content) : "";
  const hasContent = contentText.trim().length > 0;

  // Reset transient editor UI whenever the editor closes.
  useEffect(() => {
    if (!editor) { setFullscreen(false); setShowMath(false); setPreview(false); setConvertMsg(""); }
  }, [editor]);

  // Insert text at the textarea caret (wrapping the selection when `after` given).
  const insertMath = (before, after = "") => {
    const ta = taRef.current;
    const val = editor?.content || "";
    const start = ta?.selectionStart ?? val.length;
    const end = ta?.selectionEnd ?? start;
    const sel = val.slice(start, end);
    const next = val.slice(0, start) + before + sel + after + val.slice(end);
    setEditor((ed) => ({ ...ed, content: next }));
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = start + before.length + sel.length + after.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // Prefix the current line (heading / list marker), skipping if already there.
  const applyLinePrefix = (prefix) => {
    const ta = taRef.current;
    const val = editor?.content || "";
    const caret = ta?.selectionStart ?? val.length;
    const lineStart = val.lastIndexOf("\n", caret - 1) + 1;
    if (val.slice(lineStart).startsWith(prefix)) return; // already applied
    const next = val.slice(0, lineStart) + prefix + val.slice(lineStart);
    setEditor((ed) => ({ ...ed, content: next }));
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = caret + prefix.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // Convert the document text into the app's typed questions (preview only).
  // Convert the document text into questions, written back into the text box so
  // it can be saved and copied. Two output formats:
  //   "text" → clean, ANSWER-FREE readable text (type-aware: matching → Column
  //            A/B, statement → numbered statements, assertion → A/R, etc.).
  //   "csv"  → your bulk-upload CSV format (all question types, WITH answers)
  //            via questionsToCsv() — ready to paste straight into Bulk Upload.
  const runConvert = async (format) => {
    const src = htmlToText(editor?.content).trim();
    if (!src) { setError("Add some text first."); return; }
    setConverting(format);
    setConvertMsg("Converting to questions…");
    try {
      const { jobId } = await aiService.extract({ content: src });
      if (!jobId) throw new Error("Couldn't start conversion.");
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let done = false;
      for (let i = 0; i < 240 && !done; i++) {
        await sleep(2000);
        let s;
        try { s = await aiService.job(jobId); } catch { continue; }
        if (s.status === "done") {
          const qs = s.questions || [];
          const out = format === "csv"
            ? questionsToCsv(qs)
            : qs.map((q, idx) => formatQuestionText(q, idx)).join("\n\n");
          if (out.trim()) { setEditor((ed) => ({ ...ed, content: out })); bumpSeed(); }
          setConvertMsg(format === "csv"
            ? `✓ ${qs.length} question(s) in your bulk-upload (CSV) format — Save/Copy, or paste into Bulk Upload.`
            : `✓ Converted ${qs.length} question(s) — answers removed. Review, then Save or Copy.`);
          done = true;
        } else if (s.status === "error") { setConvertMsg(s.error || "Conversion failed."); done = true; }
        else setConvertMsg(`Converting… ${s.count || 0} question(s) so far`);
      }
      if (!done) setConvertMsg("Still working — large text; try again.");
    } catch (e) {
      setConvertMsg(e.message || "Conversion failed.");
    } finally {
      setConverting("");
    }
  };

  // Remove exam-paper boilerplate from the WHOLE text box (offline), leaving
  // only the questions — run this before "Convert to questions".
  const cleanText = () => {
    const src = htmlToText(editor?.content);
    if (!src.trim()) { setError("Add some text first."); return; }
    const { text, removed } = cleanExtractedText(src);
    setEditor((ed) => ({ ...ed, content: text }));
    bumpSeed();
    setConvertMsg(removed
      ? `✓ Cleaned — removed ${removed} boilerplate line(s) (file numbers, stamps, page markers).`
      : "Nothing to clean — no boilerplate lines found.");
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(htmlToText(editor?.content));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — your browser blocked clipboard access.");
    }
  };

  // Copy the document as rich HTML with MathML equations. Pasting into Word,
  // OneNote or Google Docs turns each "$…$" into a real, editable equation;
  // plain-text apps receive the raw text (LaTeX) via the text/plain flavour.
  const copyRich = async () => {
    const raw = htmlToText(editor?.content);
    if (!raw.trim()) { setError("Add some text first."); return; }
    const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4">${contentToMathmlHtml(raw)}</div>`;
    try {
      if (navigator.clipboard && typeof window.ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([raw], { type: "text/plain" }),
          }),
        ]);
      } else {
        // Fallback for browsers without the async clipboard API: copy rich HTML
        // by selecting a hidden contentEditable node and running execCommand.
        const holder = document.createElement("div");
        holder.setAttribute("contenteditable", "true");
        holder.style.cssText = "position:fixed;left:-9999px;top:0;white-space:pre-wrap";
        holder.innerHTML = html;
        document.body.appendChild(holder);
        const range = document.createRange();
        range.selectNodeContents(holder);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("copy");
        sel.removeAllRanges();
        document.body.removeChild(holder);
      }
      setCopiedRich(true);
      setTimeout(() => setCopiedRich(false), 1500);
    } catch {
      setError("Couldn't copy — your browser blocked clipboard access.");
    }
  };

  const load = () => {
    setLoading(true);
    setError("");
    documentService
      .list()
      .then(setDocs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openNew = () => { setEditor({ ...blank }); bumpSeed(); };

  const openEdit = async (row) => {
    setBusyId(row._id);
    try {
      const full = await documentService.get(row._id);
      setEditor({ id: full._id, title: full.title || "", content: full.content || "", sourceName: full.sourceName || "", pages: full.pages || 0 });
      bumpSeed(); // push the loaded content into the Word editor
      // In plain-text mode, open a saved document in its rendered form.
      setPreview(!!(full.content || "").trim());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId("");
    }
  };

  // Extract PDF text (in the browser) into the editor's content field.
  const onPdf = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF file.");
      return;
    }
    // If no editor is open (uploading fresh), open a blank one first.
    const base = editor || { ...blank };
    setPdfBusy(true);
    setPdfProgress(null);
    setError("");
    setPdfFile(file);
    setScanned(false);
    const niceTitle = file.name.replace(/\.pdf$/i, "");
    try {
      const { extractPdfText, looksScanned } = await import("../../lib/pdf");
      let total = 0;
      const text = await extractPdfText(file, (page, t) => { total = t; setPdfProgress({ page, total: t }); });
      // Scanned/image PDFs (no real text layer) — open the editor so the OCR
      // button is available, and don't fill it with the useless stamp text.
      if (!text || looksScanned(text)) {
        setScanned(true);
        setEditor({ ...base, title: base.title?.trim() ? base.title : niceTitle, sourceName: file.name, pages: total });
        setError(`“${file.name}” looks like a scanned PDF — use “Read with OCR” below to read the pages.`);
        return;
      }
      setEditor({
        ...base,
        title: base.title?.trim() ? base.title : niceTitle,
        content: base.content?.trim() ? `${htmlToText(base.content)}\n\n${text}` : text,
        sourceName: file.name,
        pages: total,
      });
      bumpSeed();
    } catch (err) {
      setError(`PDF read failed: ${err.message}`);
    } finally {
      setPdfBusy(false);
    }
  };

  // Read a scanned/image PDF with OCR (slower) into the editor's text.
  const runOcr = async () => {
    if (!pdfFile) return;
    setOcrBusy(true);
    setOcrProgress(null);
    setError("");
    try {
      const { ocrPdfText } = await import("../../lib/pdf");
      let total = 0;
      const text = await ocrPdfText(pdfFile, (page, t) => { total = t; setOcrProgress({ page, total: t }); });
      if (!text) { setError("OCR couldn't read any text from this PDF."); return; }
      setEditor((ed) => {
        const b = ed || { ...blank };
        return {
          ...b,
          title: b.title?.trim() ? b.title : pdfFile.name.replace(/\.pdf$/i, ""),
          content: b.content?.trim() ? `${htmlToText(b.content)}\n\n${text}` : text,
          sourceName: pdfFile.name,
          pages: total,
        };
      });
      bumpSeed();
      setScanned(false);
    } catch (e) {
      setError(`OCR failed: ${e.message}`);
    } finally {
      setOcrBusy(false);
    }
  };

  const save = async () => {
    if (!editor?.title.trim()) { setError("Please enter a title."); return; }
    setSaving(true);
    setError("");
    try {
      const payload = { title: editor.title.trim(), content: editor.content, sourceName: editor.sourceName, pages: editor.pages };
      if (editor.id) await documentService.update(editor.id, payload);
      else await documentService.create(payload);
      setEditor(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete “${row.title}”? This cannot be undone.`)) return;
    setBusyId(row._id);
    try {
      await documentService.remove(row._id);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId("");
    }
  };

  const downloadTxt = () => {
    if (!editor) return;
    const blob = new Blob([editor.content || ""], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(editor.title || "document").replace(/[^\w.-]+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Download as PDF: render the document (headings/bold/math) into a print
  // window and open the browser's print dialog → "Save as PDF". No extra
  // dependency needed, and the math/markdown come out formatted.
  const downloadPdf = () => {
    if (!hasContent) { setError("Add some text first."); return; }
    const title = editor.title?.trim() || "document";
    // Word-editor content is already HTML → print it as-is; plain-text content
    // goes through the markdown→HTML renderer. Both export to A4.
    const bodyHtml = isHtml(editor.content) ? editor.content : contentToHtml(editor.content);
    const win = window.open("", "_blank");
    if (!win) { setError("Your browser blocked the pop-up — allow pop-ups for this site to download a PDF."); return; }
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">` +
      `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css" crossorigin="anonymous">` +
      `<style>` +
      `@page{size:A4;margin:18mm}` +
      `*{box-sizing:border-box}` +
      `body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.6;color:#0f172a;margin:0}` +
      `h1.title{font-size:22px;margin:0 0 16px;border-bottom:1px solid #e2e8f0;padding-bottom:8px}` +
      `p{margin:0 0 6px;white-space:pre-wrap;word-wrap:break-word}` +
      `.h{font-weight:700;margin:12px 0 4px}.h1{font-size:20px}.h2{font-size:18px}.h3,.h4,.h5,.h6{font-size:15px}` +
      `.li{padding-left:1em;text-indent:-0.5em}` +
      `.sp{height:8px}` +
      `mark{background:#fef08a;padding:0 2px}` +
      `.pb{page-break-after:always;break-after:page;height:0}` +
      `.ql-editor{padding:0}.ql-align-center{text-align:center}.ql-align-right{text-align:right}.ql-align-justify{text-align:justify}` +
      `@media screen{body{max-width:210mm;margin:16px auto;padding:0 18mm}}` +
      `</style></head><body>` +
      `<h1 class="title">${escapeHtml(title)}</h1>` +
      `<div class="ql-editor ql-snow">${bodyHtml}</div>` +
      `<scr` + `ipt>window.onload=function(){setTimeout(function(){window.focus();window.print();},350)};</scr` + `ipt>` +
      `</body></html>`
    );
    win.document.close();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><FileText className="h-6 w-6 text-brand-600" /> Documents</h1>
          <p className="text-slate-500 dark:text-slate-400">Upload a PDF to extract its text (scanned PDFs can be read with OCR), or write a note — then save it here.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`btn-primary cursor-pointer ${pdfBusy ? "pointer-events-none opacity-70" : ""}`}>
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={onPdf} disabled={pdfBusy} />
            {pdfBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading{pdfProgress ? ` ${pdfProgress.page}/${pdfProgress.total}` : "…"}</> : <><Upload className="h-4 w-4" /> Upload PDF</>}
          </label>
          <button onClick={openNew} className="btn-outline"><Plus className="h-4 w-4" /> New note</button>
        </div>
      </div>

      {error && !editor && (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</div>
      )}

      {loading ? (
        <Loading label="Loading documents..." />
      ) : error && !docs.length ? (
        <ErrorState message={error} onRetry={load} />
      ) : !docs.length ? (
        <EmptyState message="No documents yet — upload a PDF or create a note to get started." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60">
              <tr>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Added</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d._id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-semibold">
                    <button onClick={() => openEdit(d)} className="text-left hover:text-brand-600">{d.title}</button>
                  </td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                    {d.sourceName ? <span>{d.sourceName}{d.pages ? ` · ${d.pages}p` : ""}</span> : <span className="italic text-slate-400">note</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{new Date(d.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(d)} disabled={busyId === d._id} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800" title="Open / edit">
                        {busyId === d._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                      </button>
                      <button onClick={() => remove(d)} disabled={busyId === d._id} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <div className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 ${fullscreen ? "p-0" : "p-4"}`}>
          <div className={`animate-scale-in card ${fullscreen ? "flex h-screen w-screen max-w-none flex-col rounded-none p-4" : "my-8 w-full max-w-3xl p-6"}`}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold"><FileText className="h-5 w-5 text-brand-600" /> {editor.id ? "Edit document" : "New document"}</h3>
              <button onClick={() => { setEditor(null); setError(""); }}><X className="h-5 w-5" /></button>
            </div>

            {error && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</div>}

            <label className="mb-1 block text-sm font-semibold">Title</label>
            <input className="input mb-4" value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} placeholder="Document title" />

            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-semibold">Text</label>
              <div className="flex items-center gap-2">
                <label className={`btn-outline cursor-pointer !py-1 !text-xs ${pdfBusy ? "pointer-events-none opacity-70" : ""}`}>
                  <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={onPdf} disabled={pdfBusy} />
                  {pdfBusy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading{pdfProgress ? ` ${pdfProgress.page}/${pdfProgress.total}` : "…"}</> : <><Upload className="h-3.5 w-3.5" /> Load from PDF</>}
                </label>
                {pdfFile && (
                  <button type="button" onClick={runOcr} disabled={ocrBusy || pdfBusy} className={`!py-1 !text-xs ${scanned ? "btn-primary" : "btn-outline"}`}>
                    {ocrBusy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> OCR {ocrProgress?.page || 0}/{ocrProgress?.total || "?"}</> : <><ScanText className="h-3.5 w-3.5" /> Read with OCR</>}
                  </button>
                )}
                <button type="button" onClick={cleanText} className="btn-outline !py-1 !text-xs" title="Remove headers, file numbers, stamps & page markers — keep only questions">
                  <Eraser className="h-3.5 w-3.5" /> Clean text
                </button>
                <button type="button" onClick={copyText} className="btn-outline !py-1 !text-xs" title="Copy the raw text (equations stay as $…$ LaTeX)">
                  {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
                <button type="button" onClick={copyRich} className="btn-outline !py-1 !text-xs" title="Copy with equations — paste into Word, OneNote or Google Docs and each $…$ becomes a real, editable equation">
                  {copiedRich ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy for Word</>}
                </button>
                <button type="button" onClick={downloadTxt} className="btn-outline !py-1 !text-xs"><Download className="h-3.5 w-3.5" /> .txt</button>
                <button type="button" onClick={downloadPdf} className="btn-outline !py-1 !text-xs" title="Download as PDF (A4)"><FileDown className="h-3.5 w-3.5" /> PDF</button>
                <button type="button" onClick={() => setDocMode((m) => (m === "rich" ? "text" : "rich"))} disabled={richFailed}
                  className={`!py-1 !text-xs ${useRich ? "btn-primary" : "btn-outline"}`}
                  title={useRich ? "Word editor (click for the plain-text editor)" : "Plain-text editor (click for the Word editor)"}>
                  <PenLine className="h-3.5 w-3.5" /> {useRich ? "Word editor" : "Plain text"}
                </button>
                {!useRich && (
                  <button type="button" onClick={() => setShowMath((v) => !v)} className={`!py-1 !text-xs ${showMath ? "btn-primary" : "btn-outline"}`} title="Formatting: bold, italic, headings, lists, math">
                    <Type className="h-3.5 w-3.5" /> Format
                  </button>
                )}
                <button type="button" onClick={() => setPreview((v) => !v)} className={`!py-1 !text-xs ${preview ? "btn-primary" : "btn-outline"}`} title={preview ? "Back to editing" : "Render — full A4 preview of the formatted document"}>
                  {preview ? <><PencilIcon className="h-3.5 w-3.5" /> Edit</> : <><Eye className="h-3.5 w-3.5" /> Render</>}
                </button>
                <button type="button" onClick={() => setFullscreen((f) => !f)} className="btn-outline !py-1 !text-xs" title={fullscreen ? "Exit full screen" : "Full screen"}>
                  {fullscreen ? <><Minimize2 className="h-3.5 w-3.5" /> Exit</> : <><Maximize2 className="h-3.5 w-3.5" /> Full screen</>}
                </button>
              </div>
            </div>

            {!useRich && showMath && (
              <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60">
                {FORMAT_BTNS.map((b, i) => (
                  <button key={`f${i}`} type="button" title={b.title}
                    onClick={() => (b.wrap ? insertMath(...b.wrap) : applyLinePrefix(b.line))}
                    className={`rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:bg-slate-900 ${b.cls || ""}`}>
                    {b.t}
                  </button>
                ))}
                <span className="mx-1 h-5 w-px self-center bg-slate-300 dark:bg-slate-600" />
                {MATH_BTNS.map((b, i) => (
                  <button key={`m${i}`} type="button" onClick={() => insertMath(...b.ins)} title={b.title || ""}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:bg-slate-900">
                    {b.t}
                  </button>
                ))}
                <span className="ml-auto self-center text-[11px] text-slate-400">Select text, then a button · or use the Render/PDF buttons to see it formatted</span>
              </div>
            )}

            {preview ? (
              <div
                className={`overflow-auto rounded-lg border border-slate-200 bg-slate-200/70 p-4 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-800 ${fullscreen ? "min-h-0 flex-1" : "max-h-[72vh]"}`}
                onDoubleClick={() => setPreview(false)}
                title="Double-click to edit"
              >
                {!hasContent ? (
                  <span className="text-slate-400">Nothing to render yet.</span>
                ) : isHtml(editor.content) ? (
                  <div
                    className="ql-editor ql-snow mx-auto w-full max-w-[794px] rounded-sm bg-white p-[40px] text-slate-900 shadow-lg sm:min-h-[1050px]"
                    dangerouslySetInnerHTML={{ __html: editor.content }}
                  />
                ) : (
                  <RichText>{editor.content}</RichText>
                )}
              </div>
            ) : useRich ? (
              <RichEditor
                value={editor.content}
                seedKey={seedKey}
                fullscreen={fullscreen}
                onChange={(html) => setEditor((ed) => ({ ...ed, content: html }))}
                onFail={() => { setRichFailed(true); setDocMode("text"); }}
              />
            ) : (
              <textarea
                ref={taRef}
                rows={16}
                className={`input resize-y font-mono text-xs ${fullscreen ? "min-h-0 flex-1" : ""}`}
                value={editor.content}
                onChange={(e) => setEditor({ ...editor, content: e.target.value })}
                placeholder="Upload a PDF to fill this, or type/paste text here…"
              />
            )}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">
                {contentText.length.toLocaleString()} characters
                {editor.sourceName ? ` · from ${editor.sourceName}${editor.pages ? ` (${editor.pages} pages)` : ""}` : ""}
              </p>
              {hasContent && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => runConvert("text")} disabled={!!converting} className="btn-outline !py-1 !text-xs">
                    {converting === "text" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Converting…</> : <><Wand2 className="h-3.5 w-3.5" /> Convert to questions</>}
                  </button>
                  <button type="button" onClick={() => runConvert("csv")} disabled={!!converting} className="btn-outline !py-1 !text-xs" title="Output in your bulk-upload CSV format (all question types, with answers)">
                    {converting === "csv" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Converting…</> : <><FileText className="h-3.5 w-3.5" /> To my format (CSV)</>}
                  </button>
                </div>
              )}
            </div>
            {convertMsg && <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{convertMsg}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => { setEditor(null); setError(""); }} className="btn-outline">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> Save</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
