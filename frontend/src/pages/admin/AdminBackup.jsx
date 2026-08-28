import { useRef, useState } from "react";
import { DatabaseBackup, Download, Upload, Loader2, AlertTriangle, CheckCircle2, HardDriveUpload, HardDriveDownload, Save, X } from "lucide-react";
import { adminBackupService } from "../../services";
import { useSettings } from "../../context/SettingsContext";
import { getAccessToken, uploadBackup, listBackups, downloadBackup } from "../../lib/googleDrive";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Turn an account/brand name into a safe filename prefix.
const safeName = (s) => String(s || "").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "backup";
const fmtWhen = (d) => { try { return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };

// Full content-library backup & restore for the admin: Content
// (streams→subjects→topics→sessions→quizzes→questions), Study Material and
// Test Series. Backups download as a file OR upload straight to Google Drive.
// Both run as background jobs with a live % progress bar.
export default function AdminBackup() {
  const { settings, save } = useSettings();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(""); // "" | "backup" | "restore" | "drive-backup" | "drive-restore"
  const [progress, setProgress] = useState(null); // { done, total, phase }
  const [msg, setMsg] = useState(null); // { ok, text }
  const [driveFiles, setDriveFiles] = useState(null); // [] shown when picking a Drive backup to restore

  // Google Drive Client ID editor (admin pastes the Client ID from Google Cloud).
  const [clientId, setClientId] = useState(settings?.googleClientId || "");
  const [savingId, setSavingId] = useState(false);
  const driveReady = !!(settings?.googleClientId || "").trim();

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  // Dated name for downloaded files (each is a separate copy the user keeps).
  const filename = () => `${safeName(settings?.siteName)}-content-backup-${new Date().toISOString().slice(0, 10)}.json`;
  // Stable name for Google Drive so each backup UPDATES the same file (WhatsApp-style).
  const driveFilename = () => `${safeName(settings?.siteName)}-content-backup.json`;

  const saveClientId = async () => {
    setSavingId(true); setMsg(null);
    try {
      await save({ googleClientId: clientId.trim() });
      setMsg({ ok: true, text: clientId.trim() ? "Google Drive is now connected. You can back up & restore to Drive below." : "Google Drive Client ID cleared." });
    } catch (e) {
      setMsg({ ok: false, text: e?.message || "Couldn't save the Client ID." });
    } finally { setSavingId(false); }
  };

  // Run the backup job and return the full backup JSON (shared by file + Drive).
  const runBackupJob = async () => {
    const { jobId, total } = await adminBackupService.start();
    setProgress({ done: 0, total: total || 0, phase: "Starting…" });
    let st;
    for (;;) {
      await sleep(800);
      st = await adminBackupService.job(jobId);
      setProgress({ done: st.done || 0, total: st.total || total || 0, phase: st.phase || "" });
      if (st.status === "done") break;
      if (st.status === "error") throw new Error(st.error || "Backup failed.");
    }
    return adminBackupService.file(jobId);
  };

  const summarizeBackup = (data, where) => {
    const c = data?.counts || {};
    const totalQ = (c.contentQuestions || 0) + (c.testQuestions || 0) + (c.practiceQuestions || 0);
    return `Backed up ${c.quizzes || 0} quizzes, ${totalQ} questions, ${c.series || 0} test series, ${c.practiceItems || 0} My Practice items and ${c.smFiles || 0} study files. ${where}`;
  };

  // Run a restore job from a parsed backup object (shared by file + Drive).
  const runRestoreJob = async (parsed) => {
    const { jobId, total } = await adminBackupService.startRestore(parsed);
    setProgress({ done: 0, total: total || 0, phase: "Starting…" });
    let st;
    for (;;) {
      await sleep(800);
      st = await adminBackupService.restoreJob(jobId);
      setProgress({ done: st.done || 0, total: st.total || total || 0, phase: st.phase || "" });
      if (st.status === "done") break;
      if (st.status === "error") throw new Error(st.error || "Restore failed.");
    }
    const r = st.result || {};
    const totalQ = (r.questions || 0) + (r.practiceQuestions || 0);
    return `Restore complete. Added ${r.quizzes || 0} quizzes, ${totalQ} questions, ${r.series || 0} test series, ${r.practiceItems || 0} My Practice items, ${r.smFiles || 0} study files (existing items were reused, not duplicated).`;
  };

  // ---- Download to a file ----
  const backup = async () => {
    setBusy("backup"); setMsg(null); setProgress({ done: 0, total: 0, phase: "Starting…" });
    try {
      const data = await runBackupJob();
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename();
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: summarizeBackup(data, "Save this file somewhere safe (e.g. Google Drive).") });
    } catch (e) {
      setMsg({ ok: false, text: e?.message || "Backup failed — please try again." });
    } finally { setBusy(""); setProgress(null); }
  };

  const onRestoreFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm("Restore MERGES this backup into your live content: it re-creates anything that's missing and reuses items that already exist (matched by name). It never deletes. Continue?")) return;
    setBusy("restore"); setMsg(null); setProgress({ done: 0, total: 0, phase: "Reading file…" });
    try {
      let parsed;
      try { parsed = JSON.parse(await file.text()); }
      catch { throw new Error("That file isn't a valid backup file."); }
      const text = await runRestoreJob(parsed);
      setMsg({ ok: true, text });
    } catch (err) {
      setMsg({ ok: false, text: err?.message || "Restore failed — please check the file and try again." });
    } finally { setBusy(""); setProgress(null); }
  };

  // ---- Google Drive ----
  const backupToDrive = async () => {
    setBusy("drive-backup"); setMsg(null); setProgress({ done: 0, total: 0, phase: "Connecting to Google Drive…" });
    try {
      const token = await getAccessToken(settings?.googleClientId);
      const data = await runBackupJob();
      setProgress((p) => ({ ...(p || {}), phase: "Uploading to Google Drive…" }));
      const up = await uploadBackup(token, driveFilename(), data);
      const where = up?.updated
        ? `Updated your single backup in Google Drive → "My Study Guide Backups" folder (always kept current).`
        : `Saved to your Google Drive → "My Study Guide Backups" folder.`;
      setMsg({ ok: true, text: summarizeBackup(data, where) });
    } catch (e) {
      setMsg({ ok: false, text: e?.message || "Google Drive backup failed — please try again." });
    } finally { setBusy(""); setProgress(null); }
  };

  const openDrivePicker = async () => {
    setBusy("drive-restore"); setMsg(null); setDriveFiles(null); setProgress({ done: 0, total: 0, phase: "Connecting to Google Drive…" });
    try {
      const token = await getAccessToken(settings?.googleClientId);
      const files = await listBackups(token);
      if (!files.length) { setMsg({ ok: false, text: "No backups found in your Google Drive yet. Create one with \"Back up to Google Drive\" first." }); return; }
      setDriveFiles(files.map((f) => ({ ...f, token })));
    } catch (e) {
      setMsg({ ok: false, text: e?.message || "Couldn't open Google Drive — please try again." });
    } finally { setProgress(null); setBusy(""); }
  };

  const restoreFromDrive = async (file) => {
    if (!window.confirm(`Restore "${file.name}" from Google Drive? This MERGES it into your live content (re-creates missing items, reuses existing ones by name). It never deletes. Continue?`)) return;
    setDriveFiles(null);
    setBusy("drive-restore"); setMsg(null); setProgress({ done: 0, total: 0, phase: "Downloading from Google Drive…" });
    try {
      const parsed = await downloadBackup(file.token, file.id);
      const text = await runRestoreJob(parsed);
      setMsg({ ok: true, text });
    } catch (e) {
      setMsg({ ok: false, text: e?.message || "Google Drive restore failed — please try again." });
    } finally { setBusy(""); setProgress(null); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
          <DatabaseBackup className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold leading-none">Backup &amp; Restore</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Save your entire content library — as a file or straight to Google Drive — and restore it anytime.</p>
        </div>
      </div>

      <div className="card mt-5 p-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This backs up <b>everything</b>: quiz content (streams, subjects, topics, sessions, quizzes &amp; questions), study material, test series, and <b>My Practice</b> — all with their questions.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button onClick={backup} disabled={!!busy} className="btn-primary flex-1">
            {busy === "backup" ? <><Loader2 className="h-4 w-4 animate-spin" /> Backing up…</> : <><Download className="h-4 w-4" /> Back up to a file</>}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="btn-outline flex-1">
            {busy === "restore" ? <><Loader2 className="h-4 w-4 animate-spin" /> Restoring…</> : <><Upload className="h-4 w-4" /> Restore from a file</>}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onRestoreFile} />
        </div>

        {/* Google Drive actions (only when a Client ID is configured) */}
        {driveReady && (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <button onClick={backupToDrive} disabled={!!busy} className="btn-outline flex-1">
              {busy === "drive-backup" ? <><Loader2 className="h-4 w-4 animate-spin" /> Backing up to Drive…</> : <><HardDriveUpload className="h-4 w-4" /> Back up to Google Drive</>}
            </button>
            <button onClick={openDrivePicker} disabled={!!busy} className="btn-outline flex-1">
              {busy === "drive-restore" ? <><Loader2 className="h-4 w-4 animate-spin" /> Working…</> : <><HardDriveDownload className="h-4 w-4" /> Restore from Google Drive</>}
            </button>
          </div>
        )}

        {/* Drive backup picker */}
        {driveFiles && (
          <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
              <p className="text-sm font-semibold">Choose a backup to restore</p>
              <button onClick={() => setDriveFiles(null)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
            <ul className="max-h-64 overflow-auto">
              {driveFiles.map((f) => (
                <li key={f.id}>
                  <button onClick={() => restoreFromDrive(f)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <span className="truncate">{f.name}</span>
                    <span className="flex-shrink-0 text-xs text-slate-400">{fmtWhen(f.modifiedTime)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {progress && (
          <div className="mt-4">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-brand-600 transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {progress.phase}{progress.total ? ` — ${pct}% · ${progress.done} / ${progress.total}` : ""}
            </p>
          </div>
        )}

        {msg && (
          <div className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300" : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300"}`}>
            {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}

        <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <b>How restore works:</b> it <b>merges</b> — anything missing is re-created, and items that already exist (matched by name) are reused, so it never duplicates your structure or deletes anything. Study-material files are stored as links, so the original files must still exist online.
        </div>
      </div>

      {/* Google Drive connection settings */}
      <div className="card mt-4 p-5">
        <h2 className="text-sm font-bold">Google Drive connection</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Paste your Google OAuth <b>Client ID</b> (from Google Cloud Console) to turn on the "Back up / Restore to Google Drive" buttons — for both admins and clients. It's not a password; it's safe to store here. Leave blank to hide the Drive buttons.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="123456789-abcdefg.apps.googleusercontent.com"
            className="input flex-1 font-mono text-xs"
          />
          <button onClick={saveClientId} disabled={savingId || clientId.trim() === (settings?.googleClientId || "").trim()} className="btn-primary">
            {savingId ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> Save</>}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Status: {driveReady ? <span className="font-semibold text-emerald-600">Connected ✓</span> : <span className="font-semibold text-slate-500">Not connected</span>}
        </p>
      </div>
    </div>
  );
}
