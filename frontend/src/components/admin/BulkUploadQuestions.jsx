import { useEffect, useState } from "react";
import { X, Upload, FileText, CheckCircle2, AlertTriangle } from "lucide-react";

// Full CSV parser that respects double-quoted fields — which may contain
// commas AND line breaks (e.g. a multi-line "Consider the following
// statements…" question). Returns an array of records (each an array of cells).
function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote ""
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* ignore */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  row.push(field);
  rows.push(row);
  // Keep only records that have some content; trim each cell.
  return rows.filter((r) => r.some((f) => String(f).trim() !== "")).map((r) => r.map((f) => f.trim()));
}

function correctIndex(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (["A", "B", "C", "D"].includes(s)) return "ABCD".indexOf(s);
  const n = parseInt(s, 10);
  if (n >= 1 && n <= 4) return n - 1;
  return 0;
}

const asDifficulty = (d) => (["Easy", "Medium", "Hard"].includes(d) ? d : "Medium");

// Assertion questions sometimes arrive with BOTH the Assertion and the Reason
// packed into the single Assertion field — e.g. "Assertion (A): … Reason (R): …"
// — leaving the Reason column empty (common in AI-generated CSV/JSON exports).
// Recover them: when reason is empty and the assertion text contains a
// "Reason (R):"/"Reason:" marker, split on it; also strip a leading
// "Assertion (A):"/"Assertion:" label from the assertion part. Returns the
// (possibly) repaired { assertion, reason } pair.
function splitAssertionReason(assertion, reason) {
  let a = String(assertion || "").trim();
  let r = String(reason || "").trim();
  if (!r && a) {
    const m = a.match(/\bReason\b\s*(?:\([Rr]\))?\s*[:\-]/);
    if (m && m.index > 0) {
      r = a.slice(m.index + m[0].length).trim();
      a = a.slice(0, m.index).trim();
    }
  }
  a = a.replace(/^\s*Assertion\b\s*(?:\([Aa]\))?\s*[:\-]\s*/, "").trim();
  r = r.replace(/^\s*Reason\b\s*(?:\([Rr]\))?\s*[:\-]\s*/, "").trim();
  return { assertion: a, reason: r };
}

// Strip a leading list marker ("1.", "2)", "I.", "(iii)", "IV -") from an item,
// since the app auto-numbers Column A (1,2,3,4) and Column B (I,II,III,IV) and
// statement/pair lists. This avoids double numbering like "1  1. Constant MRT".
export const stripListMarker = (x) =>
  String(x || "").replace(/^\s*[([]?\s*(?:\d{1,2}|[ivxlcIVXLC]{1,5})\s*[.)\]:\-]\s+/, "").trim();
const splitList = (s) => String(s || "").split("|").map((x) => stripListMarker(x)).filter(Boolean);

// Builds the per-option brief notes (why each WRONG option is wrong). The four
// cells align to options A–D; the correct option's cell is always cleared,
// since the correct answer is covered by the detailed Explanation column.
// Returns undefined when no notes were supplied so we don't store empty arrays.
function buildOptionExplanations(cells, correctIdx) {
  const four = [cells[0], cells[1], cells[2], cells[3]].map((x) => String(x || "").trim());
  if (!four.some(Boolean)) return undefined;
  four[correctIdx] = "";
  return four;
}

// Turns pasted CSV text into question objects + a list of skipped-row errors.
// Supports seven row shapes (all end with optional Difficulty, Explanation, WhyA..D):
//   MCQ (default):  Question, OptionA..D, Correct, ...
//   Matching:       matching, Question, ColumnA, ColumnB, OptionA..D, Correct, ...
//   Statement:      statement, Intro, Statements, OptionA..D, Correct, ...
//   Pair:           pair, Intro, LeftList, RightList, OptionA..D, Correct, ...
//   Pair-select:    pairselect, Intro, LeftList, RightList, OptionA..D, Correct, ...
//   Image:          image, ImageURL, Question, OptionA..D, Correct, ...
//   Table:          table, Intro, TableData, OptionA..D, Correct, ...
//   Assertion:      assertion, Assertion, Reason, OptionA..D, Correct, ...
// Explanation is the DETAILED note for the correct answer; WhyA..D are optional
// BRIEF notes shown when a student selects that (wrong) option — the correct
// option's Why cell is ignored. Lists (ColumnA/ColumnB/Statements/LeftList/
// RightList) are pipe-separated, e.g. "Newton|Bohr|Curie". TableData uses "|"
// between rows and ";" between cells; the first row is the header.
export function parseQuestionsCsv(text) {
  const records = parseCsvRecords(text);
  const rows = [];
  const errors = [];
  records.forEach((cells, idx) => {
    const first = (cells[0] || "").toLowerCase();

    // Skip an optional header row.
    if (idx === 0 && /^(type|text|question)$/i.test(first)) return;

    // ---- Matching row ----
    if (first === "matching") {
      const [, qtext, colA, colB, a, b, c, d, correct, difficulty, explanation, wa, wb, wc, wd] = cells;
      const columnA = splitList(colA);
      const columnB = splitList(colB);
      if (!qtext || columnA.length < 2 || columnB.length < 2 || !a || !b || !c || !d) {
        errors.push(`Row ${idx + 1}: matching needs a question, ColumnA & ColumnB (2+ items each, pipe-separated) and 4 options`);
        return;
      }
      const ci = correctIndex(correct);
      const optExp = buildOptionExplanations([wa, wb, wc, wd], ci);
      rows.push({
        type: "matching",
        text: qtext,
        columnA,
        columnB,
        options: [a, b, c, d],
        correct: ci,
        difficulty: asDifficulty(difficulty),
        explanation: explanation || "",
        ...(optExp ? { optionExplanations: optExp } : {}),
        status: "published",
      });
      return;
    }

    // ---- Statement-based row ----
    if (first === "statement") {
      const [, qtext, statements, a, b, c, d, correct, difficulty, explanation, wa, wb, wc, wd] = cells;
      const columnA = splitList(statements);
      if (!qtext || columnA.length < 2 || !a || !b || !c || !d) {
        errors.push(`Row ${idx + 1}: statement needs an intro, 2+ pipe-separated statements and 4 options`);
        return;
      }
      const ci = correctIndex(correct);
      const optExp = buildOptionExplanations([wa, wb, wc, wd], ci);
      rows.push({
        type: "statement",
        text: qtext,
        columnA,
        options: [a, b, c, d],
        correct: ci,
        difficulty: asDifficulty(difficulty),
        explanation: explanation || "",
        ...(optExp ? { optionExplanations: optExp } : {}),
        status: "published",
      });
      return;
    }

    // ---- Pair-matching row (how many pairs are correct) ----
    if (first === "pair") {
      const [, qtext, leftList, rightList, a, b, c, d, correct, difficulty, explanation, wa, wb, wc, wd] = cells;
      const columnA = splitList(leftList);
      const columnB = splitList(rightList);
      if (!qtext || columnA.length < 2 || columnA.length !== columnB.length || !a || !b || !c || !d) {
        errors.push(`Row ${idx + 1}: pair needs an intro, equal-length Left & Right lists (2+ items, pipe-separated) and 4 options`);
        return;
      }
      const ci = correctIndex(correct);
      const optExp = buildOptionExplanations([wa, wb, wc, wd], ci);
      rows.push({
        type: "pair",
        text: qtext,
        columnA,
        columnB,
        options: [a, b, c, d],
        correct: ci,
        difficulty: asDifficulty(difficulty),
        explanation: explanation || "",
        ...(optExp ? { optionExplanations: optExp } : {}),
        status: "published",
      });
      return;
    }

    // ---- Pair-select row (which pairs are correct — combination options) ----
    if (first === "pairselect") {
      const [, qtext, leftList, rightList, a, b, c, d, correct, difficulty, explanation, wa, wb, wc, wd] = cells;
      const columnA = splitList(leftList);
      const columnB = splitList(rightList);
      if (!qtext || columnA.length < 2 || columnA.length !== columnB.length || !a || !b || !c || !d) {
        errors.push(`Row ${idx + 1}: pairselect needs an intro, equal-length Left & Right lists (2+ items, pipe-separated) and 4 options`);
        return;
      }
      const ci = correctIndex(correct);
      const optExp = buildOptionExplanations([wa, wb, wc, wd], ci);
      rows.push({
        type: "pairselect",
        text: qtext,
        columnA,
        columnB,
        options: [a, b, c, d],
        correct: ci,
        difficulty: asDifficulty(difficulty),
        explanation: explanation || "",
        ...(optExp ? { optionExplanations: optExp } : {}),
        status: "published",
      });
      return;
    }

    // ---- Assertion & Reason row ----
    if (first === "assertion") {
      const [, assertionRaw, reasonRaw, a, b, c, d, correct, difficulty, explanation, wa, wb, wc, wd] = cells;
      // Recover rows where Assertion + Reason were packed into one field.
      const { assertion, reason } = splitAssertionReason(assertionRaw, reasonRaw);
      if (!assertion || !reason || !a || !b || !c || !d) {
        errors.push(`Row ${idx + 1}: assertion needs an Assertion, a Reason and 4 options`);
        return;
      }
      const ci = correctIndex(correct);
      const optExp = buildOptionExplanations([wa, wb, wc, wd], ci);
      rows.push({
        type: "assertion",
        text: "In the following question, a statement of Assertion (A) is followed by a statement of Reason (R). Select the correct option:",
        assertion,
        reason,
        options: [a, b, c, d],
        correct: ci,
        difficulty: asDifficulty(difficulty),
        explanation: explanation || "",
        ...(optExp ? { optionExplanations: optExp } : {}),
        status: "published",
      });
      return;
    }

    // ---- Image / diagram row ----
    if (first === "image") {
      const [, imageUrl, qtext, a, b, c, d, correct, difficulty, explanation, wa, wb, wc, wd] = cells;
      if (!imageUrl || !qtext || !a || !b || !c || !d) {
        errors.push(`Row ${idx + 1}: image needs an image URL, a question and 4 options`);
        return;
      }
      const ci = correctIndex(correct);
      const optExp = buildOptionExplanations([wa, wb, wc, wd], ci);
      rows.push({
        type: "image",
        image: imageUrl,
        text: qtext,
        options: [a, b, c, d],
        correct: ci,
        difficulty: asDifficulty(difficulty),
        explanation: explanation || "",
        ...(optExp ? { optionExplanations: optExp } : {}),
        status: "published",
      });
      return;
    }

    // ---- Table row (dynamic rows × columns) ----
    if (first === "table") {
      const [, qtext, tableData, a, b, c, d, correct, difficulty, explanation, wa, wb, wc, wd] = cells;
      // Rows separated by "|", cells within a row separated by ";".
      const tableRows = String(tableData || "")
        .split("|")
        .map((r) => r.split(";").map((cell) => cell.trim()))
        .filter((r) => r.some((cell) => cell !== ""));
      if (!qtext || tableRows.length < 2 || !a || !b || !c || !d) {
        errors.push(`Row ${idx + 1}: table needs an intro, a table (rows split by "|", cells by ";") and 4 options`);
        return;
      }
      const ci = correctIndex(correct);
      const optExp = buildOptionExplanations([wa, wb, wc, wd], ci);
      rows.push({
        type: "table",
        text: qtext,
        tableRows,
        options: [a, b, c, d],
        correct: ci,
        difficulty: asDifficulty(difficulty),
        explanation: explanation || "",
        ...(optExp ? { optionExplanations: optExp } : {}),
        status: "published",
      });
      return;
    }

    // ---- MCQ / Journal / Ledger / Rearrange row (MCQ-shaped; optionally prefixed with "mcq", "journal", "ledger" or "rearrange") ----
    const isJournal = first === "journal";
    const isLedger = first === "ledger";
    const isRearrange = first === "rearrange";
    const cols = first === "mcq" || isJournal || isLedger || isRearrange ? cells.slice(1) : cells;
    if (cols.length < 5) { errors.push(`Row ${idx + 1}: needs a question + 4 options`); return; }
    const [qtext, a, b, c, d, correct, difficulty, explanation, wa, wb, wc, wd] = cols;
    if (!qtext || !a || !b || !c || !d) { errors.push(`Row ${idx + 1}: empty question or option`); return; }
    const ci = correctIndex(correct);
    const optExp = buildOptionExplanations([wa, wb, wc, wd], ci);
    rows.push({
      type: isJournal ? "journal" : isLedger ? "ledger" : isRearrange ? "rearrange" : "mcq",
      text: qtext,
      options: [a, b, c, d],
      correct: ci,
      difficulty: asDifficulty(difficulty),
      explanation: explanation || "",
      ...(optExp ? { optionExplanations: optExp } : {}),
      status: "published",
    });
  });
  return { rows, errors };
}

// ---- CSV export (reverse of parseQuestionsCsv) ----
const LETTERS = ["A", "B", "C", "D"];

// Escape a single CSV cell: quote it when it contains a comma/quote/newline.
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// The WhyA..D tail cells from optionExplanations (the correct option is blank).
function whyCells(q) {
  const oe = Array.isArray(q.optionExplanations) ? q.optionExplanations : [];
  return [0, 1, 2, 3].map((i) => (i === q.correct ? "" : oe[i] || ""));
}

// Convert an array of question objects into CSV text that parseQuestionsCsv can
// read back — used to "Copy whole quiz/test as CSV". Handles every type.
export function questionsToCsv(questions) {
  return (questions || [])
    .map((q) => {
      const o = q.options || [];
      const [a, b, c, d] = [o[0] || "", o[1] || "", o[2] || "", o[3] || ""];
      const tail = [LETTERS[q.correct] || "A", q.difficulty || "Medium", q.explanation || "", ...whyCells(q)];
      const A = (arr) => (arr || []).join("|");
      let cells;
      switch (q.type) {
        case "matching": cells = ["matching", q.text, A(q.columnA), A(q.columnB), a, b, c, d, ...tail]; break;
        case "statement": cells = ["statement", q.text, A(q.columnA), a, b, c, d, ...tail]; break;
        case "pair": cells = ["pair", q.text, A(q.columnA), A(q.columnB), a, b, c, d, ...tail]; break;
        case "pairselect": cells = ["pairselect", q.text, A(q.columnA), A(q.columnB), a, b, c, d, ...tail]; break;
        case "table": cells = ["table", q.text, (q.tableRows || []).map((r) => (r || []).join(";")).join("|"), a, b, c, d, ...tail]; break;
        case "assertion": cells = ["assertion", q.assertion || "", q.reason || "", a, b, c, d, ...tail]; break;
        case "image": cells = ["image", q.image || "", q.text, a, b, c, d, ...tail]; break;
        case "journal": cells = ["journal", q.text, a, b, c, d, ...tail]; break;
        case "ledger": cells = ["ledger", q.text, a, b, c, d, ...tail]; break;
        case "rearrange": cells = ["rearrange", q.text, a, b, c, d, ...tail]; break;
        default: cells = [q.text, a, b, c, d, ...tail];
      }
      while (cells.length && cells[cells.length - 1] === "") cells.pop(); // trim trailing empties
      return cells.map(csvCell).join(",");
    })
    .join("\n");
}

// Parse a JSON array of question objects into the SAME internal row shape the
// CSV parser produces, so both feed the identical insert path. Accepts an array
// or { questions: [...] }. `correct` may be an index (0–3), a number (1–4) or a
// letter (A–D). Lists come as arrays (columnA/columnB/statements/tableRows).
// Tolerant JSON parse for AI output: strips code fences, narrows to the outer
// array/object, and — the big one — escapes stray LaTeX backslashes (e.g. "$\psi$",
// "$\frac{d}{t}$") that models forget to double, which otherwise throw
// "Bad escaped character". Returns { data } or { error }.
// Single-pass, position-aware repair for the messy JSON that AI models emit.
// A regex can only fix backslashes; the two errors that actually break real
// pastes are (1) an UNESCAPED double-quote inside a string value (the model
// writes  6" long  or  the "best" option ) and (2) a RAW newline/tab inside a
// string — both throw "Expected ',' or ']'" / "Bad control character". This
// walks the text tracking whether we're inside a string and fixes each case:
//   • stray LaTeX backslash (\psi, \frac)         -> doubled (\\)
//   • already-valid escapes (\" \\ \/ \n \uXXXX)  -> kept as-is
//   • raw newline / carriage-return / tab in a str -> turned into \n \r \t
//   • a " that is NOT followed (past spaces) by a , ] } : or end-of-input is
//     treated as an inner quote and escaped; otherwise it's the real closer.
// The one case no parser can resolve is an unescaped inner quote sitting right
// before a comma/bracket (…the "best", …) — that stays ambiguous and is left to
// the error snippet below.
function repairJson(src) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (!inStr) {
      out += ch;
      if (ch === '"') inStr = true;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === undefined) { out += "\\\\"; continue; } // trailing lone backslash
      if ('"\\/bfnrt'.includes(next)) { out += ch + next; i++; continue; } // valid escape — keep
      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(src.substr(i + 2, 4))) { out += ch + next; i++; continue; } // \uXXXX — keep
      out += "\\\\"; continue; // stray backslash → double it; reprocess `next` normally
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && (src[j] === " " || src[j] === "\t" || src[j] === "\r" || src[j] === "\n")) j++;
      const after = src[j];
      if (after === undefined || after === "," || after === "]" || after === "}" || after === ":") {
        inStr = false; out += ch; // genuine closing quote
      } else {
        out += '\\"'; // unescaped inner quote → escape it
      }
      continue;
    }
    if (ch === "\n") { out += "\\n"; continue; }
    if (ch === "\r") { out += "\\r"; continue; }
    if (ch === "\t") { out += "\\t"; continue; }
    out += ch;
  }
  return out;
}

// Pull a short, readable snippet around the byte offset a JSON error reports, so
// when auto-repair still can't fix it the user is pointed at the exact spot.
function nearError(text, err) {
  const m = /position (\d+)/.exec(err?.message || "");
  if (!m) return "";
  const pos = Number(m[1]);
  const start = Math.max(0, pos - 35);
  const snippet = text.slice(start, pos + 35).replace(/\s+/g, " ").trim();
  return snippet ? ` Problem is near: …${snippet}…` : "";
}

function looseJsonParse(text) {
  let raw = String(text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  const first = raw.search(/[[{]/);
  const last = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
  if (first > 0 && last > first) raw = raw.slice(first, last + 1); // drop surrounding prose
  // Escape stray LaTeX backslashes (\psi, \frac, \theta, \, \%) that models forget
  // to double — WITHOUT corrupting ones that are already correctly doubled. We
  // match an escaped-backslash PAIR (\\) first and keep it intact so its second
  // backslash is never reprocessed; otherwise we double a lone backslash that
  // isn't a real JSON escape (\" and \/ and \uXXXX are preserved). This lets a
  // file MIX doubled and single backslashes (very common in AI output) and still
  // parse. The old regex re-doubled the pair's 2nd backslash (\\, -> \\\,), which
  // threw "Bad escaped character" whenever any single backslash forced this path.
  const fixBackslashes = (s) => s.replace(/\\\\|\\(?!["/]|u[\da-fA-F]{4})/g, (m) => (m === "\\\\" ? m : "\\\\"));
  const repaired = repairJson(raw); // also fixes inner quotes + raw newlines/tabs
  const attempts = [
    raw,
    fixBackslashes(raw),
    fixBackslashes(raw).replace(/,\s*([\]}])/g, "$1"),
    repaired,
    repaired.replace(/,\s*([\]}])/g, "$1"), // repaired + drop trailing commas
  ];
  let err, errText;
  for (const t of attempts) { try { return { data: JSON.parse(t) }; } catch (e) { err = e; errText = t; } }
  return { error: err, near: nearError(errText, err) };
}

function parseQuestionsJson(text) {
  const rows = [];
  const errors = [];
  // An empty box isn't an error — it just means nothing has been pasted yet.
  // Without this guard, JSON.parse("") throws "Unexpected end of JSON input",
  // which showed a misleading "1 row will be skipped" on the empty modal.
  if (!String(text || "").trim()) return { rows, errors };
  const parsed = looseJsonParse(text);
  if (parsed.error) return { rows, errors: [`Invalid JSON: ${parsed.error.message || "could not parse"}.${parsed.near || ""} (The importer auto-fixes stray LaTeX backslashes, raw line breaks and most inner quotes; a quote sitting right before a comma — like "best", — can't be guessed, so escape it as \\" or remove it.)`] };
  const data = parsed.data;
  const list = Array.isArray(data) ? data : (Array.isArray(data?.questions) ? data.questions : null);
  if (!list) return { rows, errors: ['JSON must be an array of questions, or { "questions": [ ... ] }.'] };

  const S = (v) => (v == null ? "" : String(v)).trim();
  const arr = (x) => (Array.isArray(x) ? x.map((v) => (v == null ? "" : String(v))) : []);
  const normCorrect = (v) => {
    const s = String(v ?? "").trim().toUpperCase();
    if (["A", "B", "C", "D"].includes(s)) return "ABCD".indexOf(s);
    const n = parseInt(s, 10);
    if (n >= 1 && n <= 4) return n - 1; // 1-based
    if (n >= 0 && n <= 3) return n;     // 0-based index
    return 0;
  };
  const KNOWN = ["mcq", "matching", "statement", "pair", "pairselect", "assertion", "table", "image", "journal"];

  list.forEach((q, i) => {
    const type = KNOWN.includes(q?.type) ? q.type : "mcq";
    const options = arr(q?.options);
    const opts4 = [options[0] || "", options[1] || "", options[2] || "", options[3] || ""];
    const row = {
      type,
      text: S(q?.text ?? q?.question),
      options: opts4,
      correct: normCorrect(q?.correct),
      difficulty: ["Easy", "Medium", "Hard"].includes(q?.difficulty) ? q.difficulty : "Medium",
      explanation: S(q?.explanation),
      optionExplanations: arr(q?.optionExplanations ?? q?.whys).slice(0, 4),
    };
    const need4 = () => opts4.every((o) => o.trim());
    if (type === "assertion") {
      const ar = splitAssertionReason(q?.assertion, q?.reason);
      row.assertion = ar.assertion; row.reason = ar.reason;
      // The DB requires a `text` on every question, but an assertion carries its
      // meaning in assertion/reason — supply the standard stem when omitted (same
      // default the AI generator uses) so it isn't silently dropped on save.
      if (!row.text) row.text = "Consider the following Assertion (A) and Reason (R):";
      if (!row.assertion || !row.reason || !need4()) { errors.push(`Question ${i + 1} (assertion): needs assertion, reason and 4 options.`); return; }
    } else if (type === "image") {
      row.image = S(q?.image ?? q?.imageUrl);
      if (!row.image || !row.text || !need4()) { errors.push(`Question ${i + 1} (image): needs image URL, text and 4 options.`); return; }
    } else if (type === "table") {
      row.tableRows = Array.isArray(q?.tableRows) ? q.tableRows.map(arr).filter((r) => r.some((c) => c !== "")) : [];
      if (!row.text || row.tableRows.length < 2 || !need4()) { errors.push(`Question ${i + 1} (table): needs text, ≥2 table rows and 4 options.`); return; }
    } else if (type === "matching" || type === "pair" || type === "pairselect") {
      row.columnA = arr(q?.columnA ?? q?.leftList);
      row.columnB = arr(q?.columnB ?? q?.rightList);
      if (!row.text || !row.columnA.length || !row.columnB.length || !need4()) { errors.push(`Question ${i + 1} (${type}): needs text, columnA, columnB and 4 options.`); return; }
    } else if (type === "statement") {
      row.columnA = arr(q?.columnA ?? q?.statements);
      if (!row.text) row.text = "Consider the following statements:"; // default intro when omitted
      if (!row.columnA.length || !need4()) { errors.push(`Question ${i + 1} (statement): needs statements (columnA) and 4 options.`); return; }
    } else { // mcq
      if (!row.text || !need4()) { errors.push(`Question ${i + 1} (mcq): needs text and 4 options.`); return; }
    }
    rows.push(row);
  });
  return { rows, errors };
}

const TEMPLATE_JSON = JSON.stringify([
  { type: "mcq", text: "What is 2+2?", options: ["3", "4", "5", "6"], correct: "B", difficulty: "Easy", explanation: "2+2 equals 4.", optionExplanations: ["3 is 2+1.", "", "5 is 2+3.", "6 is 2+4."] },
  { type: "statement", text: "Consider the following statements:", columnA: ["The Sun is a star.", "The Moon is a planet."], options: ["1 only", "2 only", "1 and 2 only", "Neither 1 nor 2"], correct: "A", difficulty: "Medium", explanation: "Only statement 1 is correct; the Moon is a satellite." },
  { type: "matching", text: "Match the scientist to the discovery:", columnA: ["Newton", "Einstein", "Bohr"], columnB: ["Gravity", "Relativity", "Atom model"], options: ["1-I, 2-II, 3-III", "1-II, 2-I, 3-III", "1-III, 2-II, 3-I", "1-I, 2-III, 3-II"], correct: "A", difficulty: "Medium", explanation: "Newton–Gravity, Einstein–Relativity, Bohr–Atom model." },
  { type: "pair", text: "Consider the following pairs:", columnA: ["Xylem", "Phloem", "Stomata"], columnB: ["Water transport", "Food transport", "Gas exchange"], options: ["Only one pair", "Only two pairs", "All three pairs", "None"], correct: "C", difficulty: "Easy", explanation: "All three pairs are correctly matched." },
  { type: "pairselect", text: "Consider the following vector-disease pairs:", columnA: ["Anopheles", "Aedes", "Housefly"], columnB: ["Malaria", "Dengue", "Malaria"], options: ["1 and 2 only", "2 and 3 only", "1 and 3 only", "All of the above"], correct: "A", difficulty: "Easy", explanation: "Anopheles-malaria and Aedes-dengue are correct; the housefly does not transmit malaria, so pair 3 is wrong.", optionExplanations: ["", "Pair 3 is wrong", "Pair 3 is wrong", "Pair 3 is wrong"] },
  { type: "assertion", text: "Consider the following Assertion (A) and Reason (R):", assertion: "Earth is closer to the Sun in January.", reason: "Earth's orbit is elliptical.", options: ["Both A and R are true and R is the correct explanation of A", "Both A and R are true but R is NOT the correct explanation of A", "A is true but R is false", "A is false but R is true"], correct: "A", difficulty: "Medium", explanation: "Perihelion is in early January because the orbit is elliptical." },
  { type: "table", text: "Study the table and answer which product had the highest sales:", tableRows: [["Product", "Sales"], ["Pens", "120"], ["Books", "340"], ["Bags", "90"]], options: ["Pens", "Books", "Bags", "Cannot be determined"], correct: "B", difficulty: "Easy", explanation: "Books have the highest sales at 340." },
], null, 2);

const TEMPLATE =
  "Question,Option A,Option B,Option C,Option D,Correct,Difficulty,Explanation,WhyA,WhyB,WhyC,WhyD\n" +
  '"What is 2+2?",3,4,5,6,B,Easy,"2+2 equals 4 because you add two and two.","3 is 2+1, not 2+2.",,"5 is 2+3.","6 is 2+4."\n' +
  '"Speed of light in vacuum (m/s)?","3x10^8","1x10^6","3x10^6","9x10^8",A,Medium,"Light travels at ~3x10^8 m/s in vacuum.",,"Too small by 100x.","Too small by 100x.","This is higher than the actual value."\n' +
  'matching,"Match the scientist to the discovery","Newton|Einstein|Bohr|Curie","Relativity|Gravity|Atom model|Radioactivity","1-II, 2-I, 3-III, 4-IV","1-I, 2-II, 3-III, 4-IV","1-III, 2-IV, 3-I, 4-II","1-IV, 2-III, 3-II, 4-I",A,Medium,"Newton-Gravity, Einstein-Relativity, Bohr-Atom model, Curie-Radioactivity",,"Swaps Newton and Einstein.","All mappings are shifted.","Order is fully reversed."\n' +
  'statement,"Consider the following statements:","The Sun is a star.|The Moon is a planet.|Water boils at 100°C at sea level.","1 and 3 only","2 and 3 only","1 and 2 only","1, 2 and 3",A,Medium,"Statements 1 and 3 are correct; the Moon is a satellite, not a planet.",,"Statement 2 is wrong — the Moon is a satellite.","Includes the wrong statement 2.","Includes the wrong statement 2."\n' +
  'pair,"Consider the following pairs (River — Tributary):","Ganga|Indus|Krishna","Yamuna|Chenab|Tungabhadra","Only one pair","Only two pairs","Only three pairs","All four pairs",C,Medium,"All three pairs are correctly matched.","Undercount.","Undercount.",,"There are only three pairs listed."\n' +
  'pairselect,"Consider the following pairs (State — Capital):","Kerala|Punjab|Bihar","Thiruvananthapuram|Chandigarh|Jaipur","1 and 2 only","2 and 3 only","1 and 3 only","1, 2 and 3",A,Medium,"Pairs 1 and 2 are correct; Jaipur is in Rajasthan, not Bihar (Patna).",,"Includes the wrong pair 3.","Includes the wrong pair 3.","Includes the wrong pair 3."\n' +
  'image,"https://res.cloudinary.com/demo/image/upload/diagram.png","Identify the labelled part in the diagram:","Nucleus","Mitochondrion","Ribosome","Golgi body",A,Medium,"The labelled central organelle is the nucleus.",,"Mitochondria are rod-shaped, not central.","Ribosomes are much smaller dots.","Golgi is a stack of membranes."\n' +
  'table,"Study the table and answer which product had the highest sales:","Product;Sales|Pens;120|Books;340|Bags;90","Pens","Books","Bags","Cannot be determined",B,Easy,"Books have the highest sales at 340.","Pens are 120.",,"Bags are only 90.","The table gives clear figures."\n' +
  'assertion,"The Earth is closer to the Sun in January.","The Earth\'s orbit around the Sun is elliptical.","Both A and R are true and R is the correct explanation of A","Both A and R are true but R is NOT the correct explanation of A","A is true but R is false","A is false but R is true",A,Medium,"Earth reaches perihelion in early January because its orbit is elliptical — so R correctly explains A.",,"R does explain A here.","R is true, not false.","A is true, not false."';

// Reusable bulk-upload modal. `onUpload(questions)` should return a promise
// (e.g. resolving to { inserted }). Used for both quizzes and test series.
// `defaultSection` pre-selects the target subject (when opened from a subject).
export default function BulkUploadQuestions({ open, onClose, onUpload, title = "Bulk Upload Questions", sections = [], defaultSection = "" }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [replace, setReplace] = useState(false); // remove existing questions first
  const [section, setSection] = useState(defaultSection || sections[0] || ""); // subject to tag uploaded questions
  const [mode, setMode] = useState("csv"); // "csv" | "json"

  // Re-sync the target subject each time the modal is (re)opened, since the
  // component stays mounted between opens.
  useEffect(() => { if (open) setSection(defaultSection || sections[0] || ""); /* eslint-disable-next-line */ }, [open, defaultSection]);

  if (!open) return null;

  const { rows, errors } = mode === "json" ? parseQuestionsJson(text) : parseQuestionsCsv(text);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ""));
    reader.readAsText(file);
  };

  const submit = async () => {
    if (!rows.length) { setMsg("Nothing to upload — add at least one valid row."); return; }
    if (replace && !window.confirm("This will permanently DELETE all existing questions here and replace them with the uploaded ones. Continue?")) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await onUpload(rows, { replace, section });
      const inserted = res?.inserted ?? rows.length;
      const skipped = res?.skipped ?? Math.max(0, (res?.requested ?? rows.length) - inserted);
      if (skipped > 0) {
        // Some questions passed the paste-time check but were rejected when
        // saved. Show the count AND the first few reasons, and DON'T auto-close
        // or clear the box — so you can see which ones failed and re-upload.
        const why = (res?.errors || [])
          .slice(0, 4)
          .map((e) => `#${e.number ?? "?"} ${e.type || ""}: ${e.reason}`)
          .join("  •  ");
        setMsg(
          `⚠ ${replace ? "Replaced with" : "Uploaded"} ${inserted} of ${inserted + skipped} — ${skipped} skipped.` +
          (why ? `\nReasons: ${why}` : "")
        );
        setBusy(false);
        return; // keep the modal open so nothing is lost silently
      }
      setMsg(`✓ ${replace ? "Replaced with" : "Uploaded"} ${inserted} question(s).`);
      setText("");
      setReplace(false);
      setTimeout(onClose, 1000);
    } catch (e) {
      setMsg(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4">
      <div className="min-h-full w-full max-w-none animate-scale-in card m-0 rounded-none p-4 sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Upload className="h-5 w-5" /> {title}</h3>
          <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        {/* Input format toggle: CSV or JSON */}
        <div className="mb-3 inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          <button type="button" onClick={() => setMode("csv")} className={`rounded-md px-3 py-1 text-sm font-semibold ${mode === "csv" ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>CSV</button>
          <button type="button" onClick={() => setMode("json")} className={`rounded-md px-3 py-1 text-sm font-semibold ${mode === "json" ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>JSON</button>
        </div>

        {mode === "json" && (
          <div className="mb-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
            <p className="font-semibold">JSON format:</p>
            <p className="mt-1 text-slate-500 dark:text-slate-400">Paste an array of question objects (or <code>{`{ "questions": [ ... ] }`}</code>). Each object:</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-white p-2 text-xs dark:bg-slate-900/50">{`{ "type": "mcq", "text": "...", "options": ["A","B","C","D"],
  "correct": "B", "difficulty": "Easy", "explanation": "...",
  "optionExplanations": ["","","",""] }`}</pre>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-500 dark:text-slate-400">
              <li><b>type</b>: mcq · matching · statement · pair · pairselect · assertion · table · image (default mcq).</li>
              <li><b>correct</b>: a letter <code>A–D</code>, a number <code>1–4</code>, or a 0-based index <code>0–3</code>.</li>
              <li><b>Lists as arrays</b>: matching/pair/pairselect use <code>columnA</code> &amp; <code>columnB</code>; statement uses <code>columnA</code> (or <code>statements</code>); table uses <code>tableRows</code> (array of rows, each an array of cells).</li>
              <li><b>assertion</b>: <code>assertion</code> + <code>reason</code>; <b>image</b>: <code>image</code> (URL) + <code>text</code>.</li>
              <li><b>optionExplanations</b>: 4 per-option notes (leave the correct one ""). Math in <code>$…$</code>.</li>
            </ul>
            <button type="button" onClick={() => setText(TEMPLATE_JSON)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
              <FileText className="h-3.5 w-3.5" /> Load JSON example
            </button>
          </div>
        )}

        {mode === "csv" && (
        <div className="mb-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
          <p className="font-semibold">CSV format (one question per line):</p>
          <p className="mt-1 text-slate-500 dark:text-slate-400">Every row ends with the same tail: <code>…, Correct, Difficulty, Explanation, WhyA, WhyB, WhyC, WhyD</code></p>
          <p className="mt-1 text-slate-500 dark:text-slate-400"><b>MCQ:</b> <code>Question, Option A, Option B, Option C, Option D, …tail</code></p>
          <p className="mt-1 text-slate-500 dark:text-slate-400"><b>Matching:</b> <code>matching, Question, ColumnA, ColumnB, Option A–D, …tail</code></p>
          <p className="mt-1 text-slate-500 dark:text-slate-400"><b>Statement:</b> <code>statement, Intro, Statements, Option A–D, …tail</code></p>
          <p className="mt-1 text-slate-500 dark:text-slate-400"><b>Pair (count):</b> <code>pair, Intro, LeftList, RightList, Option A–D, …tail</code></p>
          <p className="mt-1 text-slate-500 dark:text-slate-400"><b>Pair-select (which pairs):</b> <code>pairselect, Intro, LeftList, RightList, Option A–D, …tail</code></p>
          <p className="mt-1 text-slate-500 dark:text-slate-400"><b>Image:</b> <code>image, ImageURL, Question, Option A–D, …tail</code></p>
          <p className="mt-1 text-slate-500 dark:text-slate-400"><b>Table:</b> <code>table, Intro, TableData, Option A–D, …tail</code> — TableData rows split by <code>|</code>, cells by <code>;</code> (first row = header)</p>
          <p className="mt-1 text-slate-500 dark:text-slate-400"><b>Assertion &amp; Reason:</b> <code>assertion, Assertion, Reason, Option A–D, …tail</code></p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-500 dark:text-slate-400">
            <li><b>Correct</b>: A/B/C/D (or 1–4) — the correct answer option.</li>
            <li><b>Explanation</b>: the <b>detailed</b> explanation of the correct answer (shown after answering).</li>
            <li><b>WhyA–WhyD</b> (optional): a <b>brief</b> note for each option explaining why it is wrong — shown when a student picks it. Leave the correct option's cell blank (it's ignored).</li>
            <li><b>Lists</b> (ColumnA/ColumnB, Statements, LeftList/RightList): separate items with a pipe <code>|</code>, e.g. <code>"Newton|Bohr|Curie"</code>.</li>
            <li><b>Matching option</b> is a sequence like <code>1-III, 2-I, 3-IV, 4-II</code>. <b>Statement</b> options are combos like <code>"1 and 2 only"</code>. <b>Pair</b> options are counts like <code>"Only two pairs"</code>.</li>
            <li>Wrap any value containing a comma in "double quotes". Difficulty, Explanation &amp; Why columns are optional.</li>
            <li>Tip: build it in Excel/Google Sheets, then <b>Save/Download as CSV</b> and upload the file below.</li>
          </ul>
          <button
            type="button"
            onClick={() => setText(TEMPLATE)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
          >
            <FileText className="h-3.5 w-3.5" /> Load example
          </button>
        </div>
        )}

        {sections.length > 0 && (
          <div className="mb-3 flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-600 dark:text-slate-300">Add to subject:</label>
            <select value={section} onChange={(e) => setSection(e.target.value)} className="input max-w-xs py-1.5 text-sm">
              <option value="">— No subject —</option>
              {sections.map((s, i) => <option key={i} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        <div className="mb-3 flex flex-wrap gap-2">
          <label className="btn-outline cursor-pointer">
            <FileText className="h-4 w-4" /> {mode === "json" ? "Choose JSON file" : "Choose CSV file"}
            <input type="file" accept={mode === "json" ? ".json,application/json,text/plain" : ".csv,text/csv,text/plain"} className="hidden" onChange={onFile} />
          </label>
          {text.trim() && (
            <button type="button" onClick={() => { setText(""); setMsg(""); }} className="btn-outline">
              <X className="h-4 w-4" /> Clear text
            </button>
          )}
        </div>

        <textarea
          rows={9}
          className="input resize-y font-mono text-xs"
          placeholder={mode === "json" ? 'Paste a JSON array of questions here (or { "questions": [ ... ] }), or use “Choose JSON file” above…' : "Paste your CSV rows here, or use “Choose CSV file” above…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {rows.length > 0 && (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> {rows.length} valid question(s) ready
            </span>
          )}
          {errors.length > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" /> {errors.length} row(s) will be skipped
            </span>
          )}
        </div>
        {errors.length > 0 && (
          <div className="mt-2 max-h-24 overflow-y-auto rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            {errors.slice(0, 8).map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        <label className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm ${replace ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20" : "border-slate-200 dark:border-slate-700"}`}>
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5 h-4 w-4 accent-rose-600" />
          <span>
            <span className="font-semibold text-rose-700 dark:text-rose-300">Remove existing questions first (replace all)</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">Deletes all current questions here, then uploads these. Leave unchecked to simply add to the existing ones.</span>
          </span>
        </label>

        {msg && <p className="mt-3 whitespace-pre-line text-sm font-medium">{msg}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-outline">Cancel</button>
          <button type="button" onClick={submit} disabled={busy || !rows.length} className={replace ? "btn-primary bg-rose-600 hover:bg-rose-700" : "btn-primary"}>
            {busy ? (replace ? "Replacing…" : "Uploading…") : `${replace ? "Replace with" : "Upload"} ${rows.length || ""} Question(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
