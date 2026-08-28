import { useEffect, useState } from "react";
import {
  BookOpen, Plus, Trash2, ChevronUp, ChevronDown, Upload, Loader2, Save,
  RotateCcw, X, CornerDownRight,
} from "lucide-react";
import { userManualService, uploadService } from "../../services";
import { DEFAULT_MANUAL, manualImageSrc } from "../client/manualDefault";
import { Loading, ErrorState } from "../../components/ui/AsyncState";

const blankEntry = () => ({
  title: "New function",
  summary: "",
  details: [],
  image: "",
  tab: "",
  children: [],
});

// --- Immutable tree helpers (path = array of child indices) -----------------
// Transform the node AT `path` with fn(node) -> node.
function mapNode(list, path, fn) {
  const [i, ...rest] = path;
  return list.map((n, idx) => {
    if (idx !== i) return n;
    if (rest.length === 0) return fn(n);
    return { ...n, children: mapNode(n.children || [], rest, fn) };
  });
}
// Transform the CHILDREN array at `parentPath` ([] = root) with fn(arr) -> arr.
function mapArray(list, parentPath, fn) {
  if (parentPath.length === 0) return fn(list);
  const [i, ...rest] = parentPath;
  return list.map((n, idx) =>
    idx !== i ? n : { ...n, children: mapArray(n.children || [], rest, fn) }
  );
}

// Admin editor for the User Manual. The whole tree is edited in local state and
// saved in one PUT. Content is shared with what clients see (client workspace
// + this admin view render from the same saved data).
export default function AdminUserManual() {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState({}); // { [pathKey]: true }

  const load = () => {
    setLoading(true);
    setError("");
    userManualService
      .get()
      .then((r) => {
        const s = Array.isArray(r?.sections) ? r.sections : [];
        // Seed the editor with the built-in content the first time (nothing
        // saved yet) so admins start from the current manual and edit it.
        setSections(s.length ? s : DEFAULT_MANUAL);
      })
      .catch((e) => setError(e.message || "Could not load the manual."))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(load, []);

  // --- operations -----------------------------------------------------------
  const setField = (path, key, value) =>
    setSections((s) => mapNode(s, path, (n) => ({ ...n, [key]: value })));
  const addChild = (nodePath) =>
    setSections((s) => mapArray(s, nodePath, (arr) => [...arr, blankEntry()]));
  const removeNode = (path) => {
    if (!window.confirm("Delete this entry and everything nested inside it?")) return;
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    setSections((s) => mapArray(s, parent, (arr) => arr.filter((_, i) => i !== idx)));
  };
  const moveNode = (path, dir) => {
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    setSections((s) =>
      mapArray(s, parent, (arr) => {
        const j = idx + dir;
        if (j < 0 || j >= arr.length) return arr;
        const copy = arr.slice();
        [copy[idx], copy[j]] = [copy[j], copy[idx]];
        return copy;
      })
    );
  };
  const addDetail = (path) =>
    setSections((s) => mapNode(s, path, (n) => ({ ...n, details: [...(n.details || []), ""] })));
  const setDetail = (path, i, value) =>
    setSections((s) =>
      mapNode(s, path, (n) => {
        const details = (n.details || []).slice();
        details[i] = value;
        return { ...n, details };
      })
    );
  const removeDetail = (path, i) =>
    setSections((s) =>
      mapNode(s, path, (n) => ({ ...n, details: (n.details || []).filter((_, k) => k !== i) }))
    );

  const onUpload = async (path, file) => {
    if (!file) return;
    const key = path.join(".");
    setUploading((u) => ({ ...u, [key]: true }));
    try {
      const res = await uploadService.file(file);
      setField(path, "image", res.url);
    } catch (e) {
      window.alert(e.message || "Image upload failed.");
    } finally {
      setUploading((u) => {
        const next = { ...u };
        delete next[key];
        return next;
      });
    }
  };

  const save = () => {
    setSaving(true);
    setMsg("");
    setError("");
    userManualService
      .update(sections)
      .then((r) => {
        if (Array.isArray(r?.sections)) setSections(r.sections);
        setMsg("Saved. Clients now see this manual.");
      })
      .catch((e) => setError(e.message || "Save failed."))
      .finally(() => setSaving(false));
  };

  // --- recursive editor for one entry --------------------------------------
  const renderNode = (node, path) => {
    const depth = path.length - 1;
    const key = path.join(".");
    const busy = !!uploading[key];
    const src = manualImageSrc(node.image);

    return (
      <div
        key={key}
        className={`rounded-xl border p-4 ${
          depth === 0
            ? "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
            : "mt-3 border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40"
        }`}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-brand-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            {depth === 0 ? "Function" : (<><CornerDownRight className="h-3 w-3" /> Level {depth + 1}</>)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => moveNode(path, -1)} title="Move up" className="btn-ghost p-1.5">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button onClick={() => moveNode(path, 1)} title="Move down" className="btn-ghost p-1.5">
              <ChevronDown className="h-4 w-4" />
            </button>
            <button onClick={() => removeNode(path)} title="Delete" className="btn-ghost p-1.5 text-rose-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Title</label>
            <input
              className="input"
              value={node.title || ""}
              onChange={(e) => setField(path, "title", e.target.value)}
              placeholder="e.g. Build"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Short summary (optional)</label>
            <input
              className="input"
              value={node.summary || ""}
              onChange={(e) => setField(path, "summary", e.target.value)}
              placeholder="One line describing this function"
            />
          </div>

          {/* Details */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Details (each line is a numbered step)</label>
            <div className="space-y-2">
              {(node.details || []).map((d, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-2 text-xs text-slate-400">{i + 1}.</span>
                  <textarea
                    className="input min-h-[38px] flex-1"
                    rows={1}
                    value={d}
                    onChange={(e) => setDetail(path, i, e.target.value)}
                    placeholder="Explain this step…"
                  />
                  <button onClick={() => removeDetail(path, i)} title="Remove line" className="btn-ghost p-1.5 text-rose-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button onClick={() => addDetail(path)} className="btn-ghost text-xs text-brand-600">
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
          </div>

          {/* Image */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Image (optional)</label>
            <div className="flex flex-wrap items-center gap-3">
              {src ? (
                <img src={src} alt="" className="h-16 w-28 rounded-lg border border-slate-200 object-cover dark:border-slate-700" />
              ) : (
                <div className="flex h-16 w-28 items-center justify-center rounded-lg border border-dashed border-slate-300 text-[11px] text-slate-400 dark:border-slate-600">
                  No image
                </div>
              )}
              <label className={`btn-outline cursor-pointer py-2 ${busy ? "pointer-events-none opacity-60" : ""}`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {busy ? "Uploading…" : "Upload image"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    onUpload(path, e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {node.image && (
                <button onClick={() => setField(path, "image", "")} className="btn-ghost text-xs text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              )}
            </div>
            <input
              className="input mt-2"
              value={node.image || ""}
              onChange={(e) => setField(path, "image", e.target.value)}
              placeholder="Or paste an image URL / built-in file name (e.g. build.png)"
            />
          </div>

          {/* Optional tab key */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              Workspace tab key (optional — shows an “Open” button for clients)
            </label>
            <input
              className="input"
              value={node.tab || ""}
              onChange={(e) => setField(path, "tab", e.target.value)}
              placeholder="dashboard, build, papers, checker, aigen, documents, notes, migrate, account"
            />
          </div>
        </div>

        {/* Sub-functions */}
        {(node.children || []).length > 0 && (
          <div className="mt-3 border-l-2 border-brand-100 pl-3 dark:border-brand-900/40">
            {(node.children || []).map((child, i) => renderNode(child, [...path, i]))}
          </div>
        )}
        <button onClick={() => addChild(path)} className="btn-ghost mt-3 text-xs text-brand-600">
          <Plus className="h-3.5 w-3.5" /> Add sub-function inside “{node.title || "this"}”
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header + actions */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <BookOpen className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold leading-none">User Manual</h1>
            <p className="mt-1 text-sm text-slate-400">
              Edit every function, sub-function, image and step here. Save to publish it to clients.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                if (window.confirm("Replace the current editor content with the built-in default manual? (You still need to Save.)"))
                  setSections(DEFAULT_MANUAL);
              }}
              className="btn-outline"
            >
              <RotateCcw className="h-4 w-4" /> Load default
            </button>
            <button onClick={save} disabled={saving || loading} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
        {msg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">{msg}</p>}
        {error && !loading && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
      </div>

      {loading ? (
        <div className="card p-6"><Loading label="Loading the manual…" /></div>
      ) : error ? (
        <div className="card p-6"><ErrorState message={error} onRetry={load} /></div>
      ) : (
        <div className="space-y-4">
          {sections.map((node, i) => renderNode(node, [i]))}
          <button onClick={() => addChild([])} className="btn-outline w-full">
            <Plus className="h-4 w-4" /> Add a top-level function
          </button>
        </div>
      )}
    </div>
  );
}
