import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { ArrowRight, ChevronLeft, Clock, HelpCircle, Play, Lock, Unlock } from "lucide-react";
import { practiceService } from "../../services";
import { useAuth } from "../../context/AuthContext";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

const KIND_LABEL = { quiz: "My Quiz", test: "My Test", paper: "Previous Papers" };

// Handles the three practice browse levels based on the URL params:
//   /practice/:kind                         → streams
//   /practice/:kind/:streamId               → subjects
//   /practice/:kind/:streamId/:subjectId    → items (attempt via TestAttempt)
export default function PracticeBrowse() {
  const { kind, streamId, subjectId, topicId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // My Quiz has an extra Topic level; My Test Series goes subject → items.
  // My Quiz: stream → subject → topic → items. My Test: stream → subject → items.
  // Previous Papers: stream → papers (items directly under the stream, no subject).
  const level = topicId ? "items"
    : subjectId ? (kind === "quiz" ? "topics" : "items")
    : streamId ? (kind === "paper" ? "items" : "subjects")
    : "streams";

  const load = () => {
    setLoading(true);
    setError("");
    const p =
      level === "items" ? (kind === "paper" ? practiceService.streamItems(kind, streamId) : kind === "quiz" ? practiceService.topicItems(kind, topicId) : practiceService.items(kind, subjectId))
      : level === "topics" ? practiceService.topics(kind, subjectId)
      : level === "subjects" ? practiceService.subjects(kind, streamId)
      : practiceService.streams(kind);
    p.then(setRows).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [kind, streamId, subjectId, topicId]);

  const back =
    level === "items" ? (kind === "paper" ? `/practice/${kind}` : kind === "quiz" ? `/practice/${kind}/${streamId}/${subjectId}` : `/practice/${kind}/${streamId}`)
    : level === "topics" ? `/practice/${kind}/${streamId}`
    : level === "subjects" ? `/practice/${kind}`
    : "/practice";

  const title = level === "items" ? "Select one to start" : level === "topics" ? "Choose a topic" : level === "subjects" ? "Choose a subject" : KIND_LABEL[kind] || "Practice";

  const openItem = (item) => {
    // Previous Papers: LOGIN required, but no subscription.
    if (kind === "paper") {
      if (!user) return navigate("/login");
      return navigate(`/practice/quiz/play/${item._id}`);
    }
    // My Quiz: the FIRST quiz in each topic is FREE for everyone.
    if (kind === "quiz") {
      if (item.freePreview) {
        // Logged-in users play the normal (progress-saving) route; guests use
        // the public free-preview route (no login needed).
        return navigate(user ? `/practice/quiz/play/${item._id}` : `/practice/quiz/free/${item._id}`);
      }
      if (!user) return navigate("/login");
      if (item.locked) return navigate("/pricing"); // needs a subscription
      return navigate(`/practice/quiz/play/${item._id}`);
    }
    // My Test Series → full test interface (timed, submit at end). The FIRST
    // test in each subject is FREE for everyone; the rest need login+subscription.
    if (item.freePreview) {
      return navigate(user ? `/test-series/attempt/${item._id}` : `/practice/test/free/${item._id}`);
    }
    if (!user) return navigate("/login");
    if (item.locked) return navigate("/pricing");
    navigate(`/test-series/attempt/${item._id}`);
  };

  return (
    <div className="container-page py-12">
      <Link to={back} className="btn-ghost mb-6 -ml-2 w-fit"><ChevronLeft className="h-4 w-4" /> Back</Link>
      <h1 className="text-3xl font-extrabold sm:text-4xl">{title}</h1>

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : rows.length === 0 ? (
        <EmptyState message={level === "items" ? "No practice content available to you here yet." : "Nothing shared with you here yet."} />
      ) : level === "items" ? (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((it, i) => {
            // Freemium state for My Quiz: the first quiz per topic is free; the
            // rest are locked until login + subscription. Papers need login.
            const isFreeItem = !!it.freePreview; // first quiz/test in a topic/subject
            const isLocked = !!it.locked;
            const paperNeedsLogin = kind === "paper" && it.loginOnly && !user;
            const btnLabel = isFreeItem ? "Start free" : isLocked ? (it.loginOnly ? "Log in to open" : "Subscribe to unlock") : "Start";
            return (
              <div key={it._id} style={{ animationDelay: `${i * 40}ms` }} className="card animate-fade-in-up p-6 opacity-0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-bold">{it.name}</h3>
                  {isFreeItem && (
                    <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><Unlock className="h-3 w-3" /> Free</span>
                  )}
                  {isLocked && (
                    <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400"><Lock className="h-3 w-3" /> {it.loginOnly ? "Login" : "Premium"}</span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1"><HelpCircle className="h-4 w-4" /> {it.questionCount} Qs</span>
                  {it.duration ? <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" /> {it.duration} min</span> : null}
                  {it.difficulty && <span>{it.difficulty}</span>}
                </div>
                <button onClick={() => openItem(it)} className={`mt-4 w-full ${isLocked && !paperNeedsLogin ? "btn-outline" : "btn-primary"}`}>
                  {isLocked ? <Lock className="h-4 w-4" /> : <Play className="h-4 w-4" />} {btnLabel}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((s, i) => {
            const Icon = Icons[s.icon] || (level === "streams" ? Icons.GraduationCap : level === "topics" ? Icons.Layers : Icons.BookOpen);
            const to = level === "streams" ? `/practice/${kind}/${s._id}`
              : level === "subjects" ? `/practice/${kind}/${streamId}/${s._id}`
              : `/practice/${kind}/${streamId}/${subjectId}/${s._id}`;
            return (
              <Link key={s._id} to={to} style={{ animationDelay: `${i * 40}ms` }} className="card-hover group animate-fade-in-up p-6 opacity-0">
                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${s.color || "from-violet-500 to-fuchsia-600"} text-white shadow-soft`}>
                  <Icon className="h-7 w-7" />
                </div>
                <h3 className="mt-4 text-lg font-bold">{s.name}</h3>
                {s.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{s.description}</p>}
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 transition group-hover:gap-2 dark:text-brand-400">
                  Open <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
