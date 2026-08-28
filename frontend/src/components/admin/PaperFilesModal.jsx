import { useState } from "react";
import { X, FileText, Upload, Loader2, Trash2, Save, Plus } from "lucide-react";
import { practiceService, uploadService } from "../../services";

// Admin dialog for a "Previous Papers" item: upload the actual question-paper
// PDF and one or more answer-key PDFs (to Cloudinary via /api/upload) — e.g. the
// original key plus a revised key — and write free-text additional information.
// Students then see these on the paper's start/results screen.
export default function PaperFilesModal({ item, onClose, onSaved }) {
  const [paperPdfUrl, setPaperPdfUrl] = useState(item?.paperPdfUrl || "");
  // Answer keys as a list of { label, url }. Seed from the new array, else the
  // legacy single field, else one empty row so there's always something shown.
  const [answerKeys, setAnswerKeys] = useState(() => {
    if (Array.isArray(item?.answerKeys) && item.answerKeys.length) {
      return item.answerKeys.map((k) => ({ label: k.label || "", url: k.url || "" }));
    }
    if (item?.answerKeyPdfUrl) return [{ label: "Answer key", url: item.answerKeyPdfUrl }];
    return [{ label: "Answer key", url: "" }];
  });
  const [additionalInfo, setAdditionalInfo] = useState(item?.additionalInfo || "");
  const [uploading, setUploading] = useState(""); // "paper" | `key-<idx>`
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const updateKey = (i, patch) => setAnswerKeys((ks) => ks.map((k, idx) => (idx === i ? { ...k, ...patch } : k)));
  const removeKey = (i) => setAnswerKeys((ks) => (ks.length <= 1 ? [{ label: "Answer key", url: "" }] : ks.filter((_, idx) => idx !== i)));
  const addKey = () => setAnswerKeys((ks) => [...ks, { label: "Revised key", url: "" }]);

  const doUploadPaper = async (file) => {
    if (!file) return;
    setUploading("paper");
    setMsg("");
    try {
      const res = await uploadService.file(file);
      if (!res?.url) throw new Error("Upload returned no URL.");
      setPaperPdfUrl(res.url);
    } catch (e) {
      setMsg(e.message || "Upload failed — check the file and that Cloudinary is configured.");
    } finally {
      setUploading("");
    }
  };

  const doUploadKey = async (i, file) => {
    if (!file) return;
    setUploading(`key-${i}`);
    setMsg("");
    try {
      const res = await uploadService.file(file);
      if (!res?.url) throw new Error("Upload returned no URL.");
      updateKey(i, { url: res.url });
    } catch (e) {
      setMsg(e.message || "Upload failed — check the file and that Cloudinary is configured.");
    } finally {
      setUploading("");
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const cleanedKeys = answerKeys
        .filter((k) => k.url && k.url.trim())
        .map((k) => ({ label: (k.label || "").trim() || "Answer key", url: k.url.trim() }));
      await practiceService.updateItem(item._id, { paperPdfUrl, answerKeys: cleanedKeys, additionalInfo });
      onSaved?.();
    } catch (e) {
      setMsg(e.message || "Save failed.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={saving ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg animate-scale-in card p-6">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><FileText className="h-5 w-5 text-brand-600" /> Paper files &amp; info</h3>
          <button type="button" onClick={onClose} disabled={saving}><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Attach the actual PDFs for <b>{item?.name}</b>. Students can open them and read the additional information on the paper's start screen.
        </p>

        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          {/* Question paper */}
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 text-sm font-semibold">Question paper (PDF)</p>
            {paperPdfUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <a href={paperPdfUrl} target="_blank" rel="noreferrer" className="btn-outline py-1.5 text-xs"><FileText className="h-3.5 w-3.5" /> View current PDF</a>
                <button type="button" onClick={() => setPaperPdfUrl("")} disabled={saving} className="btn-outline py-1.5 text-xs text-rose-600"><Trash2 className="h-3.5 w-3.5" /> Remove</button>
              </div>
            ) : (
              <p className="mb-2 text-xs text-slate-400">No file uploaded yet.</p>
            )}
            <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              {uploading === "paper" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {paperPdfUrl ? "Replace PDF" : "Upload PDF"}
              <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={!!uploading || saving} onChange={(e) => { doUploadPaper(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>

          {/* Answer keys (one or more: original, revised, …) */}
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 text-sm font-semibold">Answer keys (PDF)</p>
            <div className="space-y-3">
              {answerKeys.map((k, i) => (
                <div key={i} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      value={k.label}
                      onChange={(e) => updateKey(i, { label: e.target.value })}
                      placeholder={i === 0 ? "Answer key" : "e.g. Revised key"}
                      disabled={saving}
                      className="input flex-1 py-1.5 text-sm"
                    />
                    {(answerKeys.length > 1 || k.url) && (
                      <button type="button" onClick={() => removeKey(i)} disabled={saving} title="Remove this key" className="btn-outline py-1.5 text-xs text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                  {k.url ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={k.url} target="_blank" rel="noreferrer" className="btn-outline py-1.5 text-xs"><FileText className="h-3.5 w-3.5" /> View current PDF</a>
                      <button type="button" onClick={() => updateKey(i, { url: "" })} disabled={saving} className="btn-outline py-1.5 text-xs text-rose-600"><Trash2 className="h-3.5 w-3.5" /> Remove PDF</button>
                    </div>
                  ) : (
                    <p className="mb-2 text-xs text-slate-400">No file uploaded yet.</p>
                  )}
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                    {uploading === `key-${i}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {k.url ? "Replace PDF" : "Upload PDF"}
                    <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={!!uploading || saving} onChange={(e) => { doUploadKey(i, e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                </div>
              ))}
            </div>
            <button type="button" onClick={addKey} disabled={saving} className="btn-outline mt-3 w-full py-2 text-sm"><Plus className="h-4 w-4" /> Add answer key</button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Additional information</label>
            <textarea
              value={additionalInfo}
              onChange={(e) => setAdditionalInfo(e.target.value)}
              rows={4}
              placeholder="e.g. exam date, total marks, duration, instructions, source…"
              className="input"
            />
          </div>
        </div>

        {msg && <p className="mt-3 text-sm font-medium text-rose-600">{msg}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn-outline">Cancel</button>
          <button type="button" onClick={save} disabled={saving || !!uploading} className="btn-primary">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}
