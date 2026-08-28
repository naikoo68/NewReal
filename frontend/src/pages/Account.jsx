import { Link } from "react-router-dom";
import { AlarmClock, ShieldCheck, Clock, Gift, Copy, LayoutDashboard } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import Badge from "../components/ui/Badge";
import Avatar from "../components/ui/Avatar";
import ProfileEditCard from "../components/ui/ProfileEditCard";
import ProfilePhotoCard from "../components/ui/ProfilePhotoCard";

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

// The student's own "Account" page — view profile, edit name/email/phone,
// change the profile photo, copy the referral code and see account validity.
// Reached from the navbar "Account" link and the dashboard.
export default function Account() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const expired = isExpired(user?.expiresAt);

  const copyReferral = () => {
    if (!user?.referralCode) return;
    navigator.clipboard?.writeText(user.referralCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="container-page py-10">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar src={user?.avatar} name={user?.name || user?.email} size={56} />
          <div>
            <h1 className="text-2xl font-extrabold">My Account</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Manage your profile and account details.</p>
          </div>
        </div>
        <Link to="/dashboard" className="btn-outline w-fit py-2">
          <LayoutDashboard className="h-4 w-4" /> Back to dashboard
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Editable details */}
        <ProfileEditCard className="sm:col-span-2" />

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
        </div>

        {/* Profile photo */}
        <ProfilePhotoCard className="sm:col-span-3" />

        {/* Referral */}
        {user?.referralCode && (
          <div className="card p-5 sm:col-span-3">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Gift className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-bold leading-none">Refer a friend</h2>
                <p className="mt-0.5 text-xs text-slate-400">Share your code with friends.</p>
              </div>
            </div>
            <div className="mt-4">
              <button
                onClick={copyReferral}
                title="Copy your referral code to share with friends"
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-300"
              >
                <Gift className="h-4 w-4" />
                Your code: <span className="font-bold tracking-wide">{user.referralCode}</span>
                {copied ? <span className="text-emerald-600">Copied!</span> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
