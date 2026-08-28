import { useEffect, useState } from "react";
import { ShieldCheck, Loader2, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

// Reusable 6-digit OTP verification step. Used after registration and when an
// unverified user tries to log in.
export default function OtpVerify({ email, devOtp: initialDevOtp, emailSent, autoResend = false, onVerified, onLater }) {
  const { verifyOtp, resendOtp } = useAuth();
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [devOtp, setDevOtp] = useState(initialDevOtp || "");

  // When arriving from a login attempt, send a fresh code automatically.
  useEffect(() => {
    if (!autoResend) return;
    resendOtp(email)
      .then((r) => {
        if (r?.devOtp) setDevOtp(r.devOtp);
        else if (r?.emailSent) setInfo("We sent a verification code to your email.");
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const profile = await verifyOtp(email, otp.trim());
      onVerified(profile);
    } catch (err) {
      setError(err.message || "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError("");
    setInfo("");
    try {
      const r = await resendOtp(email);
      if (r?.devOtp) {
        setDevOtp(r.devOtp);
        setInfo("A new code was generated.");
      } else if (r?.emailSent) {
        setInfo("A new code was sent to your email.");
      } else {
        setInfo("A new code was generated.");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
          <ShieldCheck className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-2xl font-extrabold">Verify your email</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Enter the 6-digit code we sent to <span className="font-semibold">{email}</span>.
        </p>
      </div>

      {devOtp && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          Email delivery isn't configured yet, so here is your code for now:{" "}
          <span className="font-mono text-base font-bold tracking-widest">{devOtp}</span>
        </div>
      )}

      {!devOtp && emailSent === false && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          We couldn't send the email just now. Please tap <b>Resend code</b> below, and check your
          Spam/Promotions folder. If it keeps failing, contact support.
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}
        {info && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> {info}
          </div>
        )}
        <input
          required
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="______"
          className="input text-center text-2xl font-bold tracking-[0.5em]"
        />
        <button type="submit" disabled={busy || otp.length !== 6} className="btn-primary w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {busy ? "Verifying..." : "Verify & Continue"}
        </button>
      </form>

      <button onClick={resend} className="mt-4 flex w-full items-center justify-center gap-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
        <RefreshCw className="h-4 w-4" /> Resend code
      </button>

      {onLater && (
        <div className="mt-5 border-t border-slate-200 pt-4 text-center dark:border-slate-700">
          <button onClick={onLater} className="text-sm font-medium text-slate-500 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200">
            I'll verify later
          </button>
          <p className="mt-1 text-xs text-slate-400">
            Your account is created. You can verify anytime — you'll be asked for the code next time you log in.
          </p>
        </div>
      )}
    </div>
  );
}
