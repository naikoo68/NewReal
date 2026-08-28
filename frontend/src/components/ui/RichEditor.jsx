import { useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

// Full Word-like WYSIWYG editor backed by Quill, loaded from a CDN at runtime
// (same pattern the app uses for pdf.js / Tesseract). Covers the common Word
// text features: fonts, size, color, highlight, bold/italic/underline/strike,
// super/subscript, alignment, indentation, bullet/numbered/multilevel lists,
// headings, blockquote, code, links, images, equations (KaTeX) and clear
// formatting. Content is HTML. If Quill can't load, onFail() lets the parent
// fall back to the plain-text editor so the feature never breaks.

const QUILL_ESM = "https://cdn.jsdelivr.net/npm/quill@2.0.3/+esm";
const QUILL_CSS = "https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css";

let quillPromise = null;
function loadQuill() {
  if (quillPromise) return quillPromise;
  quillPromise = (async () => {
    if (typeof document !== "undefined" && !document.querySelector("link[data-quill-css]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = QUILL_CSS;
      link.setAttribute("data-quill-css", "1");
      document.head.appendChild(link);
    }
    // Quill's formula button renders with KaTeX via a global.
    if (typeof window !== "undefined" && !window.katex) window.katex = katex;
    const mod = await import(/* @vite-ignore */ QUILL_ESM);
    return mod?.default || mod?.Quill || (typeof window !== "undefined" ? window.Quill : null);
  })();
  return quillPromise;
}

// A rich toolbar covering the most-used Word writing features.
const TOOLBAR = [
  [{ font: [] }, { size: ["small", false, "large", "huge"] }],
  [{ header: [1, 2, 3, 4, 5, 6, false] }],
  ["bold", "italic", "underline", "strike"],
  [{ color: [] }, { background: [] }],
  [{ script: "sub" }, { script: "super" }],
  [{ align: [] }],
  [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
  ["blockquote", "code-block"],
  ["link", "image", "formula"],
  ["clean"],
];

// Inject A4-page + dark-mode styling for the Quill editor once.
function ensureA4Styles() {
  if (typeof document === "undefined" || document.getElementById("rich-a4-styles")) return;
  const s = document.createElement("style");
  s.id = "rich-a4-styles";
  s.textContent = `
    .rich-a4 .ql-container{border:none;font-size:15px}
    .rich-a4 .ql-toolbar{position:sticky;top:0;z-index:5;background:#fff;border-radius:8px 8px 0 0}
    .rich-a4 .ql-editor{background:#fff;color:#0f172a;width:100%;max-width:794px;min-height:1050px;margin:16px auto;padding:48px 56px;box-shadow:0 4px 24px rgba(0,0,0,.12);border-radius:2px}
    .rich-a4-wrap{background:#e2e8f0;border-radius:0 0 8px 8px}
    .dark .rich-a4 .ql-toolbar{background:#0f172a}
    .dark .rich-a4 .ql-toolbar .ql-stroke{stroke:#cbd5e1}
    .dark .rich-a4 .ql-toolbar .ql-fill{fill:#cbd5e1}
    .dark .rich-a4 .ql-toolbar .ql-picker{color:#cbd5e1}
    .dark .rich-a4-wrap{background:#1e293b}
  `;
  document.head.appendChild(s);
}

const looksHtml = (s) => /<\/?[a-z][\s\S]*>/i.test(String(s || ""));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function seedContent(quill, value) {
  const v = String(value || "");
  const html = looksHtml(v)
    ? v
    : v.trim()
      ? v.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`).join("")
      : "<p><br></p>";
  quill.setContents([]); // clear
  quill.clipboard.dangerouslyPasteHTML(html, "silent");
}

export default function RichEditor({ value = "", seedKey = 0, onChange, onFail, fullscreen = false }) {
  const holderRef = useRef(null);
  const quillRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const lastSeed = useRef(null);
  onChangeRef.current = onChange;

  useEffect(() => {
    let active = true;
    ensureA4Styles();
    loadQuill()
      .then((Quill) => {
        if (!active || !holderRef.current || !Quill) {
          if (!Quill && onFail) onFail();
          return;
        }
        const quill = new Quill(holderRef.current, {
          theme: "snow",
          placeholder: "Type or paste your document here…",
          modules: { toolbar: TOOLBAR },
        });
        quillRef.current = quill;
        seedContent(quill, value);
        lastSeed.current = seedKey;
        quill.on("text-change", () => {
          if (!onChangeRef.current) return;
          const html = quill.root.innerHTML;
          onChangeRef.current(html, quill.getText());
        });
      })
      .catch(() => { if (active && onFail) onFail(); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-seed only when the parent bumps seedKey (open doc, OCR, convert, clean).
  useEffect(() => {
    const quill = quillRef.current;
    if (!quill || seedKey === lastSeed.current) return;
    lastSeed.current = seedKey;
    seedContent(quill, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  return (
    <div className={`rich-a4 rich-a4-wrap overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 ${fullscreen ? "min-h-0 flex-1" : "max-h-[72vh]"}`}>
      <div ref={holderRef} />
    </div>
  );
}
