import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import {
  ListChecks,
  FileStack,
  Play,
  Clock,
  ShieldCheck,
  AlarmClock,
  Sparkles,
  HelpCircle,
  ChevronRight,
  ArrowRight,
  GraduationCap,
  FolderOpen,
  Layers,
  Gift,
  Copy,
  Crown,
  Search,
  X,
  BarChart3,
  Share2,
  Trash2,
} from "lucide-react";
import { authService, practiceService, searchService, testService } from "../../services";
import { loadNav, saveNav } from "../../lib/navState";
import { useAuth } from "../../context/AuthContext";
import Badge from "../../components/ui/Badge";
import QuestionView from "../../components/admin/QuestionView";
import PaperExport from "../../components/admin/PaperExport";
import AccountOverview from "../../components/ui/AccountOverview";
import { Loading, ErrorState } from "../../components/ui/AsyncState";
import ClientPerformance from "./ClientPerformance";
import IncomingSharesInbox from "../../components/client/IncomingSharesInbox";
import ShareByEmailModal from "../../components/client/ShareByEmailModal";

const previewText = (t, n = 100) => {
  const s = String(t || "").replace(/\$/g, "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
};
const qTrail = (d) =>
  [d?.stream, d?.subject, d?.topicName || d?.topic, d?.session, d?.quiz].filter((x) => x && x !== "—").join(" › ");

const fmtDate = (d) =>
  new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function relativeTo(d) {
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `in ${hrs} hr${hrs === 1 ? "" : "s"}`;
  const days = Math.round(hrs / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
const isExpired = (d) => d && new Date(d).getTime() < Date.now();

// The two sub-modules a client practices. My Quiz drills Stream → Subject →
// Topic → Quiz; My Test drills Stream → Test.
const KINDS = [
  { key: "quiz", label: "My Quiz", Icon: ListChecks, tone: "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300" },
  { key: "test", label: "My Test", Icon: FileStack, tone: "bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300" },
];

const eq = (a, b) => String(a || "") === String(b || "");

// Collect the distinct nodes referenced by `list` under the given key
// (e.g. every distinct stream among a set of quizzes), preserving order.
function uniqueNodes(list, key) {
  const map = new Map();
  for (const it of list) {
    const node = it[key];
    if (!node || !node._id) continue;
    const k = String(node._id);
    if (!map.has(k)) map.set(k, { node, owned: false, shared: false });
    const e = map.get(k);
    if (it.sharedByOther) e.shared = true; else e.owned = true;
  }
  // Flag a grouping node as shared-with-you only when EVERY item under it was
  // shared by someone else (so you can safely "remove" the whole node); mixed
  // nodes that also contain your own content keep the normal (share) controls.
  return [...map.values()].map((e) => ({ ...e.node, sharedByOther: e.shared && !e.owned }));
}

// Remembers the client's practice-browser drill-down position across refreshes
// and round-trips into a quiz/test, so they don't get bounced back to the top.
const DASH_NAV_KEY = "mpm-client-dashboard-nav";

// The client's home. Shows profile + validity, then lets them browse and
// practice the quizzes and tests they built (this is where practicing happens,
// not the builder). `onBuild` switches to the builder tab to add/edit content.
export default function ClientDashboard({ onBuild, onUpgrade }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [planInfo, setPlanInfo] = useState(null); // the client's plan (incl. AI generation limits)

  // Resolve the client's plan → its details (price, AI limits) for display.
  useEffect(() => {
    if (!user?.subscriptionPlan) { setPlanInfo(null); return; }
    authService
      .plans()
      .then((r) => setPlanInfo((r?.plans || []).find((p) => p.key === user.subscriptionPlan) || null))
      .catch(() => {});
  }, [user?.subscriptionPlan]);

  // Drill-down state. `kind` picks the sub-module; the selected stream/subject/
  // topic define how deep we've navigated. Switching kind resets the path.
  // Restored from sessionStorage so a refresh — or returning after finishing a
  // practice — keeps you where you were instead of jumping back to the top.
  // Restore the saved tab, but only if it's still a valid kind. A stale value
  // (e.g. "performance" saved before that tab was removed) must NOT survive, or
  // KINDS.find(...) below returns undefined and the whole dashboard crashes on
  // `.label`. Fall back to "quiz".
  const [kind, setKind] = useState(() => {
    const saved = loadNav(DASH_NAV_KEY).kind;
    return KINDS.some((k) => k.key === saved) ? saved : "quiz";
  });
  const [stream, setStream] = useState(() => loadNav(DASH_NAV_KEY).stream || null);
  const [subject, setSubject] = useState(() => loadNav(DASH_NAV_KEY).subject || null);
  const [topic, setTopic] = useState(() => loadNav(DASH_NAV_KEY).topic || null);
  const [copied, setCopied] = useState(false);
  const [q, setQ] = useState("");
  const [qResults, setQResults] = useState([]); // question matches (backend search)
  const [qLoading, setQLoading] = useState(false);
  const [detail, setDetail] = useState(null); // question shown in the detail panel
  const [shareTarget, setShareTarget] = useState(null); // { level, id, name } for the Share-by-email modal

  const copyReferral = () => {
    if (!user?.referralCode) return;
    navigator.clipboard?.writeText(user.referralCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const load = () => {
    setLoading(true);
    setError("");
    practiceService
      .myItems()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Remove content that was shared WITH you (reference access) from your
  // dashboard. Doesn't delete the owner's copy — just un-shares it from you.
  const removeShared = async (level, id, name) => {
    if (!window.confirm(`Remove "${name}" from your dashboard? It was shared with you — this only removes it from your account; the owner keeps their copy.`)) return;
    try {
      await practiceService.removeSharedWithMe({ level, id });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  // Remember the current drill-down position so a refresh or a return trip from
  // a quiz/test restores it instead of dropping back to the top.
  useEffect(() => {
    saveNav(DASH_NAV_KEY, { kind, stream, subject, topic });
  }, [kind, stream, subject, topic]);

  // Search the client's QUESTIONS by content (their own + published) via the
  // backend search, so questions are findable here just like everywhere else.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setQResults([]);
      return;
    }
    let cancelled = false;
    setQLoading(true);
    const t = setTimeout(() => {
      searchService
        .query(query)
        .then((r) => {
          if (!cancelled) setQResults((r.results || []).filter((x) => x.type === "Question"));
        })
        .catch(() => {
          if (!cancelled) setQResults([]);
        })
        .finally(() => {
          if (!cancelled) setQLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const resetPath = () => { setStream(null); setSubject(null); setTopic(null); };
  const switchKind = (k) => { setKind(k); resetPath(); };

  const play = (item) => {
    if (item.kind === "quiz") navigate(`/practice/quiz/play/${item._id}`);
    else navigate(`/test-series/attempt/${item._id}`);
  };

  // Load questions (with answers) for the paper/answer-key download — the client
  // owns this practice content, so the full data is available.
  const paperLoad = (item) => (item.kind === "quiz"
    ? () => practiceService.quizPlay(item._id)
    : () => testService.getQuestions(item._id));

  const expired = isExpired(user?.expiresAt);

  const quizzes = items.filter((i) => i.kind === "quiz");
  const tests = items.filter((i) => i.kind === "test");

  // Live "What's on your account now" overview — recomputed from the fresh
  // items each load, so it auto-updates when content is added/deleted.
  const overview = useMemo(() => {
    const distinct = (arr, key) => new Set(arr.map((x) => x[key]?._id).filter(Boolean)).size;
    const streamMap = new Map();
    for (const it of items) {
      const s = it.stream;
      if (!s?._id) continue;
      const cur = streamMap.get(String(s._id)) || { name: s.name, quizzes: 0, tests: 0 };
      if (it.kind === "quiz") cur.quizzes += 1; else cur.tests += 1;
      streamMap.set(String(s._id), cur);
    }
    return {
      quizzes: quizzes.length,
      tests: tests.length,
      questions: items.reduce((s, i) => s + (i.questionCount || 0), 0),
      streams: distinct(items, "stream"),
      subjects: distinct(quizzes, "subject"),
      topics: distinct(quizzes, "topic"),
      streamList: [...streamMap.values()],
    };
  }, [items, quizzes, tests]);

  // Search across everything the client has built — matches an item by its own
  // name OR the name of its stream / subject / topic, so searching a subject
  // surfaces all its quizzes. Spans BOTH My Quiz and My Test.
  const query = q.trim().toLowerCase();
  const searching = query.length >= 1;
  const searchMatches = searching
    ? items.filter((it) =>
        [it.name, it.stream?.name, it.subject?.name, it.topic?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
    : [];

  // Which level are we viewing for the active kind?
  //   My Quiz : streams → subjects → topics → items(quizzes)
  //   My Test : streams → items(tests)
  const level = kind === "quiz"
    ? (topic ? "items" : subject ? "topics" : stream ? "subjects" : "streams")
    : (stream ? "items" : "streams");

  // Rows for the current level, derived from the flat item list.
  let rows = [];
  if (kind === "quiz") {
    if (level === "streams") rows = uniqueNodes(quizzes, "stream");
    else if (level === "subjects") rows = uniqueNodes(quizzes.filter((q) => eq(q.stream?._id, stream._id)), "subject");
    else if (level === "topics") rows = uniqueNodes(quizzes.filter((q) => eq(q.subject?._id, subject._id)), "topic");
    else rows = quizzes.filter((q) => eq(q.topic?._id, topic._id));
  } else {
    if (level === "streams") rows = uniqueNodes(tests, "stream");
    else rows = tests.filter((t) => eq(t.stream?._id, stream._id));
  }

  // Order EVERY level alphabetically/naturally by name so subjects, streams,
  // topics and the quizzes/tests read A, B, C… (and "Quiz 2" before "Quiz 10")
  // instead of the order they happened to be created in — which is why the
  // "Choose a subject" list showed B, E, A, C, D. `numeric` keeps embedded
  // numbers in human order; `sensitivity:"base"` makes it case-insensitive.
  rows = [...rows].sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { numeric: true, sensitivity: "base" })
  );

  const isItems = level === "items";

  // Breadcrumb trail for the active kind.
  const crumbs = [{ label: (KINDS.find((k) => k.key === kind) || KINDS[0]).label, onClick: resetPath }];
  if (stream) crumbs.push({ label: stream.name, onClick: () => { setSubject(null); setTopic(null); } });
  if (subject) crumbs.push({ label: subject.name, onClick: () => setTopic(null) });
  if (topic) crumbs.push({ label: topic.name, onClick: null });

  const openNode = (node) => {
    if (kind === "test") { setStream(node); return; } // stream → tests
    if (level === "streams") setStream(node);
    else if (level === "subjects") setSubject(node);
    else if (level === "topics") setTopic(node);
  };

  const levelHint =
    level === "streams" ? "Choose a stream"
    : level === "subjects" ? "Choose a subject"
    : level === "topics" ? "Choose a topic"
    : kind === "quiz" ? "Select a quiz to start" : "Select a test to start";

  const fallbackIcon = level === "streams" ? GraduationCap : level === "topics" ? Layers : FolderOpen;

  return (
    <div className="space-y-6">
      {/* Profile + validity — side by side (name left, validity right) from the
          sm breakpoint (640px) up, so it's beside the name on tablets too; only
          stacks on small phones. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5 sm:col-span-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">Welcome back,</p>
          <h1 className="text-lg font-bold">{user?.name || "there"}</h1>
          <p className="mt-0.5 text-sm text-slate-400">{user?.email}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={onBuild} className="btn-outline">
              <Sparkles className="h-4 w-4" /> Build quizzes & tests
            </button>
            {user?.referralCode && (
              <button
                onClick={copyReferral}
                title="Copy your referral code to share with friends"
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-300"
              >
                <Gift className="h-4 w-4" />
                Refer a friend: <span className="font-bold tracking-wide">{user.referralCode}</span>
                {copied ? <span className="text-emerald-600">Copied!</span> : <Copy className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          {user?.referralCode && (
            <p className="mt-2 text-xs text-slate-400">
              Share your code — for every friend who buys a plan, you get <b className="text-emerald-600">10 free days</b> added automatically.
            </p>
          )}
        </div>

        {/* Validity */}
        <div className={`card p-5 ${expired ? "border-rose-300 dark:border-rose-900/60" : ""}`}>
          <div className="flex items-center gap-2">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${expired ? "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"}`}>
              {user?.expiresAt ? <AlarmClock className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </span>
            <h2 className="font-bold">Account validity</h2>
          </div>
          {user?.expiresAt ? (
            expired ? (
              <div className="mt-3">
                <Badge variant="Hard">Expired</Badge>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Your access ended on {fmtDate(user.expiresAt)}. Contact the administrator to renew.</p>
              </div>
            ) : (
              <div className="mt-3">
                <Badge variant="accent"><Clock className="h-3 w-3" /> Active · expires {relativeTo(user.expiresAt)}</Badge>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Valid until {fmtDate(user.expiresAt)}.</p>
              </div>
            )
          ) : (
            <div className="mt-3">
              <Badge variant="Easy">Active · never expires</Badge>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Your account has no expiry date.</p>
            </div>
          )}
          {planInfo && (
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Your plan: <span className="text-slate-700 dark:text-slate-200">{planInfo.label}</span>
                {planInfo.price ? <span className="text-slate-400"> · ₹{planInfo.price}</span> : null}
              </p>
              {planInfo.maxPerBatch ? (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50"><p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{planInfo.maxPerBatch}</p><p className="text-[10px] text-slate-500 dark:text-slate-400">Questions / batch</p></div>
                    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50"><p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{planInfo.perWindow}</p><p className="text-[10px] text-slate-500 dark:text-slate-400">Questions / window</p></div>
                    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50"><p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{planInfo.windowMinutes || 5} min</p><p className="text-[10px] text-slate-500 dark:text-slate-400">Window</p></div>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400"><Sparkles className="h-3 w-3" /> Your AI question-generation limits.</p>
                </>
              ) : null}
            </div>
          )}

          {onUpgrade && user?.expiresAt && (
            <button onClick={onUpgrade} className="btn-primary mt-4 w-full py-1.5 text-xs">
              <Crown className="h-3.5 w-3.5" /> {user?.isTrial ? "Upgrade plan" : "Renew / change plan"}
            </button>
          )}
        </div>
      </div>

      {/* Live overview of everything you've built (auto-updates on add/delete). */}
      <AccountOverview counts={overview} streamList={overview.streamList} />

      {/* Trial banner — nudge trial users to upgrade before it ends */}
      {user?.isTrial && !expired && onUpgrade && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <span className="font-semibold">You're on a free 1-day trial.</span> Upgrade to a paid plan for uninterrupted access.
          </p>
          <button onClick={onUpgrade} className="btn-primary py-1.5 text-xs">
            <Crown className="h-3.5 w-3.5" /> Upgrade plan
          </button>
        </div>
      )}

      {/* Incoming — content other users sent you; Accept to save your own copy
          (whole-stream saves directly; smaller shares ask where to save). */}
      <IncomingSharesInbox onAccepted={load} />

      {/* Performance — always visible, right below the profile */}
      <div className="card p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <BarChart3 className="h-5 w-5 text-emerald-600" /> Performance
        </h2>
        <ClientPerformance />
      </div>

      {/* Practice browser */}
      <div className="card p-5">
        {/* Search across everything you've built */}
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your quizzes, tests & questions…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          {q && (
            <button onClick={() => setQ("")} title="Clear" className="flex-shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {searching ? (
          <h2 className="text-lg font-bold">
            {searchMatches.length + qResults.length} result{searchMatches.length + qResults.length === 1 ? "" : "s"} for “{q.trim()}”
          </h2>
        ) : (<>
        {/* Kind tabs: My Quiz vs My Test */}
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k.key}
              onClick={() => switchKind(k.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                kind === k.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              <k.Icon className="h-4 w-4" /> {k.label}
            </button>
          ))}
        </div>

        {/* Breadcrumb */}
        <nav className="mt-4 flex flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-4 w-4 text-slate-400" />}
              {c.onClick ? (
                <button onClick={c.onClick} className="rounded px-2 py-1 font-medium text-slate-500 hover:text-brand-600">{c.label}</button>
              ) : (
                <span className="rounded px-2 py-1 font-medium text-brand-600">{c.label}</span>
              )}
            </span>
          ))}
        </nav>

        <h2 className="mt-2 text-lg font-bold">{levelHint}</h2>
        </>)}

        {loading ? (
          <div className="mt-6"><Loading label="Loading your content..." /></div>
        ) : error ? (
          <div className="mt-6"><ErrorState message={error} onRetry={load} /></div>
        ) : searching ? (
          <div className="mt-5 space-y-6">
            {/* Your quizzes & tests (matched by name / stream / subject / topic) */}
            {searchMatches.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Your quizzes & tests</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {searchMatches.map((item) => {
                    const empty = (item.questionCount ?? 0) === 0;
                    const cta = item.kind === "quiz" ? "Practice" : "Take Test";
                    const trail = [item.stream?.name, item.subject?.name, item.topic?.name].filter(Boolean).join(" › ");
                    return (
                      <div key={item._id} className="card p-4">
                        <Badge variant={item.kind === "quiz" ? "accent" : "brand"}>
                          {item.kind === "quiz" ? "My Quiz" : "My Test"}
                        </Badge>
                        <p className="mt-2 truncate font-semibold">{item.name}</p>
                        {trail && <p className="truncate text-xs text-slate-400">{trail}</p>}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                          <span className="inline-flex items-center gap-1"><HelpCircle className="h-3 w-3" /> {item.questionCount} Qs</span>
                          {item.kind === "test" && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {item.duration} min</span>}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => play(item)}
                            disabled={empty}
                            title={empty ? "Add questions to this first" : cta}
                            className="btn-primary flex-1 py-1.5 text-xs disabled:opacity-50"
                          >
                            <Play className="h-3.5 w-3.5" /> {empty ? "No questions" : cta}
                          </button>
                          {!empty && <PaperExport compact title={item.name} load={paperLoad(item)} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Questions (matched by their content) — tap to view full details */}
            {qResults.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Questions</h3>
                <div className="space-y-2">
                  {qResults.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => item.raw && setDetail(item.raw)}
                      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      <span className="flex-shrink-0 rounded-md bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                        Question
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{item.title}</span>
                        <span className="block truncate text-xs text-slate-400">
                          {item.match != null && <span className="mr-1.5 font-semibold text-rose-500">{item.match}% match</span>}
                          {item.subtitle}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {searchMatches.length === 0 && qResults.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {qLoading ? "Searching…" : `Nothing matches “${q.trim()}”.`}
                </p>
              </div>
            )}
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {level === "streams" ? `No ${kind === "quiz" ? "quizzes" : "tests"} yet.` : "Nothing here yet."}
            </p>
            <button onClick={onBuild} className="btn-outline mt-3">
              <Sparkles className="h-4 w-4" /> Build one
            </button>
          </div>
        ) : isItems ? (
          // Leaf level — playable quizzes / tests
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((item) => {
              const empty = (item.questionCount ?? 0) === 0;
              const cta = kind === "quiz" ? "Practice" : "Take Test";
              return (
                <div key={item._id} className="card p-4">
                  <p className="truncate font-semibold">{item.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1"><HelpCircle className="h-3 w-3" /> {item.questionCount} Qs</span>
                    {item.kind === "test" && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {item.duration} min</span>}
                    {item.difficulty && <Badge variant={item.difficulty}>{item.difficulty}</Badge>}
                    {item.sharedByOther && <Badge variant="accent"><Share2 className="h-3 w-3" /> Shared with you</Badge>}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => play(item)}
                      disabled={empty}
                      title={empty ? "Add questions to this first" : cta}
                      className="btn-primary flex-1 py-1.5 text-xs disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" /> {empty ? "No questions" : cta}
                    </button>
                    {item.sharedByOther ? (
                      <button
                        onClick={() => removeShared("item", item._id, item.name)}
                        title="Remove this shared item from your dashboard"
                        className="rounded-lg border border-slate-200 p-2 text-rose-500 hover:bg-rose-50 dark:border-slate-700 dark:hover:bg-rose-900/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => setShareTarget({ level: "item", id: item._id, name: item.name })}
                        title="Share with another user by email"
                        className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!empty && <PaperExport compact title={item.name} load={paperLoad(item)} />}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // Grouping level — streams / subjects / topics
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((node) => {
              const Icon = Icons[node.icon] || fallbackIcon;
              // Map the current drill-down level to a share level.
              const shareLevel = level === "streams" ? "stream" : level === "subjects" ? "subject" : "topic";
              return (
                <div key={node._id} className="relative">
                  <button
                    onClick={() => openNode(node)}
                    className="card-hover group w-full p-5 text-left"
                  >
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${node.color || "from-violet-500 to-fuchsia-600"} text-white shadow-soft`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="mt-3 font-bold">{node.name}</h3>
                    {node.sharedByOther && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 dark:text-brand-400"><Share2 className="h-3 w-3" /> Shared with you</span>
                    )}
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 transition group-hover:gap-2 dark:text-brand-400">
                      Open <ArrowRight className="h-4 w-4" />
                    </span>
                  </button>
                  {node.sharedByOther ? (
                    <button
                      onClick={() => removeShared(shareLevel, node._id, node.name)}
                      title={`Remove this shared ${shareLevel} from your dashboard`}
                      className="absolute right-3 top-3 rounded-lg bg-white/80 p-1.5 text-rose-500 shadow-sm hover:bg-rose-50 dark:bg-slate-800/80 dark:hover:bg-rose-900/20"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => setShareTarget({ level: shareLevel, id: node._id, name: node.name })}
                      title={`Share this ${shareLevel} with another user by email`}
                      className="absolute right-3 top-3 rounded-lg bg-white/80 p-1.5 text-slate-500 shadow-sm hover:bg-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-700"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Share practice content with another registered user by email. */}
      {shareTarget && <ShareByEmailModal target={shareTarget} onClose={() => setShareTarget(null)} />}

      {/* Question detail — opens on tap, shows the full question + its location. */}
      {detail && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
          onMouseDown={() => setDetail(null)}
        >
          <div
            className="my-10 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Question</p>
                {qTrail(detail) && (
                  <p className="mt-0.5 break-words text-sm font-semibold text-brand-600 dark:text-brand-400">
                    {qTrail(detail)}
                  </p>
                )}
              </div>
              <button
                onClick={() => setDetail(null)}
                className="flex-shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <QuestionView q={detail} />

            <div className="mt-4 flex justify-end">
              <button onClick={() => setDetail(null)} className="btn-outline">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
