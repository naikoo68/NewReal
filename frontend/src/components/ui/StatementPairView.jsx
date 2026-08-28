import MathText from "./MathText";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

// For a "rearrange" question the sentence boxes must be labelled with the SAME
// scheme the answer options use, otherwise the student can't map an option
// (e.g. "D-B-A-C") to a sentence. The AI spec asks for Roman numerals, but some
// questions come back with letters (A-B-C-D). Detect which scheme the options
// use and label the boxes to match; fall back to Roman numerals when unsure.
function rearrangeLabels(q) {
  const opts = (q?.options || []).map((o) => String(o || "")).join(" ");
  const hasRoman = /\b(?:I{1,3}|IV|VI{0,3}|IX|X)\b/.test(opts);
  const hasLetters = /\b[A-H]\b/.test(opts);
  // Prefer whichever the options clearly use; if both/neither, keep Roman.
  if (hasLetters && !hasRoman) return LETTERS;
  return ROMAN;
}

// The closing prompt shown under the statements/pairs list for these types.
export function closingPrompt(type) {
  if (type === "statement") return "Which of the statement(s) given above is/are correct?";
  if (type === "pair") return "How many of the above pairs are correctly matched?";
  if (type === "pairselect") return "Which of the pairs given above is/are correctly matched?";
  if (type === "rearrange") return "Choose the correct order of the sentences:";
  return "";
}

// Renders the numbered list that sits between the question stem and the answer
// options for statement/pair/pairselect question types:
//  - statement:  columnA holds the statements → "1. <statement>"
//  - pair:       columnA/columnB hold the two sides → "1. <left> — <right>"
//                (options are counts: "Only one pair"…)
//  - pairselect: same list as pair, but options are combinations ("1 and 2 only"…)
export default function StatementPairView({ q }) {
  if (!q) return null;

  let rows = null;
  if (q.type === "statement" || q.type === "rearrange") {
    rows = (q.columnA || [])
      .filter((s) => s != null && String(s).trim() !== "")
      .map((s) => <MathText>{s}</MathText>);
  } else if (q.type === "pair" || q.type === "pairselect") {
    const left = q.columnA || [];
    const right = q.columnB || [];
    const n = Math.max(left.length, right.length);
    rows = Array.from({ length: n }, (_, i) => [left[i], right[i]])
      .filter(([a, b]) => (a && String(a).trim()) || (b && String(b).trim()))
      .map(([a, b]) => (
        <span className="flex flex-wrap items-center gap-1">
          <MathText>{a}</MathText>
          <span className="mx-1 text-slate-400">—</span>
          <MathText>{b}</MathText>
        </span>
      ));
  }

  if (!rows || !rows.length) return null;

  const labels = q.type === "rearrange" ? rearrangeLabels(q) : null;

  return (
    <div className="mt-3">
      <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
        {rows.map((content, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="font-bold text-brand-700 dark:text-brand-300">{(labels ? labels[i] || i + 1 : i + 1)}.</span>
            {content}
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">{closingPrompt(q.type)}</p>
    </div>
  );
}
