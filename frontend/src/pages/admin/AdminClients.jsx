import { useEffect, useState } from "react";
import { Search, Ban, CheckCircle2, KeyRound, UserPlus, Trash2, X, ListChecks, FileStack, HelpCircle, Store, Pencil, Clock, AlarmClock, Gift, Ticket, Sparkles, Undo2, Archive } from "lucide-react";
import { userService, settingsService } from "../../services";
import Badge from "../../components/ui/Badge";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

// Duration units offered when giving a client a temporary (auto-expiring) account.
const UNIT_MS = { Minutes: 60_000, Hours: 3_600_000, Days: 86_400_000, Weeks: 604_800_000, Months: 2_592_000_000 };

// Subscription plan keys → readable labels (mirrors the backend CLIENT_PLANS).
const PLAN_LABELS = { "1m": "1 Month", "2m": "2 Months", "6m": "6 Months", "1y": "1 Year" };

const blank = {
  name: "",
  email: "",
  password: "",
  active: true, // access: can the client log in?
  isTemp: false, // validity: temporary auto-expiring account
  durationValue: 30,
  durationUnit: "Days",
  // AI access: master switch + which key pools this client may use.
  aiAccess: false,
  aiAllowInbuilt: true,
  aiAllowSelf: true,
  subscriptionPlan: "", // the plan this client is on (drives price + AI limits)
  // Per-feature workspace access (defaults: most ON, AI Generator OFF).
  featDashboard: true,
  featBuild: true,
  featPapers: true,
  featChecker: true,
  featNotes: true,
  featDocuments: true,
  featManual: true,
  featAiGenerator: false,
};

// The client workspace features the admin can grant/revoke (label + form key).
const FEATURES = [
  { key: "featDashboard", label: "Dashboard" },
  { key: "featBuild", label: "Build" },
  { key: "featPapers", label: "Previous Papers" },
  { key: "featChecker", label: "Question Checker" },
  { key: "aiAccess", label: "AI (API keys)" },
  { key: "featAiGenerator", label: "AI Generator" },
  { key: "featNotes", label: "Notes" },
  { key: "featDocuments", label: "Documents" },
  { key: "featManual", label: "User Manual" },
];

const fmtDate = (d) =>
  new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDay = (d) =>
  new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

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

// Self-service "client" accounts — people who register at /client/register and
// build/practice their own private My Practice content. The admin can create
// them, set validity (auto-expiry) & access, block/unblock, reset passwords
// and delete them (which also removes all their content).
export default function AdminClients() {
  const [clients, setClients] = useState([]);
  const [deletedClients, setDeletedClients] = useState([]); // Recycle bin
  const [search, setSearch] = useState("");
  const [plans, setPlans] = useState([]); // client subscription plans (from settings) for the plan dropdown
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  // "Apply features to all clients" bulk modal.
  const [featAllOpen, setFeatAllOpen] = useState(false);
  const [featAll, setFeatAll] = useState({ featDashboard: true, featBuild: true, aiAccess: false, featAiGenerator: false, featNotes: true, featDocuments: true, featManual: true });
  const [applyingAll, setApplyingAll] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    userService
      .clients()
      .then((res) => setClients(res.clients || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  // Recycle bin (soft-deleted clients) — loaded alongside the active list.
  const loadDeleted = () => {
    userService.deletedClients().then((res) => setDeletedClients(res.clients || [])).catch(() => {});
  };
  useEffect(() => { load(); loadDeleted(); }, []);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  // Load the client subscription plans so a client can be assigned one.
  useEffect(() => {
    settingsService.get().then((s) => setPlans(Array.isArray(s?.clientPlans) ? s.clientPlans : [])).catch(() => {});
  }, []);

  const openAdd = () => { setForm(blank); setEditing(null); setError(""); setModal(true); };
  const openEdit = (c) => {
    setForm({
      name: c.name,
      email: c.email,
      password: "",
      active: c.status !== "blocked",
      isTemp: !!c.expiresAt,
      durationValue: 30,
      durationUnit: "Days",
      aiAccess: !!c.aiAccess,
      aiAllowInbuilt: c.aiAllowInbuilt !== false,
      aiAllowSelf: c.aiAllowSelf !== false,
      subscriptionPlan: c.subscriptionPlan || "",
      featDashboard: c.featDashboard !== false,
      featBuild: c.featBuild !== false,
      featPapers: c.featPapers !== false,
      featChecker: c.featChecker !== false,
      featNotes: c.featNotes !== false,
      featDocuments: c.featDocuments !== false,
      featManual: c.featManual !== false,
      featAiGenerator: !!c.featAiGenerator,
    });
    setEditing(c);
    setError("");
    setModal(true);
  };

  const toggleBlock = async (c) => {
    try {
      const res = await userService.toggleStatus(c._id);
      setClients((list) => list.map((x) => (x._id === c._id ? { ...x, status: res.status } : x)));
    } catch (e) {
      flash(e.message);
    }
  };

  const resetPassword = async (c) => {
    try {
      await userService.resetPassword(c._id);
      flash(`Password reset link issued for ${c.name}.`);
    } catch (e) {
      flash(e.message);
    }
  };

  const removeClient = async (c) => {
    if (!window.confirm(`Move client "${c.name}" to the Recycle bin?\n\nTheir account and all My Practice content are KEPT and can be restored later. (To erase permanently, use the Recycle bin below.)`)) return;
    try {
      await userService.remove(c._id);
      setClients((list) => list.filter((x) => x._id !== c._id));
      loadDeleted();
      flash("Client moved to Recycle bin — you can restore it below.");
    } catch (e) {
      flash(e.message);
    }
  };

  // Restore a soft-deleted client (account + content come back intact).
  const restoreClient = async (c) => {
    try {
      await userService.restore(c._id);
      setDeletedClients((list) => list.filter((x) => x._id !== c._id));
      load();
      flash("Client restored.");
    } catch (e) {
      flash(e.message);
    }
  };

  // Permanently delete a client from the Recycle bin — irreversible.
  const permanentlyDelete = async (c) => {
    if (!window.confirm(`Permanently delete "${c.name}" and ALL their My Practice content?\n\nThis CANNOT be undone.`)) return;
    try {
      await userService.deletePermanent(c._id);
      setDeletedClients((list) => list.filter((x) => x._id !== c._id));
      flash("Client permanently deleted.");
    } catch (e) {
      flash(e.message);
    }
  };

  const saveClient = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      // Validity → an absolute expiry from now, or null for a permanent account.
      const expiresAt = form.isTemp
        ? new Date(Date.now() + Math.max(1, Number(form.durationValue) || 1) * UNIT_MS[form.durationUnit]).toISOString()
        : null;

      if (editing) {
        const payload = {
          name: form.name,
          email: form.email,
          expiresAt,
          aiAccess: form.aiAccess,
          aiAllowInbuilt: form.aiAllowInbuilt,
          aiAllowSelf: form.aiAllowSelf,
          subscriptionPlan: form.subscriptionPlan,
          featDashboard: form.featDashboard,
          featBuild: form.featBuild,
          featPapers: form.featPapers,
          featChecker: form.featChecker,
          featNotes: form.featNotes,
          featDocuments: form.featDocuments,
          featManual: form.featManual,
          featAiGenerator: form.featAiGenerator,
        };
        if (form.password) payload.password = form.password;
        const updated = await userService.update(editing._id, payload);
        // Apply access (active/blocked) if it changed.
        let status = editing.status;
        if (form.active === (editing.status === "blocked")) {
          const res = await userService.toggleStatus(editing._id);
          status = res.status;
        }
        setClients((list) => list.map((x) => (x._id === editing._id ? { ...x, ...updated, status } : x)));
        flash("Client updated.");
      } else {
        const created = await userService.create({
          name: form.name,
          email: form.email,
          password: form.password,
          role: "client",
          expiresAt,
        });
        setClients((list) => [{ ...created, quizzes: 0, tests: 0, questions: 0 }, ...list]);
        flash(form.isTemp ? "Temporary client created." : "Client created.");
      }
      setModal(false);
      setForm(blank);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = clients.filter(
    (c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.email.toLowerCase().includes(search.toLowerCase())
  );

  const previewExpiry = new Date(Date.now() + Math.max(1, Number(form.durationValue) || 1) * UNIT_MS[form.durationUnit]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Store className="h-6 w-6 text-accent-500" /> Clients</h1>
          <p className="text-slate-500 dark:text-slate-400">
            Self-service accounts that build & practice their own private My Practice content. Manage validity, access, passwords and deletion here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setFeatAllOpen(true)} className="btn-outline">
            <CheckCircle2 className="h-4 w-4" /> Apply features to all
          </button>
          <button onClick={openAdd} className="btn-primary">
            <UserPlus className="h-4 w-4" /> Add Client
          </button>
        </div>
      </div>

      {/* Apply feature access to ALL clients at once */}
      {featAllOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={applyingAll ? undefined : () => setFeatAllOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md animate-scale-in card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold">Apply features to all clients</h3>
              <button type="button" onClick={() => setFeatAllOpen(false)} disabled={applyingAll}><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Tick the tabs to grant, untick to revoke — this overwrites these features for <b>every</b> client at once.</p>
            <div className="grid grid-cols-2 gap-2">
              {FEATURES.map((f) => (
                <label key={f.key} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                  <span>{f.label}</span>
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!featAll[f.key]} onChange={(e) => setFeatAll({ ...featAll, [f.key]: e.target.checked })} />
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setFeatAllOpen(false)} disabled={applyingAll} className="btn-outline">Cancel</button>
              <button
                type="button"
                disabled={applyingAll}
                onClick={async () => {
                  if (!window.confirm("Apply these feature settings to ALL clients? This overwrites their current per-tab access.")) return;
                  setApplyingAll(true);
                  try {
                    const res = await userService.applyClientFeatures(featAll);
                    flash(`Applied to ${res?.updated ?? "all"} client(s).`);
                    setFeatAllOpen(false);
                    load();
                  } catch (e) { flash(e.message); } finally { setApplyingAll(false); }
                }}
                className="btn-primary"
              >
                {applyingAll ? "Applying..." : "Apply to all"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <Loading label="Loading clients..." />
      ) : error && !modal ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { l: "Total Clients", v: clients.length, c: "text-brand-600" },
              { l: "Active", v: clients.filter((c) => c.status === "active" && !isExpired(c.expiresAt)).length, c: "text-emerald-600" },
              { l: "Blocked / Expired", v: clients.filter((c) => c.status === "blocked" || isExpired(c.expiresAt)).length, c: "text-rose-600" },
              { l: "Questions Created", v: clients.reduce((s, c) => s + (c.questions || 0), 0), c: "text-accent-600" },
            ].map((s) => (
              <div key={s.l} className="card p-5 text-center">
                <p className={`text-3xl font-extrabold ${s.c}`}>{s.v}</p>
                <p className="mt-1 text-sm text-slate-500">{s.l}</p>
              </div>
            ))}
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients..." className="input pl-9" />
          </div>

          {filtered.length === 0 ? (
            <EmptyState message={search ? "No clients match your search." : "No client accounts yet. They appear here when people register at /client/register (or add one above)."} />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800/60">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Client</th>
                    <th className="px-5 py-3 font-semibold">Content</th>
                    <th className="px-5 py-3 font-semibold">Plan</th>
                    <th className="px-5 py-3 font-semibold">Access</th>
                    <th className="px-5 py-3 font-semibold">Validity</th>
                    <th className="px-5 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((c) => {
                    const expired = isExpired(c.expiresAt);
                    return (
                      <tr key={c._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-100 text-xs font-bold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
                              {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                            </span>
                            <div>
                              <p className="font-medium">{c.name}</p>
                              <p className="text-xs text-slate-400">{c.email}</p>
                              {c.referralCode && (
                                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                                  <Gift className="h-3 w-3" /> {c.referralCode}
                                  {c.referredBy && <span> · via {c.referredBy}</span>}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant="brand"><ListChecks className="h-3 w-3" /> {c.quizzes}</Badge>
                            <Badge variant="accent"><FileStack className="h-3 w-3" /> {c.tests}</Badge>
                            <Badge variant="neutral"><HelpCircle className="h-3 w-3" /> {c.questions} Qs</Badge>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {c.subscriptionPlan ? (
                            <div className="flex flex-col gap-1">
                              <Badge variant="brand">{plans.find((p) => p.key === c.subscriptionPlan)?.label || PLAN_LABELS[c.subscriptionPlan] || c.subscriptionPlan}</Badge>
                              <span className="flex items-center gap-1 text-xs text-slate-400">
                                ₹{c.subscriptionPrice ?? "—"}
                                {c.couponCode && <span className="inline-flex items-center gap-0.5"><Ticket className="h-3 w-3" /> {c.couponCode}</span>}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {c.status === "blocked" ? (
                            <Badge variant="Hard">Blocked</Badge>
                          ) : expired ? (
                            <Badge variant="Hard">Expired</Badge>
                          ) : (
                            <Badge variant="Easy">Active</Badge>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {c.expiresAt ? (
                            <div className="flex items-center gap-1.5">
                              {expired ? (
                                <Badge variant="Hard">Expired</Badge>
                              ) : (
                                <Badge variant="accent"><Clock className="h-3 w-3" /> {relativeTo(c.expiresAt)}</Badge>
                              )}
                              <span className="hidden text-xs text-slate-400 lg:inline">{fmtDay(c.expiresAt)}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Never expires</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => openEdit(c)} title="Edit validity & access" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button onClick={() => resetPassword(c)} title="Reset password" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">
                              <KeyRound className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => toggleBlock(c)}
                              title={c.status === "blocked" ? "Unblock" : "Block"}
                              className={`rounded-lg p-2 ${c.status === "blocked" ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30" : "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30"}`}
                            >
                              {c.status === "blocked" ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                            </button>
                            <button onClick={() => removeClient(c)} title="Move to Recycle bin (recoverable)" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Recycle bin — soft-deleted clients, restorable or permanently removable */}
          {deletedClients.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-1 flex items-center gap-2 text-lg font-bold">
                <Archive className="h-5 w-5 text-slate-500" /> Recycle bin
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800">{deletedClients.length}</span>
              </h3>
              <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
                Deleted clients are kept here with all their content. <b>Restore</b> brings the account fully back; <b>Delete permanently</b> erases it and cannot be undone.
              </p>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {deletedClients.map((c) => (
                  <div key={c._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-slate-400">{c.email}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        <Badge variant="brand"><ListChecks className="h-3 w-3" /> {c.quizzes}</Badge>
                        <Badge variant="accent"><FileStack className="h-3 w-3" /> {c.tests}</Badge>
                        <Badge variant="neutral"><HelpCircle className="h-3 w-3" /> {c.questions} Qs</Badge>
                        {c.deletedAt && <span>· deleted {fmtDate(c.deletedAt)}</span>}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <button onClick={() => restoreClient(c)} className="btn-outline !py-1.5 text-xs">
                        <Undo2 className="h-3.5 w-3.5" /> Restore
                      </button>
                      <button onClick={() => permanentlyDelete(c)} title="Delete permanently (cannot be undone)" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Add / edit client modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <form onSubmit={saveClient} className="my-8 w-full max-w-md animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{editing ? "Edit Client" : "Add Client"}</h3>
              <button type="button" onClick={() => setModal(false)}><X className="h-5 w-5" /></button>
            </div>
            {error && <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</div>}
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Full Name</label>
                <input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Client name" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Email</label>
                <input required type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="client@example.com" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  {editing ? "New Password (leave blank to keep current)" : "Password"}
                </label>
                <input required={!editing} minLength={6} className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing ? "Leave blank to keep unchanged" : "At least 6 characters"} />
              </div>

              {/* Access — can this client log in and use My Practice? */}
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div>
                  <p className="text-sm font-medium">Account access</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">When off, the client can't log in.</p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  {form.active ? "Active" : "Blocked"}
                </label>
              </div>

              {/* Validity — temporary auto-expiring account */}
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <AlarmClock className="h-4 w-4 text-accent-600" /> Set validity (auto-expire)
                  </span>
                  <input type="checkbox" className="h-4 w-4 accent-accent-600" checked={form.isTemp} onChange={(e) => setForm({ ...form, isTemp: e.target.checked })} />
                </label>

                {form.isTemp && (
                  <div className="mt-4 space-y-3">
                    {editing && (
                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {editing.expiresAt ? `Currently expires ${fmtDate(editing.expiresAt)}.` : "Currently permanent."}{" "}
                        Choosing a duration below resets the validity from now.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium">Valid for</label>
                        <input type="number" min={1} className="input" value={form.durationValue} onChange={(e) => setForm({ ...form, durationValue: e.target.value })} />
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
                      <Clock className="h-4 w-4" /> Expires on <strong>{fmtDate(previewExpiry)}</strong>
                    </p>
                  </div>
                )}
                {!form.isTemp && (
                  <p className="mt-2 text-xs text-slate-400">Off = permanent account that never expires.</p>
                )}
              </div>

              {/* Subscription plan — drives price label + AI generation limits */}
              {editing && (
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <label className="mb-1 block text-sm font-medium">Subscription plan</label>
                  <select className="input" value={form.subscriptionPlan} onChange={(e) => setForm({ ...form, subscriptionPlan: e.target.value })}>
                    <option value="">— No plan —</option>
                    {plans.map((p) => (
                      <option key={p.key || p.label} value={p.key}>
                        {p.label}{p.price ? ` — ₹${p.price}` : ""}{p.months ? ` · ${p.months} mo` : ""} · {p.maxPerBatch}/batch, {p.perWindow}/{p.windowMinutes}min
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">Sets this client's plan — its price label and AI generation limits. Manage plans in <b>AI Keys</b>.</p>
                </div>
              )}

              {/* Per-feature workspace access */}
              {editing && (
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <p className="mb-2 text-sm font-semibold">Workspace features</p>
                  <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Tick which tabs this client sees. AI (API keys) &amp; AI Generator are off by default.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {FEATURES.map((f) => (
                      <label key={f.key} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                        <span>{f.label}</span>
                        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* AI access — master switch + which key pools this client may use */}
              {editing && (
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Sparkles className="h-4 w-4 text-brand-600" /> AI access
                    </span>
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.aiAccess} onChange={(e) => setForm({ ...form, aiAccess: e.target.checked })} />
                  </label>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    When on, this client sees an <b>AI</b> tab to generate/import questions.
                  </p>

                  {form.aiAccess && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Allowed API sources</p>
                      <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                        <span>Built-in APIs <span className="text-xs text-slate-400">(your platform keys)</span></span>
                        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.aiAllowInbuilt} onChange={(e) => setForm({ ...form, aiAllowInbuilt: e.target.checked })} />
                      </label>
                      <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                        <span>Own APIs <span className="text-xs text-slate-400">(keys the client adds)</span></span>
                        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.aiAllowSelf} onChange={(e) => setForm({ ...form, aiAllowSelf: e.target.checked })} />
                      </label>
                      {!form.aiAllowInbuilt && !form.aiAllowSelf && (
                        <p className="text-xs font-medium text-rose-600 dark:text-rose-400">Enable at least one source, or the client won't be able to use AI.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setModal(false)} className="btn-outline">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : editing ? "Save Changes" : "Create Client"}</button>
            </div>
          </form>
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
