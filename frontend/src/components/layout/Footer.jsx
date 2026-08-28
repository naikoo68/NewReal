import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import Brand from "./Brand";
import { SOCIAL_ICONS, SOCIAL_COLORS, Website } from "../ui/SocialIcons";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Quizzes", to: "/quiz" },
      { label: "Test Series", to: "/test-series" },
      { label: "Study Material", to: "/study" },
      { label: "Dashboard", to: "/dashboard" },
      { label: "Leaderboard", to: "/dashboard" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Us", to: "/about" },
      { label: "Contact", to: "/contact" },
      { label: "Leave a Review", to: "/review" },
      { label: "Login", to: "/login" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Help Center", to: "/contact" },
      { label: "Privacy Policy", to: "/privacy" },
      { label: "Terms of Service", to: "/terms" },
      { label: "Refund Policy", to: "/refund" },
    ],
  },
];

export default function Footer({ hideProduct = false }) {
  const { settings } = useSettings();
  const socialLinks = (settings.socialLinks || []).filter((s) => s.url && s.url !== "#");
  const email = (settings.contacts || []).find((c) => c.type === "email")?.value;
  // Inside the client workspace the "Product" links (public quiz/test pages)
  // aren't relevant, so allow hiding that column.
  const visibleColumns = hideProduct ? columns.filter((c) => c.title !== "Product") : columns;

  // Brand block (logo, tagline, social icons) — shared by both layouts.
  const brandBlock = (
    <>
      <Link to="/">
        <Brand />
      </Link>
      <p className="mt-4 max-w-sm text-sm text-slate-500 dark:text-slate-400">
        {settings.tagline} Subject-wise quizzes, full-length test series,
        instant results and performance analytics — all in one place.
      </p>
      {socialLinks.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-3">
          {socialLinks.map((s, i) => {
            const Icon = SOCIAL_ICONS[s.platform] || Website;
            const bg = SOCIAL_COLORS[s.platform] || SOCIAL_COLORS.other;
            return (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                aria-label={s.platform}
                title={s.platform}
                style={{ backgroundColor: bg }}
                className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <Icon className="h-6 w-6" />
              </a>
            );
          })}
        </div>
      )}
    </>
  );

  // Link columns — shared markup; each is self-contained so it works as a grid
  // cell (public) or a flex child (client).
  const columnEls = visibleColumns.map((col) => (
    <div key={col.title} className="min-w-0">
      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{col.title}</h4>
      <ul className="mt-4 space-y-2.5">
        {col.links.map((link) => (
          <li key={link.label}>
            <Link
              to={link.to}
              className="text-sm text-slate-500 transition hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ));

  return (
    <footer className="mt-20 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="container-page py-12">
        {/* Brand + link columns stay side by side at ALL widths (portrait
            included) — for both the public site and the client workspace.
            `hideProduct` only controls which columns are shown. */}
        <div className="flex flex-row items-start gap-6 sm:gap-12">
          <div className="min-w-0 flex-1">{brandBlock}</div>
          <div className="flex shrink-0 gap-6 sm:gap-16">{columnEls}</div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row dark:border-slate-800 dark:text-slate-400">
          <p>© {new Date().getFullYear()} {settings.siteName}. All rights reserved.</p>
          {email && (
            <a href={`mailto:${email}`} className="flex items-center gap-2 hover:text-brand-600 dark:hover:text-brand-400">
              <Mail className="h-4 w-4" /> {email}
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}
