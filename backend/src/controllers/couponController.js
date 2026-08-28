import Coupon from "../models/Coupon.js";

// GET /api/coupons (admin) — all coupons.
export async function listCoupons(req, res) {
  const coupons = await Coupon.find().sort("-createdAt").lean();
  res.json({ coupons });
}

// POST /api/coupons (admin) — create a coupon.
export async function createCoupon(req, res) {
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ message: "Coupon code is required." });
  const type = req.body?.type === "percent" ? "percent" : "flat";
  const value = Math.max(0, parseInt(req.body?.value, 10) || 0);
  if (!value) return res.status(400).json({ message: "Discount value must be greater than 0." });

  const exists = await Coupon.findOne({ code });
  if (exists) return res.status(409).json({ message: "That coupon code already exists." });

  const coupon = await Coupon.create({
    code,
    type,
    value,
    active: req.body?.active !== false,
    usageLimit: Math.max(0, parseInt(req.body?.usageLimit, 10) || 0),
  });
  res.status(201).json(coupon);
}

// PUT /api/coupons/:id (admin) — edit a coupon.
export async function updateCoupon(req, res) {
  const patch = {};
  if (req.body?.code !== undefined) patch.code = String(req.body.code).trim().toUpperCase();
  if (req.body?.type !== undefined) patch.type = req.body.type === "percent" ? "percent" : "flat";
  if (req.body?.value !== undefined) patch.value = Math.max(0, parseInt(req.body.value, 10) || 0);
  if (req.body?.active !== undefined) patch.active = !!req.body.active;
  if (req.body?.usageLimit !== undefined) patch.usageLimit = Math.max(0, parseInt(req.body.usageLimit, 10) || 0);
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!coupon) return res.status(404).json({ message: "Coupon not found." });
    res.json(coupon);
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ message: "That coupon code already exists." });
    throw e;
  }
}

// DELETE /api/coupons/:id (admin)
export async function deleteCoupon(req, res) {
  await Coupon.findByIdAndDelete(req.params.id);
  res.json({ message: "Coupon deleted" });
}
