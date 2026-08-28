import { questionUpdatedDate } from "../../lib/questions";

/**
 * QuestionStatusFilter — a filter bar for the admin "View all" question list.
 *
 * Shows three chips: All, Updated, Not Updated.
 * "Updated" = questions whose updatedAt differs from createdAt by more than 5s
 * (i.e. they were edited after initial upload).
 * "Not Updated" = questions that have never been edited since upload.
 *
 * Props:
 *  - questions: the full (unfiltered) question list
 *  - selected:  "all" | "updated" | "not_updated"
 *  - onChange(nextValue)
 */
export default function QuestionStatusFilter({ questions = [], selected = "all", onChange }) {
  const updatedCount = questions.filter((q) => questionUpdatedDate(q) !== null).length;
  const notUpdatedCount = questions.length - updatedCount;

  const chipClass = (active) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      active
        ? "border-brand-500 bg-brand-600 text-white"
        : "border-slate-200 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    }`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</span>
      <button type="button" onClick={() => onChange("all")} className={chipClass(selected === "all")}>
        All ({questions.length})
      </button>
      <button type="button" onClick={() => onChange("updated")} className={chipClass(selected === "updated")}>
        Updated ({updatedCount})
      </button>
      <button type="button" onClick={() => onChange("not_updated")} className={chipClass(selected === "not_updated")}>
        Not Updated ({notUpdatedCount})
      </button>
    </div>
  );
}

/**
 * Filter a question list by update status.
 * @param {Array} list - questions array
 * @param {"all"|"updated"|"not_updated"} status
 * @returns {Array} filtered list
 */
export function filterByStatus(list, status) {
  if (!status || status === "all") return list;
  if (status === "updated") return list.filter((q) => questionUpdatedDate(q) !== null);
  if (status === "not_updated") return list.filter((q) => questionUpdatedDate(q) === null);
  return list;
}
