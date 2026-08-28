// On-demand text extraction for common document types (Word, PowerPoint, Excel,
// CSV, plain text). Like lib/pdf.js, the heavy parsers are loaded from a CDN the
// first time they're needed, so nothing enters the app bundle and no build-time
// dependency is required (npm install is blocked here and a lockfile mismatch
// would break `npm ci` in CI). PDFs are handled separately in lib/pdf.js.

// ---- CDN loaders (script-tag style, expose a global) ----
const MAMMOTH_URL = "https://cdn.jsdelivr.net/npm/mammoth@1/mammoth.browser.min.js";
const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js";

function loadScript(src, globalName, label) {
  return new Promise((resolve, reject) => {
    if (window[globalName]) return resolve(window[globalName]);
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error(`${label} failed to load.`)));
    s.onerror = () => reject(new Error(`Couldn't load the ${label} (check your connection).`));
    document.head.appendChild(s);
  });
}

let mammothPromise = null;
const loadMammoth = () => (mammothPromise ||= loadScript(MAMMOTH_URL, "mammoth", "Word reader"));
let jszipPromise = null;
const loadJSZip = () => (jszipPromise ||= loadScript(JSZIP_URL, "JSZip", "document reader"));

// Decode the handful of XML entities that appear in Office XML text nodes.
const decodeXml = (s) =>
  String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // must be last

// Sort "slide2.xml", "slide10.xml" numerically, not lexically.
const byTrailingNumber = (a, b) => {
  const n = (s) => { const m = s.match(/(\d+)\.xml$/); return m ? +m[1] : 0; };
  return n(a) - n(b);
};

// ---- Word (.docx) ----
async function extractDocx(file) {
  const mammoth = await loadMammoth();
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return String(value || "").replace(/\n{3,}/g, "\n\n").trim();
}

// ---- PowerPoint (.pptx) — a ZIP of slide XML; text lives in <a:t> runs ----
async function extractPptx(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort(byTrailingNumber);
  const out = [];
  for (const name of slides) {
    const xml = await zip.files[name].async("string");
    // Split into paragraphs (<a:p>) so lines are preserved; join <a:t> per line.
    const paras = xml.split(/<\/a:p>/).map((p) =>
      [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join("")
    );
    const slideText = paras.map((l) => l.trim()).filter(Boolean).join("\n");
    if (slideText) out.push(slideText);
  }
  return out.join("\n\n").trim();
}

// ---- Excel (.xlsx) — a ZIP; strings are pooled in sharedStrings.xml ----
async function extractXlsx(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // Shared string pool: each <si> is one string (may contain several <t> runs).
  let shared = [];
  if (zip.files["xl/sharedStrings.xml"]) {
    const s = await zip.files["xl/sharedStrings.xml"].async("string");
    shared = [...s.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => decodeXml(x[1])).join("")
    );
  }

  const sheets = Object.keys(zip.files)
    .filter((f) => /xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort(byTrailingNumber);
  const rows = [];
  for (const name of sheets) {
    const xml = await zip.files[name].async("string");
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      // Cells are <c ...>...</c> or self-closing <c .../> (empty).
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] || "";
        const inner = c[2] || "";
        const type = (attrs.match(/\bt="([^"]*)"/) || [])[1] || "";
        let val = "";
        if (type === "s") {
          const idx = (inner.match(/<v>([^<]*)<\/v>/) || [])[1];
          if (idx != null) val = shared[parseInt(idx, 10)] || "";
        } else if (type === "inlineStr") {
          val = [...inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => decodeXml(m[1])).join("");
        } else {
          val = decodeXml((inner.match(/<v>([^<]*)<\/v>/) || [])[1] || "");
        }
        cells.push(val);
      }
      if (cells.some((v) => String(v).trim())) rows.push(cells.join(", "));
    }
  }
  return rows.join("\n").trim();
}

// Extract plain text from a Word/PowerPoint/Excel/CSV/text file. PDFs are NOT
// handled here — the caller routes those to lib/pdf.js (which also does OCR).
export async function extractDocText(file) {
  const name = (file.name || "").toLowerCase();
  const type = file.type || "";

  if (name.endsWith(".docx")) return extractDocx(file);
  if (name.endsWith(".pptx")) return extractPptx(file);
  if (name.endsWith(".xlsx")) return extractXlsx(file);

  // Plain-text family: CSV/TSV/TXT/Markdown/JSON and anything text/*.
  if (/\.(csv|tsv|txt|md|markdown|json|rtf)$/.test(name) || type.startsWith("text/")) {
    const raw = await file.text();
    // RTF: strip control words/groups to leave readable text.
    if (name.endsWith(".rtf")) {
      return raw.replace(/\\[a-z]+-?\d* ?/gi, " ").replace(/[{}]/g, "").replace(/\s{2,}/g, " ").trim();
    }
    return raw.trim();
  }

  // Legacy binary Office formats can't be parsed reliably in the browser.
  if (name.endsWith(".doc")) throw new Error("Old .doc files aren't supported — open it and “Save As” .docx, then upload.");
  if (name.endsWith(".ppt")) throw new Error("Old .ppt files aren't supported — “Save As” .pptx, then upload.");
  if (name.endsWith(".xls")) throw new Error("Old .xls files aren't supported — “Save As” .xlsx, then upload.");

  // Last resort: try reading as text.
  const fallback = (await file.text().catch(() => "")).trim();
  if (fallback) return fallback;
  throw new Error("Unsupported file type. Use PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), CSV or text.");
}

// True for the non-PDF document types this module handles.
export function isSupportedDoc(file) {
  const name = (file?.name || "").toLowerCase();
  const type = file?.type || "";
  return (
    /\.(docx|pptx|xlsx|csv|tsv|txt|md|markdown|json|rtf|doc|ppt|xls)$/.test(name) ||
    type.startsWith("text/")
  );
}
