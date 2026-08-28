import { useRef, useState } from "react";
import { Camera, Trash2, Loader2, Check, X } from "lucide-react";
import Avatar from "./Avatar";
import { useAuth } from "../../context/AuthContext";
import { authService } from "../../services";
import { fileToResizedDataUrl } from "../../lib/imageResize";

const isImg = (v) => typeof v === "string" && (v.startsWith("http") || v.startsWith("data:"));

// Reusable "profile photo" editor: preview + upload (auto-resized) + save/remove.
// Works for any signed-in user (student, client or admin) via PUT /auth/profile.
export default function ProfilePhotoCard({ className = "" }) {
  const { user, refreshUser } = useAuth();
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null); // pending, unsaved data-URI
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const shown = preview ?? user?.avatar;

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(""); setMsg("");
    try {
      setPreview(await fileToResizedDataUrl(file, 256, 0.85));
    } catch (ex) {
      setErr(ex?.message || "Couldn't load that image.");
    }
  };

  const save = async () => {
    if (preview == null) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      await authService.updateProfile({ avatar: preview });
      await refreshUser();
      setPreview(null);
      setMsg("Profile photo updated.");
    } catch (ex) {
      setErr(ex?.message || "Couldn't save — please try again.");
    } finally { setBusy(false); }
  };

  const removePhoto = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      await authService.updateProfile({ avatar: "" });
      await refreshUser();
      setPreview(null);
      setMsg("Profile photo removed.");
    } catch (ex) {
      setErr(ex?.message || "Couldn't remove — please try again.");
    } finally { setBusy(false); }
  };

  return (
    <div className={`card p-5 ${className}`}>
      <h3 className="text-sm font-bold">Profile photo</h3>
      <div className="mt-4 flex items-center gap-4">
        <Avatar src={shown} name={user?.name || user?.email} size={72} />
        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="btn-outline py-1.5 text-sm">
              <Camera className="h-4 w-4" /> {isImg(shown) ? "Change photo" : "Upload photo"}
            </button>
            {preview != null && (
              <>
                <button type="button" onClick={save} disabled={busy} className="btn-primary py-1.5 text-sm">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
                </button>
                <button type="button" onClick={() => { setPreview(null); setErr(""); }} disabled={busy} className="btn-ghost py-1.5 text-sm">
                  <X className="h-4 w-4" /> Cancel
                </button>
              </>
            )}
            {preview == null && isImg(user?.avatar) && (
              <button type="button" onClick={removePhoto} disabled={busy} className="btn-ghost py-1.5 text-sm text-rose-600">
                <Trash2 className="h-4 w-4" /> Remove
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400">JPG or PNG. It's automatically resized for a fast, crisp fit.</p>
        </div>
      </div>
      {msg && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{msg}</p>}
      {err && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{err}</p>}
    </div>
  );
}
