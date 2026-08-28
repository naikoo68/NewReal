import { AsyncLocalStorage } from "node:async_hooks";

// Per-request tenant context. resolveTenant() runs the rest of each request
// inside this store, so any code (controllers, models, deep async) can read the
// current tenant WITHOUT it being passed around — and the model plugin can
// auto-scope every query. This is what makes Model-1 isolation safe by design:
// scoping lives in ONE place and can't be forgotten in a controller.
export const tenantStore = new AsyncLocalStorage();

// The current tenant id, or null when there's no request context (e.g. a
// background job / startup script) — in which case scoping is skipped.
export function getCurrentTenantId() {
  const s = tenantStore.getStore();
  return s ? s.tenantId : null;
}

// Override the current context's tenant. Used by auth to bind an authenticated
// request to the LOGGED-IN USER's own tenant (a trusted source), so a spoofed
// X-Tenant-Host header can't scope a session to another institute's data.
export function setCurrentTenantId(tenantId) {
  const s = tenantStore.getStore();
  if (s) {
    s.tenantId = tenantId;
    s.bypass = false; // targeting a tenant re-enables scoping to it
  }
}

// Mark the current request as cross-tenant (unscoped) — used for a super-admin
// who legitimately operates across all institutes.
export function setUnscoped() {
  const s = tenantStore.getStore();
  if (s) s.bypass = true;
}

// True when the current context has explicitly opted OUT of tenant scoping
// (super-admin cross-tenant work, auth lookups, internal maintenance).
export function isUnscoped() {
  const s = tenantStore.getStore();
  return !!(s && s.bypass);
}

// Run `fn` within a given tenant context.
export function runWithTenant(ctx, fn) {
  return tenantStore.run(ctx || { tenantId: null, bypass: false }, fn);
}

// Run `fn` with tenant scoping DISABLED — for lookups that are intentionally
// global (e.g. resolving a user by JWT id, login by email, super-admin
// cross-tenant queries).
//
// IMPORTANT: we `await fn()` INSIDE the bypass context. Mongoose queries are
// lazy — `User.findOne(...)` only executes when awaited/`.then()`-ed. If we just
// returned the un-executed query, it would run AFTER this function returns —
// back under the request's normal (scoped) context — silently defeating the
// bypass. Awaiting here forces the query to execute (and its scoping hook to
// run) while the bypass context is active. This is the bug that stopped
// institute admins/students from being found by email.
export function runUnscoped(fn) {
  return tenantStore.run({ tenantId: null, bypass: true }, async () => await fn());
}
