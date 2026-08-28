import { useEffect, useState } from "react";
import { Doughnut } from "react-chartjs-2";
import "../../lib/chartSetup";
import { ListChecks, FileStack, HelpCircle, GraduationCap, FolderOpen, Layers, Files } from "lucide-react";
import StatCard from "../../components/ui/StatCard";
import AccountOverview from "../../components/ui/AccountOverview";
import { analyticsService } from "../../services";
import { Loading, ErrorState } from "../../components/ui/AsyncState";

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null); // split practice vs content counts
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    analyticsService
      .adminAnalytics()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    analyticsService.contentOverview().then(setOverview).catch(() => {});
  };

  useEffect(load, []);

  if (loading) return <Loading label="Loading analytics..." />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const planMap = Object.fromEntries((data.planDistribution || []).map((p) => [p._id, p.count]));
  const planData = {
    labels: ["Free", "Premium", "Pro"],
    datasets: [
      {
        data: [planMap.Free || 0, planMap.Premium || 0, planMap.Pro || 0],
        backgroundColor: ["#cbd5e1", "#2563eb", "#f97316"],
        borderWidth: 0,
      },
    ],
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Dashboard</h1>
        <p className="text-slate-500 dark:text-slate-400">Live platform overview & analytics.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="Users" label="Total Users" value={data.totalUsers} accent="brand" />
        <StatCard icon="Activity" label="Active (24h)" value={data.activeUsers} accent="green" />
        <StatCard icon="FileStack" label="Total Tests" value={data.totalTests} accent="accent" />
        <StatCard icon="ListChecks" label="Total Attempts" value={data.totalAttempts} accent="violet" />
      </div>

      {/* Live content overview, split into two accurate sections so practice
          and platform content are never conflated. */}
      {overview && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AccountOverview
            title="My Practice"
            subtitle="Live counts of the practice content (My Quiz / My Test / Previous Papers)."
            items={[
              { value: overview.practice.quizzes, label: "Quizzes", Icon: ListChecks },
              { value: overview.practice.tests, label: "Tests", Icon: FileStack },
              { value: overview.practice.papers, label: "Papers", Icon: Files },
              { value: overview.practice.questions, label: "Questions", Icon: HelpCircle },
              { value: overview.practice.streams, label: "Streams", Icon: GraduationCap },
              { value: overview.practice.subjects, label: "Subjects", Icon: FolderOpen },
              { value: overview.practice.topics, label: "Topics", Icon: Layers },
            ]}
          />
          <AccountOverview
            title="Content & Test Series"
            subtitle="Live counts of the platform Content and Test Series."
            items={[
              { value: overview.content.quizzes, label: "Quizzes", Icon: ListChecks },
              { value: overview.content.tests, label: "Test Series", Icon: FileStack },
              { value: overview.content.questions, label: "Questions", Icon: HelpCircle },
              { value: overview.content.streams, label: "Streams", Icon: GraduationCap },
              { value: overview.content.subjects, label: "Subjects", Icon: FolderOpen },
              { value: overview.content.topics, label: "Topics", Icon: Layers },
            ]}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2">
          <h3 className="mb-4 font-bold">Platform Summary</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-5 dark:bg-slate-800/60">
              <p className="text-sm text-slate-500">Average Score</p>
              <p className="mt-1 text-3xl font-extrabold text-brand-600 dark:text-brand-400">{data.avgScore}%</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-5 dark:bg-slate-800/60">
              <p className="text-sm text-slate-500">Total Quiz/Test Attempts</p>
              <p className="mt-1 text-3xl font-extrabold text-accent-500">{data.totalAttempts}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-5 dark:bg-slate-800/60">
              <p className="text-sm text-slate-500">Registered Students</p>
              <p className="mt-1 text-3xl font-extrabold text-emerald-600">{data.totalUsers}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-5 dark:bg-slate-800/60">
              <p className="text-sm text-slate-500">Published Tests</p>
              <p className="mt-1 text-3xl font-extrabold text-violet-600">{data.totalTests}</p>
            </div>
          </div>
        </div>
        <div className="card p-6">
          <h3 className="mb-4 font-bold">Subscription Mix</h3>
          <div className="mx-auto h-64 max-w-xs">
            <Doughnut data={planData} options={{ plugins: { legend: { position: "bottom" } } }} />
          </div>
        </div>
      </div>
    </div>
  );
}
