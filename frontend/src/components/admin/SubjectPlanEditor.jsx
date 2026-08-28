import { Plus, Trash2 } from "lucide-react";

// Manual blueprint editor: type subject names and how many questions each.
// Controlled: rows = [{ subject, count }]. Purely a plan — no questions pulled.
export default function SubjectPlanEditor({ rows, onChange }) {
  const setRow = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => onChange([...rows, { subject: "", count: 10 }]);
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const total = rows.reduce((s, r) => s + (r.subject?.trim() ? parseInt(r.count, 10) || 0 : 0), 0);

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={r.subject}
            onChange={(e) => setRow(i, { subject: e.target.value })}
            placeholder="Subject name (e.g. Physics)"
            className="input flex-1 py-1.5 text-sm"
          />
          <input
            type="number"
            min={0}
            max={500}
            value={r.count}
            onChange={(e) => setRow(i, { count: e.target.value })}
            className="input w-20 py-1.5 text-sm"
            title="Planned number of questions"
          />
          <button type="button" onClick={() => removeRow(i)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" onClick={addRow} className="btn-outline py-1.5 text-sm">
          <Plus className="h-4 w-4" /> Add subject
        </button>
        {total > 0 && <span className="text-xs font-semibold text-slate-500">Plan: {total} question(s)</span>}
      </div>
    </div>
  );
}
