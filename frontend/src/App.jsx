import { useState, useEffect, useRef } from "react";
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
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

// ── Fond liquide animé : 3 blobs colorés + parallaxe souris/tactile ────────
function LiquidBackground() {
  const blobsRef = useRef([]);

  useEffect(() => {
    const handleMove = (e) => {
      let x, y;
      if (e.type === "touchmove") {
        x = e.touches[0].clientX;
        y = e.touches[0].clientY;
      } else {
        x = e.clientX;
        y = e.clientY;
      }
      const relX = x / window.innerWidth - 0.5;
      const relY = y / window.innerHeight - 0.5;
      requestAnimationFrame(() => {
        const [b1, b2, b3] = blobsRef.current;
        if (b1) b1.style.transform = `translate(${relX * -10}%, ${relY * -10}%) translateZ(0)`;
        if (b2) b2.style.transform = `translate(${relX * -20}%, ${relY * -20}%) translateZ(0)`;
        if (b3) b3.style.transform = `translate(${relX * -30}%, ${relY * -30}%) translateZ(0)`;
      });
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("touchmove", handleMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("touchmove", handleMove);
    };
  }, []);

  return (
    <div className="liquid-bg" aria-hidden="true">
      <div className="liquid-blob blob-1" ref={el => (blobsRef.current[0] = el)} />
      <div className="liquid-blob blob-2" ref={el => (blobsRef.current[1] = el)} />
      <div className="liquid-blob blob-3" ref={el => (blobsRef.current[2] = el)} />
    </div>
  );
}

function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navRef = useRef(null);
  const items = NAV.filter(n => !n.mobileHide);

  // Index de l'onglet actif (route la plus spécifique)
  const activeIdx = Math.max(0, items.findIndex(n =>
    n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)
  ));

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    let startX = 0, startY = 0, scrubbing = false, lastIdx = -1;

    function getIdx(clientX) {
      const rect = el.getBoundingClientRect();
      const rel = clientX - rect.left;
      return Math.max(0, Math.min(items.length - 1, Math.floor(rel / (rect.width / items.length))));
    }

    function onStart(e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      scrubbing = false;
      lastIdx = getIdx(startX);
    }

    function onMove(e) {
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dx = Math.abs(x - startX);
      const dy = Math.abs(y - startY);
      // Attend un mouvement minimal et ignore le scroll vertical
      if (!scrubbing) {
        if (dx < 5 && dy < 5) return;
        if (dy > dx) return;
        scrubbing = true;
      }
      e.preventDefault();
      const idx = getIdx(x);
      if (idx !== lastIdx) {
        lastIdx = idx;
        navigate(items[idx].to);
      }
    }

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, [navigate, items.length]);

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-20 px-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}>
      <nav ref={navRef}
        className="relative flex glass-nav rounded-[28px] h-[60px] overflow-hidden border">
        {/* Lentille glissante (effet loupe) */}
        <div
          className="glass-lens absolute top-[6px] bottom-[6px] rounded-[22px] transition-transform duration-300 ease-out pointer-events-none"
          style={{
            width: `calc(${100 / items.length}% - 8px)`,
            left: "4px",
            transform: `translateX(calc(${activeIdx * 100}% + ${activeIdx * 8}px))`,
          }}
        />
        {items.map((n, i) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}
            className={clsx(
              "relative z-10 flex-1 flex items-center justify-center transition-colors duration-200",
              i === activeIdx
                ? "text-gray-900 dark:text-white"
                : "text-gray-400 dark:text-gray-500"
            )}>
            <n.IconC />
          </NavLink>
        ))}
      </nav>
    </div>
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
    <>
    <LiquidBackground />
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
              <header
                className="md:hidden fixed top-0 left-0 right-0 z-20 flex items-center px-5 glass-nav border-b"
                style={{
                  paddingTop: "env(safe-area-inset-top)",
                  height: "calc(3.5rem + env(safe-area-inset-top))",
                }}
              >
                <NavLink to="/" className="flex items-center gap-2 hover:opacity-75 transition-opacity">
                  <span className="text-xl">⚡</span>
                  <span className="text-base font-bold bg-gradient-to-r from-violet-600 to-indigo-500 dark:from-violet-300 dark:to-indigo-300 bg-clip-text text-transparent">Coach Perso</span>
                </NavLink>
              </header>

              {/* ── Contenu principal ── */}
              <main
                className="flex-1 md:ml-56 md:pt-0 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0 min-h-screen overflow-x-hidden w-full min-w-0"
                style={{ paddingTop: "calc(3.5rem + env(safe-area-inset-top))" }}
              >
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
              <BottomNav />

            </div>
          </RequireOnboarding>
        </RequireAuth>
      } />
    </Routes>
    </>
  );
}
