import { useState, useEffect } from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "./AuthContext";
import { usePushNotifications } from "./usePush";
import Dashboard from "./pages/Dashboard";
import Programme from "./pages/Programme";
import Evaluation from "./pages/Evaluation";
import Analytics from "./pages/Analytics";
import Calendrier from "./pages/Calendrier";
import Profil from "./pages/Profil";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import Timers from "./pages/Timers";

// ── SVG Icons ──────────────────────────────────────────────────────────────
const Icon = {
  Dashboard: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  Programme: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  ),
  Calendrier: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  ),
  Evaluation: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
    </svg>
  ),
  Stats: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M3 20h18M7 20V10M12 20V4M17 20v-7" />
    </svg>
  ),
  Profil: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  Timers: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M5 3l4 2M19 3l-4 2" />
    </svg>
  ),
};

const NAV = [
  { to: "/",           label: "Dashboard",  mobileLabel: "Home",  IconC: Icon.Dashboard },
  { to: "/programme",  label: "Programme",  mobileLabel: "Prog.", IconC: Icon.Programme },
  { to: "/calendrier", label: "Calendrier", mobileLabel: "Cal.",  IconC: Icon.Calendrier },
  { to: "/evaluation", label: "Évaluation", mobileLabel: "Éval.",  IconC: Icon.Evaluation },
  { to: "/analytics",  label: "Stats",      IconC: Icon.Stats },
  { to: "/timers",     label: "Timers",     IconC: Icon.Timers },
  { to: "/profil",     label: "Profil",     IconC: Icon.Profil },
];

function SidebarLink({ to, label, IconC }) {
  return (
    <NavLink to={to} end={to === "/"}
      className={({ isActive }) => clsx(
        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all",
        isActive
          ? "glass-sm text-brand dark:text-brand font-semibold"
          : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/5"
      )}>
      <IconC />
      <span>{label}</span>
    </NavLink>
  );
}

function BottomLink({ to, label, mobileLabel, IconC }) {
  return (
    <NavLink to={to} end={to === "/"}
      className={({ isActive }) => clsx(
        "flex flex-col items-center justify-center gap-0.5 flex-1 py-2 min-h-[52px] text-xs font-medium transition-all",
        isActive ? "text-brand" : "text-gray-400 dark:text-gray-500"
      )}>
      {({ isActive }) => (
        <>
          <span className={clsx("p-1.5 rounded-xl transition-all", isActive && "bg-brand/10 dark:bg-brand/15")}>
            <IconC />
          </span>
          <span className="text-[9px] leading-tight">{mobileLabel ?? label}</span>
        </>
      )}
    </NavLink>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function RequireAuth({ children }) {
  const { token, loading } = useAuth();
  const location = useLocation();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-purple-400 dark:text-purple-300">
        <Icon.Dashboard />
      </div>
    </div>
  );
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function RequireOnboarding({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user && !user.onboarding_complet) return <Navigate to="/onboarding" replace />;
  return children;
}

export default function App() {
  const { user, setUser } = useAuth();
  usePushNotifications();

  // Retour OAuth Strava : rafraîchit le profil et nettoie l'URL
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("strava") === "ok") {
      import("./api").then(({ default: api }) =>
        api.get("/auth/me").then(r => setUser(r.data))
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <Routes>
      <Route path="/login" element={<Auth />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />

      <Route path="/*" element={
        <RequireAuth>
          <RequireOnboarding>
            <div className="min-h-screen flex overflow-x-hidden">

              {/* ── Sidebar desktop ── */}
              <aside className="hidden md:flex flex-col w-56 shrink-0 border-r glass-nav px-3 py-6 gap-1 fixed top-0 left-0 h-full z-20">
                <NavLink to="/" className="block px-4 mb-6 hover:opacity-75 transition-opacity">
                  <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Coach</p>
                  <h1 className="text-lg font-bold bg-gradient-to-r from-violet-600 to-indigo-500 dark:from-violet-300 dark:to-indigo-300 bg-clip-text text-transparent mt-0.5">Coach Perso</h1>
                  {user && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                      {user.prenom} {user.nom}
                    </p>
                  )}
                </NavLink>
                {NAV.map(n => <SidebarLink key={n.to} {...n} />)}
              </aside>

              {/* ── Header mobile ── */}
              <header className="md:hidden fixed top-0 left-0 right-0 z-20 flex items-center justify-between px-4 h-14 glass-nav border-b">
                <NavLink to="/" className="flex items-center gap-2 hover:opacity-75 transition-opacity">
                  <span className="text-xl">⚡</span>
                  <span className="text-base font-bold bg-gradient-to-r from-violet-600 to-indigo-500 dark:from-violet-300 dark:to-indigo-300 bg-clip-text text-transparent">Coach Perso</span>
                </NavLink>
              </header>

              {/* ── Contenu principal ── */}
              <main className="flex-1 md:ml-56 pt-14 md:pt-0 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 min-h-screen overflow-x-hidden w-full min-w-0">
                <ScrollToTop />
                <Routes>
                  <Route path="/"           element={<Dashboard />} />
                  <Route path="/programme"  element={<Programme />} />
                  <Route path="/evaluation" element={<Evaluation />} />
                  <Route path="/calendrier" element={<Calendrier />} />
                  <Route path="/analytics"  element={<Analytics dark={dark} />} />
                  <Route path="/timers"     element={<Timers />} />
                  <Route path="/profil"     element={<Profil dark={dark} setDark={setDark} />} />
                </Routes>
              </main>

              {/* ── Bottom nav mobile ── */}
              <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 flex glass-nav border-t"
                style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
                {NAV.filter(n => !n.mobileHide).map(n => <BottomLink key={n.to} {...n} />)}
              </nav>

            </div>
          </RequireOnboarding>
        </RequireAuth>
      } />
    </Routes>
  );
}
