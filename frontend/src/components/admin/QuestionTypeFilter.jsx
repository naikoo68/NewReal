import { QUESTION_TYPE_LABELS, questionTypeKey } from "../../lib/questions";

/**
 * QuestionTypeFilter — a filter bar for the admin "View all" question list.
 *
 * Shows one chip per question TYPE actually present in the list (with its
 * count) plus an "All" chip. Multi-select: tapping a type toggles it on/off, so
 * an admin can view only MCQs, only Assertion & Reason, or several types at
 * once. With nothing selected, every question shows.
 *
 * Renders nothing when the list has zero or one type (no filtering to do).
 *
 * Props:
 *  - questions: the full (unfiltered) question list
 *  - selected:  array of selected type keys ([] = all)
 *  - onChange(nextSelectedArray)
 */
export default function QuestionTypeFilter({ questions = [], selected = [], onChange }) {
  const counts = {};
  for (const q of questions) {
    const k = questionTypeKey(q);
    counts[k] = (counts[k] || 0) + 1;
  }
  const present = Object.keys(counts).sort((a, b) =>
    (QUESTION_TYPE_LABELS[a] || a).localeCompare(QUESTION_TYPE_LABELS[b] || b)
  );
  if (present.length <= 1) return null; // only one type — nothing to filter

  const sel = new Set(selected);
  const toggle = (k) => {
    const next = new Set(sel);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange([...next]);
  };

  const chipClass = (active) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      active
        ? "border-brand-500 bg-brand-600 text-white"
        : "border-slate-200 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    }`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Type</span>
      <button type="button" onClick={() => onChange([])} className={chipClass(sel.size === 0)}>
        All ({questions.length})
      </button>
      {present.map((k) => (
        <button key={k} type="button" onClick={() => toggle(k)} className={chipClass(sel.has(k))}>
          {QUESTION_TYPE_LABELS[k] || k} ({counts[k]})
        </button>
      ))}
    </div>
  );
}
