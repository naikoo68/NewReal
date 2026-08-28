import { useEffect, useRef, useState } from "react";
import { AlarmClock, ShieldCheck, Clock, Crown, Gift, Copy, Sparkles, User, Download, Upload, Loader2, HardDriveUpload, HardDriveDownload, X } from "lucide-react";
import { authService, practiceService } from "../../services";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";
import { getAccessToken, uploadBackup, listBackups, downloadBackup as driveDownloadBackup } from "../../lib/googleDrive";
import Badge from "../../components/ui/Badge";
import ProfilePhotoCard from "../../components/ui/ProfilePhotoCard";
import ProfileEditCard from "../../components/ui/ProfileEditCard";

const fmtWhen = (d) => { try { return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };

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

// The client's account details — name, email, validity, plan and referral.
// Moved off the dashboard into its own "Account" menu item so the dashboard
// stays focused on content; opened from the workspace hamburger menu.
export default function ClientAccount({ onUpgrade }) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const [planInfo, setPlanInfo] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user?.subscriptionPlan) { setPlanInfo(null); return; }
    authService
      .plans()
      .then((r) => setPlanInfo((r?.plans || []).find((p) => p.key === user.subscriptionPlan) || null))
      .catch(() => {});
  }, [user?.subscriptionPlan]);

  const expired = isExpired(user?.expiresAt);

  const copyReferral = () => {
    if (!user?.referralCode) return;
    navigator.clipboard?.writeText(user.referralCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  // ---- Back up / Restore my own My Practice content (with live progress) ----
  const fileRef = useRef(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [progress, setProgress] = useState(null); // { done, total, phase } while an op runs
  const [driveFiles, setDriveFiles] = useState(null); // Drive backups to pick from when restoring
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const driveReady = !!(settings?.googleClientId || "").trim();

  const acctSlug = () => String(user?.name || "").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "my";
  // Dated name for downloaded file copies.
  const backupName = () => `${acctSlug()}-practice-backup-${new Date().toISOString().slice(0, 10)}.json`;
  // Stable name for Google Drive so each backup UPDATES the same file (WhatsApp-style).
  const driveBackupName = () => `${acctSlug()}-practice-backup.json`;

  // Run the backup job → returns the full backup JSON (shared by file + Drive).
  const runBackupJob = async () => {
    const { jobId, total } = await practiceService.startBackup();
    setProgress({ done: 0, total: total || 0, phase: "Backing up" });
    let st;
    for (;;) {
      await sleep(700);
      st = await practiceService.backupJob(jobId);
      setProgress({ done: st.done || 0, total: st.total || total || 0, phase: "Backing up" });
      if (st.status === "done") break;
      if (st.status === "error") throw new Error(st.error || "Backup failed.");
    }
    return practiceService.backupFile(jobId);
  };

  // Run a restore job from a parsed backup object (shared by file + Drive).
  const runRestoreJob = async (parsed) => {
    // If this is an admin backup, automatically extract just the My Practice
    // section and restore that — so clients can use either backup format.
    let data = parsed;
    if (parsed.format === "mystudyguide-admin-backup") {
      const p = parsed.practice || {};
      if (!p.streams?.length && !p.items?.length) {
        throw new Error("This admin backup has no My Practice content to restore.");
      }
      data = {
        format: "mystudyguide-practice-backup",
        streams: p.streams || [],
        subjects: p.subjects || [],
        topics: p.topics || [],
        items: p.items || [],
        questions: p.questions || [],
      };
    }
    const { jobId, total } = await practiceService.startRestore(data) || {};
    if (!jobId) throw new Error("Restore failed to start — the server may have rejected the file. Make sure it's a valid backup.");
    setProgress({ done: 0, total: total || 0, phase: "Restoring" });
    let st;
    for (;;) {
      await sleep(700);
      st = await practiceService.restoreJob(jobId);
      setProgress({ done: st.done || 0, total: st.total || total || 0, phase: "Restoring" });
      if (st.status === "done") break;
      if (st.status === "error") throw new Error(st.error || "Restore failed.");
    }
    const r = st.result || {};
    return `✓ Restored ${r.items || 0} item(s) and ${r.questions || 0} question(s). Open My Practice (refresh) to see them.`;
  };

  const downloadBackup = async () => {
    setBackupBusy(true); setBackupMsg(""); setProgress({ done: 0, total: 0, phase: "Backing up" });
    try {
      const data = await runBackupJob();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = backupName();
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      const c = data?.counts || {};
      setBackupMsg(`✓ Backed up ${c.items || 0} item(s) and ${c.questions || 0} question(s). Now save this file to your Google Drive.`);
    } catch (e) {
      setBackupMsg(e?.message || "Backup failed — please try again.");
    } finally { setBackupBusy(false); setProgress(null); }
  };

  const onRestoreFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!window.confirm("Restore will ADD everything from this backup to your account (it does not delete or replace what you already have). Continue?")) return;
    setRestoreBusy(true); setBackupMsg(""); setProgress({ done: 0, total: 0, phase: "Restoring" });
    try {
      let parsed;
      try { parsed = JSON.parse(await file.text()); }
      catch { throw new Error("That file isn't a valid backup file."); }
      setBackupMsg(await runRestoreJob(parsed));
    } catch (err) {
      setBackupMsg(err?.message || "Restore failed — please check the file and try again.");
    } finally { setRestoreBusy(false); setProgress(null); }
  };

  // ---- Google Drive ----
  const backupToDrive = async () => {
    setBackupBusy(true); setBackupMsg(""); setProgress({ done: 0, total: 0, phase: "Connecting to Google Drive…" });
    try {
      const token = await getAccessToken(settings?.googleClientId);
      const data = await runBackupJob();
      setProgress((p) => ({ ...(p || {}), phase: "Uploading to Google Drive…" }));
      const up = await uploadBackup(token, driveBackupName(), data);
      const c = data?.counts || {};
      const tail = up?.updated ? "updated your single Google Drive backup (always kept current)" : "saved to your Google Drive";
      setBackupMsg(`✓ Backed up ${c.items || 0} item(s) and ${c.questions || 0} question(s) — ${tail}.`);
    } catch (e) {
      setBackupMsg(e?.message || "Google Drive backup failed — please try again.");
    } finally { setBackupBusy(false); setProgress(null); }
  };

  const openDrivePicker = async () => {
    setRestoreBusy(true); setBackupMsg(""); setDriveFiles(null); setProgress({ done: 0, total: 0, phase: "Connecting to Google Drive…" });
    try {
      const token = await getAccessToken(settings?.googleClientId);
      const files = await listBackups(token);
      if (!files.length) { setBackupMsg("No backups found in your Google Drive yet. Create one with \"Back up to Google Drive\" first."); return; }
      setDriveFiles(files.map((f) => ({ ...f, token })));
    } catch (e) {
      setBackupMsg(e?.message || "Couldn't open Google Drive — please try again.");
    } finally { setProgress(null); setRestoreBusy(false); }
  };

  const restoreFromDrive = async (file) => {
    if (!window.confirm(`Restore "${file.name}" from Google Drive? This ADDS everything from it to your account (it never deletes or replaces what you have). Continue?`)) return;
    setDriveFiles(null);
    setRestoreBusy(true); setBackupMsg(""); setProgress({ done: 0, total: 0, phase: "Downloading from Google Drive…" });
    try {
      const parsed = await driveDownloadBackup(file.token, file.id);
      setBackupMsg(await runRestoreJob(parsed));
    } catch (e) {
      setBackupMsg(e?.message || "Google Drive restore failed — please try again.");
    } finally { setRestoreBusy(false); setProgress(null); }
  };

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* Profile */}
      <div className="card p-5 sm:col-span-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <User className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold leading-none">{user?.name || "there"}</h1>
            <p className="mt-0.5 text-sm text-slate-400">{user?.email}</p>
          </div>
        </div>
        {user?.referralCode && (
          <>
            <div className="mt-4">
              <button
                onClick={copyReferral}
                title="Copy your referral code to share with friends"
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-300"
              >
                <Gift className="h-4 w-4" />
                Refer a friend: <span className="font-bold tracking-wide">{user.referralCode}</span>
                {copied ? <span className="text-emerald-600">Copied!</span> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Share your code — for every friend who buys a plan, you get <b className="text-emerald-600">10 free days</b> added automatically.
            </p>
          </>
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

      {/* Editable details — name, email, phone */}
      <ProfileEditCard className="sm:col-span-3" />

      {/* Profile photo */}
      <ProfilePhotoCard className="sm:col-span-3" />

      {/* Back up & Restore my content */}
      <div className="card p-5 sm:col-span-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <Download className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-bold">Back up &amp; restore my content</h2>
            <p className="mt-0.5 text-xs text-slate-400">Download all your My Practice content as a file, keep it in your Google Drive, and restore it anytime.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button onClick={downloadBackup} disabled={backupBusy || restoreBusy} className="btn-outline flex-1">
            {backupBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Backing up…</> : <><Download className="h-4 w-4" /> Back up to a file</>}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={backupBusy || restoreBusy} className="btn-outline flex-1">
            {restoreBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Restoring…</> : <><Upload className="h-4 w-4" /> Restore from a file</>}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onRestoreFile} />
        </div>
        {driveReady && (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <button onClick={backupToDrive} disabled={backupBusy || restoreBusy} className="btn-outline flex-1">
              {backupBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Working…</> : <><HardDriveUpload className="h-4 w-4" /> Back up to Google Drive</>}
            </button>
            <button onClick={openDrivePicker} disabled={backupBusy || restoreBusy} className="btn-outline flex-1">
              {restoreBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Working…</> : <><HardDriveDownload className="h-4 w-4" /> Restore from Google Drive</>}
            </button>
          </div>
        )}
        {driveFiles && (
          <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
              <p className="text-sm font-semibold">Choose a backup to restore</p>
              <button onClick={() => setDriveFiles(null)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
            <ul className="max-h-56 overflow-auto">
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
          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-brand-600 transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {progress.phase || (backupBusy ? "Backing up" : "Restoring")}… {progress.total ? `${pct}% · ${progress.done} / ${progress.total}` : ""}
            </p>
          </div>
        )}
        {backupMsg && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{backupMsg}</p>}
        <p className="mt-2 text-xs text-slate-400">
          {driveReady
            ? <>Use <b>Back up to Google Drive</b> to save straight to your own Google Drive (a "My Study Guide Backups" folder), then <b>Restore from Google Drive</b> to bring it back on any device. You can also back up to a file. Restoring <b>adds a fresh copy</b> — it never overwrites what you already have.</>
            : <>Click <b>Back up to a file</b>, then keep the downloaded file safe (e.g. upload it to your Google Drive). To restore later, choose that file here. Restoring <b>adds a fresh copy</b> of everything — it never overwrites what you already have.</>}
        </p>
      </div>
    </div>
  );
}
