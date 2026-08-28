import katex from "katex";
import "katex/dist/katex.min.css";

// Renderer for DOCUMENT text: turns the raw stored text into its formatted
// "actual form" and lays it out as A4 pages (page-wise, like Word). Supports a
// Word-like subset:
//   - Headings:  #, ##, ###, #### …            → bold (bigger for #/##).
//   - Bold:      **text** / __text__            → bold.
//   - Italic:    *text*   / _text_              → italic.
//   - Underline: <u>text</u>                     → underline.
//   - Strike:    ~~text~~                         → strikethrough.
//   - Highlight: ==text==                         → highlighted (marker pen).
//   - Lists:     "- item" / "* item"             → bullet;  "1. item" stays numbered.
//   - Math:      $…$ inline / $$…$$ block         → KaTeX.
//   - Page break: a line "<!-- pagebreak -->"     → starts a new A4 page.
// Documents are always SAVED as raw text (so they stay editable, convertible
// and copyable); this component only affects how they are DISPLAYED.

// Order matters: $$ before $, ** before *, __ before _.
const INLINE_RE =
  /\$\$([^$]+)\$\$|\$([^$]+)\$|<u>([\s\S]*?)<\/u>|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|==([^=\n]+)==|\*([^*\n]+)\*|_([^_\n]+)_/g;

// A line that is only this marker forces a new page.
const PAGE_BREAK_RE = /^\s*<!--\s*pagebreak\s*-->\s*$/i;

function renderInline(text, keyPrefix) {
  const parts = [];
  let last = 0;
  let m;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`${keyPrefix}-t${i}`}>{text.slice(last, m.index)}</span>);
    if (m[1] != null || m[2] != null) {
      parts.push(
        <span
          key={`${keyPrefix}-m${i}`}
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(m[1] ?? m[2], { throwOnError: false, displayMode: m[1] != null }),
          }}
        />
      );
    } else if (m[3] != null) {
      parts.push(<u key={`${keyPrefix}-u${i}`}>{m[3]}</u>);
    } else if (m[4] != null || m[5] != null) {
      parts.push(<strong key={`${keyPrefix}-b${i}`}>{m[4] ?? m[5]}</strong>);
    } else if (m[6] != null) {
      parts.push(<del key={`${keyPrefix}-s${i}`}>{m[6]}</del>);
    } else if (m[7] != null) {
      parts.push(<mark key={`${keyPrefix}-h${i}`} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-300/70">{m[7]}</mark>);
    } else {
      parts.push(<em key={`${keyPrefix}-i${i}`}>{m[7] ?? m[8] ?? m[9]}</em>);
    }
    last = INLINE_RE.lastIndex;
    i += 1;
  }
  if (last < text.length) parts.push(<span key={`${keyPrefix}-t${i}`}>{text.slice(last)}</span>);
  return parts;
}

// Render the lines of ONE page into paragraphs / headings / bullets.
function renderPage(chunk, pageKey) {
  return chunk.split(/\r?\n/).map((line, idx) => {
    const key = `${pageKey}-${idx}`;
    const h = line.match(/^\s*(#{1,6})\s*(.+?)\s*$/);
    if (h) {
      const level = h[1].length;
      const size = level <= 1 ? "text-lg" : level === 2 ? "text-base" : "text-sm";
      return <p key={key} className={`font-bold ${size}`}>{renderInline(h[2], key)}</p>;
    }
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    if (b) return <p key={key} className="pl-4 -indent-2">• {renderInline(b[1], key)}</p>;
    if (line.trim() === "") return <div key={key} className="h-2" />;
    return <p key={key}>{renderInline(line, key)}</p>;
  });
}

export default function RichText({ children, className = "", paged = true }) {
  const text = String(children ?? "");

  if (!paged) return <div className={`space-y-1 ${className}`}>{renderPage(text, "p0")}</div>;

  // Split into A4 pages on the page-break marker; render each as a paper sheet.
  const pages = text.split(new RegExp(PAGE_BREAK_RE.source.replace(/^\^|\$$/g, ""), "i"));
  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      {pages.map((pg, pi) => (
        <div
          key={pi}
          className="a4-page w-full max-w-[794px] rounded-sm bg-white p-[40px] text-slate-900 shadow-lg sm:min-h-[1123px]"
        >
          <div className="space-y-1">{renderPage(pg, `p${pi}`)}</div>
          <p className="mt-6 text-center text-[10px] text-slate-300">Page {pi + 1} of {pages.length}</p>
        </div>
      ))}
    </div>
  );
}
