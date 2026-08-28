import User from "../models/User.js";

// Guarantees an admin account exists based on environment variables — a safe,
// data-preserving way to bootstrap or recover admin access on hosts without
// shell access (e.g. Render free tier).
//
//   ADMIN_EMAIL     – the admin's email
//   ADMIN_PASSWORD  – the admin's password
//   ADMIN_RESET     – set to "true" to also reset the password of an existing
//                     account with that email (otherwise existing accounts are
//                     left untouched so admin-panel edits are preserved)
export async function ensureAdminFromEnv() {
  const email = String(process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    await User.create({
      name: process.env.ADMIN_NAME || "Admin",
      email,
      password,
      role: "admin",
      isEmailVerified: true,
    });
    console.log(`✔ Admin account created from env: ${email}`);
    return;
  }

  if (process.env.ADMIN_RESET === "true") {
    user.role = "admin";
    user.status = "active";
    user.password = password;
    await user.save();
    console.log(`✔ Admin account reset from env: ${email}`);
  } else if (user.role !== "admin") {
    user.role = "admin";
    await user.save();
    console.log(`✔ Promoted existing user to admin: ${email}`);
  }
}
