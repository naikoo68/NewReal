import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Line } from "react-chartjs-2";
import "../lib/chartSetup";
import {
  Flame,
  Trophy,
  CalendarClock,
  CheckCircle2,
  BookOpen,
  Bell,
  TrendingUp,
  ArrowRight,
  Crown,
} from "lucide-react";
import { UserCog } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { analyticsService, noticeService } from "../services";
import StatCard from "../components/ui/StatCard";
import Badge from "../components/ui/Badge";
import ProgressBar from "../components/ui/ProgressBar";
import Avatar from "../components/ui/Avatar";
import ProfilePhotoCard from "../components/ui/ProfilePhotoCard";
import { Loading, ErrorState, EmptyState } from "../components/ui/AsyncState";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [board, setBoard] = useState([]);
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Follow a notice's link (internal → router, external → new tab).
  const goNotice = (link) => {
    if (!link) return;
    if (/^https?:\/\//i.test(link)) window.open(link, "_blank", "noopener");
    else navigate(link);
  };

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([
      analyticsService.dashboard(),
      analyticsService.leaderboard().catch(() => []),
      noticeService.list().catch(() => []),
    ])
      .then(([d, lb, ns]) => {
        setData(d);
        setBoard(lb);
        setNotices(Array.isArray(ns) ? ns : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <div className="container-page"><Loading label="Loading your dashboard..." /></div>;
  if (error) return <div className="container-page"><ErrorState message={error} onRetry={load} /></div>;

  const profile = data?.profile || { name: user?.name, email: user?.email, avatar: user?.avatar, streak: 0 };
  const stats = data?.stats || { enrolled: 0, upcoming: 0, completed: 0, avgPercentile: 0 };
  const myRank = board.find((b) => b.isCurrentUser)?.rank;

  const trend = data?.performanceTrend || [];
  const trendData = {
    labels: trend.length ? trend.map((t) => t.label) : ["—"],
    datasets: [
      {
        label: "Percentage",
        data: trend.length ? trend.map((t) => t.value) : [0],
        borderColor: "#2563eb",
        backgroundColor: "rgba(37,99,235,0.12)",
        fill: true,
        tension: 0.4,
        pointBackgroundColor: "#2563eb",
      },
    ],
  };

  return (
    <div className="container-page py-10">
      {/* Welcome + profile */}
      <div className="flex flex-col gap-5 rounded-3xl bg-gradient-to-r from-brand-600 to-accent-500 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar src={profile.avatar} name={profile.name} size={64} fallbackClassName="bg-white/20 text-white backdrop-blur" />

          <div>
            <p className="text-sm text-white/80">Welcome back,</p>
            <h1 className="text-2xl font-extrabold">{profile.name}</h1>
            <p className="text-sm text-white/80">{profile.email}</p>
            <Link
              to="/account"
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/25"
            >
              <UserCog className="h-3.5 w-3.5" /> Manage account
            </Link>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="rounded-2xl bg-white/15 px-5 py-3 text-center backdrop-blur">
            <Flame className="mx-auto h-5 w-5" />
            <p className="mt-1 text-xl font-bold">{profile.streak ?? 0}</p>
            <p className="text-xs text-white/80">Day streak</p>
          </div>
          <div className="rounded-2xl bg-white/15 px-5 py-3 text-center backdrop-blur">
            <Trophy className="mx-auto h-5 w-5" />
            <p className="mt-1 text-xl font-bold">{myRank ? `#${myRank}` : "—"}</p>
            <p className="text-xs text-white/80">Rank</p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="BookOpen" label="Enrolled Series" value={stats.enrolled} accent="brand" />
        <StatCard icon="CalendarClock" label="Upcoming Tests" value={stats.upcoming} accent="accent" />
        <StatCard icon="CheckCircle2" label="Completed Tests" value={stats.completed} accent="green" />
        <StatCard icon="TrendingUp" label="Avg. Percentile" value={`${stats.avgPercentile}`} accent="violet" />
      </div>

      <ProfilePhotoCard className="mt-6" />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-2">
          <div className="card p-6">
            <h3 className="mb-4 flex items-center gap-2 font-bold">
              <TrendingUp className="h-5 w-5 text-brand-600" /> Performance Analytics
            </h3>
            <div className="h-64">
              <Line data={trendData} options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }} />
            </div>
          </div>

          {/* Enrolled series */}
          <div className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-bold">
                <BookOpen className="h-5 w-5 text-accent-500" /> Enrolled Test Series
              </h3>
              <Link to="/test-series" className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Browse all
              </Link>
            </div>
            {data?.enrolledSeries?.length ? (
              <div className="space-y-3">
                {data.enrolledSeries.map((t) => (
                  <div key={t._id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                    <div>
                      <p className="font-semibold">{t.name}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {t.questions?.length || 0} Q · {t.marks} marks · {t.duration} min
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={t.difficulty}>{t.difficulty}</Badge>
                      <Link to={`/test-series/attempt/${t._id}`} className="btn-primary py-2">
                        Start <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="You're not enrolled in any test series yet." />
            )}
          </div>

          {/* Recent scores */}
          <div className="card p-6">
            <h3 className="mb-4 font-bold">Recent Scores</h3>
            {data?.recentScores?.length ? (
              <div className="space-y-3">
                {data.recentScores.map((r) => {
                  const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
                  return (
                    <div key={r.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-slate-500">{r.score}/{r.total} · {r.date}</span>
                      </div>
                      <ProgressBar value={pct} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState message="No attempts yet — take a quiz or test to see scores here." />
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Leaderboard */}
          <div className="card p-6">
            <h3 className="mb-4 flex items-center gap-2 font-bold">
              <Crown className="h-5 w-5 text-amber-500" /> Leaderboard
            </h3>
            {board.length ? (
              <div className="space-y-2">
                {board.map((p) => (
                  <div
                    key={p.rank}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                      p.isCurrentUser ? "bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-900/30 dark:ring-brand-800" : ""
                    }`}
                  >
                    <span className={`w-5 text-center text-sm font-bold ${p.rank <= 3 ? "text-amber-500" : "text-slate-400"}`}>
                      {p.rank}
                    </span>
                    <Avatar src={p.avatar} name={p.name} size={32} fallbackClassName="bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.quizzes ?? 0} quizzes · {p.tests ?? 0} tests</p>
                    </div>
                    <span className="text-right text-sm font-semibold text-slate-500">
                      {p.taken ?? 0}
                      <span className="block text-[10px] font-normal text-slate-400">taken</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="Leaderboard fills up as students attempt quizzes & tests." />
            )}
          </div>

          {/* Upcoming */}
          <div className="card p-6">
            <h3 className="mb-4 flex items-center gap-2 font-bold">
              <CalendarClock className="h-5 w-5 text-brand-600" /> Upcoming Tests
            </h3>
            {data?.upcomingTests?.length ? (
              <div className="space-y-3">
                {data.upcomingTests.map((u) => (
                  <div key={u.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <p className="font-semibold">{u.name}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{u.date}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No scheduled tests right now.</p>
            )}
          </div>

          {/* Notifications */}
          <div className="card p-6">
            <h3 className="mb-4 flex items-center gap-2 font-bold">
              <Bell className="h-5 w-5 text-accent-500" /> Notifications
            </h3>
            <div className="space-y-2.5">
              {notices.length === 0 ? (
                <div className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-accent-500" />
                  <div>
                    <p className="text-sm font-semibold">Welcome to My Study Guide</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Keep your {profile.streak}-day streak going — attempt a quiz today!
                    </p>
                  </div>
                </div>
              ) : (
                notices.slice(0, 6).map((n) => {
                  const clickable = !!n.link;
                  return (
                    <div
                      key={n._id}
                      onClick={() => clickable && goNotice(n.link)}
                      className={`flex gap-3 rounded-lg border border-slate-100 p-2.5 dark:border-slate-800 ${clickable ? "cursor-pointer transition hover:border-brand-400 hover:bg-brand-50/50 dark:hover:bg-brand-900/20" : ""}`}
                    >
                      <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-accent-500" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{n.text}</p>
                        {clickable && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                            {/^https?:\/\//i.test(n.link) ? "Open link" : "Go to it"} <ArrowRight className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
