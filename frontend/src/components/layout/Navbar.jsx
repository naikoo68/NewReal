import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Menu, X, Moon, Sun, LayoutDashboard, LogOut, User, UserCog, ShieldCheck, ZoomIn, ZoomOut } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { useZoom } from "../../context/ZoomContext";
import Brand from "./Brand";
import InstallAppButton from "../client/InstallAppButton";
import Avatar from "../ui/Avatar";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/quiz", label: "Quiz" },
  { to: "/test-series", label: "Test Series" },
  { to: "/practice", label: "My Practice" },
  { to: "/study", label: "Study Material" },
  { to: "/pricing", label: "Pricing" },
  { to: "/about", label: "About Us" },
  { to: "/contact", label: "Contact" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { zoom, zoomIn, zoomOut } = useZoom();
  const navigate = useNavigate();
  // Platform super-admin AND institute admins both use the admin panel.
  const isAdmin = user?.role === "admin" || user?.role === "institute_admin";
  const isClient = user?.role === "client";
  // Clients only ever use their own My Practice workspace — replace the whole
  // nav with a single link back to it so "Home"/the logo never strands them on
  // a page with no way back to their created questions.
  const visibleLinks = isClient
    ? [{ to: "/client", label: "My Practice", end: true }]
    : user && user.quizAccess === false
    ? links.filter((l) => l.to !== "/quiz")
    : links;
  const homeTo = isClient ? "/client" : "/";

  const handleLogout = () => {
    logout();
    setOpen(false);
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-lg dark:border-slate-800/70 dark:bg-slate-950/80">
      <nav className="container-page flex items-center justify-between" style={{ minHeight: "var(--nav-height, 4rem)" }}>
        <div className="flex items-center gap-3">
          <Link to={homeTo} onClick={() => setOpen(false)}>
            <Brand nameStyle={{ fontSize: "var(--nav-brand-size, 1.125rem)" }} />
          </Link>
          <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <button onClick={zoomOut} title="Zoom out" aria-label="Zoom out" className="px-1.5 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 sm:px-2"><ZoomOut className="h-4 w-4" /></button>
            <span className="min-w-[34px] text-center text-xs font-semibold tabular-nums text-slate-500 sm:min-w-[40px]">{Math.round(zoom * 100)}%</span>
            <button onClick={zoomIn} title="Zoom in" aria-label="Zoom in" className="px-1.5 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 sm:px-2"><ZoomIn className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="hidden items-center gap-1 lg:flex">
          {visibleLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              style={{
                fontSize: "var(--nav-font-size, 0.875rem)",
                fontWeight: "var(--nav-font-weight, 500)",
                fontFamily: "var(--nav-font-family)",
                textTransform: "var(--nav-text-transform, none)",
              }}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 transition-colors ${
                  isActive
                    ? "text-brand-600 dark:text-brand-400"
                    : "text-slate-600 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <InstallAppButton />
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          {user ? (
            <div className="hidden items-center gap-2 lg:flex">
              {/* Admin-only mode switch — students never see this */}
              {isAdmin && (
                <Link to="/admin" className="btn-accent py-2">
                  <ShieldCheck className="h-4 w-4" /> Admin Mode
                </Link>
              )}
              <Link to={isClient ? "/client" : "/dashboard"} className="btn-ghost">
                <LayoutDashboard className="h-4 w-4" /> {isClient ? "My Practice" : "Dashboard"}
              </Link>
              {/* Students manage their profile here; clients use the Account tab in their workspace */}
              {!isClient && !isAdmin && (
                <Link to="/account" className="btn-ghost" title="My Account">
                  <UserCog className="h-4 w-4" /> Account
                </Link>
              )}
              <Avatar src={user.avatar} name={user.name || user.email} size={36} />
              <button onClick={handleLogout} className="btn-ghost" title="Log out">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Link to="/login" className="hidden btn-primary lg:inline-flex">
              <User className="h-4 w-4" /> Login
            </Link>
          )}

          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg p-2 text-slate-600 lg:hidden dark:text-slate-300"
            aria-label="Toggle menu"
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="animate-fade-in border-t border-slate-200 bg-white px-4 py-3 lg:hidden dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-col gap-1">
            {visibleLinks.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                onClick={() => setOpen(false)}
                style={{
                  fontSize: "var(--nav-font-size, 0.875rem)",
                  fontWeight: "var(--nav-font-weight, 500)",
                  fontFamily: "var(--nav-font-family)",
                  textTransform: "var(--nav-text-transform, none)",
                }}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2.5 ${
                    isActive
                      ? "bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300"
                      : "text-slate-700 dark:text-slate-200"
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              {user ? (
                <>
                  {isAdmin && (
                    <Link to="/admin" onClick={() => setOpen(false)} className="btn-accent w-full">
                      <ShieldCheck className="h-4 w-4" /> Admin Mode
                    </Link>
                  )}
                  <Link to={isClient ? "/client" : "/dashboard"} onClick={() => setOpen(false)} className="btn-outline w-full">
                    <LayoutDashboard className="h-4 w-4" /> {isClient ? "My Practice" : "Dashboard"}
                  </Link>
                  {!isClient && !isAdmin && (
                    <Link to="/account" onClick={() => setOpen(false)} className="btn-outline w-full">
                      <UserCog className="h-4 w-4" /> Account
                    </Link>
                  )}
                  <button onClick={handleLogout} className="btn-ghost w-full">
                    <LogOut className="h-4 w-4" /> Log out
                  </button>
                </>
              ) : (
                <Link to="/login" onClick={() => setOpen(false)} className="btn-primary w-full">
                  <User className="h-4 w-4" /> Login
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
