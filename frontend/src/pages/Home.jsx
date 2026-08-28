import { Fragment, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  BookMarked,
  FileText,
  Zap,
  LineChart,
  Trophy,
  ArrowRight,
  CheckCircle2,
  Play,
  Users,
  ListChecks,
  Layers,
  Star,
  FileStack,
  HelpCircle,
} from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";
import { analyticsService } from "../services";
import GlobalSearch from "../components/ui/GlobalSearch";

// Icons applied by position to the editable stats from Customization.
const STAT_ICONS = [Users, ListChecks, Layers];

// Default order of home sections (used if none saved / for any missing keys).
const DEFAULT_HOME_ORDER = ["hero", "stats", "quickAccess", "features", "howItWorks", "testimonials", "cta"];

// Initials for a testimonial avatar when no photo is provided.
const initials = (name) =>
  String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "★";

const features = [
  {
    icon: BookMarked,
    title: "Subject-wise Quizzes",
    desc: "Practice 12+ subjects broken into focused chapter sessions with instant feedback.",
    color: "text-brand-600 bg-brand-100 dark:bg-brand-900/40 dark:text-brand-300",
  },
  {
    icon: FileText,
    title: "Full-Length Test Series",
    desc: "Real exam-style mock tests with timers, palette and auto-submit on time-up.",
    color: "text-accent-600 bg-accent-100 dark:bg-accent-900/40 dark:text-accent-300",
  },
  {
    icon: Zap,
    title: "Instant Results",
    desc: "Get your score, percentage and detailed answer review the moment you submit.",
    color: "text-amber-600 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300",
  },
  {
    icon: LineChart,
    title: "Performance Analytics",
    desc: "Visual dashboards reveal strengths, weak topics and progress over time.",
    color: "text-violet-600 bg-violet-100 dark:bg-violet-900/40 dark:text-violet-300",
  },
  {
    icon: Trophy,
    title: "Leaderboard",
    desc: "Compete with thousands of students and climb the all-India rankings.",
    color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
];

const steps = [
  { n: "01", t: "Pick a Subject", d: "Choose from 12+ subjects and start a focused session." },
  { n: "02", t: "Attempt & Learn", d: "Answer questions, see instant explanations and bookmark tricky ones." },
  { n: "03", t: "Analyze & Improve", d: "Review analytics, fix weak topics and track your rank." },
];

export default function Home() {
  const { settings } = useSettings();
  const { user } = useAuth();

  // Live platform stats (real counts). Refetched on load, on a 45s interval,
  // and whenever the tab regains focus — so the numbers update automatically
  // as clients add/delete questions, without a manual page reload.
  const [realStats, setRealStats] = useState(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      analyticsService.stats().then((r) => active && setRealStats(r)).catch(() => {});
    load();
    const id = setInterval(load, 45000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const fmt = (n) => Number(n || 0).toLocaleString("en-IN");
  const DEFAULT_KEYS = ["students", "quizzes", "tests"];
  const DEFAULT_ROWS = [
    { label: "Total Students", metric: "students" },
    { label: "Total Quizzes", metric: "quizzes" },
    { label: "Total Test Series", metric: "tests" },
  ];
  const manualStats = settings.aboutStats?.length ? settings.aboutStats : [];
  let stats = [];
  if (settings.statsAuto === false) {
    stats = manualStats.map((s, i) => ({ icon: STAT_ICONS[i % STAT_ICONS.length], label: s.label, value: s.value }));
  } else if (realStats) {
    const rows = manualStats.length ? manualStats : DEFAULT_ROWS;
    stats = rows.map((s, i) => {
      const key = s.metric || DEFAULT_KEYS[i] || "students";
      return { icon: STAT_ICONS[i % STAT_ICONS.length], label: s.label || DEFAULT_ROWS[i]?.label || "", value: fmt(realStats[key] ?? 0) };
    });
  }

  // Live progress card for a logged-in student (from their real attempts + rank).
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!user) { setLive(null); return; }
    Promise.all([analyticsService.dashboard(), analyticsService.leaderboard().catch(() => [])])
      .then(([d, board]) => {
        const me = board.find((b) => b.isCurrentUser);
        const recent = d.recentScores || [];
        const best = recent.reduce((m, r) => Math.max(m, r.percentile || 0), 0);
        setLive({
          label: recent[0]?.name ? `Recent: ${recent[0].name}` : "Your Progress",
          accuracy: d.stats?.avgPercentile || 0,
          best,
          last: recent[0]?.percentile || 0,
          rank: me?.rank || null,
          quizzes: me?.quizzes || 0,
          tests: me?.tests || 0,
        });
      })
      .catch(() => {});
  }, [user]);

  const bars = live
    ? [
        { l: "Average Accuracy", v: live.accuracy, c: "bg-emerald-500" },
        { l: "Best Recent Score", v: live.best, c: "bg-brand-600" },
        { l: "Last Score", v: live.last, c: "bg-accent-500" },
      ]
    : [
        { l: "Quiz Accuracy", v: 86, c: "bg-emerald-500" },
        { l: "Syllabus Covered", v: 64, c: "bg-brand-600" },
        { l: "Mock Tests Done", v: 42, c: "bg-accent-500" },
      ];
  const miniStats = live
    ? [
        { v: live.rank ? `#${live.rank}` : "—", l: "Rank" },
        { v: live.quizzes, l: "Quizzes" },
        { v: live.tests, l: "Tests" },
      ]
    : [
        { v: "#5", l: "Rank" },
        { v: "7", l: "Day streak" },
        { v: "9,380", l: "Points" },
      ];
  const progressTitle = live ? live.label : "Physics · Motion";
  const progressSubtitle = live ? "Live · from your activity" : "Today's Progress";

  // Each home section as a keyed block, rendered in the admin-chosen order.
  const blocks = {
    hero: (
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-50 via-white to-white dark:from-slate-900 dark:via-slate-950 dark:to-slate-950" />
        <div className="absolute -right-20 -top-20 -z-10 h-72 w-72 rounded-full bg-accent-300/30 blur-3xl dark:bg-accent-600/10" />
        <div className="absolute -left-20 top-40 -z-10 h-72 w-72 rounded-full bg-brand-300/30 blur-3xl dark:bg-brand-700/10" />

        <div className="container-page py-16 lg:py-24">
          {/* Full-width centered header — spans across both columns (above the card too). */}
          <div className="animate-fade-in-up text-center">
            <span className="badge bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
              <Star className="h-3.5 w-3.5" /> India's smart prep platform
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Prepare Smart,{" "}
              <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
                Achieve More.
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-center text-base text-slate-600 dark:text-slate-300 sm:text-lg">
              Master every subject with adaptive quizzes, full-length test series,
              instant results and powerful analytics — built for serious aspirants.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-2 items-center gap-4 sm:gap-8 md:gap-12">
            <div className="animate-fade-in-up text-center">
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/quiz" className="btn-primary text-base">
                <Play className="h-5 w-5" /> Start Practicing
              </Link>
              <Link to="/test-series" className="btn-outline text-base">
                Explore Test Series <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/practice/paper" className="btn-outline text-base">
                <FileText className="h-5 w-5" /> Previous Papers
              </Link>
              <Link to="/practice" className="btn-outline text-base">
                <ListChecks className="h-5 w-5" /> My Practice
              </Link>
            </div>
            {/* Search all content — streams, subjects, topics, quizzes & tests */}
            <div className="mt-6 mx-auto max-w-lg">
              <GlobalSearch mode="public" placeholder="Search streams, subjects, topics, quizzes, tests…" />
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
              {["No credit card needed", "Free quizzes", "Detailed solutions"].map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {t}
                </span>
              ))}
            </div>
          </div>

          <div className="relative animate-scale-in">
            <div className="card p-4 shadow-soft sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{progressSubtitle}</p>
                  <p className="text-2xl font-bold">{progressTitle}</p>
                </div>
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 text-white">
                  <Zap className="h-6 w-6" />
                </span>
              </div>
              <div className="mt-5 space-y-4">
                {bars.map((b) => (
                  <div key={b.l}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-300">{b.l}</span>
                      <span className="font-semibold">{b.v}%</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div className={`h-full rounded-full ${b.c}`} style={{ width: `${b.v}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center sm:gap-3">
                {miniStats.map((s) => (
                  <div key={s.l} className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60 sm:p-3">
                    <p className="text-lg font-bold text-brand-600 dark:text-brand-400">{s.v}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{s.l}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute -bottom-5 -left-5 hidden animate-float rounded-2xl bg-accent-500 px-4 py-3 text-white shadow-glow sm:block">
              <Trophy className="mb-1 h-5 w-5" />
              <p className="text-xs font-semibold">Top 5%</p>
            </div>
          </div>
          </div>

          {/* Hero boxes for the three products */}
          <div className="mt-14 grid gap-5 sm:grid-cols-3">
            {[
              { to: "/quiz", label: "Quizzes", desc: "Subject-wise adaptive quizzes with instant solutions.", Icon: ListChecks, cls: "from-brand-600 to-indigo-600" },
              { to: "/test-series", label: "Test Series", desc: "Full-length & sectional mocks with real exam timing.", Icon: FileText, cls: "from-accent-500 to-orange-600" },
              { to: "/study", label: "Study Material", desc: "Curated notes, PDFs and resources to revise faster.", Icon: BookMarked, cls: "from-emerald-500 to-teal-600" },
            ].map((p) => (
              <Link key={p.to} to={p.to} className="card-hover group relative overflow-hidden p-6">
                <span className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${p.cls} text-white`}>
                  <p.Icon className="h-7 w-7" />
                </span>
                <h3 className="mt-4 text-lg font-bold">{p.label}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{p.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 dark:text-brand-400">
                  Explore <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    ),

    stats:
      stats.length > 0 ? (
        <section className="container-page">
          <div className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-900">
            {stats.map((s) => (
              <div key={s.label} className="flex items-center justify-center gap-4 py-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                  <s.icon className="h-7 w-7" />
                </span>
                <div>
                  <p className="text-2xl font-extrabold sm:text-3xl">{s.value}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null,

    // Combined totals across ALL clients (their "My Practice" content),
    // computed live on every visit — updates automatically as clients build.
    clientStats: realStats ? (
      <section className="container-page pt-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-5 text-center text-sm font-semibold uppercase tracking-wide text-slate-400">
            Across all accounts — updated live
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { v: realStats.clients, l: "Total Clients", Icon: Users },
              { v: realStats.clientQuizzes, l: "Total Quizzes", Icon: ListChecks },
              { v: realStats.clientTests, l: "Total Tests", Icon: FileStack },
              { v: realStats.clientQuestions, l: "Total Questions", Icon: HelpCircle },
            ].map((s) => (
              <div key={s.l} className="flex flex-col items-center gap-2 rounded-2xl bg-slate-50 p-5 text-center dark:bg-slate-800/60">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                  <s.Icon className="h-6 w-6" />
                </span>
                <p className="text-2xl font-extrabold sm:text-3xl">{fmt(s.v)}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    ) : null,


    features: (
      <section className="container-page py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold sm:text-4xl">Everything you need to crack it</h2>
          <p className="mt-3 text-slate-600 dark:text-slate-300">
            A complete preparation toolkit designed around how toppers actually study.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card-hover p-6">
              <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${f.color}`}>
                <f.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{f.desc}</p>
            </div>
          ))}
          <div className="flex flex-col justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 p-6 text-white">
            <h3 className="text-xl font-bold">Ready to begin?</h3>
            <p className="mt-2 text-sm text-white/90">
              Jump into a free quiz right now — no signup required.
            </p>
            <Link to="/quiz" className="mt-4 inline-flex w-fit items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 transition hover:bg-slate-100">
              Take a Quiz <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    ),

    howItWorks: (
      <section className="bg-slate-50 py-20 dark:bg-slate-900/40">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold sm:text-4xl">How it works</h2>
            <p className="mt-3 text-slate-600 dark:text-slate-300">
              Three simple steps to smarter preparation.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="card relative overflow-hidden p-6">
                <span className="absolute -right-2 -top-4 text-7xl font-black text-slate-100 dark:text-slate-800">
                  {s.n}
                </span>
                <h3 className="relative text-lg font-bold">{s.t}</h3>
                <p className="relative mt-2 text-sm text-slate-600 dark:text-slate-400">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    ),

    testimonials:
      (settings.testimonials?.length ? settings.testimonials : []).length > 0 ? (
        <section className="bg-slate-50 py-20 dark:bg-slate-900/40">
          <div className="container-page">
            <div className="mx-auto max-w-2xl text-center">
              <span className="badge bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
                <Star className="h-3.5 w-3.5" /> Loved by students
              </span>
              <h2 className="mt-4 text-3xl font-extrabold sm:text-4xl">What our students say</h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300">
                Real results from learners preparing with {settings.siteName}.
              </p>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {settings.testimonials.map((t, i) => (
                <figure key={i} className="card flex flex-col p-6">
                  <div className="flex gap-0.5 text-amber-400">
                    {Array.from({ length: 5 }).map((_, k) => (
                      <Star key={k} className={`h-4 w-4 ${k < (t.rating || 5) ? "fill-current" : "opacity-30"}`} />
                    ))}
                  </div>
                  <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    “{t.text}”
                  </blockquote>
                  <figcaption className="mt-5 flex items-center gap-3">
                    {t.photo ? (
                      <img src={t.photo} alt={t.name} className="h-11 w-11 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-accent-500 text-sm font-bold text-white">
                        {initials(t.name)}
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-bold">{t.name}</p>
                      {t.exam && <p className="text-xs text-slate-500 dark:text-slate-400">{t.exam}</p>}
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
            <div className="mt-10 text-center">
              <Link to="/review" className="btn-outline"><Star className="h-4 w-4" /> Share your review</Link>
            </div>
          </div>
        </section>
      ) : null,

    cta: (
      <section className="container-page py-20">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-700 via-brand-600 to-accent-500 px-8 py-14 text-center text-white">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <h2 className="text-3xl font-extrabold sm:text-4xl">Start your journey to the top rank</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/90">
            Join thousands of students preparing the smart way with {settings.siteName}.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="btn bg-white text-brand-700 hover:bg-slate-100">
              Create Free Account
            </Link>
            <Link to="/quiz" className="btn border border-white/40 text-white hover:bg-white/10">
              Browse Quizzes
            </Link>
          </div>
        </div>
      </section>
    ),
  };

  // Resolve the render order: saved layout first, then any missing sections
  // appended in their default position so nothing ever disappears.
  const saved = Array.isArray(settings.homeSections) && settings.homeSections.length ? settings.homeSections : [];
  const savedKeys = saved.map((s) => s.key);
  const order = [
    ...saved,
    ...DEFAULT_HOME_ORDER.filter((k) => !savedKeys.includes(k)).map((k) => ({ key: k, visible: true })),
  ];

  // Only CLIENTS are bounced off the public landing page. The app deliberately
  // keeps a client inside their own /client workspace (their nav has NO link to
  // "/"), so reaching this page means an accidental browser-Back — send them
  // home. Admins ("Switch to Student Mode") and students ("Home" in the navbar)
  // intentionally visit the public site, so they are NOT redirected. Declared
  // AFTER all hooks so the Rules of Hooks are preserved.
  if (user?.role === "client") {
    return <Navigate to="/client" replace />;
  }

  return (
    <div>
      {order
        .filter((s) => s.visible !== false && blocks[s.key])
        .map((s) => (
          <Fragment key={s.key}>
            {blocks[s.key]}
            {/* Live client-combined totals appear right after the stats strip. */}
            {s.key === "stats" && blocks.clientStats}
          </Fragment>
        ))}
    </div>
  );
}
