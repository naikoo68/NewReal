// QuestionSubjectFilter — a filter bar for a TEST's "View all" question list.
//
// Test questions carry a `section` field = the subject they belong to (matches a
// name in the test's subjectPlan). This shows one chip per subject actually
// present, WITH its question count, plus an "All" chip — so an admin can see at a
// glance how many questions each subject has in the test, and filter to just one.
//
// Renders nothing only when the list is empty. With a single subject group it
// still shows (so the admin always sees the per-subject breakdown); when every
// question is untagged it shows a "No subject" chip plus a hint explaining why.
//
// Props:
//  - questions: the full (unfiltered) question list
//  - selected:  the selected subject ("" = all)
//  - onChange(nextSubject)

const UNASSIGNED = "\u2014 No subject \u2014"; // shown for questions with no section

export function questionSubject(q) {
  const s = String(q?.section || "").trim();
  return s || UNASSIGNED;
}

// Group a question list into { subject: count }, preserving first-seen order.
export function subjectCounts(questions = []) {
  const counts = {};
  for (const q of questions) {
    const k = questionSubject(q);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

export default function QuestionSubjectFilter({ questions = [], selected = "", onChange }) {
  const counts = subjectCounts(questions);
  const subjects = Object.keys(counts).sort((a, b) => {
    if (a === UNASSIGNED) return 1; // keep "no subject" last
    if (b === UNASSIGNED) return -1;
    return a.localeCompare(b);
  });
  if (subjects.length < 1) return null; // no questions at all — nothing to show
  // True only when the single group is the "untagged" bucket — i.e. no question
  // carries a subject/section, so there's no real breakdown to offer.
  const onlyUnassigned = subjects.length === 1 && subjects[0] === UNASSIGNED;

  const chipClass = (active) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      active
        ? "border-brand-500 bg-brand-600 text-white"
        : "border-slate-200 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    }`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Subject</span>
      <button type="button" onClick={() => onChange("")} className={chipClass(!selected)}>
        All ({questions.length})
      </button>
      {subjects.map((s) => (
        <button key={s} type="button" onClick={() => onChange(s)} className={chipClass(selected === s)}>
          {s} ({counts[s]})
        </button>
      ))}
      {onlyUnassigned && (
        <span className="w-full text-xs text-slate-400">
          These questions aren’t tagged to a subject yet — Auto-build assigns subjects automatically, or set a section when adding questions.
        </span>
      )}
    </div>
  );
}

// Filter a question list to a selected subject ("" = all).
export function filterBySubject(list, subject) {
  const arr = Array.isArray(list) ? list : [];
  if (!subject) return arr;
  return arr.filter((q) => questionSubject(q) === subject);
}
