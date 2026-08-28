// Per-attempt answer-OPTION shuffling, so a quiz/test doesn't always show the
// correct answer in the same position (defeats "the answer is always C").
//
// Deterministic given a seed: the same seed reproduces the same order (so a
// mid-quiz refresh resumes identically), while a fresh seed on the next attempt
// reshuffles. The correct index and per-option explanations are remapped to the
// new positions, and a `_order` map (displayIndex → originalIndex) is attached
// so a chosen option can be mapped back to the ORIGINAL index for the server
// (which scores against the question's stored `correct`).
//
// Empty option slots (e.g. the blank padding in True/False) are kept at the end
// so a blank never lands in position A.

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strHash(s) {
  let h = 2166136261 >>> 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A fresh random seed for a new attempt.
export function makeSeed() {
  return (Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

// order[displayPos] = originalIndex (non-empty options shuffled; blanks last).
function optionOrder(q, seed) {
  const opts = Array.isArray(q?.options) ? q.options : [];
  const nonEmpty = [];
  const empty = [];
  opts.forEach((o, i) => ((String(o ?? "").trim() === "" ? empty : nonEmpty).push(i)));
  const rand = mulberry32(((seed >>> 0) ^ strHash(q?._id)) >>> 0);
  for (let i = nonEmpty.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [nonEmpty[i], nonEmpty[j]] = [nonEmpty[j], nonEmpty[i]];
  }
  return [...nonEmpty, ...empty];
}

// Return a NEW question with options/optionExplanations reshuffled, `correct`
// remapped, and `_order` attached. Safe for questions without a known `correct`
// (e.g. tests, where the API hides it) — those just get reordered options.
export function shuffleQuestion(q, seed) {
  if (!q || !Array.isArray(q.options) || q.options.length < 2) return q;
  const order = optionOrder(q, seed);
  const options = order.map((i) => q.options[i]);
  const optionExplanations = Array.isArray(q.optionExplanations)
    ? order.map((i) => q.optionExplanations[i] ?? "")
    : q.optionExplanations;
  const correct =
    typeof q.correct === "number" && q.correct >= 0 ? order.indexOf(q.correct) : q.correct;
  return { ...q, options, optionExplanations, correct, _order: order };
}

export function shuffleAll(list, seed) {
  return (Array.isArray(list) ? list : []).map((q) => shuffleQuestion(q, seed));
}

// Reorder a test's questions for one attempt: keep each SUBJECT (section)
// together, but randomise (a) the ORDER of the subjects and (b) the order of
// questions WITHIN each subject — so "General Knowledge" isn't always first and
// its questions aren't always in the same sequence. Deterministic given `seed`
// (a re-render keeps the same order). Questions with no section are grouped last.
export function shuffleQuestionOrder(questions, seed) {
  const list = Array.isArray(questions) ? questions : [];
  const groups = new Map();
  const order = [];
  for (const q of list) {
    const key = (q?.section || "").trim();
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(q);
  }
  // Randomise the subject order (named sections only); keep unsectioned last.
  const named = order.filter((k) => k !== "");
  const gRand = mulberry32(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
  for (let i = named.length - 1; i > 0; i--) {
    const j = Math.floor(gRand() * (i + 1));
    [named[i], named[j]] = [named[j], named[i]];
  }
  const finalOrder = groups.has("") ? [...named, ""] : named;

  // Randomise questions within each subject (seeded per section).
  const out = [];
  for (const key of finalOrder) {
    const arr = groups.get(key).slice();
    const qRand = mulberry32(((seed >>> 0) ^ strHash("section:" + key)) >>> 0);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(qRand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    out.push(...arr);
  }
  return out;
}

// Map a chosen DISPLAY option index back to the ORIGINAL stored index (for the
// server). No-op when the question wasn't shuffled.
export function toOriginalIndex(q, displayIdx) {
  if (displayIdx == null) return displayIdx;
  if (q && Array.isArray(q._order)) return q._order[displayIdx] ?? displayIdx;
  return displayIdx;
}

// Map an ORIGINAL stored index → the DISPLAY position under `seed` (used to
// re-align a server-provided review to the shuffled order the user saw).
export function toDisplayIndex(q, originalIdx) {
  if (originalIdx == null) return originalIdx;
  if (q && Array.isArray(q._order)) {
    const p = q._order.indexOf(originalIdx);
    return p === -1 ? originalIdx : p;
  }
  return originalIdx;
}
