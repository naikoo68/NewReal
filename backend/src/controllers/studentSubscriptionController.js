import Coupon from "../models/Coupon.js";
import { computeOffer } from "./authController.js";
import { razorpayConfigured, razorpayKeyId, createRazorpayOrder, verifyPaymentSignature } from "../config/razorpay.js";

// Student self-serve subscription: buy / renew a STUDENT plan. Both routes run
// behind attachUser + authorize("student") so a student whose plan has lapsed
// can still subscribe again. Mirrors the client subscriptionController, but
// prices against the student catalog (audience:"student") and writes the
// separate student* fields (never the client subscription / temp-account
// expiresAt), so it can't interfere with other roles' login/expiry semantics.

// Add `months` to a starting date and return the resulting Date.
function addMonths(from, months) {
  const d = new Date(from);
  d.setMonth(d.getMonth() + (months || 0));
  return d;
}

// POST /api/student-subscriptions/order — create a Razorpay order for a paid
// student plan. The free 1-day trial is activated directly (no order needed).
export async function studentUpgradeOrder(req, res) {
  const offer = await computeOffer({
    planKey: req.body?.plan,
    couponCode: req.body?.couponCode,
    referralCode: req.body?.referralCode,
    selfEmail: req.user.email,
    audience: "student",
  });
  if (!offer) return res.status(400).json({ message: "Choose a valid plan." });

  // The free trial is claimable once — no payment/order.
  if (offer.plan.key === "trial") {
    if (req.user.studentTrialUsed) {
      return res.status(400).json({ message: "You've already used your free trial. Please choose a paid plan." });
    }
    return res.json({ free: true, trial: true, finalPrice: 0 });
  }

  // Free (₹0 via coupon) or payments not configured → activate without checkout.
  if (!razorpayConfigured() || offer.finalPrice <= 0) return res.json({ free: true, finalPrice: offer.finalPrice });

  try {
    const order = await createRazorpayOrder({
      amount: offer.finalPrice,
      receipt: `stu_${String(req.user._id).slice(-8)}_${Date.now()}`,
      notes: { plan: offer.plan.key, userId: String(req.user._id), audience: "student" },
    });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: razorpayKeyId(), finalPrice: offer.finalPrice });
  } catch (e) {
    res.status(502).json({ message: e.message || "Could not start the payment." });
  }
}

// POST /api/student-subscriptions/activate — verify payment (if any) and extend
// the student's subscription validity.
export async function studentUpgradeActivate(req, res) {
  const offer = await computeOffer({
    planKey: req.body?.plan,
    couponCode: req.body?.couponCode,
    referralCode: req.body?.referralCode,
    selfEmail: req.user.email,
    audience: "student",
  });
  if (!offer) return res.status(400).json({ message: "Choose a valid plan." });

  const now = Date.now();
  // Extend from the later of now or the current (still-active) expiry so an
  // early renewal adds time instead of losing the remaining days.
  const base = req.user.studentPlanExpiresAt && new Date(req.user.studentPlanExpiresAt).getTime() > now
    ? new Date(req.user.studentPlanExpiresAt)
    : new Date();

  if (offer.plan.key === "trial") {
    // One-time free trial → 1 day of access.
    if (req.user.studentTrialUsed) {
      return res.status(400).json({ message: "You've already used your free trial. Please choose a paid plan." });
    }
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 1);
    req.user.studentPlanExpiresAt = trialEnd;
    req.user.studentTrial = true;
    req.user.studentTrialUsed = true;
    req.user.studentPlan = "trial";
    req.user.studentPlanMonths = 0;
    req.user.studentPlanPrice = 0;
    await req.user.save();
    return res.json({ ok: true, trial: true, studentPlanExpiresAt: req.user.studentPlanExpiresAt, plan: "trial" });
  }

  // Paid plan → require a verified payment when Razorpay is on and price > 0.
  if (razorpayConfigured() && offer.finalPrice > 0) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "No payment was received. Please try again." });
    }
    if (!verifyPaymentSignature({ orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature })) {
      return res.status(400).json({ message: "Payment could not be verified. Please try again." });
    }
    req.user.studentPaymentId = razorpay_payment_id;
  }

  req.user.studentPlanExpiresAt = addMonths(base, offer.plan.months);
  req.user.studentTrial = false;
  req.user.studentPlan = offer.plan.key;
  req.user.studentPlanMonths = offer.plan.months;
  req.user.studentPlanPrice = offer.finalPrice;
  if (offer.applied?.coupon && !offer.applied.coupon.invalid) req.user.couponCode = offer.applied.coupon.code;
  if (offer.applied?.referral && !offer.applied.referral.invalid) req.user.referredBy = req.user.referredBy || offer.applied.referral.code;

  await req.user.save();

  if (offer.applied?.coupon && !offer.applied.coupon.invalid) {
    Coupon.updateOne({ code: offer.applied.coupon.code }, { $inc: { usedCount: 1 } }).catch(() => {});
  }

  res.json({ ok: true, studentPlanExpiresAt: req.user.studentPlanExpiresAt, plan: offer.plan.key });
}
