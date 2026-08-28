// Shared helpers for question lists (used across Content, Tests, Practice).

// The four FIXED options for an "assertion" (Assertion & Reason) question, in
// their canonical order — (a)…(d). Their order is meaningful (the stored
// `correct` index points into this exact sequence), so they are never shuffled.
// Used as a display fallback when a question was saved without its option text
// (older/imported assertion questions can have blank `options`), matching the
// rubric the backend AI prompt requires.
export const ASSERTION_REASON_OPTIONS = [
  "Both A and R are true and R is the correct explanation of A",
  "Both A and R are true but R is NOT the correct explanation of A",
  "A is true but R is false",
  "A is false but R is true",
];

// The options to DISPLAY for a question. Normally just `q.options`, but for an
// assertion question whose options are missing/blank it falls back to the fixed
// A/R rubric above so the answer choices always render (never bare letters).
export function displayOptions(q) {
  const opts = q?.options || [];
  if (q?.type === "assertion") {
    const hasText = opts.length === 4 && opts.every((o) => String(o || "").trim() !== "");
    if (!hasText) return ASSERTION_REASON_OPTIONS.slice();
  }
  return opts;
}

// Format a date as "12 Jul 2026, 11:05 AM" — always 12-hour with AM/PM
// (hour12:true) so it never shows 24-hour time regardless of browser locale.
export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-US", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "";

// Upload date of a question. Uses `createdAt` when present; otherwise derives it
// from the Mongo `_id` — every ObjectId embeds its creation time in the first 4
// bytes — so questions uploaded before timestamps were tracked STILL show an
// accurate date, with no data migration needed.
export function questionDate(item) {
  if (item?.createdAt) return new Date(item.createdAt);
  const id = String(item?._id || item?.id || "");
  if (/^[a-f\d]{24}$/i.test(id)) return new Date(parseInt(id.substring(0, 8), 16) * 1000);
  return null;
}

// Latest EDIT date of a question — only when it was actually edited after upload.
// Mongoose keeps a single `updatedAt` that it overwrites on every save, so this
// is always just the MOST RECENT edit (editing 5 times shows only the last one).
// A ~5s threshold ignores the sub-second gap Mongo records at creation time, so
// a never-edited question reports no update date.
export function questionUpdatedDate(item) {
  if (!item?.updatedAt) return null;
  const upd = new Date(item.updatedAt);
  if (isNaN(upd.getTime())) return null;
  const created = questionDate(item);
  if (created && upd.getTime() - created.getTime() <= 5000) return null; // not edited since upload
  return upd;
}

// Formatted upload date/time for a question ("" if unknown), with the latest
// update time appended when the question has been edited since upload. The
// upload time always stays visible.
export const questionDateText = (item) => {
  const created = questionDate(item);
  if (!created) return "";
  const updated = questionUpdatedDate(item);
  const base = `Uploaded ${fmtDateTime(created)}`;
  return updated ? `${base} · Updated ${fmtDateTime(updated)}` : base;
};

// The stem to DISPLAY for a question. For an assertion question the Assertion (A)
// and Reason (R) statements live in their own fields and render in dedicated
// boxes — but some questions also carry a copy of them inside the stem `text`,
// which then shows TWICE. This returns the stem with any embedded
// "Assertion (A): …/Reason (R): …" block stripped (keeping just the intro line),
// but ONLY when the A/R are present in their own fields (so nothing is lost).
export function stemText(q) {
  const text = q?.text || "";
  if (q?.type !== "assertion" || !(q?.assertion && q?.reason)) return text;
  const idx = text.search(/\bAssertion\b\s*(?:\([Aa]\))?\s*[:\-]/);
  if (idx === -1) return text.trim();
  const intro = text.slice(0, idx).trim();
  return intro || "Consider the following Assertion (A) and Reason (R):";
}

// Every piece of searchable text for a question, covering ALL question types:
//  - mcq:        text, options, per-option explanations, explanation
//  - assertion:  assertion (A) + reason (R) statements
//  - matching:   columnA + columnB (the two matched columns)
//  - statement:  columnA (the numbered statements)
//  - pair/pairselect: columnA + columnB (the left/right pairs)
//  - table:      every cell in tableRows (header + body)
//  plus shared metadata (topic, section). So a search hits meaning found in the
//  question body OR the options OR any type-specific part — not just the stem.
function questionHaystack(item) {
  const parts = [
    item.text,
    item.explanation,
    item.topic,
    item.section,
    item.assertion,
    item.reason,
    ...(item.options || []),
    ...(item.optionExplanations || []),
    ...(item.columnA || []),
    ...(item.columnB || []),
    ...(Array.isArray(item.tableRows) ? item.tableRows.flat(Infinity) : []),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

// Option labels that must NOT count as search words (roman numerals ii–xv;
// single letters a/b/c/d and lone digits 1/2 are dropped by the length rule).
const OPTION_LABELS = new Set(["ii", "iii", "iv", "vi", "vii", "viii", "ix", "xi", "xii", "xiii", "xiv", "xv"]);

// Meaningful words from a query. Splits on ANY non-alphanumeric char so option
// labels like "(a)", "1.", "(ii)" detach from the real word ("(a)Dual" → "dual"),
// then drops single letters, lone digits and roman-numeral labels — so search
// keys off the question body only, never the option marker or its place.
const meaningfulWords = (query) => [
  ...new Set(
    String(query || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((w) => w.length >= 2 && !OPTION_LABELS.has(w))
  ),
];

// Search relevance 0–100%. Full phrase present anywhere in the question → 100%;
// otherwise the share of meaningful query WORDS found (word-level, not whole-
// phrase, ignoring option labels), so a query matches even when its words are
// split across the body and the options. The UI shows results at 40%+.
export function matchPercent(query, item) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return 0;
  const hay = questionHaystack(item);
  if (!hay) return 0;
  if (hay.includes(q)) return 100;
  const words = meaningfulWords(query);
  if (!words.length) return 0;
  const matched = words.filter((w) => hay.includes(w)).length;
  return Math.round((matched / words.length) * 100);
}

// Apply a search query to a list of questions → 40%+ matches sorted best-first,
// each tagged with `_match` (the %). Returns null when the query is empty.
export function searchQuestions(list, query) {
  const q = String(query || "").trim();
  if (!q) return null;
  return (list || [])
    .map((it) => ({ ...it, _match: matchPercent(q, it) }))
    .filter((it) => it._match >= 40)
    .sort((a, b) => b._match - a._match);
}


// Human-readable labels for each question TYPE, used by the "View all" type
// filter (and matching the badges shown on each question card).
export const QUESTION_TYPE_LABELS = {
  mcq: "MCQ",
  numericalmcq: "Numerical MCQ",
  assertion: "Assertion & Reason",
  matching: "Matching",
  statement: "Statement",
  pair: "Pair",
  pairselect: "Pair-select",
  table: "Table",
  image: "Image",
  journal: "Journal Entry",
  ledger: "Ledger Posting",
  rearrange: "Sentence Rearrangement",
  diagram: "Diagram",
};

// The canonical TYPE key for a question. A plain MCQ has no/blank/unknown type,
// so anything not in QUESTION_TYPE_LABELS collapses to "mcq".
export function questionTypeKey(q) {
  const t = q?.type;
  return QUESTION_TYPE_LABELS[t] ? t : "mcq";
}

// Filter a question list to only the selected type keys. An empty/omitted
// selection means "all types" (no filtering).
export function filterByType(list, selectedTypes) {
  const arr = Array.isArray(list) ? list : [];
  if (!Array.isArray(selectedTypes) || selectedTypes.length === 0) return arr;
  const set = new Set(selectedTypes);
  return arr.filter((q) => set.has(questionTypeKey(q)));
}
