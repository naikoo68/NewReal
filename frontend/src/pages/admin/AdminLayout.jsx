import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BookCopy,
  FileStack,
  FileText,
  BookMarked,
  Users,
  Trophy,
  Mail,
  MessageSquare,
  Megaphone,
  Palette,
  KeyRound,
  Sparkles,
  GraduationCap,
  Store,
  School,
  Ticket,
  Crown,
  ArrowRightLeft,
  Share2,
  MonitorCheck,
  SearchCheck,
  BookOpen,
  LogOut,
  Menu,
  Moon,
  Sun,
  Home,
  Feather,
  FilePlus2,
  LayoutGrid,
  Files,
  HardDrive,
  DatabaseBackup,
  Star,
} from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";
import { messageService } from "../../services";
import GlobalSearch from "../../components/ui/GlobalSearch";
import { Facebook as FacebookIcon } from "../../components/ui/SocialIcons";
import Avatar from "../../components/ui/Avatar";

// `superOnly: true` items are visible only to the platform super-admin (role
// "admin"); an institute_admin sees the rest, scoped to their own institute.
const nav = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/institutes", label: "Institutes", icon: School, superOnly: true },
  { to: "/admin/content", label: "Content", icon: BookCopy },
  { to: "/admin/tests", label: "Test Series", icon: FileStack },
  { to: "/admin/practice", label: "My Practice", icon: GraduationCap },
  { to: "/admin/previous-papers", label: "Previous Papers", icon: Files },
  { to: "/admin/checker", label: "Question Checker", icon: SearchCheck },
  { to: "/admin/shared", label: "Shared Links", icon: Share2 },
  { to: "/admin/cbt", label: "Online Exams", icon: MonitorCheck },
  { to: "/admin/migration", label: "Migration", icon: ArrowRightLeft, superOnly: true },
  { to: "/admin/clients", label: "Clients", icon: Store, superOnly: true },
  { to: "/admin/plans", label: "Plans", icon: Crown, superOnly: true },
  { to: "/admin/coupons", label: "Coupons", icon: Ticket, superOnly: true },
  { to: "/admin/study", label: "Study Material", icon: BookMarked },
  { to: "/admin/documents", label: "Documents", icon: FileText },
  { to: "/admin/notes", label: "Handwritten Notes", icon: Feather },
  { to: "/admin/pdf-builder", label: "PDF Builder", icon: FilePlus2 },
  { to: "/admin/resume", label: "Resume Builder", icon: FileText },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/performance", label: "Performance", icon: Trophy },
  { to: "/admin/storage", label: "Storage", icon: HardDrive, superOnly: true },
  { to: "/admin/backup", label: "Backup & Restore", icon: DatabaseBackup, superOnly: true },
  { to: "/admin/feedback", label: "Feedback", icon: MessageSquare },
  { to: "/admin/reviews", label: "Reviews", icon: Star },
  { to: "/admin/messages", label: "Messages", icon: Mail },
  { to: "/admin/notices", label: "Notice Board", icon: Megaphone },
  { to: "/admin/facebook", label: "Facebook Auto-Post", icon: FacebookIcon, superOnly: true },
  { to: "/admin/ai-generator", label: "AI Generator", icon: Sparkles },
  { to: "/admin/visualize", label: "Visualization Studio", icon: LayoutGrid },
  { to: "/admin/ai-keys", label: "AI Keys", icon: KeyRound, superOnly: true },
  { to: "/admin/customization", label: "Customization", icon: Palette },
  { to: "/admin/manual", label: "User Manual", icon: BookOpen },
];

export default function AdminLayout() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // Lock background page scroll while the mobile drawer is open, so scrolling
  // inside the drawer doesn't move the page behind it (and the drawer can scroll
  // independently to reveal every nav item + Log out on small screens).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();

  // Keep the unread-messages badge fresh
  useEffect(() => {
    let active = true;
    messageService
      .unreadCount()
      .then((r) => active && setUnread(r.unread || 0))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      <Link to="/admin" className="flex items-center gap-2 px-6 py-5">
        {settings.logoUrl ? (
          <img src={settings.logoUrl} alt={settings.siteName} className="h-9 w-9 rounded-xl object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 text-white">
            <GraduationCap className="h-5 w-5" />
          </span>
        )}
        <div>
          <p className="text-sm font-extrabold leading-none">{settings.siteName}</p>
          <p className="text-xs text-slate-400">Admin Panel</p>
        </div>
      </Link>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
        {nav.filter((n) => !n.superOnly || user?.role === "admin").map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? "bg-brand-600 text-white shadow-soft"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`
            }
          >
            <n.icon className="h-5 w-5" />
            <span className="flex-1">{n.label}</span>
            {n.to === "/admin/messages" && unread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-xs font-bold text-white">
                {unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-1 border-t border-slate-200 p-3 dark:border-slate-800">
        {user?.role === "institute_admin" && user?.tenant?.slug ? (
          // Institute admins get sent to THEIR OWN public portal (?t=<slug>),
          // not the platform site. A full-page load is required so the tenant
          // query param is applied by the API layer for every request.
          <a href={`/?t=${user.tenant.slug}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <Home className="h-5 w-5" /> View my student portal
          </a>
        ) : (
          <Link to="/" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <Home className="h-5 w-5" /> Switch to Student Mode
          </Link>
        )}
        <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20">
          <LogOut className="h-5 w-5" /> Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-shrink-0 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">
        <div className="sticky top-0 h-screen">
          <SidebarContent />
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-white dark:bg-slate-900">
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 lg:hidden">
            <Menu className="h-6 w-6" />
          </button>
          {/* Global admin search — surfaces ALL metadata (incl. drafts & client items) */}
          <div className="min-w-0 flex-1">
            <GlobalSearch
              mode="admin"
              placeholder="Search all content — streams, subjects, topics, quizzes, tests…"
              className="max-w-2xl"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="rounded-lg p-2 text-slate-600 dark:text-slate-300">
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <Avatar src={user?.avatar} name={user?.name || "Admin"} size={36} />

          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
