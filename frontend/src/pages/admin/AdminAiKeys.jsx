import { useEffect, useState, useCallback } from "react";
import { KeyRound, Plus, Trash2, Pencil, X, CheckCircle2, XCircle, Loader2, RefreshCw, Power, PowerOff, Download, List, Layers, Wand2, AlertTriangle, Eye, EyeOff, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { aiService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const PRESETS = [
  // gemini-3.5-flash-lite is the current default: a newer lite model that returns
  // cleaner JSON (fewer empty replies) than 2.5-flash-lite while keeping a generous
  // free tier. If a key ever 404s on it, use "Show models"/Auto-pick to fall back.
  { label: "Google Gemini", baseUrl: GEMINI_BASE, models: "gemini-3.5-flash-lite" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", models: "gpt-4o-mini" },
  { label: "TokenLab", baseUrl: "https://api.tokenlab.sh/v1", models: "gpt-4o-mini" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", models: "llama-3.3-70b-versatile" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", models: "deepseek-chat" },
  // OpenRouter — one key, hundreds of models (incl. free ":free" ones and Claude/Gemini/GPT).
  // After adding the key, use the "Show models" button to pick a valid model id.
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", models: "deepseek/deepseek-chat" },
  // AgentRouter (agentrouter.org) — OpenAI-compatible gateway aggregating GPT /
  // Claude / Gemini / DeepSeek behind one key. After adding, use "Show models"
  // (or Auto-pick) to set a valid model id.
  { label: "AgentRouter", baseUrl: "https://agentrouter.org/v1", models: "gpt-4o-mini" },
  // Kiro has no official public API — it works via a self-hosted "Kiro gateway"
  // (OpenAI-compatible). Replace the Base URL with YOUR gateway's public address.
  { label: "Kiro", baseUrl: "https://your-kiro-gateway/v1", models: "claude-sonnet-4" },
];

const blank = { label: "", baseUrl: GEMINI_BASE, models: "gemini-3.5-flash-lite", key: "", creditLimit: "", autoDetect: true };
// Bulk-add defaults: one shared preset applied to every pasted key.
const blankBulk = { label: "", baseUrl: GEMINI_BASE, models: "gemini-3.5-flash-lite", creditLimit: "", keysText: "" };

const PER_PAGE = 10; // keys shown per page; bulk actions are scoped to the current page

// Built-in models offered by the "Set model" control, all served on the Gemini
// base URL (so your existing Google keys can use them — no new key needed). The
// first entry is the default. gemini-3.5-flash-lite leads: newer, cleaner JSON and
// fewer empty replies than 2.5-flash-lite. The 3.6 ids are the newest generation;
// the gemma-3-* ids are Google's open Gemma models on the SAME endpoint. Not every
// free key/project serves every model, so test a new pick on ONE key first before
// applying it to all.
const GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "gemini-3.5-flash-lite — recommended (newer, cleaner JSON)" },
  { id: "gemini-3.6-flash-lite", label: "gemini-3.6-flash-lite — newest lite (test on one key first)" },
  { id: "gemini-3.6-flash", label: "gemini-3.6-flash — newest (higher quality)" },
  { id: "gemini-3.5-flash", label: "gemini-3.5-flash — near-Pro quality" },
  { id: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite — free 15 RPM · 1,000/day (best quota)" },
  { id: "gemini-2.5-flash", label: "gemini-2.5-flash — free 10 RPM · 250/day" },
  { id: "gemini-2.5-pro", label: "gemini-2.5-pro — free 5 RPM · 100/day" },
  { id: "gemini-2.0-flash", label: "gemini-2.0-flash" },
  { id: "gemini-2.0-flash-lite", label: "gemini-2.0-flash-lite" },
  { id: "gemma-3-27b-it", label: "gemma-3-27b-it — Gemma, best quality (test on one key first)" },
  { id: "gemma-3-12b-it", label: "gemma-3-12b-it — Gemma, lighter" },
  { id: "gemma-3-4b-it", label: "gemma-3-4b-it — Gemma, lightest/fastest" },
  { id: "gemini-flash-latest", label: "gemini-flash-latest (alias)" },
  { id: "gemini-flash-lite-latest", label: "gemini-flash-lite-latest (alias)" },
];

// Compact number formatter (1234567 -> "1.23M", 12345 -> "12.3K").
const fmt = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.?0+$/, "") + "K";
  return String(v);
};

// `clientMode` renders the same manager for a self-service client: the backend
// scopes every call to the client's OWN keys, so add / bulk-add / test / test-all
// / refresh / delete all work unchanged. Only the heading copy differs, and
// server/env-key features never appear (the API doesn't return them to clients).
export default function AdminAiKeys({ clientMode = false }) {
  const [keys, setKeys] = useState([]);
  const [models, setModels] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // { mode:"add"|"edit", data }
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false); // reveal the API key text in the add/edit modal
  const [revealing, setRevealing] = useState(false); // fetching the stored key for the edit modal
  const [copied, setCopied] = useState(false); // brief "Copied!" state after copying the key
  const [detecting, setDetecting] = useState(false); // auto-detecting a working model after add
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkForm, setBulkForm] = useState(blankBulk);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState(null); // { created, skipped } after a bulk add
  const [testing, setTesting] = useState({}); // id -> bool
  const [openError, setOpenError] = useState({}); // id -> bool (tap a key's error to expand the full text)
  const [busy, setBusy] = useState({}); // id -> bool (toggle/delete)
  const [bulkBusy, setBulkBusy] = useState(""); // "" | "test" | "import"
  const [keyModels, setKeyModels] = useState({}); // id -> available model ids
  const [modelsBusy, setModelsBusy] = useState({}); // id -> bool
  const [modelSearch, setModelSearch] = useState({}); // id -> filter text
  const [page, setPage] = useState(0); // current page (0-based)
  const [selected, setSelected] = useState(() => new Set()); // ids ticked for bulk delete
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [pageModel, setPageModel] = useState(GEMINI_MODELS[0].id); // model to apply to the current page
  const [scope, setScope] = useState("page"); // "page" | "all" — what bulk actions target
  // Custom model ids the admin adds by hand — persisted in the browser so they
  // stay in the dropdown across reloads.
  const [customModels, setCustomModels] = useState(() => {
    try { return JSON.parse(localStorage.getItem("aiKeys.customModels") || "[]").filter(Boolean); } catch { return []; }
  });
  const [newModel, setNewModel] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    aiService.keys
      .list()
      .then((res) => {
        // Backward/forward compatible: response is { keys, models } or a raw array.
        const list = Array.isArray(res) ? res : res?.keys || [];
        setKeys(list);
        setModels(Array.isArray(res) ? [] : res?.models || []);
        setTotals(Array.isArray(res) ? null : res?.totals || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  // Pagination — 10 keys per page. The bulk actions (test / auto-pick / enable /
  // disable) run ONLY over `pageKeys`, so e.g. "Test all" on page 3 tests just
  // that page's 10 keys and never touches other pages.
  const pageCount = Math.max(1, Math.ceil(keys.length / PER_PAGE));
  const curPage = Math.min(page, pageCount - 1);
  const pageStart = curPage * PER_PAGE;
  const pageKeys = keys.slice(pageStart, pageStart + PER_PAGE);

  // Scope for the bulk actions: just the current page, or every key on all pages
  // (so all keys can be tested / model-set / enabled together and work as one pool).
  const scopeAll = scope === "all";
  const scopeLabel = scopeAll ? "all pages" : `page ${curPage + 1}`;

  // ---- Multi-select delete (tick keys, delete them together) ----------------
  // Selectable for bulk delete = a real deletable key. Only ENV/server keys
  // (source "env", read-only) are excluded — every saved key now carries
  // source "db", so the old `!k.source` check wrongly matched NOTHING and the
  // select checkboxes did nothing.
  const selectableOnPage = pageKeys.filter((k) => !k.readOnly && k.source !== "env");
  const allPageSelected = selectableOnPage.length > 0 && selectableOnPage.every((k) => selected.has(k._id));
  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAllPage = () => setSelected((s) => {
    const n = new Set(s);
    if (allPageSelected) selectableOnPage.forEach((k) => n.delete(k._id));
    else selectableOnPage.forEach((k) => n.add(k._id));
    return n;
  });
  const clearSelection = () => setSelected(new Set());

  // Add a hand-typed model id to the dropdown and persist it (browser-local).
  const addCustomModel = () => {
    const id = newModel.trim();
    if (!id) return;
    const known = GEMINI_MODELS.some((m) => m.id === id) || customModels.includes(id);
    if (!known) {
      const next = [...customModels, id];
      setCustomModels(next);
      try { localStorage.setItem("aiKeys.customModels", JSON.stringify(next)); } catch { /* ignore */ }
    }
    setPageModel(id);
    setNewModel("");
  };
  const removeCustomModel = (id) => {
    const next = customModels.filter((m) => m !== id);
    setCustomModels(next);
    try { localStorage.setItem("aiKeys.customModels", JSON.stringify(next)); } catch { /* ignore */ }
    if (pageModel === id) setPageModel(GEMINI_MODELS[0].id);
  };

  // Set one model on every (editable) key in the current scope (this page / all pages).
  const applyModelToPage = async () => {
    const model = pageModel.trim();
    const targets = (scopeAll ? keys : pageKeys).filter((k) => !k.readOnly);
    if (!targets.length || !model) return;
    // Remember a hand-typed model so it stays in the list next time.
    if (!GEMINI_MODELS.some((m) => m.id === model) && !customModels.includes(model)) {
      const next = [...customModels, model];
      setCustomModels(next);
      try { localStorage.setItem("aiKeys.customModels", JSON.stringify(next)); } catch { /* ignore */ }
    }
    setBulkBusy("pagemodel");
    setError("");
    try {
      await Promise.allSettled(targets.map((k) => aiService.keys.update(k._id, { models: model })));
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy("");
    }
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected key(s)? This cannot be undone.`)) return;
    setBulkDeleting(true);
    setError("");
    try {
      await Promise.allSettled(ids.map((id) => aiService.keys.remove(id)));
      clearSelection();
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  // Copy the current key value to the clipboard. Falls back to a hidden textarea
  // + execCommand for older / non-secure-context mobile browsers where
  // navigator.clipboard is unavailable.
  const copyKey = async () => {
    const text = String(form.key || "");
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can still select the revealed text manually */
    }
  };

  const openAdd = () => { setForm(blank); setShowKey(false); setCopied(false); setModal({ mode: "add" }); };
  const openEdit = (k) => {
    setShowKey(false);
    setCopied(false);
    setForm({ label: k.label || "", baseUrl: k.baseUrl, models: k.models, key: "", creditLimit: k.creditLimit || "" }); // key blank = keep existing
    setModal({ mode: "edit", data: k });
    // Env/server keys aren't stored in the DB, so there's nothing to reveal.
    if (k.readOnly || k.source === "env") return;
    // Pull the real stored key so the owner can see / copy / edit it. Falls back
    // silently to the "leave blank to keep" behaviour if the fetch fails.
    setRevealing(true);
    aiService.keys
      .reveal(k._id)
      .then((res) => {
        const real = typeof res === "string" ? res : res?.key || "";
        // Only fill if the user hasn't already started typing a replacement.
        setForm((f) => (f.key ? f : { ...f, key: real }));
      })
      .catch(() => { /* keep blank = keep existing */ })
      .finally(() => setRevealing(false));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (modal.mode === "add") {
        if (!form.key.trim()) throw new Error("Paste the API key.");
        const created = await aiService.keys.create(form);
        // Auto-find a working model for the pasted key before closing.
        if (form.autoDetect && created?._id) {
          setDetecting(true);
          try { await aiService.keys.autoModel(created._id); } catch { /* keep the key even if detection fails */ }
          setDetecting(false);
        }
      } else {
        await aiService.keys.update(modal.data._id, form); // blank key keeps the old one
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
      setDetecting(false);
    }
  };

  // Auto-detect + set a working model for an existing key (magic-wand button).
  const autoDetectOne = async (k) => {
    setBusy((b) => ({ ...b, [k._id]: true }));
    setError("");
    try {
      const res = await aiService.keys.autoModel(k._id);
      load();
      if (res && res.ok === false) setError(res.error || "No working model found for this key.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy((b) => ({ ...b, [k._id]: false }));
    }
  };

  const openBulk = () => { setBulkForm(blankBulk); setBulkResult(null); setBulkModal(true); };

  // Split the textarea into individual keys (one per line; commas/spaces also
  // work). API keys never contain spaces, so this is safe.
  const parseBulkKeys = (text) => {
    const seen = new Set();
    return String(text || "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s && !seen.has(s) && seen.add(s));
  };

  const saveBulk = async (e) => {
    e.preventDefault();
    const list = parseBulkKeys(bulkForm.keysText);
    if (!list.length) { setError("Paste at least one API key (one per line)."); return; }
    setBulkSaving(true);
    setError("");
    try {
      const res = await aiService.keys.bulkCreate({
        keys: list,
        baseUrl: bulkForm.baseUrl,
        models: bulkForm.models,
        creditLimit: bulkForm.creditLimit,
        label: bulkForm.label,
      });
      setBulkResult({ created: res?.created || 0, skipped: res?.skipped || 0 });
      setBulkForm((f) => ({ ...f, keysText: "" })); // clear pasted keys, keep the preset
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkSaving(false);
    }
  };

  const test = async (id) => {
    setTesting((t) => ({ ...t, [id]: true }));
    try {
      await aiService.keys.test(id);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setTesting((t) => ({ ...t, [id]: false }));
    }
  };

  // Ask the provider which models THIS key can use, and show them as chips.
  const showModels = async (k) => {
    setModelsBusy((b) => ({ ...b, [k._id]: true }));
    setError("");
    try {
      const res = await aiService.keys.models(k._id);
      setKeyModels((s) => ({ ...s, [k._id]: res.models || [] }));
    } catch (e) {
      setError(`Couldn't list models: ${e.message}`);
    } finally {
      setModelsBusy((b) => ({ ...b, [k._id]: false }));
    }
  };
  // Set a key's model to the chosen id, then refresh.
  const pickModel = async (k, m) => {
    try {
      await aiService.keys.update(k._id, { models: m });
      setKeyModels((s) => { const c = { ...s }; delete c[k._id]; return c; });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const toggle = async (k) => {
    setBusy((b) => ({ ...b, [k._id]: true }));
    try {
      await aiService.keys.update(k._id, { enabled: !k.enabled });
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy((b) => ({ ...b, [k._id]: false }));
    }
  };

  const remove = async (k) => {
    if (!window.confirm(`Delete the key "${k.label || k.keyMask}"? This cannot be undone.`)) return;
    setBusy((b) => ({ ...b, [k._id]: true }));
    try {
      await aiService.keys.remove(k._id);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy((b) => ({ ...b, [k._id]: false }));
    }
  };

  const importOne = async (k) => {
    // Import a single Render env key into the DB so it becomes manageable.
    setBusy((b) => ({ ...b, [k._id]: true }));
    try {
      await aiService.keys.importEnv();
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy((b) => ({ ...b, [k._id]: false }));
    }
  };

  const importAll = async () => {
    setBulkBusy("import");
    try {
      const res = await aiService.keys.importEnv();
      load();
      if (!res?.imported) setError("No new server keys to import (they may already be in the panel).");
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy("");
    }
  };

  // Test keys — the whole pool ("all pages") or just this page.
  const testAll = async () => {
    if (scopeAll) {
      setBulkBusy("test"); setError("");
      try { await aiService.keys.testAll(); load(); } catch (e) { setError(e.message); } finally { setBulkBusy(""); }
      return;
    }
    const targets = pageKeys.filter((k) => !k.readOnly);
    if (!targets.length) return;
    setBulkBusy("test");
    setTesting((t) => { const n = { ...t }; targets.forEach((k) => (n[k._id] = true)); return n; });
    try {
      await Promise.allSettled(targets.map((k) => aiService.keys.test(k._id)));
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy("");
      setTesting((t) => { const n = { ...t }; targets.forEach((k) => (n[k._id] = false)); return n; });
    }
  };

  // Enable / disable keys — the whole pool ("all pages") or just this page.
  const setAllEnabled = async (enabled) => {
    if (scopeAll) {
      if (!enabled && !window.confirm("Disable ALL keys on every page? The AI Generator won't work until you enable at least one again.")) return;
      setBulkBusy(enabled ? "enableall" : "disableall"); setError("");
      try { await aiService.keys.setAllEnabled(enabled); load(); } catch (e) { setError(e.message); } finally { setBulkBusy(""); }
      return;
    }
    const targets = pageKeys.filter((k) => !k.readOnly);
    if (!targets.length) return;
    if (!enabled && !window.confirm(`Disable the ${targets.length} key(s) on this page? Keys on other pages are unaffected.`)) return;
    setBulkBusy(enabled ? "enableall" : "disableall");
    setError("");
    try {
      await Promise.allSettled(targets.map((k) => aiService.keys.update(k._id, { enabled })));
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy("");
    }
  };

  // Auto-detect the best working model — the whole pool ("all pages") or this page.
  const autoModelAll = async () => {
    if (scopeAll) {
      setBulkBusy("automodel"); setError("");
      try {
        const res = await aiService.keys.autoModelAll();
        load();
        if (res && typeof res.ok === "number" && res.ok < (res.total || 0)) {
          setError(`Auto-picked models for ${res.ok} of ${res.total} key(s). ${res.failed} couldn't find a working model (invalid key or out of quota).`);
        }
      } catch (e) { setError(e.message); } finally { setBulkBusy(""); }
      return;
    }
    const targets = pageKeys.filter((k) => !k.readOnly);
    if (!targets.length) return;
    setBulkBusy("automodel");
    setError("");
    try {
      const results = await Promise.allSettled(targets.map((k) => aiService.keys.autoModel(k._id)));
      load();
      const ok = results.filter((r) => r.status === "fulfilled" && r.value?.ok !== false).length;
      if (ok < targets.length) {
        setError(`Auto-picked models for ${ok} of ${targets.length} key(s) on this page. The rest couldn't find a working model (invalid key or out of quota).`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy("");
    }
  };

  const hasEnvKeys = keys.some((k) => k.source === "env");
  const activeCount = keys.filter((k) => k.enabled).length;

  const StatusBadge = ({ k }) => {
    if (!k.enabled) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800">Disabled</span>;
    if (k.lastStatus === "ok") return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Active</span>;
    if (k.lastStatus === "limited") {
      const cls = "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
      return k.lastError
        ? <button type="button" onClick={() => setOpenError((s) => ({ ...s, [k._id]: !s[k._id] }))} title="Tap to see the full error" className={cls}><AlertTriangle className="h-3.5 w-3.5" /> Rate-limited</button>
        : <span className={cls}><AlertTriangle className="h-3.5 w-3.5" /> Rate-limited</span>;
    }
    if (k.lastStatus === "error") {
      const cls = "inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
      return k.lastError
        ? <button type="button" onClick={() => setOpenError((s) => ({ ...s, [k._id]: !s[k._id] }))} title="Tap to see the full error" className={cls}><XCircle className="h-3.5 w-3.5" /> Not working</button>
        : <span className={cls}><XCircle className="h-3.5 w-3.5" /> Not working</span>;
    }
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800">Untested</span>;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{clientMode ? "My API Keys" : "AI API Keys"}</h1>
          <p className="text-slate-500 dark:text-slate-400">
            {clientMode
              ? "Add your own AI provider keys. Several keys on the same model act as quota fallbacks —"
              : "Add the keys the AI Generator uses. Enabled keys with the same model act as quota fallbacks —"}
            <span className="font-semibold text-emerald-600 dark:text-emerald-400"> {activeCount} enabled</span>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} disabled={loading} className="btn-outline" title="Refresh usage & totals">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          {keys.length > PER_PAGE && (
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5 dark:border-slate-700" title="Choose whether the bulk actions affect only this page or every key on all pages">
              <button onClick={() => setScope("page")} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${!scopeAll ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>This page</button>
              <button onClick={() => setScope("all")} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${scopeAll ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>All pages</button>
            </div>
          )}
          {keys.length > 0 && (
            <button onClick={testAll} disabled={bulkBusy === "test"} className="btn-outline" title={`Test the keys on ${scopeLabel}`}>
              {bulkBusy === "test" ? <><Loader2 className="h-4 w-4 animate-spin" /> Testing…</> : <><RefreshCw className="h-4 w-4" /> Test ({scopeLabel})</>}
            </button>
          )}
          {keys.length > 0 && (
            <button onClick={autoModelAll} disabled={bulkBusy === "automodel"} className="btn-outline" title={`Auto-detect & set the best working model for the keys on ${scopeLabel}`}>
              {bulkBusy === "automodel" ? <><Loader2 className="h-4 w-4 animate-spin" /> Picking models…</> : <><Wand2 className="h-4 w-4" /> Auto-pick ({scopeLabel})</>}
            </button>
          )}
          {keys.length > 0 && (
            <button onClick={() => setAllEnabled(true)} disabled={bulkBusy === "enableall"} className="btn-outline" title={`Enable the keys on ${scopeLabel}`}>
              {bulkBusy === "enableall" ? <><Loader2 className="h-4 w-4 animate-spin" /> Enabling…</> : <><Power className="h-4 w-4" /> Enable ({scopeLabel})</>}
            </button>
          )}
          {keys.length > 0 && (
            <button onClick={() => setAllEnabled(false)} disabled={bulkBusy === "disableall"} className="btn-outline !text-rose-600 dark:!text-rose-400" title={`Disable the keys on ${scopeLabel}`}>
              {bulkBusy === "disableall" ? <><Loader2 className="h-4 w-4 animate-spin" /> Disabling…</> : <><PowerOff className="h-4 w-4" /> Disable ({scopeLabel})</>}
            </button>
          )}
          {hasEnvKeys && (
            <button onClick={importAll} disabled={bulkBusy === "import"} className="btn-outline">
              {bulkBusy === "import" ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : <><Download className="h-4 w-4" /> Import server keys</>}
            </button>
          )}
          <button onClick={openBulk} className="btn-outline"><Layers className="h-4 w-4" /> Bulk add</button>
          <button onClick={openAdd} className="btn-primary"><Plus className="h-4 w-4" /> Add API Key</button>
        </div>
      </div>

      {models.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <p className="mb-1.5 text-sm font-semibold">Models available in the generator ({models.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <span key={m} className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{m}</span>
            ))}
          </div>
        </div>
      )}

      {totals && (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Requests used</p>
              <p className="text-xl font-extrabold">{fmt(totals.totalRequests)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Tokens used</p>
              <p className="text-xl font-extrabold">{fmt(totals.totalTokens)}</p>
            </div>
            <div className={`rounded-xl border p-3 ${totals.hasLimits ? "border-slate-200 dark:border-slate-700" : "border-dashed border-slate-200 opacity-60 dark:border-slate-700"}`}>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total credits</p>
              <p className="text-xl font-extrabold">{totals.hasLimits ? fmt(totals.totalCredits) : "—"}</p>
            </div>
            <div className={`rounded-xl border p-3 ${totals.hasLimits ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-900/10" : "border-dashed border-slate-200 opacity-60 dark:border-slate-700"}`}>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Remaining</p>
              <p className="text-xl font-extrabold text-emerald-700 dark:text-emerald-300">{totals.hasLimits ? fmt(totals.totalRemaining) : "—"}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Usage is counted by this site (real). Providers like Gemini/OpenAI don't expose your remaining balance via API —
            set a <b>credit limit</b> (token budget) on a key to see “credits” and “remaining”. Credits &amp; remaining count only keys that have a limit set.
          </p>
        </div>
      )}

      {loading ? (
        <Loading label="Loading keys..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : keys.length === 0 ? (
        <EmptyState message="No API keys yet. Click “Add API Key” to add your first one." />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={allPageSelected} onChange={toggleSelectAllPage} disabled={selectableOnPage.length === 0} />
              Select all on this page
              <span className="text-slate-400">· showing <b>{pageStart + 1}–{Math.min(pageStart + PER_PAGE, keys.length)}</b> of <b>{keys.length}</b> · page {curPage + 1}/{pageCount}</span>
            </label>
            {selected.size > 0 ? (
              <span className="flex items-center gap-2">
                <span className="font-semibold text-slate-600 dark:text-slate-300">{selected.size} selected</span>
                <button onClick={deleteSelected} disabled={bulkDeleting} className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                  {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete selected
                </button>
                <button onClick={clearSelection} disabled={bulkDeleting} className="rounded-lg border border-slate-200 px-2 py-1 font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Clear</button>
              </span>
            ) : (
              <span className="text-slate-400">Bulk actions above apply to this page only</span>
            )}
          </div>

          {/* Per-page model setter — apply a built-in OR custom model to every key on this page. */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/40">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Set model for {scopeLabel}:</span>
              {/* Editable combobox: pick from the list OR type any model id directly. */}
              <input
                list="ai-model-list"
                value={pageModel}
                onChange={(e) => setPageModel(e.target.value)}
                placeholder="Type or pick a model (e.g. gemini-2.5-flash-lite)"
                className="input !w-auto min-w-[15rem] py-1 text-xs"
              />
              <datalist id="ai-model-list">
                {GEMINI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                {customModels.map((m) => <option key={m} value={m} />)}
              </datalist>
              <button onClick={applyModelToPage} disabled={bulkBusy === "pagemodel"} className="btn-primary py-1 text-xs">
                {bulkBusy === "pagemodel" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying…</> : <><Wand2 className="h-3.5 w-3.5" /> Apply to {scopeLabel}</>}
              </button>
              <span className="text-slate-400">Applies to the {(scopeAll ? keys : pageKeys).filter((k) => !k.readOnly).length} key(s) on {scopeLabel}.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400">Add a custom model:</span>
              <input
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomModel(); } }}
                placeholder="e.g. gemini-3-flash-preview"
                className="input !w-auto py-1 text-xs"
              />
              <button onClick={addCustomModel} disabled={!newModel.trim()} className="btn-outline py-1 text-xs"><Plus className="h-3.5 w-3.5" /> Add &amp; save</button>
              {customModels.map((m) => (
                <span key={m} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {m}
                  <button onClick={() => removeCustomModel(m)} title="Remove this saved model" className="text-slate-400 hover:text-rose-600"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          </div>
          {pageKeys.map((k) => (
            <div key={k._id} className={`card flex flex-wrap items-center justify-between gap-3 p-4 ${selected.has(k._id) ? "ring-2 ring-rose-400 dark:ring-rose-500/60" : ""}`}>
              {!k.readOnly && k.source !== "env" && (
                <input
                  type="checkbox"
                  className="h-4 w-4 flex-shrink-0 accent-rose-600"
                  checked={selected.has(k._id)}
                  onChange={() => toggleSelect(k._id)}
                  title="Select for bulk delete"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">{k.label || "Untitled key"}</p>
                  <StatusBadge k={k} />
                  {k.source === "env" && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800">From server (Render)</span>
                  )}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800">{k.keyMask}</code>
                </div>
                <p className="mt-1 truncate text-xs text-slate-400">
                  {k.models} · {k.baseUrl}
                </p>
                {(k.lastStatus === "error" || k.lastStatus === "limited") && k.lastError && (
                  <button
                    type="button"
                    onClick={() => setOpenError((s) => ({ ...s, [k._id]: !s[k._id] }))}
                    aria-expanded={!!openError[k._id]}
                    title={openError[k._id] ? "Hide full error" : "Tap to see the full error"}
                    className={`mt-1 flex w-full items-start gap-1 rounded text-left text-xs ${k.lastStatus === "limited" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span className={`min-w-0 flex-1 ${openError[k._id] ? "whitespace-pre-wrap break-words" : "truncate"}`}>{k.lastError}</span>
                    {openError[k._id] ? <ChevronUp className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> : <ChevronDown className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />}
                  </button>
                )}
                {k.source !== "env" && (
                  <p className="mt-1 text-xs text-slate-400">
                    <span className="font-semibold text-slate-500 dark:text-slate-300">{fmt(k.usedRequests)}</span> requests ·{" "}
                    <span className="font-semibold text-slate-500 dark:text-slate-300">{fmt(k.usedTokens)}</span> tokens used
                    {k.creditLimit > 0 && (
                      <> · limit <span className="font-semibold text-slate-500 dark:text-slate-300">{fmt(k.creditLimit)}</span> · <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmt(Math.max(0, k.creditLimit - k.usedTokens))} left</span></>
                    )}
                  </p>
                )}
              </div>
              {k.readOnly ? (
                <button onClick={() => importOne(k)} disabled={busy[k._id]} className="btn-outline flex-shrink-0 py-1.5 text-xs">
                  {busy[k._id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Import to manage
                </button>
              ) : (
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button onClick={() => autoDetectOne(k)} disabled={busy[k._id]} title="Auto-detect & set the best (highest) working model" className="rounded-lg p-2 text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:hover:bg-accent-900/30">
                    {busy[k._id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  </button>
                  <button onClick={() => showModels(k)} disabled={modelsBusy[k._id]} title="Show models this key can use" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">
                    {modelsBusy[k._id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <List className="h-4 w-4" />}
                  </button>
                  <button onClick={() => test(k._id)} disabled={testing[k._id]} title="Test this key now" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:hover:bg-brand-900/30">
                    {testing[k._id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </button>
                  <button onClick={() => toggle(k)} disabled={busy[k._id]} title={k.enabled ? "Disable" : "Enable"} className={`rounded-lg p-2 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800 ${k.enabled ? "text-emerald-600" : "text-slate-400"}`}>
                    <Power className="h-4 w-4" />
                  </button>
                  <button onClick={() => openEdit(k)} title="Edit" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(k)} disabled={busy[k._id]} title="Delete" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-900/30">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}

              {keyModels[k._id] && (
                <div className="w-full border-t border-slate-100 pt-2 dark:border-slate-800">
                  <p className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Models this key can use — click one to set it:
                  </p>
                  {keyModels[k._id].length === 0 ? (
                    <p className="text-xs text-slate-400">No models returned — the key may be invalid or out of quota.</p>
                  ) : (() => {
                    const q = (modelSearch[k._id] || "").toLowerCase().trim();
                    const filtered = keyModels[k._id].filter((m) => m.toLowerCase().includes(q));
                    return (
                      <>
                        <input
                          value={modelSearch[k._id] || ""}
                          onChange={(e) => setModelSearch((s) => ({ ...s, [k._id]: e.target.value }))}
                          placeholder={`Search ${keyModels[k._id].length} models…  (e.g. "flash", ":free", "claude")`}
                          className="input mb-2 py-1 text-xs"
                        />
                        {filtered.length === 0 ? (
                          <p className="text-xs text-slate-400">No models match “{modelSearch[k._id]}”.</p>
                        ) : (
                          <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                            {filtered.map((m) => (
                              <button
                                key={m}
                                onClick={() => pickModel(k, m)}
                                title="Use this model for this key"
                                className={`rounded-full border px-2 py-0.5 text-xs font-medium transition ${
                                  k.models === m
                                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                                    : "border-slate-200 text-slate-600 hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300"
                                }`}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          ))}

          {pageCount > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
              <button onClick={() => setPage(0)} disabled={curPage === 0} className="btn-outline px-2 py-1 text-xs disabled:opacity-40">« First</button>
              <button onClick={() => setPage((p) => Math.max(0, Math.min(p, pageCount - 1) - 1))} disabled={curPage === 0} className="btn-outline px-2 py-1 text-xs disabled:opacity-40">‹ Prev</button>
              {Array.from({ length: pageCount }, (_, i) => i)
                .filter((i) => i === 0 || i === pageCount - 1 || Math.abs(i - curPage) <= 2)
                .reduce((acc, i) => { if (acc.length && i - acc[acc.length - 1] > 1) acc.push("…"); acc.push(i); return acc; }, [])
                .map((i, idx) => (i === "…"
                  ? <span key={`gap${idx}`} className="px-1 text-slate-400">…</span>
                  : <button key={i} onClick={() => setPage(i)} className={`min-w-[2rem] rounded-lg border px-2 py-1 text-xs font-semibold ${i === curPage ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300" : "border-slate-200 text-slate-600 hover:border-brand-500 dark:border-slate-700 dark:text-slate-300"}`}>{i + 1}</button>
                ))}
              <button onClick={() => setPage((p) => Math.min(pageCount - 1, Math.min(p, pageCount - 1) + 1))} disabled={curPage >= pageCount - 1} className="btn-outline px-2 py-1 text-xs disabled:opacity-40">Next ›</button>
              <button onClick={() => setPage(pageCount - 1)} disabled={curPage >= pageCount - 1} className="btn-outline px-2 py-1 text-xs disabled:opacity-40">Last »</button>
            </div>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <form onSubmit={save} className="my-8 w-full max-w-lg animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold"><KeyRound className="h-5 w-5 text-brand-600" /> {modal.mode === "add" ? "Add API Key" : "Edit API Key"}</h3>
              <button type="button" onClick={() => setModal(null)}><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-semibold">Provider preset</label>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button key={p.label} type="button" onClick={() => setForm((f) => ({ ...f, baseUrl: p.baseUrl, models: p.models, label: f.label || p.label }))}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300">
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">Label</label>
                <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Gemini account 1" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">API key {modal.mode === "edit" && <span className="font-normal text-slate-400">(leave blank to keep the current one)</span>}</label>
                <div className="relative">
                  <input
                    className="input pr-20"
                    type={showKey ? "text" : "password"}
                    value={form.key}
                    onChange={(e) => setForm({ ...form, key: e.target.value })}
                    placeholder={revealing ? "Loading current key…" : modal.mode === "edit" ? "•••• (unchanged)" : "Paste the API key"}
                    autoComplete="off"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center">
                    {form.key && (
                      <button
                        type="button"
                        onClick={copyKey}
                        title={copied ? "Copied!" : "Copy key"}
                        aria-label={copied ? "Copied" : "Copy key"}
                        className="flex items-center px-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      title={showKey ? "Hide key" : "Show key"}
                      aria-label={showKey ? "Hide key" : "Show key"}
                      className="flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {revealing ? <Loader2 className="h-4 w-4 animate-spin" /> : showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">Base URL</label>
                <input className="input" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={GEMINI_BASE} />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">Model(s) {modal.mode === "add" && form.autoDetect && <span className="font-normal text-slate-400">(auto-detected — optional)</span>}</label>
                <input className="input" value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} placeholder="gemini-2.5-flash" />
                <p className="mt-1 text-xs text-slate-400">Comma-separate multiple models. Use the <b>same</b> model on several keys to make them quota fallbacks.</p>
              </div>

              {modal.mode === "add" && (
                <label className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm dark:bg-brand-900/20">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={form.autoDetect} onChange={(e) => setForm({ ...form, autoDetect: e.target.checked })} />
                  <span><b>Auto-detect the best model</b> — after adding, I'll test the key's models and set the highest one that works, falling back to a lighter one if needed (recommended).</span>
                </label>
              )}

              <div>
                <label className="mb-1 block text-sm font-semibold">Credit limit <span className="font-normal text-slate-400">(tokens, optional)</span></label>
                <input type="number" min="0" className="input" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} placeholder="e.g. 1000000" />
                <p className="mt-1 text-xs text-slate-400">Your total token budget for this key. Leave blank/0 if unknown — providers don't share it, so this is a manual figure used to show “remaining”.</p>
              </div>

              {modal.mode === "edit" && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!form.resetUsage} onChange={(e) => setForm({ ...form, resetUsage: e.target.checked })} />
                  Reset this key's usage counters to zero
                </label>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-outline">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{detecting ? <><Loader2 className="h-4 w-4 animate-spin" /> Finding a working model…</> : saving ? "Saving..." : modal.mode === "add" ? "Add Key" : "Save Changes"}</button>
            </div>
          </form>
        </div>
      )}

      {bulkModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <form onSubmit={saveBulk} className="my-8 w-full max-w-lg animate-scale-in card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold"><Layers className="h-5 w-5 text-brand-600" /> Bulk add API keys</h3>
              <button type="button" onClick={() => setBulkModal(null)}><X className="h-5 w-5" /></button>
            </div>

            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
              Paste several keys of the <b>same provider</b> — one per line. They'll all share the
              preset below. Adding several keys on the same model turns them into quota fallbacks.
            </p>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-semibold">Provider preset</label>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button key={p.label} type="button" onClick={() => setBulkForm((f) => ({ ...f, baseUrl: p.baseUrl, models: p.models, label: f.label || p.label }))}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300">
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">Label prefix <span className="font-normal text-slate-400">(optional)</span></label>
                <input className="input" value={bulkForm.label} onChange={(e) => setBulkForm({ ...bulkForm, label: e.target.value })} placeholder="e.g. Gemini — keys are numbered “Gemini 1”, “Gemini 2”…" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">Base URL</label>
                <input className="input" value={bulkForm.baseUrl} onChange={(e) => setBulkForm({ ...bulkForm, baseUrl: e.target.value })} placeholder={GEMINI_BASE} />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">Model(s)</label>
                <input className="input" value={bulkForm.models} onChange={(e) => setBulkForm({ ...bulkForm, models: e.target.value })} placeholder="gemini-2.5-flash" />
                <p className="mt-1 text-xs text-slate-400">Comma-separate multiple models. Applied to every key in the paste.</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">Credit limit <span className="font-normal text-slate-400">(tokens, optional)</span></label>
                <input type="number" min="0" className="input" value={bulkForm.creditLimit} onChange={(e) => setBulkForm({ ...bulkForm, creditLimit: e.target.value })} placeholder="e.g. 1000000" />
                <p className="mt-1 text-xs text-slate-400">Same budget applied to each key. Leave blank/0 if unknown.</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">API keys <span className="font-normal text-slate-400">(one per line)</span></label>
                <textarea
                  className="input min-h-[140px] font-mono text-xs"
                  value={bulkForm.keysText}
                  onChange={(e) => setBulkForm({ ...bulkForm, keysText: e.target.value })}
                  placeholder={"AIzaSy...key1\nAIzaSy...key2\nAIzaSy...key3"}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="mt-1 text-xs text-slate-400">
                  {parseBulkKeys(bulkForm.keysText).length} key(s) detected. Duplicates and keys already added are skipped automatically.
                </p>
              </div>

              {bulkResult && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">
                  Added <b>{bulkResult.created}</b> key(s){bulkResult.skipped ? <>, skipped <b>{bulkResult.skipped}</b> duplicate(s)</> : null}.
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setBulkModal(null)} className="btn-outline">Close</button>
              <button type="submit" disabled={bulkSaving || parseBulkKeys(bulkForm.keysText).length === 0} className="btn-primary">
                {bulkSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Adding…</> : <>Add {parseBulkKeys(bulkForm.keysText).length || ""} key(s)</>}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
