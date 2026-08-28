import { forwardRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

// Renders note text as natural-looking HANDWRITING on a clean A4 sheet, using
// handwriting fonts and multiple "gel pen" colours (title/section/body/bold/
// highlight). Supports unruled (blank) or ruled (lined) paper. The output is
// real, readable text styled to look handwritten — so it can be exported to a
// crisp PNG/PDF that resembles a scanned handwritten page.

function ensureFonts() {
  if (typeof document === "undefined" || document.getElementById("hw-fonts")) return;
  const link = document.createElement("link");
  link.id = "hw-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Kalam:wght@400;700&display=swap";
  document.head.appendChild(link);
}

const INK = {
  body: "#1a237e",   // dark blue gel pen
  title: "#b3261e",  // red
  h2: "#1e40af",     // blue
  h3: "#15803d",     // green
  bold: "#6d28d9",   // purple
};

// Inline tokens: **bold**, ==highlight==, and $math$ (shown as plain text).
const INLINE_RE = /\*\*([^*]+)\*\*|==([^=\n]+)==|\$([^$\n]+)\$/g;

function renderInline(text, key) {
  const parts = [];
  let last = 0;
  let m;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`${key}-t${i}`}>{text.slice(last, m.index)}</span>);
    if (m[1] != null) parts.push(<span key={`${key}-b${i}`} style={{ color: INK.bold, fontWeight: 700 }}>{m[1]}</span>);
    else if (m[2] != null) parts.push(<span key={`${key}-h${i}`} style={{ background: "#fff59d", borderRadius: 3, padding: "0 2px" }}>{m[2]}</span>);
    else parts.push(
      <span
        key={`${key}-m${i}`}
        style={{ fontFamily: "'KaTeX_Main', 'Times New Roman', serif" }}
        dangerouslySetInnerHTML={{ __html: katex.renderToString(m[3], { throwOnError: false }) }}
      />
    );
    last = INLINE_RE.lastIndex;
    i += 1;
  }
  if (last < text.length) parts.push(<span key={`${key}-t${i}`}>{text.slice(last)}</span>);
  return parts;
}

const HandwrittenSheet = forwardRef(function HandwrittenSheet({ text = "", paper = "unruled" }, ref) {
  ensureFonts();
  const ruled = paper === "ruled";
  const lineH = 36;
  const lines = String(text || "").split(/\r?\n/);

  const sheetStyle = {
    fontFamily: "'Kalam', cursive",
    color: INK.body,
    fontSize: "20px",
    lineHeight: `${lineH}px`,
    padding: "60px 68px",
    minHeight: "1123px",
    position: "relative",
    ...(ruled
      ? {
          backgroundImage: `repeating-linear-gradient(#ffffff, #ffffff ${lineH - 1}px, #b8d2ef ${lineH - 1}px, #b8d2ef ${lineH}px)`,
          backgroundPosition: "0 60px",
        }
      : {}),
  };

  return (
    <div ref={ref} className="hw-sheet mx-auto w-full max-w-[794px] rounded-sm bg-white shadow-lg" style={sheetStyle}>
      {ruled && <div style={{ position: "absolute", top: 0, bottom: 0, left: "52px", width: "2px", background: "#f0a6ad" }} />}
      {lines.map((raw, idx) => {
        const tilt = { transform: `rotate(${(((idx % 5) - 2) * 0.12).toFixed(2)}deg)` };
        const h = raw.match(/^\s*(#{1,6})\s*(.+?)\s*$/);
        if (h) {
          const lvl = h[1].length;
          const color = lvl === 1 ? INK.title : lvl === 2 ? INK.h2 : INK.h3;
          const size = lvl === 1 ? "34px" : lvl === 2 ? "28px" : "24px";
          return (
            <p key={idx} style={{ ...tilt, fontFamily: "'Caveat', cursive", fontWeight: 700, color, fontSize: size, margin: "10px 0 4px", textDecoration: lvl === 1 ? "underline" : "none" }}>
              {renderInline(h[2], idx)}
            </p>
          );
        }
        const b = raw.match(/^\s*[-*]\s+(.*)$/);
        if (b) {
          return (
            <p key={idx} style={{ ...tilt, margin: "0 0 2px", paddingLeft: "26px", textIndent: "-18px" }}>
              <span style={{ color: INK.h3 }}>➤ </span>{renderInline(b[1], idx)}
            </p>
          );
        }
        if (raw.trim() === "") return <div key={idx} style={{ height: `${lineH}px` }} />;
        return <p key={idx} style={{ ...tilt, margin: "0 0 2px" }}>{renderInline(raw, idx)}</p>;
      })}
    </div>
  );
});

export default HandwrittenSheet;
