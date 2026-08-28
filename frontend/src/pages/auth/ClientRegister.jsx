import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { User, Mail, Lock, Eye, EyeOff, UserPlus, Loader2, AlertCircle, Sparkles, Check, Tag, Gift } from "lucide-react";
import AuthShell from "../../components/auth/AuthShell";
import OtpVerify from "../../components/auth/OtpVerify";
import AccountTypeTabs from "../../components/auth/AccountTypeTabs";
import PlanPicker from "../../components/client/PlanPicker";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";
import { authService, paymentService } from "../../services";

// Load Razorpay Checkout once, on demand.
function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

// Prices mirror the backend (single source of truth) — used only until the
// live /auth/plans response arrives, so the form never renders empty.
const FALLBACK_PLANS = [
  { key: "trial", label: "1-Day Free Trial", months: 0, price: 0, trial: true },
  { key: "1m", label: "1 Month", months: 1, price: 299 },
  { key: "2m", label: "2 Months", months: 2, price: 499 },
  { key: "6m", label: "6 Months", months: 6, price: 699 },
  { key: "1y", label: "1 Year", months: 12, price: 899 },
];

// Self-service registration for a "client" account. A client picks a plan and
// gets a private My Practice workspace to build and take their own quizzes/tests.
export default function ClientRegister() {
  const { register, applySession } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPw, setShowPw] = useState(false);
  const [otpStep, setOtpStep] = useState(null); // { email, devOtp, emailSent }
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [plans, setPlans] = useState(FALLBACK_PLANS);
  // Pre-select the plan chosen on the public /pricing page (if any), else trial.
  const [planKey, setPlanKey] = useState(location.state?.plan || "trial");
  const [coupon, setCoupon] = useState("");
  const [referral, setReferral] = useState("");
  const [offer, setOffer] = useState(null); // { basePrice, discount, finalPrice, applied }
  const [payEnabled, setPayEnabled] = useState(false); // Razorpay configured on the server?
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Authoritative plans/prices + whether online payment is enabled.
  useEffect(() => {
    authService.plans().then((r) => { if (r?.plans?.length) setPlans(r.plans); }).catch(() => {});
    paymentService.config().then((r) => setPayEnabled(!!r?.enabled)).catch(() => {});
  }, []);

  // Live price preview (debounced) when the plan or codes change.
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      authService
        .validateOffer({ plan: planKey, couponCode: coupon, referralCode: referral, email: form.email })
        .then((r) => active && setOffer(r))
        .catch(() => active && setOffer(null));
    }, 400);
    return () => { active = false; clearTimeout(t); };
  }, [planKey, coupon, referral, form.email]);

  const selectedPlan = plans.find((p) => p.key === planKey) || plans[0];
  // The free trial has no price, so coupon/referral don't apply — hide them.
  const isFreePlan = !!selectedPlan?.trial || (selectedPlan?.price ?? 0) <= 0;
  const basePrice = offer?.basePrice ?? selectedPlan?.price ?? 0;
  const discount = offer?.discount ?? 0;
  const total = offer?.finalPrice ?? selectedPlan?.price ?? 0;

  // Pick a plan; clear coupon/referral when switching to a free/trial plan.
  const handlePickPlan = (key) => {
    setPlanKey(key);
    const p = plans.find((x) => x.key === key);
    if (p && (p.trial || (p.price ?? 0) <= 0)) { setCoupon(""); setReferral(""); }
  };

  // Create the account. `paymentFields` carries the verified Razorpay details
  // for paid signups; empty for free/OTP signups.
  const doRegister = async (paymentFields = {}) => {
    const res = await register(form.name, form.email, form.password, "client", {
      plan: planKey,
      couponCode: coupon.trim() || undefined,
      referralCode: referral.trim() || undefined,
      ...paymentFields,
    });
    // Paid signup → server returns a session; log in and go straight to the app.
    if (res?.paid && res?.token) {
      applySession(res.token, res.user);
      navigate("/client", { replace: true });
      return;
    }
    // Free / payments-off → verify email via OTP.
    setOtpStep({ email: res.email || form.email, devOtp: res.devOtp, emailSent: res.emailSent });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Take payment first when it's enabled and the plan costs money.
      if (payEnabled && total > 0) {
        const order = await paymentService.createOrder({
          plan: planKey,
          couponCode: coupon.trim() || undefined,
          referralCode: referral.trim() || undefined,
          email: form.email,
        });
        if (order.free) {
          await doRegister();
        } else {
          const ready = await loadRazorpay();
          if (!ready) throw new Error("Couldn't open the payment window. Check your connection and try again.");
          await new Promise((resolve, reject) => {
            const rzp = new window.Razorpay({
              key: order.keyId,
              order_id: order.orderId,
              amount: order.amount,
              currency: order.currency || "INR",
              name: settings?.siteName || "My Study Guide",
              image: settings?.logoUrl || undefined,
              description: `${selectedPlan?.label} plan`,
              prefill: { name: form.name, email: form.email },
              theme: { color: settings?.primaryColor || "#2563eb" },
              handler: async (resp) => {
                try {
                  await doRegister({
                    razorpay_order_id: resp.razorpay_order_id,
                    razorpay_payment_id: resp.razorpay_payment_id,
                    razorpay_signature: resp.razorpay_signature,
                  });
                  resolve();
                } catch (err) {
                  reject(err);
                }
              },
              modal: { ondismiss: () => reject(new Error("Payment was cancelled.")) },
            });
            rzp.on("payment.failed", (r) => reject(new Error(r?.error?.description || "Payment failed. Please try again.")));
            rzp.open();
          });
        }
      } else {
        // Payments not enabled yet → account activates on email verification.
        await doRegister();
      }
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  if (otpStep) {
    return (
      <AuthShell title="Almost there">
        <OtpVerify
          email={otpStep.email}
          devOtp={otpStep.devOtp}
          emailSent={otpStep.emailSent}
          onVerified={() => navigate("/client", { replace: true })}
          onLater={() => navigate("/login")}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create a Client account" subtitle="Pick a plan and build your own private quizzes & tests.">
      <AccountTypeTabs active="client" onSelect={(k) => { if (k === "student") navigate("/register"); }} />
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-accent-200 bg-accent-50 px-3 py-2.5 text-sm text-accent-800 dark:border-accent-900/50 dark:bg-accent-900/20 dark:text-accent-200">
        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0" />
        A Client account gives you your own private <b>My Practice</b> space to create and take your own quizzes and tests.
      </div>
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Full Name</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Your name"
              className="input pl-9"
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              required
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              className="input pl-9"
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              required
              minLength={6}
              type={showPw ? "text" : "password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 6 characters"
              className="input px-9"
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Plan selection */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Choose your billing cycle &amp; plan</label>
          <PlanPicker plans={plans} value={planKey} onChange={handlePickPlan} />

          {/* AI generation limits for the chosen plan */}
          {selectedPlan?.maxPerBatch ? (
            <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50/60 p-3 text-xs dark:border-brand-900/40 dark:bg-brand-900/10">
              <p className="mb-1.5 flex items-center gap-1 font-semibold text-brand-700 dark:text-brand-300"><Sparkles className="h-3.5 w-3.5" /> AI question generation — {selectedPlan.label}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white/70 p-2 dark:bg-slate-800/50"><p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{selectedPlan.maxPerBatch}</p><p className="text-[10px] text-slate-500 dark:text-slate-400">Questions / batch</p></div>
                <div className="rounded-lg bg-white/70 p-2 dark:bg-slate-800/50"><p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{selectedPlan.perWindow}</p><p className="text-[10px] text-slate-500 dark:text-slate-400">Questions / window</p></div>
                <div className="rounded-lg bg-white/70 p-2 dark:bg-slate-800/50"><p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{selectedPlan.windowMinutes || 5} min</p><p className="text-[10px] text-slate-500 dark:text-slate-400">Window</p></div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Coupon + referral — hidden for the free trial (nothing to discount) */}
        {!isFreePlan && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Coupon code <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <div className="relative">
              <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                placeholder="e.g. WELCOME10"
                className="input pl-9 uppercase"
              />
            </div>
            {offer?.applied?.coupon?.invalid && <p className="mt-1 text-xs text-rose-600">Invalid coupon code</p>}
            {offer?.applied?.coupon?.label && (
              <p className="mt-1 text-xs text-emerald-600">✓ {offer.applied.coupon.label} applied</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Referral code <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <div className="relative">
              <Gift className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={referral}
                onChange={(e) => setReferral(e.target.value.toUpperCase())}
                placeholder="Friend's code"
                className="input pl-9 uppercase"
              />
            </div>
            {offer?.applied?.referral?.invalid && <p className="mt-1 text-xs text-rose-600">Referral code not found</p>}
            {offer?.applied?.referral?.discount > 0 && (
              <p className="mt-1 text-xs text-emerald-600">✓ ₹{offer.applied.referral.discount} referral discount</p>
            )}
          </div>
        </div>
        )}

        {/* Price summary */}
        <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
          <div className="flex items-center justify-between">
            <span className="text-slate-600 dark:text-slate-300">{selectedPlan?.label} plan</span>
            <span className={discount > 0 ? "text-slate-400 line-through" : "font-semibold"}>₹{basePrice}</span>
          </div>
          {discount > 0 && (
            <div className="mt-1 flex items-center justify-between text-emerald-600">
              <span>Discount</span>
              <span>−₹{discount}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-base font-extrabold dark:border-slate-700">
            <span>Total</span>
            <span>₹{total}</span>
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input required type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" />
          I agree to the Terms of Service and Privacy Policy.
        </label>

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          {busy
            ? "Processing..."
            : planKey === "trial"
            ? "Start 1-day free trial"
            : payEnabled && total > 0
            ? `Pay ₹${total} & Create account`
            : `Create account · ₹${total}`}
        </button>
        <p className="text-center text-xs text-slate-400">
          {planKey === "trial"
            ? "Free 1-day trial — no payment needed. You can upgrade to a paid plan anytime."
            : payEnabled && total > 0
            ? "You'll pay securely via Razorpay, then your account activates instantly for the selected duration."
            : "After verifying your email, your account is active for the selected duration."}
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-300">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
