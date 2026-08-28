import MathText from "./MathText";

// Renders a "table"-type question's data grid. `q.tableRows` is a 2D array
// (rows × columns) of any dimensions — the first row is shown as the header.
// The table adjusts automatically to however many rows/columns are supplied.
export default function TableView({ q }) {
  if (!q || q.type !== "table") return null;
  const rows = Array.isArray(q.tableRows) ? q.tableRows.filter((r) => Array.isArray(r)) : [];
  if (!rows.length) return null;

  const [header, ...body] = rows;

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-brand-50 dark:bg-brand-900/30">
            {(header || []).map((cell, i) => (
              <th key={i} className="border border-slate-200 px-3 py-2 text-left font-semibold text-brand-800 dark:border-slate-700 dark:text-brand-200">
                <MathText>{cell}</MathText>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-800/40">
              {(row || []).map((cell, c) => (
                <td key={c} className="border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <MathText>{cell}</MathText>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
