import { useCallback, useEffect, useState } from "react";
import { Share2, Users, Eye, ExternalLink, Copy, Check, RefreshCw, ChevronDown, Clock, Loader2, X, Trash2 } from "lucide-react";
import { testService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

// Public link for a share token (hash-router friendly). My Quiz opens in the
// quiz-style player; tests use the exam-style player.
const publicUrl = (token, kind) =>
  `${window.location.origin}${window.location.pathname}#/public/${kind === "My Quiz" ? "quiz" : "test"}/${token}`;

const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");
const fmtTime = (s) => {
  const n = Number(s) || 0;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};
const isExpired = (d) => d && new Date(d).getTime() < Date.now();

const KIND_STYLE = {
  "Test Series": "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
  "My Test": "bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300",
  "My Quiz": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export default function AdminSharedLinks() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [deleting, setDeleting] = useState("");
  const [detail, setDetail] = useState(null); // { row, data, loading }

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    testService
      .sharedLinks()
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const copy = async (token, kind) => {
    try {
      await navigator.clipboard.writeText(publicUrl(token, kind));
      setCopied(token);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt("Copy this public link:", publicUrl(token, kind));
    }
  };

  // Delete (turn off) a public link — it stops working and leaves the tracker.
  const removeLink = async (r) => {
    if (!window.confirm(`Delete the public link for “${r.name}”?\nThe link will stop working immediately (the quiz/test itself is not deleted).`)) return;
    setDeleting(r._id);
    try {
      await testService.togglePublicLink(r._id, false);
      setRows((list) => list.filter((x) => x._id !== r._id));
    } catch (e) {
      alert(e.message || "Could not delete the link.");
    } finally {
      setDeleting("");
    }
  };

  const openDetail = (row) => {
    setDetail({ row, data: null, loading: true });
    testService
      .publicAttempts(row._id)
      .then((data) => setDetail({ row, data, loading: false }))
      .catch((e) => setDetail({ row, data: { error: e.message, attempts: [] }, loading: false }));
  };

  const totalCompletions = rows.reduce((s, r) => s + (r.completions || 0), 0);
  const totalOpens = rows.reduce((s, r) => s + (r.opens || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <Share2 className="h-6 w-6 text-brand-600" /> Shared Links
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            Every quiz/test with a public link — how many people completed it, and open the link to take/preview it.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-outline">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Summary */}
      {!loading && !error && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card p-4"><p className="text-2xl font-bold text-slate-700 dark:text-slate-200">{rows.length}</p><p className="text-xs text-slate-500">Shared links</p></div>
          <div className="card p-4"><p className="text-2xl font-bold text-brand-600 dark:text-brand-400">{totalOpens}</p><p className="text-xs text-slate-500">Total opens</p></div>
          <div className="card p-4"><p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{totalCompletions}</p><p className="text-xs text-slate-500">Total completions</p></div>
          <div className="card p-4"><p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{rows.filter((r) => isExpired(r.publicExpiresAt)).length}</p><p className="text-xs text-slate-500">Expired links</p></div>
        </div>
      )}

      {loading ? (
        <Loading label="Loading shared links..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState message="No public links yet. Turn on Share on a quiz or test to create one." />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const expired = isExpired(r.publicExpiresAt);
            return (
              <div key={r._id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${KIND_STYLE[r.kind] || "bg-slate-100 text-slate-600"}`}>{r.kind}</span>
                      <p className="truncate font-bold">{r.name}</p>
                      {expired ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">Expired</span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Active</span>
                      )}
                    </div>
                    {r.context && <p className="mt-0.5 text-xs text-slate-400">{r.context}</p>}
                    <p className="mt-0.5 text-xs text-slate-400">
                      {r.questionCount} questions
                      {r.publicExpiresAt && ` · expires ${fmtDate(r.publicExpiresAt)}`}
                      {r.lastCompletedAt && ` · last completed ${fmtDate(r.lastCompletedAt)}`}
                    </p>
                  </div>

                  {/* Opens + completions stats */}
                  <div className="flex flex-shrink-0 items-center gap-4">
                    <div className="text-center">
                      <p className="flex items-center gap-1 text-2xl font-extrabold text-brand-600 dark:text-brand-400">
                        <Eye className="h-5 w-5" /> {r.opens ?? 0}
                      </p>
                      <p className="text-[11px] text-slate-500">opened</p>
                    </div>
                    <div className="text-center">
                      <p className="flex items-center gap-1 text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                        <Users className="h-5 w-5" /> {r.completions}
                      </p>
                      <p className="text-[11px] text-slate-500">completed</p>
                    </div>
                    {r.avgPercentage != null && (
                      <div className="text-center">
                        <p className="text-2xl font-extrabold text-brand-600 dark:text-brand-400">{r.avgPercentage}%</p>
                        <p className="text-[11px] text-slate-500">avg score</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a href={publicUrl(r.publicToken, r.kind)} target="_blank" rel="noreferrer" className="btn-primary py-1.5 text-xs">
                    <ExternalLink className="h-3.5 w-3.5" /> Open link
                  </a>
                  <button onClick={() => copy(r.publicToken, r.kind)} className="btn-outline py-1.5 text-xs">
                    {copied === r.publicToken ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy link</>}
                  </button>
                  <button onClick={() => openDetail(r)} disabled={!r.completions} className="btn-outline py-1.5 text-xs disabled:opacity-50">
                    <ChevronDown className="h-3.5 w-3.5" /> View completions ({r.completions})
                  </button>
                  <button onClick={() => removeLink(r)} disabled={deleting === r._id} className="btn-outline py-1.5 text-xs text-rose-600 disabled:opacity-50" title="Delete this public link (stops it working)">
                    {deleting === r._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete link
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Completions detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} className="my-10 w-full max-w-2xl animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold"><Users className="h-5 w-5 text-emerald-600" /> Completions — {detail.row.name}</h3>
              <button onClick={() => setDetail(null)}><X className="h-5 w-5" /></button>
            </div>
            {detail.loading ? (
              <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : detail.data?.error ? (
              <ErrorState message={detail.data.error} />
            ) : (detail.data?.attempts || []).length === 0 ? (
              <EmptyState message="No completions recorded yet." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                      <th className="px-3 py-2 text-left font-semibold">#</th>
                      <th className="px-3 py-2 text-left font-semibold">Score</th>
                      <th className="px-3 py-2 text-left font-semibold">%</th>
                      <th className="px-3 py-2 text-left font-semibold">Correct</th>
                      <th className="px-3 py-2 text-left font-semibold">Time</th>
                      <th className="px-3 py-2 text-left font-semibold">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.attempts.map((a, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold">{a.score}{a.maxScore != null ? ` / ${a.maxScore}` : ""}</td>
                        <td className="px-3 py-2">{a.percentage}%</td>
                        <td className="px-3 py-2">{a.correct}/{a.totalQ}</td>
                        <td className="px-3 py-2 tabular-nums"><Clock className="mr-1 inline h-3 w-3 text-slate-400" />{fmtTime(a.timeTaken)}</td>
                        <td className="px-3 py-2 text-slate-500">{fmtDate(a.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-400">Public takers have no account, so completions are anonymous.</p>
          </div>
        </div>
      )}
    </div>
  );
}
