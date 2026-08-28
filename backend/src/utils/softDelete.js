// Shared helpers for the site-wide Recycle Bin (soft delete + restore).
//
// Instead of removing a document immediately, delete controllers flag it with
// `deleted: true` + `deletedAt: <now>`. List queries spread NOT_DELETED so
// soft-deleted items disappear from the normal UI but stay in the database,
// recoverable from the Recycle Bin. A separate "permanent delete" then removes
// them (and cascades to children) for good.
//
// NOT_DELETED uses `{ $ne: true }` (not `false`) so legacy documents created
// before this feature — which have no `deleted` field at all — still count as
// live, with no data migration required.

export const NOT_DELETED = { deleted: { $ne: true } };

// Only the soft-deleted documents (for the Recycle Bin listing).
export const ONLY_DELETED = { deleted: true };

// Field patch to apply when soft-deleting a document.
export const softDeletePatch = () => ({ deleted: true, deletedAt: new Date() });

// Field patch to apply when restoring a document from the Recycle Bin.
export const restorePatch = () => ({ deleted: false, deletedAt: null });
