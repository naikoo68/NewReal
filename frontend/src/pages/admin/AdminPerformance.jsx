import { useEffect, useState } from "react";
import { Trophy, Trash2, RefreshCw, ListChecks, FileStack, Users, Medal, X } from "lucide-react";
import { analyticsService } from "../../services";
import Badge from "../../components/ui/Badge";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

const TABS = [
  { key: "combined", label: "Combined", icon: Trophy },
  { key: "quizzes", label: "Quizzes", icon: ListChecks },
  { key: "tests", label: "Tests", icon: FileStack },
];

const rankColor = (i) =>
  i === 0 ? "text-amber-500" : i === 1 ? "text-slate-400" : i === 2 ? "text-orange-600" : "text-slate-400";

export default function AdminPerformance() {
  const [data, setData] = useState({ users: [], attempts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("combined");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null); // full performance of one user
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = (userId) => {
    setDetail(null);
    setDetailLoading(true);
    analyticsService
      .userPerformance(userId)
      .then((d) => setDetail({ ...d, userId }))
      .catch((e) => setError(e.message))
      .finally(() => setDetailLoading(false));
  };

  const load = () => {
    setLoading(true);
    setError("");
    analyticsService.performance().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const sorted = [...(data.users || [])].sort((a, b) => {
    if (tab === "quizzes") return b.quizzes - a.quizzes || b.quizScore - a.quizScore;
    if (tab === "tests") return b.tests - a.tests || b.testScore - a.testScore;
    return b.taken - a.taken || b.totalScore - a.totalScore;
  });

  const clearUser = async (u) => {
    if (!window.confirm(`Clear all quiz & test history for ${u.name}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await analyticsService.clearUserPerformance(u.userId);
      setDetail(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Clear ALL performance history for EVERY user? This permanently deletes every quiz & test attempt and cannot be undone.")) return;
    setBusy(true);
    try {
      await analyticsService.clearAllPerformance();
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const metricValue = (u) => (tab === "quizzes" ? u.quizScore : tab === "tests" ? u.testScore : u.totalScore);
  const metricCount = (u) => (tab === "quizzes" ? u.quizzes : tab === "tests" ? u.tests : u.taken);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Trophy className="h-6 w-6 text-amber-500" /> Performance Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400">Who took what, and rankings across quizzes &amp; tests.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-outline" disabled={busy}><RefreshCw className="h-4 w-4" /> Refresh</button>
          <button onClick={clearAll} className="btn-outline text-rose-600" disabled={busy}><Trash2 className="h-4 w-4" /> Clear whole dashboard</button>
        </div>
      </div>

      {loading ? (
        <Loading label="Loading performance..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          {/* Ranking */}
          <div className="card p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    tab === t.key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  <t.icon className="h-4 w-4" /> {t.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-slate-400">{sorted.length} student(s) with activity</span>
            </div>

            {sorted.length === 0 ? (
              <EmptyState message="No attempts yet — rankings will appear once students take quizzes or tests." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400 dark:border-slate-800">
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3 text-center">Quizzes</th>
                      <th className="px-4 py-3 text-center">Tests</th>
                      <th className="px-4 py-3 text-center">Avg %</th>
                      <th className="px-4 py-3 text-center">{tab === "quizzes" ? "Quiz score" : tab === "tests" ? "Test score" : "Total score"}</th>
                      <th className="px-4 py-3">Last active</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((u, i) => (
                      <tr key={u.userId} onClick={() => openDetail(u.userId)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 font-bold ${rankColor(i)}`}>
                            {i < 3 ? <Medal className="h-4 w-4" /> : null}{i + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{u.name}</p>
                          <p className="text-xs text-slate-400">{u.email}</p>
                        </td>
                        <td className="px-4 py-3 text-center">{u.quizzes}</td>
                        <td className="px-4 py-3 text-center">{u.tests}</td>
                        <td className="px-4 py-3 text-center">{u.avgPct}%</td>
                        <td className="px-4 py-3 text-center font-semibold">{metricValue(u)} <span className="text-xs font-normal text-slate-400">({metricCount(u)})</span></td>
                        <td className="px-4 py-3 text-slate-500">{fmtDate(u.lastAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={(e) => { e.stopPropagation(); clearUser(u); }} disabled={busy} title="Clear this user's history" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Who took what — recent activity */}
          <div className="card p-0">
            <div className="flex items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
              <Users className="h-5 w-5 text-brand-600" />
              <h3 className="font-bold">Recent activity — who took what</h3>
              <span className="ml-auto text-xs text-slate-400">{data.attempts.length} recent</span>
            </div>
            {data.attempts.length === 0 ? (
              <EmptyState message="No quiz or test attempts recorded yet." />
            ) : (
              <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
                {data.attempts.map((a) => (
                  <div key={a._id} onClick={() => openDetail(a.userId)} className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {a.userName} <span className="text-slate-400">·</span>{" "}
                        <span className="text-slate-600 dark:text-slate-300">{a.title}</span>
                      </p>
                      <p className="text-xs text-slate-400">{a.email} · {fmtDate(a.createdAt)}</p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <Badge variant={a.type === "test" ? "accent" : "brand"}>{a.type === "test" ? "Test" : "Quiz"}</Badge>
                      <span className="text-sm text-slate-500">{a.correct ?? 0}/{a.total ?? 0}</span>
                      <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold dark:bg-slate-800">{a.percentage ?? 0}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Full performance of one user */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} className="my-8 w-full max-w-2xl animate-scale-in card p-6">
            {detailLoading || !detail ? (
              <Loading label="Loading performance..." />
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-bold">{detail.user.name}</h3>
                    <p className="text-xs text-slate-400">{detail.user.email}</p>
                  </div>
                  <button onClick={() => setDetail(null)}><X className="h-5 w-5" /></button>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {[
                    { label: "Quizzes", value: detail.summary.quizzes },
                    { label: "Tests", value: detail.summary.tests },
                    { label: "Taken", value: detail.summary.taken },
                    { label: "Avg %", value: `${detail.summary.avgPct}%` },
                    { label: "Best %", value: `${detail.summary.best}%` },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-slate-200 p-3 text-center dark:border-slate-700">
                      <p className="text-lg font-extrabold text-brand-600">{s.value}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
                    </div>
                  ))}
                </div>

                <p className="mt-4 mb-2 text-sm font-semibold">All attempts</p>
                <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  {detail.attempts.length === 0 ? (
                    <EmptyState message="No quiz or test attempts yet." />
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-400 dark:bg-slate-800">
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Title</th>
                          <th className="px-3 py-2 text-center">Score</th>
                          <th className="px-3 py-2 text-center">%</th>
                          <th className="px-3 py-2">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.attempts.map((a) => (
                          <tr key={a._id} className="border-t border-slate-100 dark:border-slate-800/60">
                            <td className="px-3 py-2"><Badge variant={a.type === "test" ? "accent" : "brand"}>{a.type === "test" ? "Test" : "Quiz"}</Badge></td>
                            <td className="px-3 py-2">{a.title}</td>
                            <td className="px-3 py-2 text-center">{a.correct ?? 0}/{a.total ?? 0}</td>
                            <td className="px-3 py-2 text-center font-semibold">{a.percentage ?? 0}%</td>
                            <td className="px-3 py-2 text-slate-500">{fmtDate(a.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <button onClick={() => setDetail(null)} className="btn-outline">Close</button>
                  <button onClick={() => clearUser({ userId: detail.userId, name: detail.user.name })} disabled={busy || !detail.attempts.length} className="btn-outline text-rose-600"><Trash2 className="h-4 w-4" /> Clear performance</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
