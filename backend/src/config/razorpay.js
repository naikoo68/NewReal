import crypto from "crypto";

// Razorpay helpers using the REST API directly (no SDK dependency). Keys come
// from env: RAZORPAY_KEY_ID (public) and RAZORPAY_KEY_SECRET (server-only).
export const razorpayConfigured = () =>
  !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

export const razorpayKeyId = () => process.env.RAZORPAY_KEY_ID || "";

// Create an order. `amount` is in rupees; Razorpay expects the smallest unit.
export async function createRazorpayOrder({ amount, currency = "INR", receipt, notes }) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  // Razorpay caps `receipt` at 40 characters — never send a longer one.
  const safeReceipt = receipt ? String(receipt).slice(0, 40) : undefined;
  const resp = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency, receipt: safeReceipt, notes, payment_capture: 1 }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error?.description || "Could not create the payment order.");
  return data; // { id, amount, currency, ... }
}

// Verify the Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, secret).
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature || !process.env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
