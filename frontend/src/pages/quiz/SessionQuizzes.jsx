import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Play, HelpCircle, ListChecks } from "lucide-react";
import { contentService } from "../../services";
import Badge from "../../components/ui/Badge";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

export default function SessionQuizzes() {
  const { subjectId, topicId, sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([contentService.sessions(topicId), contentService.quizzes(sessionId)])
      .then(([sessions, qz]) => {
        setSession(sessions.find((s) => s._id === sessionId) || null);
        setQuizzes(qz);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [topicId, sessionId]);

  if (loading) return <div className="container-page"><Loading label="Loading quizzes..." /></div>;
  if (error) return <div className="container-page"><ErrorState message={error} onRetry={load} /></div>;

  return (
    <div className="container-page py-12">
      <Link to={`/quiz/${subjectId}/${topicId}`} className="btn-ghost mb-6 -ml-2 w-fit">
        <ChevronLeft className="h-4 w-4" /> Back to sessions
      </Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-medium text-accent-600 dark:text-accent-400">Session</p>
        <h1 className="text-3xl font-extrabold">{session?.title || "Quizzes"}</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-300">{quizzes.length} quiz(zes) in this session</p>
      </div>

      <h2 className="mt-10 text-xl font-bold">Quizzes</h2>
      {quizzes.length === 0 ? (
        <EmptyState message="No quizzes in this session yet." />
      ) : (
        <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((q, i) => (
            <Link
              key={q._id}
              to={`/quiz/${subjectId}/${topicId}/${sessionId}/${q._id}`}
              style={{ animationDelay: `${i * 50}ms` }}
              className="card-hover animate-fade-in-up flex flex-col p-6 opacity-0"
            >
              <div className="flex items-start justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-900/40 dark:text-accent-300">
                  <ListChecks className="h-5 w-5" />
                </span>
                <Badge variant={q.difficulty}>{q.difficulty}</Badge>
              </div>
              <h3 className="mt-3 text-lg font-bold">{q.title}</h3>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                <HelpCircle className="h-4 w-4" /> {q.questions} questions
              </p>
              <span className="btn-primary mt-auto w-full">
                <Play className="h-4 w-4" /> Start Quiz
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
