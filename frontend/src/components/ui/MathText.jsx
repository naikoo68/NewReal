import katex from "katex";
import "katex/dist/katex.min.css";

// Renders text that may contain LaTeX math.
// Supports $...$ / $$...$$ AND the \(...\) / \[...\] delimiters that many AI
// models emit — all are normalised to $ form before rendering, so math in
// AI-generated questions AND explanations renders correctly.
//
// It also repairs a common AI artifact: literal "\n" / "\r\n" escape sequences
// left inside the text (instead of a real line break) are turned back into real
// line breaks in the prose (never inside math, so LaTeX like \neq is untouched).
// Repair math that was corrupted when the AI's JSON was parsed: a LaTeX command
// written with a SINGLE backslash ("\frac", "\times", "\text", "\beta") has its
// escape eaten by JSON.parse, leaving a stray control char behind
// ("\frac"→FF+"rac", "\times"/"\text"→TAB+"imes"/"ext", "\beta"→BS+"eta"). Those
// control chars never occur in normal explanation text, so we restore the lost
// backslash+letter. This fixes questions saved BEFORE the backend parser fix,
// without needing to re-run Extend. (Real line breaks — "\n"/0x0A — are left
// alone so multi-line formatting is preserved.)
const recoverEatenLatex = (t) =>
  String(t ?? "")
    .replace(/\f/g, "\\f") // form-feed → \f… (\frac, \forall)
    .replace(/\v/g, "\\v") // vertical tab → \v… (\vec)
    .replace(/[\b]/g, "\\b") // backspace → \b… (\beta, \binom, \bar)
    .replace(/\t/g, "\\t"); // tab → \t… (\times, \text, \theta, \tan)

function normalizeDelimiters(t) {
  return String(t ?? "")
    // \[ ... \]  →  $$ ... $$   (block math)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, e) => "$$" + e + "$$")
    // \( ... \)  →  $ ... $     (inline math)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, e) => "$" + e + "$");
}

// Turn stray literal "\n" (backslash + n) in PROSE into real newlines. Only used
// on non-math segments so real LaTeX commands (\neq, \nu, \times…) are safe.
const fixProseNewlines = (t) => t.replace(/\\r\\n|\\n|\\r/g, "\n");

// Does the text between a pair of "$" actually look like MATH — or is it prose
// that got trapped because a stray "$" (a currency sign like "$300"/"$900")
// mis-paired with a real math delimiter? AI explanations frequently write money
// as "$300", which collides with "$…$" math and scrambles the whole line.
// We only treat a "$…$" span as math when its content is genuinely math-like.
function looksLikeMath(s) {
  if (!s || !s.trim()) return false;
  // Definitive LaTeX / math markers (commands, sub/superscripts, groups, "=").
  if (/[\\^_={}]/.test(s)) return true;
  // Anything longer than this with NO math marker is almost certainly prose
  // dragged in by a stray currency "$".
  if (s.length > 120) return false;
  // A pure numeric / operator expression, e.g. "30 + 20 = 65", "3.14".
  if (/^[\s\d.,+\-*/()×÷=<>%]+$/.test(s)) return true;
  // A short symbol/token like "n", "x", "H", "R_1".
  const words = s.trim().split(/\s+/).filter(Boolean);
  return words.length <= 3 && /[A-Za-z0-9]/.test(s);
}

// Split text into text/math parts WITHOUT the naive global-regex pairing (which
// breaks the moment a stray currency "$" appears). We scan left-to-right and a
// "$" only opens math when it can be paired with a later "$" AND the enclosed
// content looks like math; otherwise the "$" is emitted as a literal dollar
// sign. This makes "$300 … $H=\frac{a}{b}$ … $900 … $30+20=65$" render with the
// prose (and dollar amounts) intact and only the real formulas as math.
function parseMathParts(text) {
  const parts = [];
  let buf = "";
  let i = 0;
  const n = text.length;
  const pushText = (s) => { if (s) parts.push({ type: "text", value: s }); };

  while (i < n) {
    const c = text[i];
    if (c !== "$") { buf += c; i += 1; continue; }

    // Block math: $$ … $$
    if (text[i + 1] === "$") {
      const close = text.indexOf("$$", i + 2);
      if (close !== -1) {
        pushText(buf); buf = "";
        parts.push({ type: "math", value: text.slice(i + 2, close), block: true });
        i = close + 2;
        continue;
      }
      buf += "$$"; i += 2; continue; // no closing $$ → literal
    }

    // Inline math: $ … $ — only when the paired content is genuinely math.
    const close = text.indexOf("$", i + 1);
    if (close !== -1 && looksLikeMath(text.slice(i + 1, close))) {
      pushText(buf); buf = "";
      parts.push({ type: "math", value: text.slice(i + 1, close), block: false });
      i = close + 1;
      continue;
    }

    // A stray/currency "$" (e.g. "$300") — keep it as a literal dollar sign so
    // it does not mis-pair with the real math further along the line.
    buf += "$"; i += 1;
  }
  pushText(buf);
  return parts;
}

export default function MathText({ children, className = "" }) {
  const text = normalizeDelimiters(recoverEatenLatex(children));

  if (!text.includes("$")) {
    // `whitespace-pre-line` preserves real line breaks in multi-line text.
    return <span className={`whitespace-pre-line ${className}`}>{fixProseNewlines(text)}</span>;
  }

  const parts = parseMathParts(text);

  return (
    <span className={`whitespace-pre-line ${className}`}>
      {parts.map((p, i) =>
        p.type === "math" ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(p.value, {
                throwOnError: false,
                displayMode: p.block,
              }),
            }}
          />
        ) : (
          <span key={i}>{fixProseNewlines(p.value)}</span>
        )
      )}
    </span>
  );
}
