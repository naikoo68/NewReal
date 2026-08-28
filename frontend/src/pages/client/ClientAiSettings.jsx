import { useEffect, useState } from "react";
import { Sparkles, Server, KeyRound, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { aiService } from "../../services";
import { Loading, ErrorState } from "../../components/ui/AsyncState";
import AdminAiKeys from "../admin/AdminAiKeys";

// The client-facing "AI" tab. The admin decides (per client) whether AI is
// available and which sources are allowed:
//   • Built-in APIs — the platform's shared keys (nothing for the client to set up)
//   • Own APIs      — keys the client adds & manages themselves
// The client picks between the sources they're allowed; when using their own
// keys they get the full manager (add / bulk add / test / test-all / refresh).
export default function ClientAiSettings() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingMode, setSavingMode] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    aiService
      .access()
      .then(setInfo)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const chooseMode = async (mode) => {
    if (!info || info.mode === mode || savingMode) return;
    setSavingMode(mode);
    setError("");
    try {
      const res = await aiService.setMode(mode);
      setInfo((p) => ({ ...p, mode: res.mode }));
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingMode("");
    }
  };

  if (loading) return <Loading label="Loading AI settings..." />;
  if (error && !info) return <ErrorState message={error} onRetry={load} />;

  if (!info?.access) {
    return (
      <div className="card p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <h2 className="mt-3 text-lg font-bold">AI isn't enabled for your account</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Please contact the administrator to request access to the AI question generator.
        </p>
      </div>
    );
  }

  const { mode, allowInbuilt, allowSelf, inbuiltAvailable, inbuiltKeys = 0, ownKeys = 0 } = info;

  const Option = ({ value, Icon, title, desc, status }) => {
    const selected = mode === value;
    return (
      <button
        type="button"
        onClick={() => chooseMode(value)}
        disabled={!!savingMode}
        className={`flex flex-col gap-2 rounded-2xl border p-4 text-left transition ${
          selected
            ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/40 dark:bg-brand-900/20"
            : "border-slate-200 hover:border-brand-400 dark:border-slate-700"
        }`}
      >
        <span className="flex items-center justify-between">
          <span className={`flex items-center gap-2 font-bold ${selected ? "text-brand-700 dark:text-brand-300" : ""}`}>
            <Icon className="h-5 w-5" /> {title}
          </span>
          {savingMode === value ? (
            <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          ) : selected ? (
            <CheckCircle2 className="h-5 w-5 text-brand-600" />
          ) : null}
        </span>
        <span className="text-sm text-slate-500 dark:text-slate-400">{desc}</span>
        {status}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold">
          <Sparkles className="h-6 w-6 text-brand-600" /> AI
        </h1>
        <p className="text-slate-500 dark:text-slate-400">
          Choose where the AI gets its API access. Then generate or import questions from the <b>Build</b> tab.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</div>
      )}

      {/* Source selector — only the options the admin allows are shown. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {allowInbuilt && (
          <Option
            value="inbuilt"
            Icon={Server}
            title="Built-in APIs"
            desc="Use the platform's shared API keys — nothing to set up."
            status={
              inbuiltAvailable ? (
                <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Ready ({inbuiltKeys} key{inbuiltKeys === 1 ? "" : "s"})
                </span>
              ) : (
                <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> Currently unavailable
                </span>
              )
            }
          />
        )}
        {allowSelf && (
          <Option
            value="self"
            Icon={KeyRound}
            title="My own APIs"
            desc="Add your own provider API keys and manage them below."
            status={
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {ownKeys} key{ownKeys === 1 ? "" : "s"} added
              </span>
            }
          />
        )}
      </div>

      {/* Body for the active mode. */}
      {mode === "self" ? (
        allowSelf ? (
          <AdminAiKeys clientMode />
        ) : null
      ) : (
        <div className="card p-5 text-sm text-slate-600 dark:text-slate-300">
          {inbuiltAvailable ? (
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Built-in AI is ready. Open the <b>Build</b> tab and use <b>Generate with AI</b> or <b>Import</b>.
            </p>
          ) : (
            <p className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Built-in AI isn't available right now.{" "}
              {allowSelf ? "You can switch to your own API keys above." : "Please contact the administrator."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
