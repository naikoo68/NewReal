import { useEffect, useState } from "react";
import { Crown, Check, Tag, Gift, Loader2, AlarmClock, ShieldCheck, Sparkles } from "lucide-react";
import { authService, subscriptionService } from "../../services";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";
import PlanPicker from "../../components/client/PlanPicker";

const FALLBACK_PLANS = [
  { key: "1m", label: "1 Month", months: 1, price: 299 },
  { key: "2m", label: "2 Months", months: 2, price: 499 },
  { key: "6m", label: "6 Months", months: 6, price: 699 },
  { key: "1y", label: "1 Year", months: 12, price: 899 },
];

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

// Shown to a client whose trial/plan has expired. Lets them pick a paid plan,
// apply a coupon/referral, pay via Razorpay, and instantly regain access.
export default function ClientUpgrade({ onClose }) {
  const { user, refreshUser } = useAuth();
  const { settings } = useSettings();
  const [plans, setPlans] = useState(FALLBACK_PLANS);
  const [planKey, setPlanKey] = useState("1m");
  const [coupon, setCoupon] = useState("");
  const [referral, setReferral] = useState("");
  const [offer, setOffer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    authService
      .plans()
      .then((r) => { if (r?.plans?.length) setPlans(r.plans.filter((p) => p.key !== "trial")); })
      .catch(() => {});
  }, []);

  // Live price preview (debounced) when the plan or codes change.
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      authService
        .validateOffer({ plan: planKey, couponCode: coupon, referralCode: referral, email: user?.email })
        .then((r) => active && setOffer(r))
        .catch(() => active && setOffer(null));
    }, 400);
    return () => { active = false; clearTimeout(t); };
  }, [planKey, coupon, referral, user?.email]);

  const selectedPlan = plans.find((p) => p.key === planKey) || plans[0];
  const basePrice = offer?.basePrice ?? selectedPlan?.price ?? 0;
  const discount = offer?.discount ?? 0;
  const total = offer?.finalPrice ?? selectedPlan?.price ?? 0;
  const wasTrial = user?.isTrial;
  const expired = user?.expiresAt && new Date(user.expiresAt).getTime() < Date.now();

  const codes = () => ({ plan: planKey, couponCode: coupon.trim() || undefined, referralCode: referral.trim() || undefined });

  const upgrade = async () => {
    setBusy(true);
    setError("");
    try {
      const order = await subscriptionService.order(codes());
      if (order.free) {
        await subscriptionService.activate(codes());
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
            prefill: { name: user?.name, email: user?.email },
            theme: { color: settings?.primaryColor || "#2563eb" },
            handler: async (resp) => {
              try {
                await subscriptionService.activate({
                  ...codes(),
                  razorpay_order_id: resp.razorpay_order_id,
                  razorpay_payment_id: resp.razorpay_payment_id,
                  razorpay_signature: resp.razorpay_signature,
                });
                resolve();
              } catch (e) {
                reject(e);
              }
            },
            modal: { ondismiss: () => reject(new Error("Payment was cancelled.")) },
          });
          rzp.on("payment.failed", (r) => reject(new Error(r?.error?.description || "Payment failed. Please try again.")));
          rzp.open();
        });
      }
      await refreshUser(); // extends validity → the workspace unlocks automatically
    } catch (e) {
      setError(e.message || "Upgrade failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      {onClose && (
        <button onClick={onClose} className="mb-3 text-sm font-medium text-slate-500 hover:text-brand-600 dark:text-slate-400">
          ← Back to dashboard
        </button>
      )}
      <div className="card p-6">
        <div className="flex items-center gap-3">
          <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${expired ? "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300" : "bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"}`}>
            {expired ? <AlarmClock className="h-6 w-6" /> : <Crown className="h-6 w-6" />}
          </span>
          <div>
            <h1 className="text-xl font-extrabold">
              {expired ? (wasTrial ? "Your free trial has ended" : "Your plan has expired") : (wasTrial ? "Upgrade from your free trial" : "Renew or change your plan")}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {expired ? "Upgrade to keep building and taking your quizzes & tests." : "Get more time and full access to your quizzes & tests."}
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</div>
        )}

        {/* Plans — choose a billing cycle, then a plan */}
        <div className="mt-5">
          <PlanPicker plans={plans} value={planKey} onChange={setPlanKey} includeTrial={false} />
        </div>

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

        {/* Coupon + referral */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Coupon code <span className="font-normal text-slate-400">(optional)</span></label>
            <div className="relative">
              <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="e.g. WELCOME10" className="input pl-9 uppercase" />
            </div>
            {offer?.applied?.coupon?.invalid && <p className="mt-1 text-xs text-rose-600">Invalid coupon code</p>}
            {offer?.applied?.coupon?.label && <p className="mt-1 text-xs text-emerald-600">✓ {offer.applied.coupon.label} applied</p>}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Referral code <span className="font-normal text-slate-400">(optional)</span></label>
            <div className="relative">
              <Gift className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={referral} onChange={(e) => setReferral(e.target.value.toUpperCase())} placeholder="Friend's code" className="input pl-9 uppercase" />
            </div>
            {offer?.applied?.referral?.invalid && <p className="mt-1 text-xs text-rose-600">Referral code not found</p>}
            {offer?.applied?.referral?.discount > 0 && <p className="mt-1 text-xs text-emerald-600">✓ ₹{offer.applied.referral.discount} referral discount</p>}
          </div>
        </div>

        {/* Summary */}
        <div className="mt-4 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
          <div className="flex items-center justify-between">
            <span className="text-slate-600 dark:text-slate-300">{selectedPlan?.label} plan</span>
            <span className={discount > 0 ? "text-slate-400 line-through" : "font-semibold"}>₹{basePrice}</span>
          </div>
          {discount > 0 && (
            <div className="mt-1 flex items-center justify-between text-emerald-600"><span>Discount</span><span>−₹{discount}</span></div>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-base font-extrabold dark:border-slate-700"><span>Total</span><span>₹{total}</span></div>
        </div>

        <button onClick={upgrade} disabled={busy} className="btn-primary mt-4 w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
          {busy ? "Processing..." : `Upgrade · ₹${total}`}
        </button>
        <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" /> Secure payment via Razorpay · activates instantly
        </p>
      </div>
    </div>
  );
}
