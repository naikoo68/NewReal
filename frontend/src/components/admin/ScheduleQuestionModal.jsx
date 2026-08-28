import { useEffect, useRef, useState } from "react";
import { X, Send, Clock, Loader2, CheckCircle2, AlertTriangle, Eye } from "lucide-react";
import { Facebook, Instagram } from "../ui/SocialIcons";
import { facebookService, uploadService } from "../../services";
import { useSettings } from "../../context/SettingsContext";
import QuestionPostCard from "./QuestionPostCard";
import { captureNodeToBlob } from "../../lib/questionImage";

// Post/schedule ONE specific question to Facebook/Instagram, straight from the
// question view. Either "Post now" or schedule at a chosen date & time.
export default function ScheduleQuestionModal({ open, question, onClose }) {
  const [opts, setOpts] = useState({
    toFacebook: true, toInstagram: false, asImage: false,
    includeOptions: true, includeAnswer: false, hashtags: "",
  });
  const [when, setWhen] = useState(""); // datetime-local value; empty = post now
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const { settings } = useSettings();
  const cardRef = useRef(null); // off-screen node captured into the posted image
  const siteName = settings?.siteName || "My Study Guide";

  useEffect(() => {
    if (open) {
      setOpts({ toFacebook: true, toInstagram: false, asImage: false, includeOptions: true, includeAnswer: false, hashtags: "" });
      setWhen(""); setMsg(null); setBusy(false); setPreviewUrl(null); setPreviewing(false);
      // Pre-fill the hashtags: your global default tags + auto tags built from
      // this question's subject/topic. You can still edit them before posting.
      if (question?._id) {
        facebookService.suggestTags(question._id)
          .then((r) => { if (r?.hashtags) setOpts((o) => ({ ...o, hashtags: r.hashtags })); })
          .catch(() => {});
      }
    }
  }, [open, question?._id]);

  // Preview = shows the image that will be posted. When a watermark is
  // configured, use the server-rendered image (which bakes in the watermark).
  // Otherwise, use a local screenshot of the card (exact math rendering).
  const doPreview = async () => {
    setPreviewing(true); setMsg(null);
    try {
      if (settings?.fbSelfieWatermarkEnabled !== false && settings?.fbSelfieWatermarkUrl) {
        // Server-rendered preview (includes watermark overlay)
        const r = await facebookService.previewImage({
          questionId: question._id,
          includeOptions: opts.includeOptions,
          includeAnswer: opts.includeAnswer,
          hashtags: opts.hashtags,
        });
        if (r?.url) { setPreviewUrl(r.url); return; }
      }
      // Fallback: client-side screenshot (no watermark)
      const blob = await captureNodeToBlob(cardRef.current, { scale: 2 });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      setMsg({ ok: false, text: e.message || "Could not generate preview." });
    } finally {
      setPreviewing(false);
    }
  };

  // Capture the card and upload it to Cloudinary → the image URL to post.
  // When watermark is active, the server ignores client screenshots and renders
  // its own image with the watermark — so we skip the capture entirely.
  const captureAndUpload = async () => {
    if (settings?.fbSelfieWatermarkEnabled !== false && settings?.fbSelfieWatermarkUrl) {
      return ""; // server will render with watermark
    }
    const blob = await captureNodeToBlob(cardRef.current, { scale: 2 });
    const file = new File([blob], `question-${question._id}.png`, { type: "image/png" });
    const r = await uploadService.file(file);
    return r?.url || "";
  };

  if (!open || !question) return null;

  const set = (k, v) => {
    setOpts((o) => ({ ...o, [k]: v }));
    if (["includeOptions", "includeAnswer", "hashtags"].includes(k)) setPreviewUrl(null); // preview is now stale
  };

  const run = async (scheduled) => {
    if (!opts.toFacebook && !opts.toInstagram) { setMsg({ ok: false, text: "Choose Facebook and/or Instagram." }); return; }
    if (scheduled && !when) { setMsg({ ok: false, text: "Pick a date & time first." }); return; }
    setBusy(true); setMsg(null);
    try {
      // When an image is going out (Facebook image or Instagram), capture the
      // exact card as a screenshot and post THAT. If capture/upload fails we
      // send no imageUrl and the server falls back to its own rendering.
      let imageUrl = "";
      if (opts.asImage || opts.toInstagram) {
        try { imageUrl = await captureAndUpload(); } catch { imageUrl = ""; }
      }
      const payload = { questionId: question._id, ...opts, imageUrl, label: (question.text || "").slice(0, 80) };
      if (scheduled) {
        await facebookService.scheduleQuestion({ ...payload, runAt: new Date(when).toISOString() });
        setMsg({ ok: true, text: `Scheduled for ${new Date(when).toLocaleString()}. See it under Facebook Auto-Post.` });
      } else {
        const r = await facebookService.postQuestion(payload);
        setMsg({ ok: true, text: r?.lastResult || "Posted." });
      }
    } catch (e) {
      setMsg({ ok: false, text: e.message || "Failed. Check your Facebook connection." });
    } finally {
      setBusy(false);
    }
  };

  const Toggle = ({ k, label, Icon, color }) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4" style={{ accentColor: color }} checked={opts[k]} onChange={(e) => set(k, e.target.checked)} />
      {Icon && <Icon className="h-4 w-4" style={{ color }} />} {label}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-8 w-full max-w-md animate-scale-in card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Facebook className="h-5 w-5 text-[#1877F2]" /> Post / schedule this question</h3>
          <button onClick={onClose} disabled={busy}><X className="h-5 w-5" /></button>
        </div>

        <p className="mb-4 line-clamp-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          {(question.text || "").replace(/\$/g, "").slice(0, 160) || "Question"}
        </p>

        <p className="mb-1 text-sm font-semibold">Post to</p>
        <div className="flex flex-wrap gap-4">
          <Toggle k="toFacebook" label="Facebook" Icon={Facebook} color="#1877F2" />
          <Toggle k="toInstagram" label="Instagram (image)" Icon={Instagram} color="#E1306C" />
          <Toggle k="asImage" label="Image on Facebook" color="#4f46e5" />
        </div>
        {opts.toInstagram && <p className="mt-1 text-xs text-slate-400">Instagram always posts an image — one is generated automatically.</p>}

        <p className="mb-1 mt-4 text-sm font-semibold">Content</p>
        <div className="flex flex-wrap gap-4">
          <Toggle k="includeOptions" label="Show options" color="#4f46e5" />
          <Toggle k="includeAnswer" label="Reveal answer" color="#059669" />
        </div>

        <label className="mb-1 mt-4 block text-sm font-semibold">Hashtags (optional)</label>
        <input className="input" value={opts.hashtags} onChange={(e) => set("hashtags", e.target.value)} placeholder="#GK #Quiz" disabled={busy} />

        {/* Live image preview — shows the exact card that will be posted. */}
        <div className="mt-4">
          <button type="button" onClick={doPreview} disabled={previewing || busy} className="btn-outline">
            {previewing ? <><Loader2 className="h-4 w-4 animate-spin" /> Rendering…</> : <><Eye className="h-4 w-4" /> {previewUrl ? "Refresh preview" : "Preview image"}</>}
          </button>
          {previewUrl && (
            <img src={previewUrl} alt="Post preview" className="mt-3 w-full max-w-[360px] rounded-xl border border-slate-200 shadow-sm dark:border-slate-700" />
          )}
          <p className="mt-1 text-xs text-slate-400">A screenshot of the exact card students see (same math rendering). Posted to Instagram, and to Facebook when “image” is on.</p>
        </div>

        {/* Off-screen card that gets screenshotted. Kept rendered (not hidden)
            so html2canvas can capture it; parked far off-screen. */}
        <div aria-hidden style={{ position: "fixed", left: -100000, top: 0, pointerEvents: "none", opacity: 0 }}>
          <div ref={cardRef}>
            <QuestionPostCard question={question} includeOptions={opts.includeOptions} includeAnswer={opts.includeAnswer} siteName={siteName} hashtags={opts.hashtags} />
          </div>
        </div>

        <label className="mb-1 mt-4 flex items-center gap-1.5 text-sm font-semibold"><Clock className="h-4 w-4 text-slate-400" /> Schedule for (optional)</label>
        <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} disabled={busy} />
        <p className="mt-1 text-xs text-slate-400">Leave empty and use “Post now”, or pick a time and use “Schedule”.</p>

        {msg && <p className={`mt-3 inline-flex items-center gap-1 text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {msg.text}</p>}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-outline">Close</button>
          <button onClick={() => run(true)} disabled={busy || !when} className="btn-outline"><Clock className="h-4 w-4" /> Schedule</button>
          <button onClick={() => run(false)} disabled={busy} className="btn-primary">{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Working…</> : <><Send className="h-4 w-4" /> Post now</>}</button>
        </div>
      </div>
    </div>
  );
}
