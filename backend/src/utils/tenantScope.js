// Central helpers for tenant-scoping queries. Keeping this in one place means
// scoping is applied consistently and can't be silently forgotten in a
// controller. Phase 3 wires these into the controllers (and the model plugin
// enforces scoping at the query layer as a safety net).

export function getTenantId(req) {
  return req?.tenantId || null;
}

// Merge the current tenant into a query condition, e.g.
//   User.find(tenantFilter(req, { role: "student" }))
export function tenantFilter(req, extra = {}) {
  const id = getTenantId(req);
  return id ? { ...extra, tenantId: id } : { ...extra };
}

// Stamp the current tenant onto a new document / create payload, e.g.
//   Question.create(stampTenant(req, { text, options }))
export function stampTenant(req, doc = {}) {
  const id = getTenantId(req);
  return id ? { ...doc, tenantId: id } : { ...doc };
}
