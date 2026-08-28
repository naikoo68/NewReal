import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Megaphone, X, ArrowRight } from "lucide-react";
import { noticeService } from "../../services";

// A scrolling "notice board" ticker shown at the very top of the site. It
// pulls active notices from the backend and animates them right → left in a
// seamless loop. Tapping the "Notice" icon opens a panel listing every notice.
// Clicking a notice that links to a quiz/test navigates the user straight there.
export default function NoticeTicker() {
  const [notices, setNotices] = useState([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    noticeService
      .list()
      .then((list) => active && setNotices(Array.isArray(list) ? list : []))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!notices.length) return null;

  // Follow a notice's link: internal paths use the router, external open a tab.
  const go = (link) => {
    if (!link) return;
    setOpen(false);
    if (/^https?:\/\//i.test(link)) window.open(link, "_blank", "noopener");
    else navigate(link);
  };

  const totalChars = notices.reduce((n, x) => n + (x.text?.length || 0), 0);
  const duration = Math.min(80, Math.max(18, Math.round(totalChars / 3)));

  // A single scrolling notice. If it links somewhere, clicking navigates there;
  // otherwise it opens the panel.
  const Item = ({ n }) => (
    <span
      onClick={(e) => {
        if (n.link) { e.stopPropagation(); go(n.link); }
      }}
      className={`mx-6 inline-flex items-center gap-2 ${n.link ? "hover:underline" : ""}`}
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-white/70" />
      {n.text}
    </span>
  );

  const Track = () => (
    <div className="animate-marquee flex shrink-0 items-center whitespace-nowrap">
      {notices.map((n) => (
        <Item key={n._id} n={n} />
      ))}
    </div>
  );

  return (
    <>
      <div className="relative z-[55] flex items-stretch overflow-hidden bg-gradient-to-r from-brand-700 via-brand-600 to-accent-600 text-sm font-medium text-white">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="View all notices"
          className="z-10 flex flex-shrink-0 items-center gap-1.5 bg-accent-600 px-3 py-1.5 font-bold uppercase tracking-wide shadow-md transition hover:bg-accent-500"
        >
          <Megaphone className="h-4 w-4" />
          <span className="hidden sm:inline">Notice</span>
        </button>
        <div
          className="marquee-track flex flex-1 cursor-pointer items-center overflow-hidden py-1.5"
          style={{ "--marquee-duration": `${duration}s` }}
          onClick={() => setOpen(true)}
        >
          <Track />
          <Track aria-hidden="true" />
        </div>
      </div>

      {/* All notices panel */}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="my-10 w-full max-w-lg animate-scale-in rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2 rounded-t-2xl bg-gradient-to-r from-brand-700 via-brand-600 to-accent-600 px-5 py-3.5 text-white">
              <h3 className="flex items-center gap-2 text-lg font-bold">
                <Megaphone className="h-5 w-5" /> Notice Board
              </h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 hover:bg-white/20">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
              {notices.map((n, i) => {
                const clickable = !!n.link;
                return (
                  <div
                    key={n._id}
                    onClick={() => clickable && go(n.link)}
                    className={`flex gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700 ${clickable ? "cursor-pointer transition hover:border-brand-400 hover:bg-brand-50/50 dark:hover:bg-brand-900/20" : ""}`}
                  >
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-bold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800 dark:text-slate-100">{n.text}</p>
                      {clickable && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                          {/^https?:\/\//i.test(n.link) ? "Open link" : "Go to it"} <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      )}
                      {n.createdAt && (
                        <p className="mt-1 text-xs text-slate-400">{new Date(n.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
