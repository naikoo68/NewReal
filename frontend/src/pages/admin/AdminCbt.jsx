import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MonitorCheck, Users, Eye, ExternalLink, Copy, Check, RefreshCw, Trophy, Clock,
  Loader2, X, Plus, Search, CalendarClock, Trash2, Mail, Medal, Send, Link2, ChevronRight, UserCheck,
} from "lucide-react";
import { cbtService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");
const fmtTime = (s) => {
  const n = Number(s) || 0;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};
// A Date → the value a <input type="datetime-local"> expects (local time).
const toLocalInput = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
};

const STATUS_BADGE = {
  live: { label: "Live", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  off: { label: "Off", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  scheduled: { label: "Scheduled", cls: "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300" },
  ended: { label: "Ended — releasing…", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  awaiting_result: { label: "Awaiting result", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  released: { label: "Results released", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
};

const rankStyle = (r) =>
  r === 1 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    : r === 2 ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
    : r === 3 ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400";

export default function AdminCbt() {
  const [rows, setRows] = useState([]);
  const [portalLink, setPortalLink] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  const [drafts, setDrafts] = useState({}); // id -> datetime-local string
  const [addOpen, setAddOpen] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [accessRow, setAccessRow] = useState(null); // exam whose late-entry allowlist is being edited
  const [board, setBoard] = useState(null); // { row, data, loading }
  const [students, setStudents] = useState(null); // { row, data, loading }

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    // Build the portal link from the browser's own URL so it's always correct
    // (never localhost), regardless of any backend CLIENT_URL config.
    setPortalLink(`${window.location.origin}${window.location.pathname}#/online-exams`);
    cbtService
      .exams()
      .then((r) => {
        const list = Array.isArray(r) ? r : [];
        setRows(list);
        setDrafts(Object.fromEntries(list.map((x) => [x._id, { start: toLocalInput(x.cbtStartAt), entry: toLocalInput(x.cbtEntryCloseAt), end: toLocalInput(x.cbtEndAt), resultMode: x.cbtResultMode === "manual" ? "manual" : "auto", result: toLocalInput(x.cbtResultAt) }])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const copyPortal = async () => {
    try {
      await navigator.clipboard.writeText(portalLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the exam portal link:", portalLink);
    }
  };

  const patch = (id, changes) => setRows((list) => list.map((r) => (r._id === id ? { ...r, ...changes } : r)));

  const toggleLive = async (r) => {
    const next = !r.cbtLive;
    patch(r._id, { cbtLive: next, status: next ? "live" : "off" });
    try {
      await cbtService.update(r._id, { live: next });
    } catch (e) {
      patch(r._id, { cbtLive: r.cbtLive, status: r.status }); // revert
      alert(e.message || "Could not update the live status.");
    }
  };

  const saveSchedule = async (r) => {
    const d = drafts[r._id] || {};
    setBusy(`sch-${r._id}`);
    try {
      const startAt = d.start ? new Date(d.start).toISOString() : "";
      const entryCloseAt = d.entry ? new Date(d.entry).toISOString() : "";
      const endAt = d.end ? new Date(d.end).toISOString() : "";
      const resultMode = d.resultMode === "manual" ? "manual" : "auto";
      const resultAt = resultMode === "manual" && d.result ? new Date(d.result).toISOString() : "";
      const res = await cbtService.update(r._id, { startAt, entryCloseAt, endAt, resultMode, resultAt });
      patch(r._id, { cbtStartAt: res.cbtStartAt, cbtEntryCloseAt: res.cbtEntryCloseAt, cbtEndAt: res.cbtEndAt, cbtResultMode: res.cbtResultMode, cbtResultAt: res.cbtResultAt });
    } catch (e) {
      alert(e.message || "Could not save the schedule.");
    } finally {
      setBusy("");
    }
  };

  const releaseNow = async (r) => {
    if (!window.confirm(`End “${r.name}” now and release results?\nRanks are finalised and every candidate is emailed their scorecard. This can't be undone.`)) return;
    setBusy(`rel-${r._id}`);
    try {
      const res = await cbtService.release(r._id);
      patch(r._id, { cbtResultsReleased: true, cbtLive: false, status: "released" });
      if (res && res.emailConfigured === false) alert("Results released, but email isn't configured — candidates can still view results via their result link.");
    } catch (e) {
      alert(e.message || "Could not release results.");
    } finally {
      setBusy("");
    }
  };

  const removeExam = async (r) => {
    if (!window.confirm(`Remove “${r.name}” from the exam page?\nThe exam stops being listed and can't be taken. Stored attempts & rankings are kept.`)) return;
    setBusy(`rm-${r._id}`);
    try {
      await cbtService.remove(r._id);
      setRows((list) => list.filter((x) => x._id !== r._id));
    } catch (e) {
      alert(e.message || "Could not remove the exam.");
    } finally {
      setBusy("");
    }
  };

  const openBoard = (row) => {
    setBoard({ row, data: null, loading: true });
    cbtService
      .leaderboard(row._id)
      .then((data) => setBoard({ row, data, loading: false }))
      .catch((e) => setBoard({ row, data: { error: e.message, rows: [] }, loading: false }));
  };

  const openStudents = (row) => {
    setStudents({ row, data: null, loading: true });
    cbtService
      .students(row._id)
      .then((data) => setStudents({ row, data, loading: false }))
      .catch((e) => setStudents({ row, data: { error: e.message, rows: [] }, loading: false }));
  };

  const totalCandidates = rows.reduce((s, r) => s + (r.candidates || 0), 0);
  const liveCount = rows.filter((r) => r.status === "live").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <MonitorCheck className="h-6 w-6 text-brand-600" /> Online Exams (CBT)
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            One shareable exam page. Add tests, switch each <b>Live</b> when ready, and set when it ends —
            results (score &amp; rank) are emailed to every candidate only after the exam is over.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="btn-outline">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button onClick={() => setRegOpen(true)} className="btn-outline">
            <Users className="h-4 w-4" /> Candidates
          </button>
          <button onClick={() => setAddOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> Add test
          </button>
        </div>
      </div>

      {/* The single shareable portal link */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"><Link2 className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Share this exam page</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{portalLink}</p>
        </div>
        <a href={portalLink} target="_blank" rel="noreferrer" className="btn-outline py-1.5 text-xs"><ExternalLink className="h-3.5 w-3.5" /> Open</a>
        <button onClick={copyPortal} className="btn-primary py-1.5 text-xs">
          {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy link</>}
        </button>
      </div>

      {/* Summary */}
      {!loading && !error && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card p-4"><p className="text-2xl font-bold text-slate-700 dark:text-slate-200">{rows.length}</p><p className="text-xs text-slate-500">On the page</p></div>
          <div className="card p-4"><p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{liveCount}</p><p className="text-xs text-slate-500">Live now</p></div>
          <div className="card p-4"><p className="text-2xl font-bold text-brand-600 dark:text-brand-400">{rows.reduce((s, r) => s + (r.opens || 0), 0)}</p><p className="text-xs text-slate-500">Total opens</p></div>
          <div className="card p-4"><p className="text-2xl font-bold text-accent-600 dark:text-accent-400">{totalCandidates}</p><p className="text-xs text-slate-500">Candidates</p></div>
        </div>
      )}

      {loading ? (
        <Loading label="Loading online exams..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState message='No exams on the page yet. Tap "Add test" to put one of your My Tests on the exam page.' />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const badge = STATUS_BADGE[r.status] || STATUS_BADGE.off;
            // Only fully lock once results are RELEASED. An "ended" exam (past
            // its end time but not released) stays editable so the admin can
            // extend/clear the end time or toggle it live again.
            const locked = r.cbtResultsReleased;
            return (
              <div key={r._id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badge.cls}`}>{badge.label}</span>
                      <p className="truncate font-bold">{r.name}</p>
                    </div>
                    {r.context && <p className="mt-0.5 text-xs text-slate-400">{r.context}</p>}
                    <p className="mt-0.5 text-xs text-slate-400">
                      {r.questionCount} questions · {r.duration} min · {r.marks} marks
                      {r.lastAttemptAt && ` · last attempt ${fmtDate(r.lastAttemptAt)}`}
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-4">
                    <div className="text-center">
                      <p className="flex items-center gap-1 text-2xl font-extrabold text-brand-600 dark:text-brand-400"><Eye className="h-5 w-5" /> {r.opens ?? 0}</p>
                      <p className="text-[11px] text-slate-500">opened</p>
                    </div>
                    <button onClick={() => openStudents(r)} className="rounded-lg px-1 text-center transition hover:bg-slate-100 dark:hover:bg-slate-800" title="View the status of all joined students">
                      <p className="flex items-center gap-1 text-2xl font-extrabold text-emerald-600 dark:text-emerald-400"><Users className="h-5 w-5" /> {r.candidates}</p>
                      <p className="text-[11px] text-slate-500">candidates</p>
                    </button>
                  </div>
                </div>

                {/* Controls: Live toggle + OTP toggle + start/end schedule */}
                <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.cbtLive}
                        disabled={locked}
                        onClick={() => toggleLive(r)}
                        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${r.cbtLive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"} ${locked ? "opacity-50" : ""}`}
                      >
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${r.cbtLive ? "left-[22px]" : "left-0.5"}`} />
                      </button>
                      Live
                    </label>
                    <span className="text-xs text-slate-400">Candidates register (name + email + OTP) on the portal page.</span>
                  </div>

                  <div className="flex flex-wrap items-end gap-3 text-sm">
                    <div>
                      <label className="mb-0.5 flex items-center gap-1 text-xs text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> Starts (optional)</label>
                      <input
                        type="datetime-local"
                        value={drafts[r._id]?.start || ""}
                        disabled={locked}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r._id]: { ...d[r._id], start: e.target.value } }))}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 flex items-center gap-1 text-xs text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> Late entry until (optional)</label>
                      <input
                        type="datetime-local"
                        value={drafts[r._id]?.entry || ""}
                        disabled={locked}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r._id]: { ...d[r._id], entry: e.target.value } }))}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" /> Ends (exam closes)</label>
                      <input
                        type="datetime-local"
                        value={drafts[r._id]?.end || ""}
                        disabled={locked}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r._id]: { ...d[r._id], end: e.target.value } }))}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
                      />
                    </div>
                  </div>

                  {/* Result declaration — Automatic (at end) or Manual (scheduled timer / button) */}
                  <div className="flex flex-wrap items-end gap-3 text-sm">
                    <div>
                      <span className="mb-0.5 flex items-center gap-1 text-xs text-slate-500"><Trophy className="h-3.5 w-3.5" /> Result declaration</span>
                      <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                        {["auto", "manual"].map((m) => {
                          const active = (drafts[r._id]?.resultMode || "auto") === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              disabled={locked}
                              onClick={() => setDrafts((d) => ({ ...d, [r._id]: { ...d[r._id], resultMode: m } }))}
                              className={`px-3 py-1 text-xs font-semibold transition ${active ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"} ${locked ? "opacity-50" : ""}`}
                            >
                              {m === "auto" ? "Automatic" : "Manual"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {(drafts[r._id]?.resultMode || "auto") === "manual" && (
                      <div>
                        <label className="mb-0.5 flex items-center gap-1 text-xs text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> Declare results at (optional)</label>
                        <input
                          type="datetime-local"
                          value={drafts[r._id]?.result || ""}
                          disabled={locked}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r._id]: { ...d[r._id], result: e.target.value } }))}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
                        />
                      </div>
                    )}
                    {!locked && (
                      toLocalInput(r.cbtStartAt) !== (drafts[r._id]?.start || "") ||
                      toLocalInput(r.cbtEntryCloseAt) !== (drafts[r._id]?.entry || "") ||
                      toLocalInput(r.cbtEndAt) !== (drafts[r._id]?.end || "") ||
                      (r.cbtResultMode || "auto") !== (drafts[r._id]?.resultMode || "auto") ||
                      toLocalInput(r.cbtResultAt) !== (drafts[r._id]?.result || "")
                    ) && (
                      <button onClick={() => saveSchedule(r)} disabled={busy === `sch-${r._id}`} className="btn-primary py-1.5 text-xs">
                        {busy === `sch-${r._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save schedule"}
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-slate-400">
                    <b>Late entry until</b>: the last time a student may <b>start</b> — after it, new students can't enter (those already in keep going, timer ends at the end time). Leave empty to allow entry until the end.
                  </p>
                  <p className="text-xs text-slate-400">
                    {(drafts[r._id]?.resultMode || "auto") === "manual"
                      ? <><b>Manual results</b>: after the exam ends, results stay hidden until the <b>Declare results at</b> time{drafts[r._id]?.result ? "" : " (set one above)"} — or until you click <b>Release results</b> any time.</>
                      : <><b>Automatic results</b>: results are declared as soon as the exam <b>ends</b>{r.cbtEndAt ? "" : " (set an end time above, or switch to Manual)"}.</>}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a href={`#/cbt/exam/${r.cbtToken}`} target="_blank" rel="noreferrer" className="btn-outline py-1.5 text-xs" title="Preview the exam as a candidate">
                    <ExternalLink className="h-3.5 w-3.5" /> Preview
                  </a>
                  <button onClick={() => openStudents(r)} className="btn-outline py-1.5 text-xs" title="Status of all students who joined this exam">
                    <Users className="h-3.5 w-3.5" /> Students
                  </button>
                  <button onClick={() => openBoard(r)} disabled={!r.candidates} className="btn-outline py-1.5 text-xs disabled:opacity-50">
                    <Trophy className="h-3.5 w-3.5" /> Rankings ({r.candidates})
                  </button>
                  <button onClick={() => setAccessRow(r)} className="btn-outline py-1.5 text-xs" title="Grant specific students late-entry access (they can start after the cutoff)">
                    <UserCheck className="h-3.5 w-3.5" /> Late entry access{(r.cbtAllowedEmails || []).length ? ` (${(r.cbtAllowedEmails || []).length})` : ""}
                  </button>
                  {!r.cbtResultsReleased && (
                    <button onClick={() => releaseNow(r)} disabled={busy === `rel-${r._id}`} className="btn-accent py-1.5 text-xs" title="End the exam now and email everyone their scorecard">
                      {busy === `rel-${r._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Release results
                    </button>
                  )}
                  <button onClick={() => removeExam(r)} disabled={busy === `rm-${r._id}`} className="btn-outline py-1.5 text-xs text-rose-600 disabled:opacity-50" title="Remove this exam from the page">
                    {busy === `rm-${r._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addOpen && <AddTestModal onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load(); }} />}
      {regOpen && <RegistrationsModal onClose={() => setRegOpen(false)} />}
      {accessRow && (
        <AccessModal
          row={accessRow}
          onClose={() => setAccessRow(null)}
          onSaved={(res) => { patch(accessRow._id, { cbtRestrictEntry: res.cbtRestrictEntry, cbtAllowedEmails: res.cbtAllowedEmails }); setAccessRow(null); }}
        />
      )}
      {board && <LeaderboardModal board={board} onClose={() => setBoard(null)} />}
      {students && (
        <StudentsModal
          state={students}
          onClose={() => setStudents(null)}
          onReload={() => openStudents(students.row)}
          onAllowedChange={(list) => patch(students.row._id, { cbtAllowedEmails: list })}
        />
      )}
    </div>
  );
}

/* ---------------- Full-screen modal shell (Students / Rankings / Late entry) ----------------
   A modal that fills the screen (edge-to-edge on mobile, a tall centred panel on
   desktop) with a sticky header, a scrollable body, and an optional sticky footer.
   Esc closes it. Used so wide tables and long lists have room to breathe. */
function FullScreenModal({ title, icon, subtitle, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl animate-scale-in dark:bg-slate-900 sm:mx-auto sm:max-w-6xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-bold sm:text-lg">{icon}<span className="truncate">{title}</span></h3>
            {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Close (Esc)"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
        {footer && <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">{footer}</div>}
      </div>
    </div>
  );
}

/* -------- Late-entry access modal: grant specific students late entry -------- */
function AccessModal({ row, onClose, onSaved }) {
  const [restrict, setRestrict] = useState(!!row.cbtRestrictEntry);
  const [text, setText] = useState((row.cbtAllowedEmails || []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const emailCount = [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))].length;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await cbtService.update(row._id, { restrictEntry: restrict, allowedEmails: text });
      onSaved(res);
    } catch (e) {
      setError(e.message || "Could not save.");
      setBusy(false);
    }
  };

  return (
    <FullScreenModal
      onClose={onClose}
      icon={<UserCheck className="h-5 w-5 text-brand-600" />}
      title={`Late entry access — ${row.name}`}
      footer={
        <div className="mx-auto flex w-full max-w-2xl items-center justify-end gap-2">
          <button onClick={onClose} className="btn-outline">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />} {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Students listed here can <b>start this exam even after the “Late entry until” cutoff</b> has passed — use it to re-admit someone who joined late. (They still can't start once the exam has <b>ended</b>.)
        </p>

        <label className="mb-1 block text-sm font-semibold">
          Emails with late-entry access <span className="font-normal text-slate-400">({emailCount})</span>
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="one@example.com&#10;two@example.com&#10;…  (or paste comma-separated)"
          className="min-h-[160px] w-full flex-1 rounded-xl border border-slate-200 p-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-800"
        />
        <p className="mt-1 text-xs text-slate-400">One email per line (commas/spaces also work). Invalid entries are ignored. Tip: you can also grant access to one student from the <b>Students</b> list.</p>

        <div className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
          <label className="flex items-center gap-2 text-sm font-medium">
            <button
              type="button"
              role="switch"
              aria-checked={restrict}
              onClick={() => setRestrict((v) => !v)}
              className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${restrict ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-600"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${restrict ? "left-[22px]" : "left-0.5"}`} />
            </button>
            Make this exam private (only these emails can take it)
          </label>
          <p className="mt-1 text-xs text-slate-400">
            {restrict ? "Only the emails above can register/take this exam — others won't see it." : "Anyone who registers on the portal can take this exam; the list above only grants late entry."}
          </p>
        </div>

        {error && <p className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
      </div>
    </FullScreenModal>
  );
}

/* ---------------- Registered candidates modal ---------------- */
function RegistrationsModal({ onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [deleting, setDeleting] = useState("");

  useEffect(() => {
    setLoading(true);
    cbtService
      .registrations()
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const del = async (r) => {
    if (!window.confirm(`Remove candidate "${r.name}" (${r.email})?\nTheir sign-in is removed (they'd have to register again). Their exam results are kept.`)) return;
    setDeleting(r._id);
    try {
      await cbtService.deleteRegistration(r._id);
      setRows((list) => list.filter((x) => x._id !== r._id));
    } catch (e) {
      alert(e.message || "Could not remove the candidate.");
    } finally {
      setDeleting("");
    }
  };

  const filtered = rows.filter((r) => `${r.name} ${r.email}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-10 w-full max-w-3xl animate-scale-in card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Users className="h-5 w-5 text-brand-600" /> Registered candidates ({rows.length})</h3>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700">
          <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="w-full bg-transparent py-2 text-sm outline-none" />
          {q && <button onClick={() => setQ("")} className="flex-shrink-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : error ? (
          <ErrorState message={error} />
        ) : filtered.length === 0 ? (
          <EmptyState message={rows.length === 0 ? "No one has registered yet." : `No candidates match “${q}”.`} />
        ) : (
          <div className="max-h-[55vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="px-3 py-2 text-left font-semibold">Name</th>
                  <th className="px-3 py-2 text-left font-semibold">Email</th>
                  <th className="px-3 py-2 text-left font-semibold">Verified</th>
                  <th className="px-3 py-2 text-left font-semibold">Exams</th>
                  <th className="px-3 py-2 text-left font-semibold">Registered</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r._id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-3 py-2 font-semibold">{r.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{r.email}</td>
                    <td className="px-3 py-2">
                      {r.verified
                        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Yes</span>
                        : <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">No</span>}
                    </td>
                    <td className="px-3 py-2">{r.examsTaken}</td>
                    <td className="px-3 py-2 text-slate-500">{fmtDate(r.registeredAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => del(r)} disabled={deleting === r._id} className="btn-outline py-1 text-xs text-rose-600 disabled:opacity-50" title="Remove candidate">
                        {deleting === r._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">Removing a candidate clears their portal sign-in only — their submitted exam results and rankings are kept.</p>
      </div>
    </div>
  );
}

/* ---------------- Add-test modal: put a My Test on the exam page ----------------
   Drill down the full My Test route: Stream → Subject → Test. */
const gid = (x) => (x && x.id ? String(x.id) : "none");
const gname = (x) => (x && x.name ? x.name : "Uncategorized");
function uniqueBy(rows, keyFn, nameFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, nameFn(r)); }
  return [...m.entries()].map(([id, name]) => ({ id, name }));
}

function AddTestModal({ onClose, onAdded }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [streamId, setStreamId] = useState(""); // selected stream
  const [subjectId, setSubjectId] = useState(""); // selected subject
  const [q, setQ] = useState(""); // optional search across all My Tests
  const [adding, setAdding] = useState("");

  useEffect(() => {
    setLoading(true);
    cbtService
      .candidates()
      .then((r) => setItems(Array.isArray(r) ? r : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const add = async (item) => {
    setAdding(item._id);
    try {
      await cbtService.add(item._id);
      onAdded();
    } catch (e) {
      alert(e.message || "Could not add this test.");
      setAdding("");
    }
  };

  const streams = useMemo(() => uniqueBy(items, (t) => gid(t.stream), (t) => gname(t.stream)), [items]);
  const subjects = useMemo(
    () => uniqueBy(items.filter((t) => gid(t.stream) === streamId), (t) => gid(t.subject), (t) => gname(t.subject)),
    [items, streamId]
  );
  const searching = q.trim().length > 0;
  const shownTests = useMemo(() => {
    if (searching) return items.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
    if (!streamId || !subjectId) return [];
    return items.filter((t) => gid(t.stream) === streamId && gid(t.subject) === subjectId);
  }, [items, streamId, subjectId, q, searching]);

  const TestRow = (i) => (
    <div key={i._id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="min-w-0">
        <p className="truncate font-semibold">{i.name}</p>
        <p className="text-xs text-slate-400">{i.context && `${i.context} · `}{i.questionCount} questions · {i.duration} min</p>
      </div>
      {i.cbtEnabled ? (
        <span className="flex-shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">On the page</span>
      ) : (
        <button onClick={() => add(i)} disabled={adding === i._id || !i.questionCount} className="btn-primary flex-shrink-0 py-1.5 text-xs disabled:opacity-50" title={!i.questionCount ? "Add questions first" : "Add to the exam page"}>
          {adding === i._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
        </button>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-10 w-full max-w-2xl animate-scale-in card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Plus className="h-5 w-5 text-brand-600" /> Add a test to the exam page</h3>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        {/* Optional global search (skips the drill-down) */}
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700">
          <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all My Tests by name…" className="w-full bg-transparent py-2 text-sm outline-none" />
          {q && <button onClick={() => setQ("")} className="flex-shrink-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : error ? (
          <ErrorState message={error} />
        ) : items.length === 0 ? (
          <EmptyState message="No My Tests found. Create a My Test (with questions) first." />
        ) : searching ? (
          <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
            {shownTests.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No My Tests match “{q}”.</p>
            ) : shownTests.map(TestRow)}
          </div>
        ) : (
          <>
            {/* Breadcrumb of the current drill-down path */}
            <div className="mb-3 flex flex-wrap items-center gap-1 text-xs text-slate-500">
              <button onClick={() => { setStreamId(""); setSubjectId(""); }} className={`rounded px-1.5 py-0.5 ${!streamId ? "font-bold text-brand-600" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>Stream</button>
              <ChevronRight className="h-3 w-3" />
              <span className={subjectId ? "" : streamId ? "font-bold text-brand-600" : "opacity-50"}>Subject</span>
              <ChevronRight className="h-3 w-3" />
              <span className={subjectId ? "font-bold text-brand-600" : "opacity-50"}>Test</span>
            </div>

            {/* Level 1: Stream */}
            {!streamId && (
              <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                {streams.map((s) => (
                  <button key={s.id} onClick={() => { setStreamId(s.id); setSubjectId(""); }} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-brand-300 dark:border-slate-700">
                    <span className="font-semibold">{s.name}</span>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            )}

            {/* Level 2: Subject */}
            {streamId && !subjectId && (
              <>
                <button onClick={() => setStreamId("")} className="mb-2 text-sm text-brand-600 hover:underline">← Back to streams</button>
                <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                  {subjects.map((s) => (
                    <button key={s.id} onClick={() => setSubjectId(s.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-brand-300 dark:border-slate-700">
                      <span className="font-semibold">{s.name}</span>
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Level 3: Tests */}
            {streamId && subjectId && (
              <>
                <button onClick={() => setSubjectId("")} className="mb-2 text-sm text-brand-600 hover:underline">← Back to subjects</button>
                <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                  {shownTests.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">No tests here yet.</p>
                  ) : shownTests.map(TestRow)}
                </div>
              </>
            )}
          </>
        )}

        <p className="mt-3 text-xs text-slate-400">After adding, switch it <b>Live</b> and set an end time on the exam list.</p>
      </div>
    </div>
  );
}

/* ---------------- Leaderboard modal: all candidates ranked ---------------- */
function LeaderboardModal({ board, onClose }) {
  const rows = board.data?.rows || [];
  return (
    <FullScreenModal onClose={onClose} icon={<Trophy className="h-5 w-5 text-amber-500" />} title={`Rankings — ${board.row.name}`}>
      {board.loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : board.data?.error ? (
        <ErrorState message={board.data.error} />
      ) : rows.length === 0 ? (
        <EmptyState message="No candidates have completed this exam yet." />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500">
            {board.data.candidates} candidate{board.data.candidates === 1 ? "" : "s"} · {board.data.totalAttempts} attempt{board.data.totalAttempts === 1 ? "" : "s"} (best attempt per student)
            {!board.data.resultsReleased && <span className="ml-1 text-amber-600 dark:text-amber-400">· not yet released to candidates</span>}
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="px-3 py-2 text-left font-semibold">Rank</th>
                  <th className="px-3 py-2 text-left font-semibold">Name</th>
                  <th className="px-3 py-2 text-left font-semibold">Email</th>
                  <th className="px-3 py-2 text-left font-semibold">Score</th>
                  <th className="px-3 py-2 text-left font-semibold">%</th>
                  <th className="px-3 py-2 text-left font-semibold">Correct</th>
                  <th className="px-3 py-2 text-left font-semibold">Time</th>
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.email + a.rank} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-3 py-2">
                      <span className={`inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-full px-2 text-xs font-bold ${rankStyle(a.rank)}`}>
                        {a.rank <= 3 && <Medal className="h-3 w-3" />}{a.rank}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-semibold">{a.name}</td>
                    <td className="px-3 py-2 text-slate-500"><span className="inline-flex items-center gap-1"><Mail className="h-3 w-3 text-slate-400" />{a.email}</span></td>
                    <td className="px-3 py-2 font-semibold">{a.score}{a.maxScore != null ? ` / ${a.maxScore}` : ""}</td>
                    <td className="px-3 py-2">{a.percentage}%</td>
                    <td className="px-3 py-2">{a.correct}/{a.totalQ}</td>
                    <td className="px-3 py-2 tabular-nums"><Clock className="mr-1 inline h-3 w-3 text-slate-400" />{fmtTime(a.timeTaken)}</td>
                    <td className="px-3 py-2 text-slate-500">{fmtDate(a.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </FullScreenModal>
  );
}


/* ---------------- Students modal: status of everyone who joined ---------------- */
const STUDENT_STATUS = {
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  in_progress: { label: "In progress", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  not_started: { label: "Not started", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
};

function StudentsModal({ state, onClose, onReload, onAllowedChange }) {
  const { row, data, loading } = state;
  const [q, setQ] = useState("");
  const [busyEmail, setBusyEmail] = useState("");
  const rows = data?.rows || [];
  const counts = data?.counts || { total: 0, completed: 0, inProgress: 0, notStarted: 0 };

  const filtered = rows.filter((r) => `${r.name} ${r.email}`.toLowerCase().includes(q.trim().toLowerCase()));

  const setLate = async (r, allow) => {
    setBusyEmail(r.email);
    try {
      const res = await cbtService.grantLateEntry(row._id, r.email, allow);
      onAllowedChange(res.cbtAllowedEmails || []);
      onReload();
    } catch (e) {
      alert(e.message || "Could not update late-entry access.");
    } finally {
      setBusyEmail("");
    }
  };

  return (
    <FullScreenModal onClose={onClose} icon={<Users className="h-5 w-5 text-brand-600" />} title={`Students — ${row.name}`}>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : data?.error ? (
          <ErrorState message={data.error} />
        ) : rows.length === 0 ? (
          <EmptyState message="No students have joined this exam yet." />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{counts.completed} completed</span>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{counts.inProgress} in progress</span>
              <span className="rounded-full bg-slate-200 px-2.5 py-1 font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{counts.notStarted} not started</span>
            </div>

            <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700">
              <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="w-full bg-transparent py-2 text-sm outline-none" />
              {q && <button onClick={() => setQ("")} className="flex-shrink-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}
            </div>

            {filtered.length === 0 ? (
              <EmptyState message={`No students match “${q}”.`} />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                      <th className="px-3 py-2 text-left font-semibold">Name</th>
                      <th className="px-3 py-2 text-left font-semibold">Email</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-left font-semibold">Score</th>
                      <th className="px-3 py-2 text-left font-semibold">Late entry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const st = STUDENT_STATUS[r.status] || STUDENT_STATUS.not_started;
                      return (
                        <tr key={r.email} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                          <td className="px-3 py-2 font-semibold">{r.name || "—"}</td>
                          <td className="px-3 py-2 text-slate-500"><span className="inline-flex items-center gap-1"><Mail className="h-3 w-3 text-slate-400" />{r.email}</span></td>
                          <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span></td>
                          <td className="px-3 py-2">{r.status === "completed" ? `${r.score}${r.maxScore != null ? ` / ${r.maxScore}` : ""} (${r.percentage}%)` : "—"}</td>
                          <td className="px-3 py-2">
                            {r.status === "completed" ? (
                              r.lateEntryAccess ? <span className="text-xs text-slate-400">granted</span> : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                            ) : r.lateEntryAccess ? (
                              <button onClick={() => setLate(r, false)} disabled={busyEmail === r.email} className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 dark:bg-emerald-900/40 dark:text-emerald-300" title="Granted — click to revoke">
                                {busyEmail === r.email ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Granted
                              </button>
                            ) : (
                              <button onClick={() => setLate(r, true)} disabled={busyEmail === r.email} className="btn-outline py-1 text-xs disabled:opacity-50" title="Let this student start even after the late-entry cutoff">
                                {busyEmail === r.email ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />} Grant late entry
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-400">
              <b>Completed</b> = submitted · <b>In progress</b> = started, not submitted yet · <b>Not started</b> = granted access but hasn't begun. “Grant late entry” lets a student start even after the <b>Late entry until</b> cutoff.
            </p>
          </>
        )}
    </FullScreenModal>
  );
}
