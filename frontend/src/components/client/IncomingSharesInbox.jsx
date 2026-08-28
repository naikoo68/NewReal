import { useEffect, useState, useRef } from "react";
import { Inbox, Check } from "lucide-react";
import { practiceService } from "../../services";
import AcceptShareModal from "./AcceptShareModal";
import { runAcceptShareJob, acceptSharePercent } from "../../lib/acceptShareProgress";

// Self-contained "Incoming shares" inbox. Fetches pending shares sent to the
// current account and lets them Accept (save an owned copy) or Decline.
// Renders nothing when there's nothing pending. Works for both clients and
// admins — the backend scopes shares by the logged-in user's id, and an admin's
// accepted copy is stored in the shared platform space automatically.
//
// Props:
//   onAccepted — optional callback fired after a successful accept, so the host
//                page (e.g. AdminPractice) can refresh its content list.
export default function IncomingSharesInbox({ onAccepted }) {
  const [incoming, setIncoming] = useState([]);
  const [busy, setBusy] = useState(""); // share id currently being accepted/declined
  const [placing, setPlacing] = useState(null); // share whose "where to save" dialog is open
  const [progress, setProgress] = useState({}); // shareId -> live copy progress
  const aliveRef = useRef(true);

  useEffect(() => {
    practiceService.incomingShares().then(setIncoming).catch(() => {});
    return () => { aliveRef.current = false; };
  }, []);

  const remove = (id) => setIncoming((list) => list.filter((x) => x._id !== id));

  // Whole-stream share → save as-is (no placement needed). Anything smaller
  // (subject/topic/quiz/test) → open the dialog to choose existing vs new.
  const accept = async (s) => {
    if (s.level !== "stream") { setPlacing(s); return; }
    setBusy(s._id);
    try {
      const { jobId, itemsTotal = 0, questionsTotal = 0 } = await practiceService.acceptShare(s._id);
      setProgress((m) => ({ ...m, [s._id]: { status: "running", itemsSaved: 0, itemsTotal, questionsSaved: 0, questionsTotal } }));
      await runAcceptShareJob(jobId, (p) => setProgress((m) => ({ ...m, [s._id]: p })), () => aliveRef.current);
      if (!aliveRef.current) return;
      remove(s._id);
      onAccepted?.();
    } catch {
      /* surfaced via global api error toast */
    } finally {
      setBusy("");
      setProgress((m) => { const n = { ...m }; delete n[s._id]; return n; });
    }
  };

  const decline = async (s) => {
    setBusy(s._id);
    try {
      await practiceService.declineShare(s._id);
      remove(s._id);
    } catch {
      /* ignore */
    } finally {
      setBusy("");
    }
  };

  if (!incoming.length) return null;

  return (
    <div className="card border-brand-200 p-5 dark:border-brand-900/50">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Inbox className="h-5 w-5 text-brand-600" /> Incoming
        <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{incoming.length}</span>
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Content other users sent you. <b>Accept</b> to save your own copy (you can then practise, edit and keep it); <b>Decline</b> to remove it.
      </p>
      <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {incoming.map((s) => (
          <div key={s._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">{s.title}</p>
              <p className="text-xs text-slate-400">
                from <b className="text-slate-500 dark:text-slate-300">{s.from}</b> · {s.level === "item" ? (s.kind === "test" ? "1 test" : "1 quiz") : `${s.itemCount} ${s.kind === "test" ? "test" : "quiz"}(s) · whole ${s.level}`}
              </p>
            </div>
            {progress[s._id] ? (
              <div className="w-44 flex-shrink-0">
                <div className="mb-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Saving…</span><span>{acceptSharePercent(progress[s._id])}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-brand-600 transition-all duration-300" style={{ width: `${acceptSharePercent(progress[s._id])}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {progress[s._id].questionsSaved}/{progress[s._id].questionsTotal} questions · {progress[s._id].itemsSaved}/{progress[s._id].itemsTotal} {s.kind === "test" ? "tests" : "quizzes"}
                </p>
              </div>
            ) : (
              <div className="flex flex-shrink-0 items-center gap-2">
                <button onClick={() => accept(s)} disabled={busy === s._id} className="btn-primary py-1.5 text-xs disabled:opacity-50">
                  <Check className="h-3.5 w-3.5" /> {busy === s._id ? "Saving…" : s.level === "stream" ? "Accept & save" : "Accept & choose…"}
                </button>
                <button onClick={() => decline(s)} disabled={busy === s._id} className="btn-outline py-1.5 text-xs text-rose-600">Decline</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {placing && (
        <AcceptShareModal
          share={placing}
          onClose={() => setPlacing(null)}
          onDone={() => { remove(placing._id); setPlacing(null); onAccepted?.(); }}
        />
      )}
    </div>
  );
}
