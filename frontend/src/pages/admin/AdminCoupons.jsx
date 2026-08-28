import { useEffect, useState } from "react";
import { Ticket, Plus, Pencil, Trash2, X, CheckCircle2, Power } from "lucide-react";
import { couponService } from "../../services";
import Badge from "../../components/ui/Badge";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

const blank = { code: "", type: "flat", value: 100, active: true, usageLimit: 0 };

const discountText = (c) => (c.type === "percent" ? `${c.value}% off` : `₹${c.value} off`);

// Admin management of discount coupons used at Client registration checkout.
export default function AdminCoupons() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    couponService
      .list()
      .then((res) => setCoupons(res.coupons || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const openAdd = () => { setForm(blank); setEditing(null); setError(""); setModal(true); };
  const openEdit = (c) => {
    setForm({ code: c.code, type: c.type, value: c.value, active: c.active, usageLimit: c.usageLimit || 0 });
    setEditing(c);
    setError("");
    setModal(true);
  };

  const toggleActive = async (c) => {
    try {
      const updated = await couponService.update(c._id, { active: !c.active });
      setCoupons((list) => list.map((x) => (x._id === c._id ? updated : x)));
    } catch (e) {
      flash(e.message);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete coupon "${c.code}"?`)) return;
    try {
      await couponService.remove(c._id);
      setCoupons((list) => list.filter((x) => x._id !== c._id));
      flash("Coupon deleted.");
    } catch (e) {
      flash(e.message);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value: Math.max(0, Number(form.value) || 0),
        active: form.active,
        usageLimit: Math.max(0, Number(form.usageLimit) || 0),
      };
      if (editing) {
        const updated = await couponService.update(editing._id, payload);
        setCoupons((list) => list.map((x) => (x._id === editing._id ? updated : x)));
        flash("Coupon updated.");
      } else {
        const created = await couponService.create(payload);
        setCoupons((list) => [created, ...list]);
        flash("Coupon created.");
      }
      setModal(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Ticket className="h-6 w-6 text-accent-500" /> Coupons</h1>
          <p className="text-slate-500 dark:text-slate-400">
            Discount codes clients can apply when registering. A percent (%) or flat (₹) discount off the plan price.
          </p>
        </div>
        <button onClick={openAdd} className="btn-primary">
          <Plus className="h-4 w-4" /> Add Coupon
        </button>
      </div>

      {loading ? (
        <Loading label="Loading coupons..." />
      ) : error && !modal ? (
        <ErrorState message={error} onRetry={load} />
      ) : coupons.length === 0 ? (
        <EmptyState message="No coupons yet. Create one so clients can get a discount at registration." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800/60">
              <tr>
                <th className="px-5 py-3 font-semibold">Code</th>
                <th className="px-5 py-3 font-semibold">Discount</th>
                <th className="px-5 py-3 font-semibold">Usage</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {coupons.map((c) => (
                <tr key={c._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-5 py-3">
                    <span className="rounded-md bg-slate-100 px-2 py-1 font-mono font-bold tracking-wide dark:bg-slate-800">{c.code}</span>
                  </td>
                  <td className="px-5 py-3 font-semibold">{discountText(c)}</td>
                  <td className="px-5 py-3 text-slate-500">
                    {c.usedCount || 0}{c.usageLimit ? ` / ${c.usageLimit}` : " (unlimited)"}
                  </td>
                  <td className="px-5 py-3">
                    {c.active ? <Badge variant="Easy">Active</Badge> : <Badge variant="neutral">Disabled</Badge>}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => toggleActive(c)} title={c.active ? "Disable" : "Enable"} className={`rounded-lg p-2 ${c.active ? "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30" : "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"}`}>
                        <Power className="h-4 w-4" />
                      </button>
                      <button onClick={() => openEdit(c)} title="Edit" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => remove(c)} title="Delete" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <form onSubmit={save} className="my-8 w-full max-w-md animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{editing ? "Edit Coupon" : "Add Coupon"}</h3>
              <button type="button" onClick={() => setModal(false)}><X className="h-5 w-5" /></button>
            </div>
            {error && <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</div>}
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Coupon code</label>
                <input required className="input font-mono uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. WELCOME10" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Discount type</label>
                  <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    <option value="flat">Flat (₹ off)</option>
                    <option value="percent">Percent (% off)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{form.type === "percent" ? "Percent off" : "Amount off (₹)"}</label>
                  <input required type="number" min={1} className="input" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Usage limit <span className="font-normal text-slate-400">(0 = unlimited)</span></label>
                <input type="number" min={0} className="input" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Active (clients can use it)
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setModal(false)} className="btn-outline">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : editing ? "Save Changes" : "Create Coupon"}</button>
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
