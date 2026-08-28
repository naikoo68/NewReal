import { useEffect, useState } from "react";
import { Search, Ban, CheckCircle2, KeyRound, Crown, UserPlus, Pencil, Trash2, X, Clock, AlarmClock, ListChecks, BookOpen, FileStack } from "lucide-react";
import { userService, testService, authService } from "../../services";
import Badge from "../../components/ui/Badge";
import { Loading, ErrorState } from "../../components/ui/AsyncState";

// Duration units offered when creating a temporary account.
const UNIT_MS = { Minutes: 60_000, Hours: 3_600_000, Days: 86_400_000, Weeks: 604_800_000 };

const blankUser = {
  name: "",
  email: "",
  password: "",
  role: "student",
  plan: "Free",
  isTemp: false, // temporary account toggle
  durationValue: 7, // "valid for" amount
  durationUnit: "Days", // amount unit
  // Student subscription (manual admin grant). studentSubEdit gates whether a
  // save touches the subscription at all (so editing other fields never changes
  // it by accident).
  studentSubEdit: false,
  studentAction: "set", // "set" (grant/extend) | "remove"
  studentPlanKey: "",
  studentDurationValue: 1,
  studentDurationUnit: "Months",
};

// Add a duration to a base date, returning a new Date. Used for the student
// subscription validity (Months/Years need calendar math, not fixed ms).
function addDuration(base, value, unit) {
  const d = new Date(base);
  const v = Math.max(1, Number(value) || 1);
  if (unit === "Days") d.setDate(d.getDate() + v);
  else if (unit === "Weeks") d.setDate(d.getDate() + v * 7);
  else if (unit === "Months") d.setMonth(d.getMonth() + v);
  else if (unit === "Years") d.setFullYear(d.getFullYear() + v);
  return d;
}
const STUDENT_UNITS = ["Days", "Weeks", "Months", "Years"];

// Human-friendly absolute date, e.g. "22 Jun 2026, 4:30 PM".
const fmtDate = (d) =>
  new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

// Relative countdown, e.g. "in 3 days" / "in 2 hours" / "Expired".
function relativeTo(d) {
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `in ${hrs} hr${hrs === 1 ? "" : "s"}`;
  const days = Math.round(hrs / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
const isExpired = (d) => d && new Date(d).getTime() < Date.now();

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankUser);
  const [saving, setSaving] = useState(false);
  const [studentPlans, setStudentPlans] = useState([]); // for the manual-subscription plan picker

  // Load the student plan catalog once (used to label/assign a manual sub).
  useEffect(() => {
    authService.studentPlans().then((r) => setStudentPlans(r?.plans || [])).catch(() => {});
  }, []);

  // "Manage access" panel state
  const [accessUser, setAccessUser] = useState(null); // the user whose access is open
  const [access, setAccess] = useState(null); // { quizAccess, tests: [...] }
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);

  const openAccess = async (u) => {
    setAccessUser(u);
    setAccess(null);
    setAccessLoading(true);
    try {
      const data = await userService.getAccess(u._id);
      setAccess(data);
    } catch (e) {
      flash(e.message);
      setAccessUser(null);
    } finally {
      setAccessLoading(false);
    }
  };

  // Permanently delete a test series (from the access panel) for everyone.
  const deleteTestSeries = async (t, i) => {
    if (!window.confirm(`Permanently delete the test series "${t.name}" for ALL users? This cannot be undone.`)) return;
    try {
      await testService.remove(t._id);
      setAccess((a) => ({ ...a, tests: a.tests.filter((_, xi) => xi !== i) }));
      flash("Test series deleted.");
    } catch (e) {
      flash(e.message);
    }
  };

  const saveAccess = async () => {
    if (!access) return;
    setAccessSaving(true);
    try {
      await userService.updateAccess(accessUser._id, {
        quizAccess: access.quizAccess,
        myQuizAccess: access.myQuizAccess,
        myTestAccess: access.myTestAccess,
        tests: access.tests.map((t) => ({ _id: t._id, visible: t.visible, validUntil: t.validUntil })),
      });
      // Reflect temp/test changes in the row's expiry is not needed; just refresh count
      setUsers((list) => list.map((x) => (x._id === accessUser._id ? { ...x, quizAccess: access.quizAccess } : x)));
      flash("Access updated.");
      setAccessUser(null);
      setAccess(null);
    } catch (e) {
      flash(e.message);
    } finally {
      setAccessSaving(false);
    }
  };

  const openAdd = () => { setForm(blankUser); setEditing(null); setError(""); setModal(true); };
  const openEdit = (u) => {
    setForm({
      name: u.name,
      email: u.email,
      password: "",
      role: u.role,
      plan: u.plan,
      isTemp: !!u.expiresAt,
      durationValue: 7,
      durationUnit: "Days",
      // Don't auto-modify the subscription; pre-fill the picker with the
      // student's current plan for convenience.
      studentSubEdit: false,
      studentAction: "set",
      studentPlanKey: u.studentPlan || "",
      studentDurationValue: 1,
      studentDurationUnit: "Months",
    });
    setEditing(u);
    setError("");
    setModal(true);
  };

  const load = () => {
    setLoading(true);
    setError("");
    userService
      .list()
      .then((res) => setUsers(res.users || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const toggleBlock = async (u) => {
    try {
      const res = await userService.toggleStatus(u._id);
      setUsers((list) => list.map((x) => (x._id === u._id ? { ...x, status: res.status } : x)));
    } catch (e) {
      flash(e.message);
    }
  };

  const resetPassword = async (u) => {
    try {
      await userService.resetPassword(u._id);
      flash(`Password reset link issued for ${u.name}.`);
    } catch (e) {
      flash(e.message);
    }
  };

  const removeUser = async (u) => {
    if (!window.confirm(`Delete user "${u.name}"? This cannot be undone.`)) return;
    try {
      await userService.remove(u._id);
      setUsers((list) => list.filter((x) => x._id !== u._id));
      flash("User deleted.");
    } catch (e) {
      flash(e.message);
    }
  };

  const saveUser = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      // Compute the expiry timestamp from the chosen duration (from now).
      const expiresAt = form.isTemp
        ? new Date(Date.now() + Math.max(1, Number(form.durationValue) || 1) * UNIT_MS[form.durationUnit]).toISOString()
        : null;

      // Student subscription fields — only built when the admin explicitly chose
      // to modify it (studentSubEdit), so unrelated edits never touch it.
      const studentFields = {};
      if (form.role === "student" && form.studentSubEdit) {
        if (form.studentAction === "remove") {
          studentFields.studentPlan = "";
          studentFields.studentPlanExpiresAt = null;
        } else {
          studentFields.studentPlan = form.studentPlanKey || "1m";
          studentFields.studentPlanExpiresAt = addDuration(new Date(), form.studentDurationValue, form.studentDurationUnit).toISOString();
        }
      }

      if (editing) {
        const payload = { name: form.name, email: form.email, role: form.role, plan: form.plan, ...studentFields };
        if (form.password) payload.password = form.password; // only change if provided
        // Only recompute expiry when a new duration was chosen; otherwise keep
        // the existing one. Turning the toggle OFF clears it (sends null).
        if (!form.isTemp) payload.expiresAt = null;
        else if (form.isTemp) payload.expiresAt = expiresAt;
        const updated = await userService.update(editing._id, payload);
        setUsers((list) => list.map((x) => (x._id === editing._id ? { ...x, ...updated } : x)));
        flash("User updated.");
      } else {
        const created = await userService.create({ ...form, expiresAt, ...studentFields });
        setUsers((list) => [created, ...list]);
        flash(form.isTemp ? "Temporary account created." : "User created.");
      }
      setModal(false);
      setForm(blankUser);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const planVariant = (p) => (p === "Premium" ? "brand" : p === "Pro" ? "accent" : "neutral");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">User Management</h1>
          <p className="text-slate-500 dark:text-slate-400">
            Add users (permanent or temporary/auto-expiring), block/unblock, reset passwords and manage subscriptions.
          </p>
        </div>
        <button onClick={openAdd} className="btn-primary">
          <UserPlus className="h-4 w-4" /> Add User
        </button>
      </div>

      {loading ? (
        <Loading label="Loading users..." />
      ) : error && !modal ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { l: "Total Users", v: users.length, c: "text-brand-600" },
              { l: "Active", v: users.filter((u) => u.status === "active").length, c: "text-emerald-600" },
              { l: "Blocked", v: users.filter((u) => u.status === "blocked").length, c: "text-rose-600" },
              { l: "Temporary", v: users.filter((u) => u.expiresAt).length, c: "text-accent-600" },
            ].map((s) => (
              <div key={s.l} className="card p-5 text-center">
                <p className={`text-3xl font-extrabold ${s.c}`}>{s.v}</p>
                <p className="mt-1 text-sm text-slate-500">{s.l}</p>
              </div>
            ))}
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..." className="input pl-9" />
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800/60">
                <tr>
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 font-semibold">Plan</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Expires</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((u) => (
                  <tr key={u._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                          {u.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </span>
                        <div>
                          <p className="font-medium">{u.name}</p>
                          <p className="text-xs text-slate-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={u.role === "admin" ? "accent" : u.role === "client" ? "brand" : "neutral"}>{u.role}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={planVariant(u.plan)}>
                          {u.plan !== "Free" && <Crown className="h-3 w-3" />} {u.plan}
                        </Badge>
                        {u.role === "student" && u.studentPlanExpiresAt && (
                          new Date(u.studentPlanExpiresAt).getTime() > Date.now() ? (
                            <Badge variant="Easy" title={`Subscription active until ${fmtDate(u.studentPlanExpiresAt)}`}>
                              Sub · {relativeTo(u.studentPlanExpiresAt)}
                            </Badge>
                          ) : (
                            <Badge variant="Hard" title={`Subscription expired ${fmtDate(u.studentPlanExpiresAt)}`}>Sub expired</Badge>
                          )
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={u.status === "active" ? "Easy" : "Hard"}>{u.status}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      {u.expiresAt ? (
                        <div className="flex items-center gap-1.5">
                          {isExpired(u.expiresAt) ? (
                            <Badge variant="Hard">Expired</Badge>
                          ) : (
                            <Badge variant="accent"><Clock className="h-3 w-3" /> {relativeTo(u.expiresAt)}</Badge>
                          )}
                          <span className="hidden text-xs text-slate-400 lg:inline">{fmtDate(u.expiresAt)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Never</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => openAccess(u)} title="Manage content access" className="rounded-lg p-2 text-accent-600 hover:bg-accent-50 dark:hover:bg-accent-900/30">
                          <ListChecks className="h-4 w-4" />
                        </button>
                        <button onClick={() => openEdit(u)} title="Edit" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => resetPassword(u)} title="Reset password" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => toggleBlock(u)}
                          title={u.status === "blocked" ? "Unblock" : "Block"}
                          className={`rounded-lg p-2 ${u.status === "blocked" ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30" : "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30"}`}
                        >
                          {u.status === "blocked" ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                        </button>
                        <button onClick={() => removeUser(u)} title="Delete" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Add / edit user modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <form onSubmit={saveUser} className="my-8 w-full max-w-md animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{editing ? "Edit User" : "Add User"}</h3>
              <button type="button" onClick={() => setModal(false)}><X className="h-5 w-5" /></button>
            </div>
            {error && <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</div>}
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Full Name</label>
                <input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Email</label>
                <input required type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@example.com" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  {editing ? "New Password (leave blank to keep current)" : "Password"}
                </label>
                <input required={!editing} minLength={6} className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing ? "Leave blank to keep unchanged" : "At least 6 characters"} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Role</label>
                  <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    <option value="student">Student</option>
                    <option value="client">Client</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Plan</label>
                  <select className="input" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                    <option>Free</option><option>Premium</option><option>Pro</option>
                  </select>
                </div>
              </div>

              {/* Temporary account — auto-expires after the chosen duration */}
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <AlarmClock className="h-4 w-4 text-accent-600" /> Temporary account (auto-expires)
                  </span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent-600"
                    checked={form.isTemp}
                    onChange={(e) => setForm({ ...form, isTemp: e.target.checked })}
                  />
                </label>

                {form.isTemp && (
                  <div className="mt-4 space-y-3">
                    {editing && (
                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {editing.expiresAt ? `Currently expires ${fmtDate(editing.expiresAt)}.` : "Currently permanent."}{" "}
                        Choosing a duration below resets the expiry from now.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium">Valid for</label>
                        <input
                          type="number"
                          min={1}
                          className="input"
                          value={form.durationValue}
                          onChange={(e) => setForm({ ...form, durationValue: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium">Unit</label>
                        <select className="input" value={form.durationUnit} onChange={(e) => setForm({ ...form, durationUnit: e.target.value })}>
                          {Object.keys(UNIT_MS).map((u) => (
                            <option key={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="flex flex-wrap items-center gap-1.5 text-sm text-accent-700 dark:text-accent-300">
                      <Clock className="h-4 w-4" /> Expires on{" "}
                      <strong>{fmtDate(Date.now() + Math.max(1, Number(form.durationValue) || 1) * UNIT_MS[form.durationUnit])}</strong>
                    </p>
                  </div>
                )}
              </div>

              {/* Student subscription — manual grant / extend / remove. Gates a
                  student's access to attempting quizzes/test-series & Dashboard. */}
              {form.role === "student" && (
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Crown className="h-4 w-4 text-brand-600" /> Manage student subscription
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      checked={form.studentSubEdit}
                      onChange={(e) => setForm({ ...form, studentSubEdit: e.target.checked })}
                    />
                  </label>

                  {editing && (
                    <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {editing.studentPlanExpiresAt && new Date(editing.studentPlanExpiresAt).getTime() > Date.now()
                        ? <>Active{editing.studentTrial ? " (trial)" : ""} — expires <strong>{fmtDate(editing.studentPlanExpiresAt)}</strong> ({relativeTo(editing.studentPlanExpiresAt)}).</>
                        : "No active subscription — this student can't attempt quizzes/test-series or open their Dashboard."}
                    </p>
                  )}

                  {form.studentSubEdit && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium">Action</label>
                        <select className="input" value={form.studentAction} onChange={(e) => setForm({ ...form, studentAction: e.target.value })}>
                          <option value="set">Grant / set validity</option>
                          <option value="remove">Remove subscription</option>
                        </select>
                      </div>

                      {form.studentAction === "set" ? (
                        <>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">Plan</label>
                            <select className="input" value={form.studentPlanKey} onChange={(e) => setForm({ ...form, studentPlanKey: e.target.value })}>
                              <option value="">(auto — 1 Month)</option>
                              {studentPlans.map((p) => (
                                <option key={p.key} value={p.key}>{p.label}{p.price > 0 ? ` — ₹${p.price}` : ""}</option>
                              ))}
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="mb-1.5 block text-sm font-medium">Valid for</label>
                              <input type="number" min={1} className="input" value={form.studentDurationValue} onChange={(e) => setForm({ ...form, studentDurationValue: e.target.value })} />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-sm font-medium">Unit</label>
                              <select className="input" value={form.studentDurationUnit} onChange={(e) => setForm({ ...form, studentDurationUnit: e.target.value })}>
                                {STUDENT_UNITS.map((u) => <option key={u}>{u}</option>)}
                              </select>
                            </div>
                          </div>
                          <p className="flex flex-wrap items-center gap-1.5 text-sm text-brand-700 dark:text-brand-300">
                            <Clock className="h-4 w-4" /> Active until{" "}
                            <strong>{fmtDate(addDuration(new Date(), form.studentDurationValue, form.studentDurationUnit))}</strong>
                          </p>
                          <p className="text-xs text-slate-400">Sets validity to now + the chosen duration (no payment taken).</p>
                        </>
                      ) : (
                        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                          This removes the student's subscription access on save.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setModal(false)} className="btn-outline">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : editing ? "Save Changes" : "Create User"}</button>
            </div>
          </form>
        </div>
      )}

      {/* Manage content access modal */}
      {accessUser && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-lg animate-scale-in card p-6">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-bold">Content Access</h3>
              <button type="button" onClick={() => setAccessUser(null)}><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{accessUser.name} · {accessUser.email}</p>

            {accessLoading || !access ? (
              <Loading label="Loading access..." />
            ) : (
              <div className="space-y-5">
                {/* Quiz access */}
                <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"><BookOpen className="h-5 w-5" /></span>
                    <div>
                      <p className="font-medium">Quizzes</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">On by default for every user.</p>
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={access.quizAccess} onChange={(e) => setAccess({ ...access, quizAccess: e.target.checked })} />
                    {access.quizAccess ? "Enabled" : "Disabled"}
                  </label>
                </div>

                {/* My Quiz access (practice) — OFF by default */}
                <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"><ListChecks className="h-5 w-5" /></span>
                    <div>
                      <p className="font-medium">My Quiz</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Grants access to all My Quiz practice content. Off by default.</p>
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={!!access.myQuizAccess} onChange={(e) => setAccess({ ...access, myQuizAccess: e.target.checked })} />
                    {access.myQuizAccess ? "Enabled" : "Disabled"}
                  </label>
                </div>

                {/* My Test access (practice) — OFF by default */}
                <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><FileStack className="h-5 w-5" /></span>
                    <div>
                      <p className="font-medium">My Test</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Grants access to all My Test practice content. Off by default.</p>
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-amber-600" checked={!!access.myTestAccess} onChange={(e) => setAccess({ ...access, myTestAccess: e.target.checked })} />
                    {access.myTestAccess ? "Enabled" : "Disabled"}
                  </label>
                </div>

                {/* Test series access */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Test Series ({access.tests.length})</p>
                    {access.tests.length > 0 && (
                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-accent-600"
                          checked={access.tests.every((t) => t.visible)}
                          onChange={(e) => setAccess({ ...access, tests: access.tests.map((t) => ({ ...t, visible: e.target.checked })) })}
                        />
                        Visible for every test series
                      </label>
                    )}
                  </div>
                  {access.tests.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">No test series created yet.</p>
                  ) : (
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {access.tests.map((t, i) => (
                        <div key={t._id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{t.name}</p>
                              <p className="text-xs text-slate-400">{t.category}</p>
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-2">
                              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-accent-600"
                                  checked={t.visible}
                                  onChange={(e) => setAccess({ ...access, tests: access.tests.map((x, xi) => xi === i ? { ...x, visible: e.target.checked } : x) })}
                                />
                                {t.visible ? "Visible" : "Hidden"}
                              </label>
                              <button type="button" onClick={() => deleteTestSeries(t, i)} title="Delete this test series permanently" className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          {t.visible && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-xs text-slate-500 dark:text-slate-400">Valid until</span>
                              <input
                                type="date"
                                className="input h-8 py-1 text-xs"
                                value={t.validUntil ? new Date(t.validUntil).toISOString().slice(0, 10) : ""}
                                onChange={(e) => setAccess({ ...access, tests: access.tests.map((x, xi) => xi === i ? { ...x, validUntil: e.target.value ? new Date(e.target.value).toISOString() : null } : x) })}
                              />
                              {t.validUntil && (
                                <button type="button" onClick={() => setAccess({ ...access, tests: access.tests.map((x, xi) => xi === i ? { ...x, validUntil: null } : x) })} className="text-xs text-slate-400 hover:text-rose-600">clear</button>
                              )}
                              <span className="text-xs text-slate-400">{t.validUntil ? "" : "(no limit)"}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setAccessUser(null)} className="btn-outline">Cancel</button>
                  <button type="button" onClick={saveAccess} disabled={accessSaving} className="btn-primary">{accessSaving ? "Saving..." : "Save Access"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg dark:bg-white dark:text-slate-900">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" /> {toast}
        </div>
      )}
    </div>
  );
}
