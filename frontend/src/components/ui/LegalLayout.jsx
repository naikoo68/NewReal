import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";

// Shared shell for the legal pages (Privacy / Terms / Refund).
// `sections` is an array of { h, p } where `p` is a string or an array of
// strings/JSX rendered as paragraphs. Company name + contact email are pulled
// from site settings so white-label buyers get their own details automatically.
export default function LegalLayout({ title, updated, intro, sections = [] }) {
  const { settings } = useSettings();
  const email = (settings.contacts || []).find((c) => c.type === "email")?.value;

  // Scroll to top when opening a legal page.
  useEffect(() => { window.scrollTo(0, 0); }, [title]);

  return (
    <div className="container-page py-14">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-extrabold leading-none">{title}</h1>
            {updated && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Last updated: {updated}</p>}
          </div>
        </div>

        {intro && <p className="mt-6 text-slate-600 dark:text-slate-300">{intro}</p>}

        <div className="mt-8 space-y-8">
          {sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{s.h}</h2>
              <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {(Array.isArray(s.p) ? s.p : [s.p]).map((para, k) => (
                  <p key={k}>{para}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <p className="font-semibold text-slate-900 dark:text-white">Questions?</p>
          <p className="mt-1">
            For anything about this policy, contact {settings.siteName}
            {email ? <> at <a href={`mailto:${email}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">{email}</a></> : null}.
          </p>
        </div>
      </div>
    </div>
  );
}
