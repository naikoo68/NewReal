// Shared logic for resolving whether a user may access a test series.
// A test may be visible to everyone (visibleToAll) unless an explicit per-user
// entry overrides it. An entry can hide the test (visible:false) or grant
// time-limited access (validUntil in the past = expired = hidden).

export function findAccessEntry(test, userId) {
  if (!userId) return null;
  return (test.access || []).find((a) => String(a.user) === String(userId)) || null;
}

export function isTestVisibleToUser(test, userId) {
  const entry = findAccessEntry(test, userId);
  if (entry) {
    if (!entry.visible) return false;
    if (entry.validUntil && new Date(entry.validUntil).getTime() < Date.now()) return false;
    return true;
  }
  // No explicit entry: hidden by default unless the test is marked public.
  return test.visibleToAll === true;
}

// True when this item has been account-to-account shared with the given user
// (used to let a recipient see and play/take a shared practice quiz/test).
export function isSharedWithUser(doc, userId) {
  if (!userId) return false;
  return (doc?.sharedWith || []).some((u) => String(u) === String(userId));
}

// True when the user holds an ACTIVE student subscription (paid or trial). A
// subscribed student gets full access to all practice quizzes & test-series —
// this is the core perk of the student plans, so it unlocks the same content
// the per-account myQuizAccess/myTestAccess master grants do.
export function hasActiveSubscription(user) {
  return !!(user?.studentPlanExpiresAt && new Date(user.studentPlanExpiresAt).getTime() > Date.now());
}
