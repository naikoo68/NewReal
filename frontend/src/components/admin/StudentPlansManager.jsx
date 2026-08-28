import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Save, GraduationCap } from "lucide-react";
import { settingsService } from "../../services";

// Defaults shown only if settings have no student plans yet (mirror the backend).
const DEFAULT_PLANS = [
  { key: "trial", label: "1-Day Free Trial", cycle: "Trial", months: 0, price: 0, trial: true },
  { key: "1m", label: "1 Month", cycle: "Monthly", months: 1, price: 149 },
  { key: "3m", label: "3 Months", cycle: "Quarterly", months: 3, price: 399 },
  { key: "6m", label: "6 Months", cycle: "Semi-Annually", months: 6, price: 699 },
  { key: "1y", label: "1 Year", cycle: "Yearly", months: 12, price: 899 },
];
const CYCLE_OPTIONS = ["Monthly", "Quarterly", "Semi-Annually", "Yearly", "Trial"];
const blankPlan = () => ({ key: "", label: "", cycle: "Monthly", months: 1, price: 0, trial: false });
const num = (v, min, max) => Math.max(min, Math.min(max, parseInt(v, 10) || min));

// Admin-only card: manage the STUDENT subscription plans (pricing only — no AI
// limits). These are the plans students subscribe to in order to attempt
// quizzes/test-series and see their performance Dashboard.
export default function StudentPlansManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    settingsService
      .get()
      .then((s) => {
        setPlans(Array.isArray(s?.studentPlans) && s.studentPlans.length ? s.studentPlans.map((p) => ({ ...p })) : DEFAULT_PLANS.map((p) => ({ ...p })));
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const setPlan = (i, key, val) => setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, [key]: val } : p)));
  const addPlan = () => setPlans((ps) => [...ps, blankPlan()]);
  const removePlan = (i) => setPlans((ps) => ps.filter((_, j) => j !== i));

  const save = async () => {
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const cleanPlans = plans
        .map((p) => ({
          key: String(p.key || "").trim(), // keep existing keys stable; blank = backend generates
          label: String(p.label || "").trim(),
          cycle: String(p.cycle || "").trim(),
          months: num(p.months, 0, 120),
          price: num(p.price, 0, 10000000),
          trial: !!p.trial,
        }))
        .filter((p) => p.label);
      const res = await settingsService.update({ studentPlans: cleanPlans });
      setPlans((res?.studentPlans || cleanPlans).map((p) => ({ ...p })));
      setMsg("✓ Saved student plans.");
    } catch (e) {
      setErr(e.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><GraduationCap className="h-5 w-5 text-brand-600" /> Student plans &amp; pricing</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            These are the plans students subscribe to. A subscription unlocks attempting quizzes/test-series and their performance Dashboard. Set <b>Months = 0</b> for a free trial.
          </p>
        </div>
        <button onClick={save} disabled={saving || loading} className="btn-primary flex-shrink-0">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> Save</>}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Subscription plans</p>
            <button onClick={addPlan} className="btn-outline py-1 text-xs"><Plus className="h-3.5 w-3.5" /> Add plan</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="px-3 py-2 text-left font-semibold">Plan label</th>
                  <th className="px-3 py-2 text-left font-semibold">Cycle</th>
                  <th className="px-3 py-2 text-left font-semibold">Months</th>
                  <th className="px-3 py-2 text-left font-semibold">Price (₹)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">No plans yet. Click “Add plan”.</td></tr>
                ) : plans.map((p, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-3 py-2"><input value={p.label} onChange={(e) => setPlan(i, "label", e.target.value)} placeholder="e.g. 3 Months" className="input !py-1 min-w-[140px]" /></td>
                    <td className="px-3 py-2">
                      <select value={CYCLE_OPTIONS.includes(p.cycle) ? p.cycle : ""} onChange={(e) => setPlan(i, "cycle", e.target.value)} className="input !py-1 min-w-[120px]">
                        <option value="">Auto (by months)</option>
                        {CYCLE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2"><input type="number" min={0} value={p.months} onChange={(e) => setPlan(i, "months", e.target.value)} className="input !py-1 w-16" /></td>
                    <td className="px-3 py-2"><input type="number" min={0} value={p.price} onChange={(e) => setPlan(i, "price", e.target.value)} className="input !py-1 w-24" /></td>
                    <td className="px-3 py-2 text-right"><button onClick={() => removePlan(i)} title="Remove plan" className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            <b>Months</b> = how long the plan lasts (0 = a free trial). Prices here are what students see on the pricing page &amp; at checkout.
          </p>
          {msg && <p className="mt-2 text-sm font-medium text-emerald-600">{msg}</p>}
          {err && <p className="mt-2 text-sm font-medium text-rose-600">{err}</p>}
        </>
      )}
    </div>
  );
}
