import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Save, Sparkles } from "lucide-react";
import { settingsService } from "../../services";

// Defaults shown only if settings have no plans yet (mirror the backend).
const DEFAULT_PLANS = [
  { key: "trial", label: "1-Day Free Trial", cycle: "Trial", months: 0, price: 0, trial: true, maxPerBatch: 20, perWindow: 20, windowMinutes: 5 },
  { key: "1m", label: "1 Month", cycle: "Monthly", months: 1, price: 299, maxPerBatch: 50, perWindow: 100, windowMinutes: 5 },
  { key: "2m", label: "2 Months", cycle: "Monthly", months: 2, price: 499, maxPerBatch: 100, perWindow: 200, windowMinutes: 5 },
  { key: "6m", label: "6 Months", cycle: "Semi-Annually", months: 6, price: 699, maxPerBatch: 200, perWindow: 400, windowMinutes: 5 },
  { key: "1y", label: "1 Year", cycle: "Yearly", months: 12, price: 899, maxPerBatch: 500, perWindow: 1000, windowMinutes: 5 },
];
const CYCLE_OPTIONS = ["Monthly", "Quarterly", "Semi-Annually", "Yearly", "Trial"];
const blankPlan = () => ({ key: "", label: "", cycle: "Monthly", months: 1, price: 0, trial: false, maxPerBatch: 50, perWindow: 100, windowMinutes: 5 });
const num = (v, min, max) => Math.max(min, Math.min(max, parseInt(v, 10) || min));

// Admin-only card: manage the client SUBSCRIPTION plans in one place — pricing
// (label / months / price) AND the AI generation limits granted on each plan
// (max per batch + questions per window). A client's AI limits come from the
// plan they purchased. Also sets the admin's own per-batch cap.
export default function AiPlansManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [globalMax, setGlobalMax] = useState(500);
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    settingsService
      .get()
      .then((s) => {
        setGlobalMax(s?.aiMaxPerBatch ?? 500);
        setPlans(Array.isArray(s?.clientPlans) && s.clientPlans.length ? s.clientPlans.map((p) => ({ ...p })) : DEFAULT_PLANS.map((p) => ({ ...p })));
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
          maxPerBatch: num(p.maxPerBatch, 1, 5000),
          perWindow: num(p.perWindow, 1, 100000),
          windowMinutes: num(p.windowMinutes, 1, 1440),
        }))
        .filter((p) => p.label);
      const res = await settingsService.update({ aiMaxPerBatch: num(globalMax, 1, 5000), clientPlans: cleanPlans });
      setGlobalMax(res?.aiMaxPerBatch ?? globalMax);
      setPlans((res?.clientPlans || cleanPlans).map((p) => ({ ...p })));
      setMsg("✓ Saved plans & AI limits.");
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
          <h2 className="flex items-center gap-2 text-lg font-bold"><Sparkles className="h-5 w-5 text-brand-600" /> Client plans &amp; AI limits</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            These are the plans clients buy. Edit the price/duration and the AI generation limits per plan — a client's AI limits follow the plan they purchased. Assign a plan to a specific client on the <b>Clients</b> page.
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
          <div className="mb-4 max-w-xs">
            <label className="mb-1 block text-sm font-semibold">Admin — max questions per batch</label>
            <input type="number" min={1} max={5000} value={globalMax} onChange={(e) => setGlobalMax(e.target.value)} className="input" />
            <p className="mt-1 text-xs text-slate-400">Your own cap for one generation. Also the ceiling no plan can exceed.</p>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Subscription plans</p>
            <button onClick={addPlan} className="btn-outline py-1 text-xs"><Plus className="h-3.5 w-3.5" /> Add plan</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="px-3 py-2 text-left font-semibold">Plan label</th>
                  <th className="px-3 py-2 text-left font-semibold">Cycle</th>
                  <th className="px-3 py-2 text-left font-semibold">Months</th>
                  <th className="px-3 py-2 text-left font-semibold">Price (₹)</th>
                  <th className="px-3 py-2 text-left font-semibold">Max / batch</th>
                  <th className="px-3 py-2 text-left font-semibold">Q / window</th>
                  <th className="px-3 py-2 text-left font-semibold">Window (min)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-400">No plans yet. Click “Add plan”.</td></tr>
                ) : plans.map((p, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-3 py-2"><input value={p.label} onChange={(e) => setPlan(i, "label", e.target.value)} placeholder="e.g. 3 Months" className="input !py-1 min-w-[130px]" /></td>
                    <td className="px-3 py-2">
                      <select value={CYCLE_OPTIONS.includes(p.cycle) ? p.cycle : ""} onChange={(e) => setPlan(i, "cycle", e.target.value)} className="input !py-1 min-w-[120px]">
                        <option value="">Auto (by months)</option>
                        {CYCLE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2"><input type="number" min={0} value={p.months} onChange={(e) => setPlan(i, "months", e.target.value)} className="input !py-1 w-16" /></td>
                    <td className="px-3 py-2"><input type="number" min={0} value={p.price} onChange={(e) => setPlan(i, "price", e.target.value)} className="input !py-1 w-24" /></td>
                    <td className="px-3 py-2"><input type="number" min={1} value={p.maxPerBatch} onChange={(e) => setPlan(i, "maxPerBatch", e.target.value)} className="input !py-1 w-20" /></td>
                    <td className="px-3 py-2"><input type="number" min={1} value={p.perWindow} onChange={(e) => setPlan(i, "perWindow", e.target.value)} className="input !py-1 w-20" /></td>
                    <td className="px-3 py-2"><input type="number" min={1} value={p.windowMinutes} onChange={(e) => setPlan(i, "windowMinutes", e.target.value)} className="input !py-1 w-16" /></td>
                    <td className="px-3 py-2 text-right"><button onClick={() => removePlan(i)} title="Remove plan" className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            <b>Months</b> = how long the plan lasts (0 = a trial). <b>Q / window</b> + <b>Window</b> = e.g. 100 questions every 5 minutes. Prices here are what clients see at registration &amp; upgrade.
          </p>
          {msg && <p className="mt-2 text-sm font-medium text-emerald-600">{msg}</p>}
          {err && <p className="mt-2 text-sm font-medium text-rose-600">{err}</p>}
        </>
      )}
    </div>
  );
}
