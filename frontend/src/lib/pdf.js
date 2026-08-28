// On-demand PDF text extraction in the browser.
//
// pdf.js is loaded from a CDN the first time a PDF is uploaded, so it never
// enters the app bundle and needs no build-time dependency (npm install here is
// blocked, and a lockfile mismatch would break `npm ci` in CI). The jsdelivr
// "@4" major range guarantees the library and its worker resolve to the same
// existing version.
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build";

let libPromise = null;
function loadPdfjs() {
  if (!libPromise) {
    // @vite-ignore keeps Vite from trying to bundle/resolve the CDN URL — it
    // stays a native runtime dynamic import in the browser.
    libPromise = import(/* @vite-ignore */ `${PDFJS}/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return libPromise;
}

// Rebuild readable, line-broken text from pdf.js text items. pdf.js returns
// small text fragments with position info; joining them all with spaces (the
// old behaviour) destroyed line breaks, so numbered questions ("1.", "2.") no
// longer started a line and the question detector/splitter couldn't find them.
// Here we start a new line when pdf.js flags an end-of-line (hasEOL) or when the
// vertical position (transform[5]) jumps between fragments.
function itemsToText(items) {
  const lines = [];
  let cur = "";
  let lastY = null;
  for (const it of items) {
    if (!it || typeof it.str !== "string") continue;
    const y = Array.isArray(it.transform) ? it.transform[5] : null;
    const yJumped = lastY !== null && y !== null && Math.abs(y - lastY) > 2;
    if (yJumped) { lines.push(cur); cur = it.str; }
    else { cur += it.str; }
    if (it.hasEOL) { lines.push(cur); cur = ""; lastY = null; }
    else if (y !== null) lastY = y;
  }
  if (cur) lines.push(cur);
  return lines
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// Remove exam-paper / eOffice boilerplate that isn't part of any question:
// the file-number stamp, "Generated from eOffice by … on <date>", "Computer No.",
// and page markers like "(Set-A)", "(15)" and "[P.T.O.]". OCR garbles these
// (e.g. "Office" for "eOffice", "J8K", "BISHAL!"), so matching is lenient. Set
// markers only match when parenthesised or hyphenated so a real "set A" inside a
// question is never removed.
function stripBoilerplate(text) {
  const dropLine = [
    /file\s*no[.:]/i, // "File No. JKSSB-…"
    /generated\s+from\s+\w*office/i, // "Generated from eOffice/Office by …"
    /\bcomputer\s*no\b/i, // "(Computer No. 7593614)"
    /\d{3,}\s*\/\s*\d{2,4}\s*\/\s*\d+\s*\/\s*\d+/, // reference no. like "8233675/2026/0/0 Clerical Hall JKSSB"
    /(maximum|max\.?|total)\s+marks|marks\s*[:=]/i, // "Maximum Marks: 100"
    /\btime\s*(allowed|:|=)|\bduration\b/i, // "Time Allowed: 2 hours"
    /\broll\s*(no|number)\b/i, // roll number field
    /\b(invigilator|signature|candidate'?s?\s+name)\b/i, // invigilator/candidate lines
    /read\s+the\s+following\s+instructions|do\s+not\s+open|rough\s+work|instructions\s+to\s+candidates/i,
    /service\s+selection\s+board/i,
  ];
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    if (dropLine.some((re) => re.test(line))) continue; // whole stamp line
    // Strip page-turn / set markers wherever they appear (never real content).
    line = line
      .replace(/\(\s*set\s*-?\s*[a-d]\s*\)/gi, "") // (Set-A) / (Set A)
      .replace(/\bset-[a-d]\b/gi, "") // Set-A
      .replace(/\[?\s*p\.?\s*t\.?\s*o\.?\s*\d*\s*\]?/gi, "") // [P.T.O.15] / P.T.O
      .replace(/\s{2,}/g, " ")
      .trim();
    // Drop lines that are now only a bare page number like "(15)" or "15".
    const bare = line.replace(/[()[\]]/g, "").trim();
    if (!bare || /^\d{1,4}$/.test(bare)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Extract plain text from a PDF File/Blob. onProgress(page, totalPages) fires
// once per page so the caller can show progress. Returns the combined text
// (empty string for image-only / scanned PDFs that have no selectable text).
export async function extractPdfText(file, onProgress) {
  const lib = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await lib.getDocument({ data }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToText(content.items));
      onProgress?.(i, pdf.numPages);
    }
  } finally {
    try { await pdf.cleanup(); } catch { /* ignore */ }
  }
  return stripBoilerplate(pages.join("\n\n").replace(/[ \t]+/g, " "));
}


// Heuristic: a real question paper has lots of words. Scanned/image PDFs (e.g.
// eOffice government files) only carry a short digital stamp as selectable text,
// so very few words means the pages are images and need OCR.
export function looksScanned(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  return words.length < 60;
}

// Tesseract.js (OCR) is also loaded from a CDN on demand. It downloads its
// worker/core/language data from the CDN on first use (~15MB), so OCR is slow.
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
let tessPromise = null;
function loadTesseract() {
  if (!tessPromise) {
    tessPromise = new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const s = document.createElement("script");
      s.src = TESSERACT;
      s.async = true;
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error("OCR engine failed to load.")));
      s.onerror = () => reject(new Error("Couldn't load the OCR engine (check your connection)."));
      document.head.appendChild(s);
    });
  }
  return tessPromise;
}

// Read a SCANNED / image PDF by rendering each page to an image and running OCR.
// onProgress(page, totalPages, phase) fires per page. Much slower and less exact
// than text extraction — use only when the PDF has no real text layer.
export async function ocrPdfText(file, onProgress) {
  const lib = await loadPdfjs();
  const Tesseract = await loadTesseract();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await lib.getDocument({ data }).promise;
  const worker = await Tesseract.createWorker("eng");
  const pages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 }); // upscale for better OCR accuracy
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      const { data: { text } } = await worker.recognize(canvas);
      pages.push(text || "");
      canvas.width = 0; canvas.height = 0; // free memory
      onProgress?.(i, pdf.numPages);
    }
  } finally {
    try { await worker.terminate(); } catch { /* ignore */ }
    try { await pdf.cleanup(); } catch { /* ignore */ }
  }
  return stripBoilerplate(pages.join("\n\n").replace(/[ \t]+/g, " "));
}


// OCR a raw image file (PNG/JPG/WebP) to text. Tesseract accepts a File/Blob
// directly, so no PDF rendering is needed. onProgress(1,1) fires once (kept for
// a consistent progress signature with the PDF readers).
export async function ocrImage(file, onProgress) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker("eng");
  try {
    onProgress?.(1, 1);
    const { data: { text } } = await worker.recognize(file);
    return stripBoilerplate(String(text || "").replace(/[ \t]+/g, " "));
  } finally {
    try { await worker.terminate(); } catch { /* ignore */ }
  }
}
