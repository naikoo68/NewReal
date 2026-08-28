// Build a printable A4 "question paper" or "answer key" from a list of question
// objects. Renders every question type (mcq, matching, statement, pair/
// pairselect, assertion, table) with inline $…$ math (KaTeX), the site's brand
// colours, a clean serif look, coloured difficulty chips and coloured Column
// A/B boxes — then downloads it as a real PDF (html2canvas + jsPDF) or, as a
// fallback, opens a print window.
import katex from "katex";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

// Fixed difficulty-chip palette (mirrors the quiz UI: Easy=emerald,
// Medium=amber, Hard=rose).
const DIFF = {
  Easy: { bg: "#dcfce7", fg: "#047857", bd: "#a7f3d0" },
  Medium: { bg: "#fef3c7", fg: "#b45309", bd: "#fde68a" },
  Hard: { bg: "#ffe4e6", fg: "#be123c", bd: "#fecdd3" },
};

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// hex (#rgb / #rrggbb) → rgba() with the given alpha (for soft tints).
function hexA(hex, a) {
  const h = String(hex || "").replace("#", "").trim();
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  if (v.length !== 6 || Number.isNaN(n)) return `rgba(37,99,235,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Render a string with inline ($…$) / block ($$…$$) math; everything else escaped.
function inline(text) {
  const t = String(text == null ? "" : text);
  const re = /\$\$([^$]+)\$\$|\$([^$]+)\$/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (m.index > last) out += esc(t.slice(last, m.index));
    // output:"html" (not the default htmlAndMathml): the hidden MathML copy is
    // hidden with CSS `clip`, which html2canvas can't apply — so it would get
    // rendered as duplicated/garbled text in the PDF. HTML-only avoids that.
    try { out += katex.renderToString(m[1] ?? m[2], { throwOnError: false, displayMode: m[1] != null, output: "html" }); }
    catch { out += esc(m[0]); }
    last = re.lastIndex;
  }
  if (last < t.length) out += esc(t.slice(last));
  return out;
}

export const answerLetter = (q) => (typeof q?.correct === "number" && q.correct >= 0 ? (LETTERS[q.correct] || "?") : "—");

function questionBlock(q, idx, withAnswers) {
  const diff = DIFF[q?.difficulty] ? q.difficulty : "";
  const chip = diff ? `<span class="chip d-${diff.toLowerCase()}">${esc(diff)}</span>` : "";
  const parts = [`<div class="q"><p class="stem"><b class="qn">${idx + 1}.</b> ${inline(q.text)} ${chip}</p>`];
  const A = (q.columnA || []).map((x) => String(x)).filter((x) => x.trim());
  const B = (q.columnB || []).map((x) => String(x)).filter((x) => x.trim());

  if (q.type === "assertion") {
    if (q.assertion) parts.push(`<div class="box boxA"><span class="bx-h">Assertion (A)</span> ${inline(q.assertion)}</div>`);
    if (q.reason) parts.push(`<div class="box boxB"><span class="bx-h">Reason (R)</span> ${inline(q.reason)}</div>`);
  } else if (q.type === "statement") {
    parts.push(`<div class="box boxA"><div class="lst">${A.map((s, i) => `<div>${i + 1}. ${inline(s)}</div>`).join("")}</div></div>`);
  } else if (q.type === "pair" || q.type === "pairselect") {
    const n = Math.max(A.length, B.length);
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(`<div>${i + 1}. ${inline(A[i] || "")} — ${inline(B[i] || "")}</div>`);
    parts.push(`<div class="box boxA"><div class="lst">${rows.join("")}</div></div>`);
  } else if (q.type === "matching") {
    parts.push(
      `<div class="match"><div class="box boxA"><div class="ch chA">Column A</div>${A.map((x, i) => `<div>${i + 1}. ${inline(x)}</div>`).join("")}</div>` +
      `<div class="box boxB"><div class="ch chB">Column B</div>${B.map((x, i) => `<div>${ROMAN[i] || i + 1}. ${inline(x)}</div>`).join("")}</div></div>`
    );
  } else if (q.type === "table") {
    const rows = (q.tableRows || []).map((r) => `<tr>${(Array.isArray(r) ? r : [r]).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
    if (rows) parts.push(`<table class="tbl">${rows}</table>`);
  }

  const opts = q.options || [];
  const optHtml = opts
    .map((o, i) => {
      if (String(o).trim() === "") return "";
      const isCorrect = withAnswers && i === q.correct;
      return `<div class="opt${isCorrect ? " correct" : ""}">${isCorrect ? "&#10003; " : ""}<b>${LETTERS[i] || i + 1})</b> ${inline(o)}</div>`;
    })
    .join("");
  if (optHtml) parts.push(`<div class="opts">${optHtml}</div>`);

  if (withAnswers) {
    parts.push(`<p class="ans"><b>Answer:</b> ${answerLetter(q)}</p>`);
    if (q.explanation && String(q.explanation).trim()) parts.push(`<p class="exp"><b>Explanation:</b> ${inline(q.explanation)}</p>`);
  }
  parts.push(`</div>`);
  return parts.join("");
}

// A diagonal, tiled watermark placed INSIDE each page (so it appears on every
// page in both print and the generated PDF).
function pageWatermark(label) {
  if (!label) return "";
  const spans = Array.from({ length: 300 }).map(() => `<span>${esc(label)}</span>`).join("");
  return `<div class="pwm" aria-hidden="true"><div class="in">${spans}</div></div>`;
}

// The full first-page header (brand, title, badge, name/date fields or the
// answer-key grid) and the slim continuation header for later pages.
function paperHeaders(title, list, opts = {}) {
  const { withAnswers = false, brand = "My Study Guide" } = opts;
  const kind = withAnswers ? "ANSWER KEY" : "QUESTION PAPER";
  const fields = withAnswers
    ? ""
    : `<div class="fields"><span>Name: <b class="line">&nbsp;</b></span><span>Roll No: <b class="line sm">&nbsp;</b></span><span>Date: <b class="line sm">&nbsp;</b></span><span>Marks: <b class="line xs">&nbsp;</b></span></div>`;
  const grid = withAnswers
    ? `<h2 class="kh">Answer Key at a glance</h2><div class="grid">${list.map((q, i) => `<span class="cell"><b>${i + 1}.</b> ${answerLetter(q)}</span>`).join("")}</div><hr class="rule2">`
    : "";
  const fullHeader =
    `<div class="hdr"><div><p class="brand">${esc(brand)}</p><h1>${esc(title)}</h1>` +
    `<p class="sub">${list.length} question(s)${withAnswers ? " · with answers &amp; explanations" : ""}</p></div>` +
    `<span class="badge">${kind}</span></div>` + fields + `<hr class="rule">` + grid;
  const slimHeader = `<div class="shdr"><span>${esc(brand)} — ${esc(title)}</span><span>${kind}</span></div><hr class="rule2">`;
  return { fullHeader, slimHeader, kind };
}

function paperFooter(opts = {}, pi = 0, pageCount = 1) {
  const { withAnswers = false, brand = "My Study Guide" } = opts;
  return `<div class="foot">${esc(brand)} · ${withAnswers ? "Answer Key" : "Question Paper"}${pageCount > 1 ? ` · Page ${pi + 1} of ${pageCount}` : ""}</div>`;
}

// Build the shared CSS + page sections for a paper/answer-key.
function compose(title, questions, opts = {}) {
  const {
    withAnswers = false,
    brand = "My Study Guide",
    perPage = 0,
    watermark = "",
    watermarkOpacity = 0.12,
    watermarkSize = 16,
    border = "single",
    brandColor = "#2563eb",
    accentColor = "#f97316",
    fontFamily = 'Georgia, "Times New Roman", "Cambria", serif',
    typeScale = 1,
  } = opts;
  // typeScale genuinely reflows the CONTENT smaller (font sizes + spacing) so a
  // dense page fits an A4 sheet at FULL WIDTH — no CSS transform (html2canvas
  // ignores transforms → clipping) and no width-shrinking. Structural sizes
  // (page/frame/border) stay fixed so the border is identical on every page.
  const ts = Math.max(0.1, Math.min(2.2, Number(typeScale) || 1));
  const z = (nn) => `${Math.round(nn * ts * 1000) / 1000}px`;
  // When fixedPages is set (preview + PDF), each .page is locked to exactly A4
  // and clips overflow — so the on-screen preview shows EXACTLY what the PDF
  // captures (true WYSIWYG). Otherwise pages grow with content (print fallback).
  const pageHeightCss = opts.fixedPages ? "height:1123px;overflow:hidden" : "min-height:1123px";
  const frameOverflowCss = opts.fixedPages ? "overflow:hidden;" : "";
  const borderCss = border === "none" ? "none" : border === "double" ? `3px double ${brandColor}` : border === "thick" ? `3px solid ${brandColor}` : `1.6px solid ${hexA(brandColor, 0.65)}`;
  const borderRadius = border === "none" ? "0" : "10px";
  const pagePad = border === "none" ? "10px 4px 22px" : "20px 24px 26px";
  const list = Array.isArray(questions) ? questions : [];
  const blocks = list.map((q, i) => questionBlock(q, i, withAnswers));
  const n = Number(perPage) || 0;
  // `groups` (array of arrays of question indices) is the measurement-based
  // auto-pagination: each group = one page, filled by actual text length. When
  // present it overrides the fixed perPage chunking.
  const groups = Array.isArray(opts.groups) && opts.groups.length ? opts.groups : null;

  const chunks = [];
  if (groups) { groups.forEach((g) => chunks.push((g || []).map((i) => blocks[i]).filter(Boolean))); }
  else if (n > 0) { for (let i = 0; i < blocks.length; i += n) chunks.push(blocks.slice(i, i + n)); }
  else chunks.push(blocks);
  if (!chunks.length) chunks.push([]);

  const { fullHeader, slimHeader, kind } = paperHeaders(title, list, opts);
  const wm = pageWatermark(watermark);
  const pageCount = chunks.length;
  const pages = chunks
    .map((chunk, pi) =>
      `<section class="page"><div class="frame">${wm}<div class="pc">` +
      (pi === 0 ? fullHeader : slimHeader) +
      chunk.join("") +
      paperFooter(opts, pi, pageCount) +
      `</div></div></section>`
    )
    .join("");

  const css =
    `@page{size:A4;margin:12mm}*{box-sizing:border-box}` +
    `body{font-family:${fontFamily};color:#0f172a;line-height:1.55;margin:0;font-size:${z(16)}}` +
    // .page is an A4-proportioned sheet (794px wide = 210mm) with a comfortable
    // outer MARGIN. It GROWS with its content (min-height, no clipping); the PDF
    // generator fits each rendered page onto one A4 sheet (shrinking dense pages
    // so nothing is ever cut off).
    `.page{position:relative;background:#fff;padding:34px;display:flex;flex-direction:column;width:794px;${pageHeightCss};margin:0 auto}` +
    `.frame{flex:1;position:relative;${frameOverflowCss}border:${borderCss};border-radius:${borderRadius};padding:${pagePad}}` +
    `.page + .page{margin-top:18px}.pc{position:relative;z-index:1}` +
    `.hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}` +
    `.brand{font-size:${z(11)};font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${brandColor};margin:0 0 2px}` +
    `h1{font-size:${z(21)};margin:0;color:${brandColor}}.sub{color:#64748b;font-size:${z(12)};margin:${z(3)} 0 0}` +
    `.badge{flex-shrink:0;background:${brandColor};color:#fff;border-radius:999px;padding:${z(5)} ${z(13)};font-size:${z(11)};font-weight:800;letter-spacing:.06em}` +
    `.shdr{display:flex;justify-content:space-between;gap:12px;font-size:${z(11)};font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${brandColor}}` +
    `.fields{display:flex;flex-wrap:wrap;gap:${z(8)} ${z(22)};margin:${z(12)} 0 0;font-size:${z(13)};color:#334155}` +
    `.line{display:inline-block;border-bottom:1px solid #94a3b8;min-width:150px}.line.sm{min-width:90px}.line.xs{min-width:60px}` +
    `.rule{border:none;border-top:2px solid ${brandColor};margin:${z(12)} 0 ${z(16)}}.rule2{border:none;border-top:1px solid ${hexA(brandColor, 0.35)};margin:${z(8)} 0 ${z(14)}}` +
    `.q{margin:0 0 ${z(15)};page-break-inside:avoid;break-inside:avoid}.stem{margin:0 0 ${z(5)}}` +
    `.qn{color:${brandColor};font-weight:800;margin-right:2px}` +
    // Difficulty chips.
    `.chip{display:inline-block;vertical-align:middle;border-radius:999px;padding:${z(1)} ${z(9)};font-size:${z(10.5)};font-weight:800;letter-spacing:.03em;border:1px solid;line-height:1.5}` +
    `.d-easy{background:${DIFF.Easy.bg};color:${DIFF.Easy.fg};border-color:${DIFF.Easy.bd}}` +
    `.d-medium{background:${DIFF.Medium.bg};color:${DIFF.Medium.fg};border-color:${DIFF.Medium.bd}}` +
    `.d-hard{background:${DIFF.Hard.bg};color:${DIFF.Hard.fg};border-color:${DIFF.Hard.bd}}` +
    // Coloured Column A / B (and statement / assertion) boxes.
    `.box{border-radius:9px;padding:${z(8)} ${z(12)};margin:${z(5)} 0;font-size:${z(14)}}` +
    `.boxA{background:${hexA(brandColor, 0.07)};border:1px solid ${hexA(brandColor, 0.3)}}` +
    `.boxB{background:${hexA(accentColor, 0.09)};border:1px solid ${hexA(accentColor, 0.32)}}` +
    `.box .lst>div{margin:${z(2)} 0}.bx-h{display:inline-block;font-weight:800;margin-right:6px}` +
    `.boxA .bx-h{color:${brandColor}}.boxB .bx-h{color:${accentColor}}` +
    `.match{display:flex;gap:${z(16)};margin:${z(5)} 0}.match .box{flex:1}` +
    `.match .ch{font-weight:800;font-size:${z(11)};text-transform:uppercase;letter-spacing:.05em;margin-bottom:${z(4)}}` +
    `.chA{color:${brandColor}}.chB{color:${accentColor}}` +
    `.opts{margin:${z(5)} 0 0 ${z(16)}}.opt{margin:${z(2)} 0}.opt.correct{color:#15803d;font-weight:700}` +
    `.ans{margin:${z(5)} 0 0 ${z(16)};color:#15803d;font-weight:700}.exp{margin:${z(2)} 0 0 ${z(16)};color:#334155;font-size:${z(13)}}` +
    `.tbl{border-collapse:collapse;margin:${z(5)} 0}.tbl td{border:1px solid #cbd5e1;padding:${z(3)} ${z(8)};font-size:${z(13)}}` +
    `.kh{font-size:${z(15)};margin:0 0 ${z(6)};color:${brandColor}}.grid{display:flex;flex-wrap:wrap;gap:${z(6)} ${z(18)};margin:0 0 ${z(6)};font-size:${z(13)}}.cell{white-space:nowrap}` +
    `.foot{margin-top:${z(16)};border-top:1px solid ${hexA(brandColor, 0.2)};padding-top:${z(8)};text-align:center;font-size:${z(11)};color:#94a3b8}` +
    // Per-page watermark (behind the content).
    `.pwm{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}` +
    `.pwm .in{position:absolute;inset:-25%;transform:rotate(-24deg);display:flex;flex-wrap:wrap;align-content:flex-start;justify-content:center;gap:44px;opacity:${watermarkOpacity}}` +
    `.pwm .in span{white-space:nowrap;font-weight:800;text-transform:uppercase;letter-spacing:.2em;color:#94a3b8;font-size:${watermarkSize}px}` +
    `*{-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `@media print{.page{break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}.page+.page{margin-top:0}}` +
    `@media screen{body{background:#f1f5f9;padding:16px}}`;

  return { css, pages, kind };
}

export function buildPaperHtml(title, questions, opts = {}) {
  const { css, pages, kind } = compose(title, questions, opts);
  const autoPrint = opts.autoPrint !== false;
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${kind}</title>` +
    `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">` +
    `<style>${css}</style></head><body>` +
    pages +
    (autoPrint ? `<scr` + `ipt>window.onload=function(){setTimeout(function(){window.focus();window.print();},600)};</scr` + `ipt>` : "") +
    `</body></html>`
  );
}

// Open the paper/answer-key in a print window (fallback). Returns false if the
// pop-up was blocked.
export function printPaper(title, questions, opts) {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(buildPaperHtml(title, questions, opts));
  win.document.close();
  return true;
}

// Decide page breaks by ACTUAL TEXT LENGTH: measure every question at the
// normal (readable) font size and greedily fill each A4 page until the next
// question wouldn't fit, then start a new page. Returns an array of pages, each
// an array of question indices. The number of pages therefore follows the total
// length of the content — no fixed "per page" count and no shrinking just to
// hit a number. Long questions simply take more room; short ones pack tighter.
export async function paginateByLength(title, questions, opts = {}) {
  const list = Array.isArray(questions) ? questions : [];
  if (typeof document === "undefined" || list.length === 0) return [[]];
  if (list.length === 1) return [[0]];
  const withAnswers = !!opts.withAnswers;
  const { css } = compose(title, [], { ...opts, groups: null, perPage: 0 });
  const { fullHeader, slimHeader } = paperHeaders(title, list, opts);
  const footer = paperFooter(opts, 0, 2);

  const meas = document.createElement("div");
  meas.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;z-index:-1";
  meas.innerHTML =
    `<style>${css} .page{height:1123px !important;min-height:0 !important}.frame{overflow:hidden !important}</style>` +
    `<div class="paperroot"><section class="page"><div class="frame"><div class="pc" id="__pcmeas"></div></div></section></div>`;
  document.body.appendChild(meas);
  try {
    // Load KaTeX CSS + math fonts FIRST, so formulas/tables are measured at
    // their real rendered height. Otherwise math/tables are underestimated,
    // pages get over-packed, and the bottom content is clipped in the PDF
    // (the "tables/formulas don't match the preview" bug).
    ensureKatexCss();
    await ensureKatexFonts();
    await new Promise((r) => setTimeout(r, 40));
    const frame = meas.querySelector(".frame");
    const pc = meas.querySelector("#__pcmeas");
    if (!frame || !pc) return [[...list.keys()]];
    const fcs = getComputedStyle(frame);
    const availH = Math.max(240, frame.clientHeight - parseFloat(fcs.paddingTop) - parseFloat(fcs.paddingBottom));
    const measure = (html) => { pc.innerHTML = html; return pc.scrollHeight; };
    const hFull = measure(fullHeader);
    const hSlim = measure(slimHeader);
    const hFoot = measure(footer) + 16; // + footer's top margin
    const SAFETY = 30; // guard against rounding / collapsed margins
    // Each question's vertical footprint (+ its bottom margin).
    const qH = list.map((q, i) => measure(questionBlock(q, i, withAnswers)) + 15);
    const usableFor = (pi) => Math.max(120, availH - hFoot - (pi === 0 ? hFull : hSlim) - SAFETY);

    const groups = [];
    let cur = [];
    let used = 0;
    let pi = 0;
    for (let i = 0; i < list.length; i++) {
      if (cur.length && used + qH[i] > usableFor(pi)) { groups.push(cur); cur = []; used = 0; pi += 1; }
      cur.push(i);
      used += qH[i];
    }
    if (cur.length) groups.push(cur);
    return groups.length ? groups : [[...list.keys()]];
  } catch {
    return [[...list.keys()]];
  } finally {
    meas.remove();
  }
}

function loadScript(src, ready) {
  return new Promise((resolve, reject) => {
    if (ready()) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}
async function loadPdfLibs() {
  await loadScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js", () => typeof window !== "undefined" && !!window.html2canvas);
  await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js", () => typeof window !== "undefined" && window.jspdf && !!window.jspdf.jsPDF);
  return { html2canvas: window.html2canvas, jsPDF: window.jspdf && window.jspdf.jsPDF };
}
function ensureKatexCss() {
  if (typeof document === "undefined" || document.getElementById("katex-cdn-css")) return;
  const l = document.createElement("link");
  l.id = "katex-cdn-css";
  l.rel = "stylesheet";
  l.href = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
  l.crossOrigin = "anonymous";
  document.head.appendChild(l);
}

// Force the KaTeX web fonts to finish loading. html2canvas snapshots
// synchronously, so if these lazy-loaded fonts aren't ready the math glyphs
// (fraction bars, roots, symbols, math italics) fall back to a system font and
// look wrong. We explicitly request each family/style.
async function ensureKatexFonts() {
  if (typeof document === "undefined" || !document.fonts || !document.fonts.load) return;
  const fams = ["KaTeX_Main", "KaTeX_Math", "KaTeX_Size1", "KaTeX_Size2", "KaTeX_Size3", "KaTeX_Size4", "KaTeX_AMS", "KaTeX_Caligraphic", "KaTeX_Fraktur", "KaTeX_SansSerif", "KaTeX_Script", "KaTeX_Typewriter"];
  try {
    await Promise.all(fams.flatMap((f) => [
      document.fonts.load(`16px "${f}"`),
      document.fonts.load(`italic 16px "${f}"`),
      document.fonts.load(`bold 16px "${f}"`),
    ]));
  } catch { /* ignore */ }
}

// Render the composed pages into an off-screen wrapper (fixed A4 pages) and wait
// for CSS + math fonts. Returns the wrapper element.
async function mountPaper(css, pages) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:-10000px;top:0;background:#ffffff;z-index:-1";
  // Lock every page to EXACTLY A4 (794×1123px) with clipping, so the render maps
  // 1:1 to a full-width A4 sheet.
  wrap.innerHTML =
    `<style>${css} .page{margin:0 !important;min-height:0 !important;height:1123px !important}` +
    `.page+.page{margin-top:0 !important}.frame{overflow:hidden !important}</style>` +
    `<div class="paperroot">${pages}</div>`;
  document.body.appendChild(wrap);
  await new Promise((r) => setTimeout(r, 150)); // let the KaTeX stylesheet apply
  await ensureKatexFonts(); // make sure math fonts are loaded before snapshot
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }
  await new Promise((r) => setTimeout(r, 150)); // final settle
  return wrap;
}

// How much does the densest page overflow its A4 frame? Returns the largest
// ratio of needed-height / available-height across pages (>1 means overflow).
function measureOverflow(wrap) {
  let ratio = 1;
  wrap.querySelectorAll(".page").forEach((p) => {
    const frame = p.querySelector(".frame");
    const pc = p.querySelector(".pc");
    if (!frame || !pc) return;
    const cs = getComputedStyle(frame);
    const availH = frame.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availH > 0 && pc.scrollHeight > availH) ratio = Math.max(ratio, pc.scrollHeight / availH);
  });
  return ratio;
}

// Build the PDF and download it AUTOMATICALLY (no print dialog).
//
// Each page is a fixed A4 sheet (794×1123px). If content overflows, we REFLOW
// it smaller by lowering the typography scale (font sizes + spacing) — a genuine
// re-layout, NOT a CSS transform (html2canvas ignores transforms and would clip)
// and NOT a width shrink (the page always fills the full A4 width). A single
// scale is used for every page, so text size and border thickness stay uniform.
// A chosen questions-per-page maps 1:1 to A4 pages. Returns false to fall back.
export async function savePdf(title, questions, opts = {}) {
  if (typeof document === "undefined") return false;
  let libs;
  try { libs = await loadPdfLibs(); } catch { return false; }
  const { html2canvas, jsPDF } = libs || {};
  if (typeof html2canvas !== "function" || typeof jsPDF !== "function") return false;
  ensureKatexCss();

  // Auto mode (no fixed per-page count and no caller-supplied groups): decide
  // page breaks by real text length so each A4 page is filled to a readable
  // extent and the page count follows the content.
  let effOpts = opts;
  if (!Number(opts.perPage) && !Array.isArray(opts.groups)) {
    try {
      const groups = await paginateByLength(title, questions, opts);
      if (groups && groups.length) effOpts = { ...opts, groups };
    } catch { /* fall back to single flow */ }
  }

  // Pass 1: render at full size and measure the worst overflow.
  let composed = compose(title, questions, effOpts);
  let wrap = await mountPaper(composed.css, composed.pages);
  try {
    const ratio = measureOverflow(wrap);
    // Pass 2: if any page overflows, re-render everything at a fitting scale so
    // the densest page fits — full width, nothing clipped, uniform text/borders.
    if (ratio > 1.001) {
      // Shrink relative to the user's chosen size (never override it upward),
      // only as a safety net when a page still overflows.
      const baseTs = Number(effOpts.typeScale) || 1;
      const typeScale = Math.max(0.4, (baseTs / ratio) * 0.97);
      wrap.remove();
      composed = compose(title, questions, { ...effOpts, typeScale });
      wrap = await mountPaper(composed.css, composed.pages);
    }

    const pageEls = wrap.querySelectorAll(".page");
    if (!pageEls.length) return false;
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    // Standard PDF metadata so the file looks professional in Adobe Acrobat's
    // Document Properties.
    try {
      pdf.setProperties({
        title: String(title || "Question Paper"),
        subject: opts.withAnswers ? "Answer Key" : "Question Paper",
        author: String(opts.brand || "My Study Guide"),
        creator: String(opts.brand || "My Study Guide"),
      });
    } catch { /* ignore */ }
    const A4W = 210, A4H = 297; // mm
    for (let i = 0; i < pageEls.length; i++) {
      // Every page is a fixed 794×1123 (A4) box → render at ~285 DPI (scale 3)
      // for crisp text when zooming in Adobe, and place it filling the whole A4
      // sheet at full width.
      // eslint-disable-next-line no-await-in-loop
      const canvas = await html2canvas(pageEls[i], { scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false, width: 794, height: 1123, windowWidth: 794 });
      const imgData = canvas.toDataURL("image/jpeg", 0.97);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, A4W, A4H);
    }
    pdf.save(`${String(title || "paper").replace(/[^\w.-]+/g, "_")}.pdf`);
    return true;
  } catch {
    return false;
  } finally {
    if (wrap) wrap.remove();
  }
}
