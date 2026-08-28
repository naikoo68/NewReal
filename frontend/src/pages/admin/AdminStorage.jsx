import { useEffect, useState, useCallback } from "react";
import { HardDrive, Trash2, RefreshCw, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { storageService } from "../../services";
import { Loading, ErrorState } from "../../components/ui/AsyncState";

const AGE_OPTIONS = [
  { v: 30, l: "1 month" },
  { v: 90, l: "3 months" },
  { v: 180, l: "6 months" },
  { v: 365, l: "1 year" },
];

export default function AdminStorage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(90);
  const [sel, setSel] = useState({ stripCbtReview: true, cbtAttempts: false, publicAttempts: false, userAttempts: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback((d) => {
    setLoading(true);
    setError("");
    storageService
      .stats(d)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  const toggle = (k) => setSel((s) => ({ ...s, [k]: !s[k] }));

  const runCleanup = async () => {
    // If deleting CBT attempts entirely, the "strip review" option is redundant.
    const payload = { days, ...sel, stripCbtReview: sel.cbtAttempts ? false : sel.stripCbtReview };
    if (!payload.userAttempts && !payload.publicAttempts && !payload.cbtAttempts && !payload.stripCbtReview) {
      setMsg("Pick at least one thing to clean up below.");
      return;
    }
    const ageLabel = AGE_OPTIONS.find((o) => o.v === days)?.l || `${days} days`;
    if (!window.confirm(`Clean up records older than ${ageLabel}? This cannot be undone.`)) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await storageService.cleanup(payload);
      const parts = [];
      if (r.deletedUserAttempts) parts.push(`${r.deletedUserAttempts} quiz/test attempts`);
      if (r.deletedPublicAttempts) parts.push(`${r.deletedPublicAttempts} shared-link attempts`);
      if (r.deletedCbtAttempts) parts.push(`${r.deletedCbtAttempts} exam attempts`);
      if (r.strippedCbtReview) parts.push(`freed detail from ${r.strippedCbtReview} exam attempts`);
      setMsg(parts.length ? `Done — removed ${parts.join(", ")}. Storage updates below.` : "Nothing matched — there was nothing that old to remove.");
      load(days);
    } catch (e) {
      setMsg(e.message || "Cleanup failed.");
    } finally {
      setBusy(false);
    }
  };

  const barColor = (pct) => (pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><HardDrive className="h-6 w-6 text-brand-600" /> Storage</h1>
          <p className="text-slate-500 dark:text-slate-400">See how full your database is and free up space by removing old records.</p>
        </div>
        <button onClick={() => load(days)} className="btn-outline" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loading ? (
        <Loading label="Checking storage…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load(days)} />
      ) : data ? (
        <>
          {/* Usage */}
          <div className="card p-5">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Used</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <b className={data.usedPct >= 90 ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-200"}>{data.totalMB} MB</b> of {data.limitMB} MB ({data.usedPct}%)
              </p>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className={`h-full rounded-full transition-all ${barColor(data.usedPct)}`} style={{ width: `${data.usedPct}%` }} />
            </div>
            {data.usedPct >= 90 && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> Storage is almost full. Clean up old records below to avoid problems saving new content.
              </p>
            )}
            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
              <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60"><p className="text-slate-400">Questions & content</p><p className="mt-0.5 text-base font-bold">{data.dataMB} MB</p></div>
              <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60"><p className="text-slate-400">Indexes</p><p className="mt-0.5 text-base font-bold">{data.indexMB} MB</p></div>
              <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60"><p className="text-slate-400">Total records</p><p className="mt-0.5 text-base font-bold">{data.objects.toLocaleString()}</p></div>
            </div>
          </div>

          {/* Biggest collections */}
          {data.collections?.length > 0 && (
            <div className="card p-5">
              <p className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">What's using the space</p>
              <div className="space-y-1.5">
                {data.collections.slice(0, 8).map((c) => (
                  <div key={c.name} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium text-slate-700 dark:text-slate-200">{c.name}</span>
                    <span className="flex-shrink-0 text-slate-500 dark:text-slate-400">{Math.round((c.dataMB + c.indexMB) * 10) / 10} MB · {c.docs.toLocaleString()} records</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cleanup */}
          <div className="card p-5">
            <p className="flex items-center gap-2 text-lg font-bold"><Trash2 className="h-5 w-5 text-rose-600" /> Free up space</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Old records of tests/quizzes people took pile up over time. Remove ones older than:
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Older than</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input max-w-[10rem] py-1.5 text-sm">
                {AGE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>

            <div className="mt-4 space-y-2">
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                <input type="checkbox" checked={sel.stripCbtReview} disabled={sel.cbtAttempts} onChange={() => toggle("stripCbtReview")} className="mt-0.5 h-4 w-4 accent-brand-600" />
                <span>
                  <b>Trim old exam (CBT) details</b> — keeps each candidate's score & rank but removes the heavy full‑paper snapshot. Safest, usually the biggest saving.
                  <span className="mt-0.5 block font-semibold text-brand-600 dark:text-brand-300">{data.cleanup.cbtWithReview.toLocaleString()} exam attempts can be trimmed</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                <input type="checkbox" checked={sel.publicAttempts} onChange={() => toggle("publicAttempts")} className="mt-0.5 h-4 w-4 accent-brand-600" />
                <span>
                  <b>Delete old shared‑link results</b> — anonymous results from public share links.
                  <span className="mt-0.5 block font-semibold text-brand-600 dark:text-brand-300">{data.cleanup.publicAttempts.toLocaleString()} records</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                <input type="checkbox" checked={sel.userAttempts} onChange={() => toggle("userAttempts")} className="mt-0.5 h-4 w-4 accent-brand-600" />
                <span>
                  <b>Delete old quiz/test attempts</b> — students' past attempt history (their performance charts use this).
                  <span className="mt-0.5 block font-semibold text-brand-600 dark:text-brand-300">{data.cleanup.userAttempts.toLocaleString()} records</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-rose-200 p-3 text-sm dark:border-rose-900/50">
                <input type="checkbox" checked={sel.cbtAttempts} onChange={() => toggle("cbtAttempts")} className="mt-0.5 h-4 w-4 accent-rose-600" />
                <span>
                  <b className="text-rose-700 dark:text-rose-300">Delete old exam (CBT) attempts entirely</b> — removes candidates' scores AND details for old exams. Use only if you don't need those rankings.
                  <span className="mt-0.5 block font-semibold text-rose-600 dark:text-rose-400">{data.cleanup.cbtAttempts.toLocaleString()} records</span>
                </span>
              </label>
            </div>

            {msg && <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> {msg}</p>}

            <div className="mt-4 flex justify-end">
              <button onClick={runCleanup} disabled={busy} className="btn-primary bg-rose-600 hover:bg-rose-700 disabled:opacity-50">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Cleaning up…</> : <><Trash2 className="h-4 w-4" /> Clean up now</>}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Tip: deleting old records frees space immediately. Your questions and quizzes are never touched by this page — to remove those, use Delete / Find Duplicates in the content pages.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
