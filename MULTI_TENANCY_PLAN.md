# Multi-Tenant SaaS Plan (Model 1 — shared database, `tenantId`)

Goal: institutes **self-register online, pay via Razorpay, and get their space
created automatically** — each with its own **branding + subdomain (custom
domain later)**, its own **institute admin**, and **fully isolated data** (no
shared content). You remain the **super-admin** over all institutes. Designed to
scale to **thousands** of institutes on **one shared database**, separated by a
`tenantId` on every record.

This is a large change to a live system, so it is delivered in **safe, phased
PRs**. Enforcement is turned on only after the foundation is in place, so the
existing single-tenant app keeps working throughout.

---

## Core model

- One MongoDB cluster, one database, shared collections.
- **Every tenant-owned document carries `tenantId`** (the institute's id).
- A **single tenant-resolution layer** determines the current institute per
  request (from the **subdomain** `slug.yourapp.com`, a custom domain, or the
  logged-in user's `tenantId`).
- A **single shared query layer** auto-applies `{ tenantId }` to every read and
  stamps it on every create — so no controller can leak or forget it.
- Roles:
  - `super_admin` — you. No tenant. Can see/manage every institute.
  - `institute_admin` — an institute's own admin. Scoped to their `tenantId`.
  - `client` / `student` — unchanged, but scoped to their `tenantId`.

---

## Phases

### Phase 1 — Foundation (non-breaking)  ← this PR
- `Tenant` model (name, slug/subdomain, customDomain, status, subscription).
- Super-admin **Tenants API** to list/create/suspend institutes (manual for now;
  online paid signup comes in Phase 5).
- Committed plan (this document).
- **No existing behavior changes yet** — nothing is scoped or enforced.

### Phase 2 — Tenant plumbing (still non-breaking, default tenant)
- Add optional, indexed `tenantId` to every tenant-owned model.
- Tenant-resolution middleware (subdomain / header / user) with a **default
  tenant** fallback so current behavior is preserved.
- Central `tenantScope` helpers (filter + stamp).
- One-time **migration**: create a "default" tenant and backfill `tenantId` on
  all existing documents into it (so nothing breaks).

### Phase 3 — Enforce isolation
- Route every controller's queries through the `tenantScope` helpers.
- Convert the global `Settings` singleton into **per-tenant settings/branding**.
- Frontend resolves the tenant from the host and themes per institute.
- Add regression checks that a query without a tenant filter is rejected.

### Phase 4 — Roles & per-institute admin
- Add `institute_admin`; scope the admin panel to the caller's tenant.
- Super-admin console to view/manage all institutes.
- Existing platform `admin` becomes `super_admin`.

### Phase 5 — Paid online onboarding
- Public "Register your institute" flow → **Razorpay payment** → on verified
  payment, **auto-provision** the tenant: create settings/branding, the first
  institute admin, assign the subdomain, activate the plan. Instant.

### Phase 6 — Custom domains (optional, last)
- Map an institute's own domain → tenant, with DNS verification + SSL.
- Launch on subdomains first; add custom domains as an upgrade.

---

## Non-goals / notes
- **Physical DB isolation** is not part of Model 1 — isolation is logical via
  `tenantId` (no shared content, no cross-tenant access). This is the standard,
  cost-effective SaaS model and matches the stated requirements.
- Hosting stays a **single** frontend + backend deployment serving all
  subdomains (wildcard DNS). Custom domains (Phase 6) may need a paid hosting
  tier.
- Razorpay/keys, email and AI provider stay platform-level unless a future phase
  makes them per-tenant.
