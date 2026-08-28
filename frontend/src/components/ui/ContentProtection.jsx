import { useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";

// Deters copying of site content for students (and guests): disables text
// selection, right-click, copy/cut, drag and the iOS long-press callout.
// Admins are never restricted. Controlled by the "restrictCopy" setting.
export default function ContentProtection() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const isAdmin = user?.role === "admin";
  const copyActive = settings?.restrictCopy !== false && !isAdmin;

  useEffect(() => {
    if (!copyActive) return;
    const block = (e) => {
      const t = e.target;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      return false;
    };
    const events = ["copy", "cut", "contextmenu", "selectstart", "dragstart"];
    events.forEach((ev) => document.addEventListener(ev, block));
    document.body.classList.add("no-select");
    return () => {
      events.forEach((ev) => document.removeEventListener(ev, block));
      document.body.classList.remove("no-select");
    };
  }, [copyActive]);

  return null;
}
