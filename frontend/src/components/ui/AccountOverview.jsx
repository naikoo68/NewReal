import { ListChecks, FileStack, HelpCircle, GraduationCap, FolderOpen, Layers, ShieldCheck } from "lucide-react";

// One compact stat cell.
function Stat({ value, label, Icon }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800/60">
      <Icon className="mx-auto h-4 w-4 text-brand-500" />
      <p className="mt-1 text-lg font-extrabold text-slate-800 dark:text-slate-100">{value ?? 0}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

// Live "What's on your account now" overview card. Presentational: the caller
// passes the counts (client = their own content; admin = platform-wide) and,
// optionally, a stream breakdown list. Reused on the client dashboard and the
// admin dashboard.
export default function AccountOverview({
  title = "What's on your account now",
  subtitle = "This is read live — add or delete a quiz/test and it changes here automatically.",
  counts = {},
  items = null,
  streamList = null,
  streamsLabel = "Your streams",
}) {
  // Either render a caller-provided list of cells, or the default six from counts.
  const cells = items || [
    { value: counts.quizzes, label: "Quizzes", Icon: ListChecks },
    { value: counts.tests, label: "Tests", Icon: FileStack },
    { value: counts.questions, label: "Questions", Icon: HelpCircle },
    { value: counts.streams, label: "Streams", Icon: GraduationCap },
    { value: counts.subjects, label: "Subjects", Icon: FolderOpen },
    { value: counts.topics, label: "Topics", Icon: Layers },
  ];
  return (
    <div className="card p-5">
      <h2 className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-emerald-600" /> {title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {cells.map((c, i) => (
          <Stat key={i} value={c.value} label={c.label} Icon={c.Icon} />
        ))}
      </div>

      {streamList && streamList.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{streamsLabel}</p>
          <div className="flex flex-wrap gap-2">
            {streamList.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs dark:border-slate-700">
                <GraduationCap className="h-3.5 w-3.5 text-brand-500" />
                <span className="font-semibold">{s.name}</span>
                <span className="text-slate-400">{s.quizzes} quiz{s.quizzes === 1 ? "" : "zes"}{s.tests ? `, ${s.tests} test${s.tests === 1 ? "" : "s"}` : ""}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
