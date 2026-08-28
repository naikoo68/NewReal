import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";

const CYCLES = ["Monthly", "Quarterly", "Semi-Annually", "Yearly"];

// The billing cycle a plan belongs to — explicit `cycle`, else inferred from months.
export function planCycle(p) {
  if (p?.cycle) return p.cycle;
  const m = p?.months || 0;
  if (m <= 0) return "Trial";
  if (m >= 12) return "Yearly";
  if (m >= 6) return "Semi-Annually";
  if (m >= 3) return "Quarterly";
  return "Monthly";
}

// Two-step plan picker: pick a billing cycle, then a plan (price) within it.
// plans = [{ key, label, months, price, trial, cycle, maxPerBatch, perWindow, windowMinutes }]
export default function PlanPicker({ plans, value, onChange, includeTrial = true }) {
  const list = useMemo(
    () => (plans || []).filter((p) => includeTrial || !(p.trial || planCycle(p) === "Trial")),
    [plans, includeTrial]
  );

  const groups = useMemo(() => {
    const g = {};
    for (const p of list) (g[planCycle(p)] ||= []).push(p);
    return g;
  }, [list]);

  const cycleOrder = useMemo(() => {
    const order = [];
    if (groups.Trial) order.push("Trial");
    for (const c of CYCLES) if (groups[c]) order.push(c);
    for (const c of Object.keys(groups)) if (!order.includes(c)) order.push(c); // any custom cycles
    return order;
  }, [groups]);

  const cycleOf = (key) => {
    const p = list.find((x) => x.key === key);
    return p ? planCycle(p) : (cycleOrder[0] || "");
  };
  const [cycle, setCycle] = useState(() => cycleOf(value));

  // Keep the visible cycle in step with the selected plan.
  useEffect(() => {
    const c = cycleOf(value);
    if (c && c !== cycle) setCycle(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // When plans (re)load, make sure the active cycle actually exists.
  useEffect(() => {
    if (cycleOrder.length && !cycleOrder.includes(cycle)) setCycle(cycleOrder[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleOrder]);

  const pickCycle = (c) => {
    setCycle(c);
    const first = (groups[c] || [])[0];
    if (first && first.key !== value) onChange(first.key);
  };

  const inCycle = groups[cycle] || [];
  const label = (c) => (c === "Trial" ? "Free Trial" : c);

  return (
    <div>
      {/* Step 1 — billing cycle */}
      <div className="flex flex-wrap gap-2">
        {cycleOrder.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => pickCycle(c)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              cycle === c ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {label(c)}
          </button>
        ))}
      </div>

      {/* Step 2 — plans inside the chosen cycle */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {inCycle.map((p) => {
          const active = p.key === value;
          return (
            <button
              type="button"
              key={p.key}
              onClick={() => onChange(p.key)}
              className={`relative rounded-xl border p-3 text-left transition ${
                active ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-900/20" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
              }`}
            >
              {active && <Check className="absolute right-2 top-2 h-4 w-4 text-brand-600" />}
              <p className="text-sm font-semibold">{p.label}</p>
              <p className="text-lg font-extrabold">{p.price > 0 ? `₹${p.price}` : "Free"}</p>
              {p.maxPerBatch ? (
                <p className="mt-0.5 text-[11px] leading-tight text-slate-500 dark:text-slate-400">AI: {p.maxPerBatch}/batch · {p.perWindow}/{p.windowMinutes || 5}min</p>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
