import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Play, HelpCircle } from "lucide-react";
import { contentService } from "../../services";
import Badge from "../../components/ui/Badge";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

export default function TopicSessions() {
  const { subjectId, topicId } = useParams();
  const [topic, setTopic] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([contentService.topics(subjectId), contentService.sessions(topicId)])
      .then(([topics, sess]) => {
        setTopic(topics.find((t) => t._id === topicId) || null);
        setSessions(sess);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [subjectId, topicId]);

  if (loading) return <div className="container-page"><Loading label="Loading sessions..." /></div>;
  if (error) return <div className="container-page"><ErrorState message={error} onRetry={load} /></div>;

  return (
    <div className="container-page py-12">
      <Link to={`/quiz/${subjectId}`} className="btn-ghost mb-6 -ml-2 w-fit">
        <ChevronLeft className="h-4 w-4" /> Back to topics
      </Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-medium text-accent-600 dark:text-accent-400">Topic</p>
        <h1 className="text-3xl font-extrabold">{topic?.title || "Sessions"}</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-300">{sessions.length} session(s) in this topic</p>
      </div>

      <h2 className="mt-10 text-xl font-bold">Sessions & Chapters</h2>
      {sessions.length === 0 ? (
        <EmptyState message="No sessions in this topic yet." />
      ) : (
        <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((s, i) => (
            <Link
              key={s._id}
              to={`/quiz/${subjectId}/${topicId}/${s._id}`}
              style={{ animationDelay: `${i * 50}ms` }}
              className="card-hover animate-fade-in-up flex flex-col p-6 opacity-0"
            >
              <div className="flex items-start justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 text-sm font-bold text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                  {s.index}
                </span>
                <Badge variant={s.difficulty}>{s.difficulty}</Badge>
              </div>
              <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                <HelpCircle className="h-4 w-4" /> {s.quizzes ?? 0} quizzes
              </p>
              <span className="btn-primary mt-auto w-full">
                <Play className="h-4 w-4" /> View Quizzes
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
