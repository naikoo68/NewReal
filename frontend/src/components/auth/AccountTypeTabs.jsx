import { GraduationCap, Store } from "lucide-react";

// Segmented Student / Client selector shown on the auth pages.
// `active` is "student" | "client"; onSelect(key) fires when a tab is clicked.
export default function AccountTypeTabs({ active, onSelect }) {
  const tabs = [
    { key: "student", label: "Student", Icon: GraduationCap },
    { key: "client", label: "Client", Icon: Store },
  ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          aria-pressed={active === t.key}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
            active === t.key
              ? "bg-white text-brand-600 shadow-sm dark:bg-slate-900 dark:text-brand-400"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <t.Icon className="h-4 w-4" /> {t.label}
        </button>
      ))}
    </div>
  );
}
