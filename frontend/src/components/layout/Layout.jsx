import { useEffect, useState } from "react";
import { Outlet, ScrollRestoration } from "react-router-dom";
import Navbar from "./Navbar";
import Footer from "./Footer";
import NoticeTicker from "./NoticeTicker";
import ClientWelcomeModal from "../client/ClientWelcomeModal";

export default function Layout() {
  // Welcome popup on the public site — shows once each time the site is opened
  // (Layout mounts once per full page load), with the same welcome message +
  // admin-editable announcement used in the client workspace.
  // Show the welcome popup only ONCE per browser session — NOT on every refresh
  // or back-navigation. sessionStorage survives refreshes and history moves
  // within the same tab, and is cleared when the browser/tab is closed, so the
  // popup appears when the site is freshly opened and not again after that.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("mpm-welcome-seen")) {
        sessionStorage.setItem("mpm-welcome-seen", "1");
        setShowWelcome(true);
      }
    } catch {
      setShowWelcome(true); // storage blocked (private mode) — just show it
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {showWelcome && <ClientWelcomeModal onClose={() => setShowWelcome(false)} />}
      <NoticeTicker />
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}
