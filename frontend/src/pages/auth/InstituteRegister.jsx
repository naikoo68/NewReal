import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { School, User, Mail, Lock, Globe, Eye, EyeOff, Loader2, AlertCircle, Check, Tag, Gift, ShieldCheck, ArrowRight } from "lucide-react";
import AuthShell from "../../components/auth/AuthShell";
import PlanPicker from "../../components/client/PlanPicker";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";
import { authService, instituteSignupService } from "../../services";

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

const FALLBACK_PLANS = [
  { key: "trial", label: "14-Day Free Trial", cycle: "Trial", months: 0, price: 0, trial: true },
  { key: "1m", label: "1 Month", cycle: "Monthly", months: 1, price: 1499 },
  { key: "6m", label: "6 Months", cycle: "Semi-Annually", months: 6, price: 6999 },
  { key: "1y", label: "1 Year", cycle: "Yearly", months: 12, price: 11999 },
];

const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// Public: an institute signs itself up, pays, and its space is provisioned.
export default function InstituteRegister() {
  const { applySession, refreshUser } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [cfg, setCfg] = useState({ enabled: true, payEnabled: false, plans: FALLBACK_PLANS });
  const [showPw, setShowPw] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", slugEdited: false, adminName: "", adminEmail: "", adminPassword: "" });
  const [planKey, setPlanKey] = useState("trial");
  const [coupon, setCoupon] = useState("");
  const [referral, setReferral] = useState("");
  const [offer, setOffer] = useState(null);
  const [avail, setAvail] = useState(null); // { slugAvailable, emailAvailable, reserved, slugValid }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { slug }

  useEffect(() => {
    instituteSignupService.config().then((r) => {
      setCfg({ enabled: !!r.enabled, payEnabled: !!r.payEnabled, plans: r.plans?.length ? r.plans : FALLBACK_PLANS });
    }).catch(() => {});
  }, []);

  // Auto-fill the subdomain from the institute name until the user edits it.
  const effectiveSlug = form.slugEdited ? slugify(form.slug) : slugify(form.name);

  // Debounced availability check (slug + email).
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!effectiveSlug && !form.adminEmail) { setAvail(null); return; }
      instituteSignupService.availability({ slug: effectiveSlug, email: form.adminEmail })
        .then((r) => alive && setAvail(r))
        .catch(() => alive && setAvail(null));
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [effectiveSlug, form.adminEmail]);

  // Debounced price preview.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      authService.validateOffer({ plan: planKey, couponCode: coupon, referralCode: referral, email: form.adminEmail, audience: "tenant" })
        .then((r) => alive && setOffer(r))
        .catch(() => alive && setOffer(null));
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [planKey, coupon, referral, form.adminEmail]);

  const selectedPlan = cfg.plans.find((p) => p.key === planKey) || cfg.plans[0];
  const isFreePlan = !!selectedPlan?.trial || (selectedPlan?.price ?? 0) <= 0;
  const basePrice = offer?.basePrice ?? selectedPlan?.price ?? 0;
  const discount = offer?.discount ?? 0;
  const total = offer?.finalPrice ?? selectedPlan?.price ?? 0;

  const handlePickPlan = (key) => {
    setPlanKey(key);
    const p = cfg.plans.find((x) => x.key === key);
    if (p && (p.trial || (p.price ?? 0) <= 0)) { setCoupon(""); setReferral(""); }
  };

  const payload = (extra = {}) => ({
    name: form.name,
    slug: effectiveSlug,
    adminName: form.adminName,
    adminEmail: form.adminEmail,
    adminPassword: form.adminPassword,
    plan: planKey,
    couponCode: coupon.trim() || undefined,
    referralCode: referral.trim() || undefined,
    ...extra,
  });

  const finish = async (res) => {
    if (res?.token) {
      applySession(res.token, res.admin);
      await refreshUser().catch(() => {});
    }
    setDone({ slug: res?.tenant?.slug || effectiveSlug });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (avail && (!avail.slugAvailable || !avail.emailAvailable)) {
      setError(!avail.slugAvailable ? "That subdomain isn't available." : "That admin email is already registered.");
      return;
    }
    setBusy(true);
    try {
      if (cfg.payEnabled && !isFreePlan && total > 0) {
        const order = await instituteSignupService.order(payload());
        if (order.free) {
          await finish(await instituteSignupService.provision(payload()));
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
              description: `${form.name} — ${selectedPlan?.label} plan`,
              prefill: { name: form.adminName, email: form.adminEmail },
              theme: { color: settings?.primaryColor || "#2563eb" },
              handler: async (resp) => {
                try {
                  await finish(await instituteSignupService.provision(payload({
                    razorpay_order_id: resp.razorpay_order_id,
                    razorpay_payment_id: resp.razorpay_payment_id,
                    razorpay_signature: resp.razorpay_signature,
                  })));
                  resolve();
                } catch (err) { reject(err); }
              },
              modal: { ondismiss: () => reject(new Error("Payment was cancelled.")) },
            });
            rzp.on("payment.failed", (r) => reject(new Error(r?.error?.description || "Payment failed. Please try again.")));
            rzp.open();
          });
        }
      } else {
        // Free trial / payments-off → provision directly.
        await finish(await instituteSignupService.provision(payload()));
      }
    } catch (err) {
      setError(err.message || "Could not create your institute.");
    } finally {
      setBusy(false);
    }
  };

  if (!cfg.enabled) {
    return (
      <AuthShell title="Institute signup">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          Institute self-signup isn't open yet. Please check back soon, or contact us to set up your institute.
        </div>
        <p className="mt-6 text-center text-sm">
          <Link to="/" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">← Back to home</Link>
        </p>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Your institute is ready! 🎉">
        <div className="card p-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
            <Check className="h-8 w-8" />
          </span>
          <h2 className="mt-4 text-lg font-extrabold">{form.name} is set up</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Your space{done.slug ? <> (<b>{done.slug}</b>)</> : null} is live and you're signed in as its admin.
          </p>
          <button onClick={() => navigate("/admin")} className="btn-primary mt-5 w-full">
            Go to your admin panel <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Register your institute" subtitle="Get your own branded space with your own admin, students and content.">
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm text-brand-800 dark:border-brand-900/50 dark:bg-brand-900/20 dark:text-brand-200">
        <School className="mt-0.5 h-4 w-4 flex-shrink-0" />
        Your institute gets its own subdomain, branding, admin and fully isolated data.
      </div>
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium">Institute name</label>
          <div className="relative">
            <School className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bright Future Academy" className="input pl-9" />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Subdomain</label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={form.slugEdited ? form.slug : effectiveSlug}
              onChange={(e) => setForm({ ...form, slug: e.target.value, slugEdited: true })}
              placeholder="brightfuture"
              className="input pl-9"
            />
          </div>
          {effectiveSlug && avail && (
            avail.reserved ? <p className="mt-1 text-xs text-rose-600">That subdomain is reserved.</p>
            : !avail.slugValid ? <p className="mt-1 text-xs text-rose-600">Use lowercase letters, numbers and hyphens.</p>
            : avail.slugAvailable ? <p className="mt-1 text-xs text-emerald-600">✓ {effectiveSlug} is available</p>
            : <p className="mt-1 text-xs text-rose-600">That subdomain is taken.</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Admin name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input required value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} placeholder="Your name" className="input pl-9" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Admin email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input required type="email" autoCapitalize="none" spellCheck={false} value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} placeholder="you@institute.com" className="input pl-9" />
            </div>
            {form.adminEmail && avail && !avail.emailAvailable && <p className="mt-1 text-xs text-rose-600">Email already registered.</p>}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Admin password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input required minLength={6} type={showPw ? "text" : "password"} value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} placeholder="At least 6 characters" className="input px-9" />
            <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Choose a plan</label>
          <PlanPicker plans={cfg.plans} value={planKey} onChange={handlePickPlan} />
        </div>

        {!isFreePlan && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Coupon <span className="font-normal text-slate-400">(optional)</span></label>
              <div className="relative">
                <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} className="input pl-9 uppercase" />
              </div>
              {offer?.applied?.coupon?.label && <p className="mt-1 text-xs text-emerald-600">✓ {offer.applied.coupon.label} applied</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Referral <span className="font-normal text-slate-400">(optional)</span></label>
              <div className="relative">
                <Gift className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={referral} onChange={(e) => setReferral(e.target.value.toUpperCase())} className="input pl-9 uppercase" />
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
          <div className="flex items-center justify-between">
            <span className="text-slate-600 dark:text-slate-300">{selectedPlan?.label} plan</span>
            <span className={discount > 0 ? "text-slate-400 line-through" : "font-semibold"}>{isFreePlan ? "Free" : `₹${basePrice}`}</span>
          </div>
          {discount > 0 && <div className="mt-1 flex items-center justify-between text-emerald-600"><span>Discount</span><span>−₹{discount}</span></div>}
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-base font-extrabold dark:border-slate-700"><span>Total</span><span>{isFreePlan ? "Free" : `₹${total}`}</span></div>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input required type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" />
          I agree to the Terms of Service and Privacy Policy.
        </label>

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <School className="h-4 w-4" />}
          {busy ? "Setting up…" : isFreePlan ? "Start free trial" : cfg.payEnabled ? `Pay ₹${total} & create institute` : `Create institute`}
        </button>
        <p className="flex items-center justify-center gap-1 text-center text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" /> {isFreePlan ? "Free trial — no payment needed." : "Secure payment via Razorpay · your institute activates instantly"}
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-300">
        Already have an institute?{" "}
        <Link to="/admin/login" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">Log in</Link>
      </p>
    </AuthShell>
  );
}
