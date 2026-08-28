import MathText from "./MathText";

// Renders the Assertion (A) and Reason (R) statements for "assertion"-type
// questions, shown between the question stem/directive and the answer options.
export default function AssertionReasonView({ q }) {
  if (!q || q.type !== "assertion") return null;
  if (!q.assertion && !q.reason) return null;

  return (
    <div className="mt-3 space-y-2">
      {q.assertion && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/40">
          <span className="font-bold text-brand-700 dark:text-brand-300">Assertion (A): </span>
          <MathText>{q.assertion}</MathText>
        </div>
      )}
      {q.reason && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/40">
          <span className="font-bold text-accent-700 dark:text-accent-300">Reason (R): </span>
          <MathText>{q.reason}</MathText>
        </div>
      )}
    </div>
  );
}
