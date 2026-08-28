import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { GraduationCap, LogOut, Moon, Sun, ZoomIn, ZoomOut, LayoutDashboard, Wrench, ArrowRightLeft, Sparkles, FileText, Feather, BookOpen, Files, SearchCheck, Menu, User } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useSettings } from "../../context/SettingsContext";
import { useZoom } from "../../context/ZoomContext";
import Avatar from "../../components/ui/Avatar";
import AdminPractice from "../admin/AdminPractice";
import AdminMigration from "../admin/AdminMigration";
import AdminChecker from "../admin/AdminChecker";
import ClientDashboard from "./ClientDashboard";
import ClientAccount from "./ClientAccount";
import ClientUserManual from "./ClientUserManual";
import ClientUpgrade from "./ClientUpgrade";
import ClientAiSettings from "./ClientAiSettings";
import AdminDocuments from "../admin/AdminDocuments";
import AdminNotes from "../admin/AdminNotes";
import AdminAiStudio from "../admin/AdminAiStudio";
import Footer from "../../components/layout/Footer";
import ClientWelcomeModal from "../../components/client/ClientWelcomeModal";
import InstallAppButton from "../../components/client/InstallAppButton";

// The self-service CLIENT workspace. A client only ever sees the My Practice
// section (their own private content) — no other part of the site. It reuses
// the practice manager in `clientMode`, which the backend scopes to this
// client's own content.
export default function ClientWorkspace() {
  const { user, logout, refreshUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { settings } = useSettings();
  const { zoom, zoomIn, zoomOut } = useZoom();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [showUpgrade, setShowUpgrade] = useState(false); // opened voluntarily from the dashboard
  const [menuOpen, setMenuOpen] = useState(false); // hamburger menu (all tabs except Dashboard)
  // Welcome popup — shown only ONCE per browser session (not on refresh or
  // back-navigation). Shared sessionStorage flag with the public site.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("mpm-welcome-seen")) {
        sessionStorage.setItem("mpm-welcome-seen", "1");
        setShowWelcome(true);
      }
    } catch {
      setShowWelcome(true);
    }
  }, []);

  // Pull the latest profile once when the workspace opens. This is a long-lived
  // single-page app, so a client who logged in earlier may be holding a stale
  // profile — in particular an old `aiAccess: false`. Refreshing here makes
  // newly-granted AI access (and plan/validity changes) show up without needing
  // a hard browser refresh or a re-login. Failures are ignored (keep cached).
  useEffect(() => {
    refreshUser?.().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trial/plan finished → lock the workspace behind the upgrade screen.
  const expired = user?.expiresAt && new Date(user.expiresAt).getTime() < Date.now();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  // Per-feature access set by the admin (Clients panel). Dashboard/Build/Notes/
  // Documents/User-manual default ON; AI (keys) and AI Generator default OFF.
  const tabs = [
    ...(user?.featDashboard !== false ? [{ key: "dashboard", label: "Dashboard", Icon: LayoutDashboard }] : []),
    ...(user?.featBuild !== false ? [
      { key: "build", label: "Build", Icon: Wrench },
      { key: "migrate", label: "Migrate", Icon: ArrowRightLeft },
    ] : []),
    ...(user?.featPapers !== false ? [{ key: "papers", label: "Previous Papers", Icon: Files }] : []),
    ...(user?.featChecker !== false ? [{ key: "checker", label: "Question Checker", Icon: SearchCheck }] : []),
    ...(user?.aiAccess ? [{ key: "ai", label: "AI", Icon: Sparkles }] : []),
    ...(user?.featAiGenerator ? [{ key: "aigen", label: "AI Generator", Icon: Sparkles }] : []),
    ...(user?.featDocuments !== false ? [{ key: "documents", label: "Documents", Icon: FileText }] : []),
    ...(user?.featNotes !== false ? [{ key: "notes", label: "Notes", Icon: Feather }] : []),
    ...(user?.featManual !== false ? [{ key: "manual", label: "User Manual", Icon: BookOpen }] : []),
    { key: "account", label: "Account", Icon: User }, // always available — profile, validity, plan, referral
  ];

  // The active tab lives in the URL (?tab=…) so a refresh restores it. Unknown/
  // empty → the first tab the client is allowed to see.
  const allowedTabs = tabs.map((t) => t.key);
  const firstTab = allowedTabs[0] || "dashboard";
  const paramTab = searchParams.get("tab");
  const tab = allowedTabs.includes(paramTab) ? paramTab : firstTab;
  const setTab = (key) => setSearchParams(key && key !== firstTab ? { tab: key } : {});

  // Header shows only the Dashboard tab; every other tab lives in a hamburger
  // menu on the right, keeping the client header compact (esp. on phones).
  const dashboardTab = tabs.find((t) => t.key === "dashboard");
  const menuTabs = tabs.filter((t) => t.key !== "dashboard");
  const activeMenuTab = menuTabs.find((t) => t.key === tab);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {showWelcome && <ClientWelcomeModal onClose={() => setShowWelcome(false)} />}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link to="/client" className="flex items-center gap-2">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt={settings.siteName} className="h-9 w-9 rounded-xl object-cover" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 text-white">
                <GraduationCap className="h-5 w-5" />
              </span>
            )}
            <div>
              <p className="text-sm font-extrabold leading-none">{settings.siteName}</p>
              <p className="text-xs text-slate-400">My Practice</p>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <InstallAppButton />
            <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <button onClick={zoomOut} title="Zoom out" className="px-2 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><ZoomOut className="h-4 w-4" /></button>
              <span className="min-w-[40px] text-center text-xs font-semibold tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
              <button onClick={zoomIn} title="Zoom in" className="px-2 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><ZoomIn className="h-4 w-4" /></button>
            </div>
            <button onClick={toggleTheme} className="rounded-lg p-2 text-slate-600 dark:text-slate-300" title="Toggle theme">
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <span className="hidden sm:block" title={user?.name}>
              <Avatar src={user?.avatar} name={user?.name || "Me"} size={36} />
            </span>
            <button onClick={handleLogout} className="btn-ghost" title="Log out">
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
        {/* Header nav: only the Dashboard tab is shown inline; all other tabs
            (Build, Migrate, Previous Papers, …) live in a hamburger menu on the
            right. */}
        {!expired && (
        <div className="mx-auto mt-3 flex max-w-6xl items-center gap-2">
          {dashboardTab && (
            <button
              onClick={() => { setTab(dashboardTab.key); setShowUpgrade(false); }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                tab === dashboardTab.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              <dashboardTab.Icon className="h-4 w-4" /> {dashboardTab.label}
            </button>
          )}

          {menuTabs.length > 0 && (
            <div className="relative ml-auto">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Open menu"
                aria-expanded={menuOpen}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  activeMenuTab ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                <Menu className="h-4 w-4" /> {activeMenuTab ? activeMenuTab.label : "Menu"}
              </button>
              {menuOpen && (
                <>
                  {/* Click-away backdrop closes the menu. */}
                  <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    {menuTabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => { setTab(t.key); setShowUpgrade(false); setMenuOpen(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium transition ${
                          tab === t.key ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        }`}
                      >
                        <t.Icon className="h-4 w-4" /> {t.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        {expired || showUpgrade ? (
          <ClientUpgrade onClose={expired ? undefined : () => setShowUpgrade(false)} />
        ) : tab === "dashboard" ? (
          <ClientDashboard onBuild={() => setTab("build")} onUpgrade={() => setShowUpgrade(true)} />
        ) : tab === "migrate" ? (
          <AdminMigration clientMode />
        ) : tab === "ai" ? (
          <ClientAiSettings />
        ) : tab === "aigen" ? (
          <AdminAiStudio clientMode />
        ) : tab === "documents" ? (
          <AdminDocuments />
        ) : tab === "notes" ? (
          <AdminNotes />
        ) : tab === "manual" ? (
          <ClientUserManual onGoTab={setTab} />
        ) : tab === "papers" ? (
          <AdminPractice clientMode fixedKind="paper" />
        ) : tab === "checker" ? (
          <AdminChecker />
        ) : tab === "account" ? (
          <ClientAccount onUpgrade={() => setShowUpgrade(true)} />
        ) : (
          <AdminPractice clientMode />
        )}
      </main>

      {/* Site footer below the workspace (without the public "Product" links). */}
      <Footer hideProduct />
    </div>
  );
}
