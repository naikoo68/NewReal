// A self-contained VECTOR PDF builder. It renders a simple document model
// (blocks with basic formatting) into a crisp, fully SELECTABLE A4 PDF using
// jsPDF's native text engine — NOT html2canvas. The result opens perfectly in
// Adobe Reader with real text you can select/search, at any zoom. jsPDF is
// loaded on demand from a CDN (no npm install required).

let _jspdfPromise = null;
function loadJsPDF() {
  if (typeof window !== "undefined" && window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (_jspdfPromise) return _jspdfPromise;
  _jspdfPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.async = true;
    s.onload = () => resolve(window.jspdf && window.jspdf.jsPDF);
    s.onerror = () => reject(new Error("Failed to load jsPDF"));
    document.head.appendChild(s);
  });
  return _jspdfPromise;
}

// The three standard PDF font families (crisp + selectable, no embedding). The
// `css` value mirrors them in the on-screen preview.
export const DOC_FONTS = [
  { id: "helvetica", label: "Helvetica (sans-serif)", css: "Helvetica, Arial, sans-serif" },
  { id: "times", label: "Times (serif)", css: '"Times New Roman", Georgia, serif' },
  { id: "courier", label: "Courier (monospace)", css: '"Courier New", monospace' },
];

// The editing blocks the builder offers, with sensible default sizes.
export const DOC_BLOCK_TYPES = [
  { id: "heading", label: "Heading", size: 20, bold: true, hasText: true },
  { id: "subheading", label: "Subheading", size: 15, bold: true, hasText: true },
  { id: "paragraph", label: "Paragraph", size: 11, bold: false, hasText: true },
  { id: "bullets", label: "Bullet list", size: 11, bold: false, hasText: true },
  { id: "divider", label: "Divider line", size: 11, bold: false, hasText: false },
  { id: "spacer", label: "Spacer (blank space)", size: 11, bold: false, hasText: false },
  { id: "pagebreak", label: "Page break", size: 11, bold: false, hasText: false },
];

const PT_TO_MM = 0.352778;

const hexToRgb = (hex) => {
  const h = String(hex || "#0f172a").replace("#", "").trim();
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  if (v.length !== 6 || Number.isNaN(n)) return [15, 23, 42];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const styleFor = (b) => (b.bold && b.italic ? "bolditalic" : b.bold ? "bold" : b.italic ? "italic" : "normal");

// Render the document model → downloads a vector PDF. Returns true on success.
export async function buildDocPdf(blocks, opts = {}) {
  const jsPDF = await loadJsPDF();
  if (typeof jsPDF !== "function") return false;
  const {
    title = "Document",
    fontFamily = "helvetica",
    margin = 20, // mm
    pageNumbers = true,
    watermark = "",
    brand = "",
    border = "none", // none | single | thick | double
    borderColor = "#334155",
  } = opts;
  const list = Array.isArray(blocks) ? blocks : [];

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  try { pdf.setProperties({ title: String(title), author: brand || "PDF Builder", creator: brand || "PDF Builder" }); } catch { /* ignore */ }

  const pageW = 210;
  const pageH = 297;
  const contentW = pageW - margin * 2;
  const bottom = pageH - margin;
  let y = margin;

  const lineH = (size) => size * PT_TO_MM * 1.4;
  const addPageIfNeeded = (need) => { if (y + need > bottom) { pdf.addPage(); y = margin; } };

  const drawLines = (lines, size, align, color, underline) => {
    const lh = lineH(size);
    const [r, g, b] = hexToRgb(color);
    pdf.setTextColor(r, g, b);
    const last = lines.length - 1;
    lines.forEach((ln, idx) => {
      addPageIfNeeded(lh);
      let x = margin;
      const optn = {};
      if (align === "center") { x = pageW / 2; optn.align = "center"; }
      else if (align === "right") { x = pageW - margin; optn.align = "right"; }
      else if (align === "justify" && idx < last) { optn.align = "justify"; optn.maxWidth = contentW; }
      pdf.text(ln, x, y, optn);
      if (underline && ln.trim()) {
        const w = align === "justify" && idx < last ? contentW : pdf.getTextWidth(ln);
        let ux = margin;
        if (align === "center") ux = pageW / 2 - w / 2;
        else if (align === "right") ux = pageW - margin - w;
        const uy = y + size * PT_TO_MM * 0.28;
        pdf.setDrawColor(r, g, b);
        pdf.setLineWidth(0.3);
        pdf.line(ux, uy, ux + w, uy);
      }
      y += lh;
    });
  };

  for (const b of list) {
    const size = Number(b.fontSize) || 11;
    if (b.type === "pagebreak") { pdf.addPage(); y = margin; continue; }
    if (b.type === "spacer") {
      y += lineH(size) * (Number(b.lines) || 1.2);
      if (y > bottom) { pdf.addPage(); y = margin; }
      continue;
    }
    if (b.type === "divider") {
      addPageIfNeeded(5);
      const [r, g, bl] = hexToRgb(b.color || "#94a3b8");
      pdf.setDrawColor(r, g, bl);
      pdf.setLineWidth(0.4);
      pdf.line(margin, y, pageW - margin, y);
      y += 5;
      continue;
    }
    pdf.setFont(fontFamily, styleFor(b));
    pdf.setFontSize(size);
    if (b.type === "bullets") {
      const items = String(b.text || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const [r, g, bl] = hexToRgb(b.color || "#0f172a");
      pdf.setTextColor(r, g, bl);
      const indent = 5;
      const lh = lineH(size);
      for (const it of items) {
        const wrapped = pdf.splitTextToSize(it, contentW - indent);
        wrapped.forEach((ln, i) => {
          addPageIfNeeded(lh);
          if (i === 0) pdf.text("\u2022", margin, y);
          pdf.text(ln, margin + indent, y);
          y += lh;
        });
      }
      y += lineH(size) * 0.35;
      continue;
    }
    // heading / subheading / paragraph
    const wrapped = pdf.splitTextToSize(String(b.text || ""), contentW);
    drawLines(wrapped, size, b.align || "left", b.color || "#0f172a", !!b.underline);
    y += lineH(size) * (b.type === "paragraph" ? 0.5 : 0.4);
  }

  // Final pass: page border + watermark + page numbers on every page.
  const total = pdf.getNumberOfPages();
  const bInset = 8; // mm from the page edge
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    if (border && border !== "none") {
      const [br, bg, bb] = hexToRgb(borderColor);
      pdf.setDrawColor(br, bg, bb);
      const w = pageW - bInset * 2;
      const h = pageH - bInset * 2;
      if (border === "double") {
        pdf.setLineWidth(0.5);
        pdf.rect(bInset, bInset, w, h);
        pdf.rect(bInset + 1.6, bInset + 1.6, w - 3.2, h - 3.2);
      } else {
        pdf.setLineWidth(border === "thick" ? 1.3 : 0.4);
        pdf.rect(bInset, bInset, w, h);
      }
    }
    if (watermark) {
      if (pdf.saveGraphicsState) pdf.saveGraphicsState();
      try { if (pdf.GState) pdf.setGState(new pdf.GState({ opacity: 0.08 })); } catch { /* ignore */ }
      pdf.setTextColor(120, 120, 120);
      pdf.setFont(fontFamily, "bold");
      pdf.setFontSize(64);
      pdf.text(String(watermark), pageW / 2, pageH / 2, { align: "center", angle: 35 });
      if (pdf.restoreGraphicsState) pdf.restoreGraphicsState();
    }
    if (pageNumbers) {
      pdf.setFont(fontFamily, "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(150, 150, 150);
      // Keep the number inside the frame when a border is drawn.
      const numY = border && border !== "none" ? pageH - bInset - 4 : pageH - 8;
      pdf.text(`${brand ? brand + " \u00b7 " : ""}Page ${p} of ${total}`, pageW / 2, numY, { align: "center" });
    }
  }

  pdf.save(`${String(title || "document").replace(/[^\w.-]+/g, "_")}.pdf`);
  return true;
}
