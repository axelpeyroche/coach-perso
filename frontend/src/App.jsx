import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "./AuthContext";
import Auth from "./pages/Auth";

// Pages chargées à la demande : chaque page (et recharts) dans son propre chunk
const Accueil = lazy(() => import("./pages/Accueil"));
const Plan = lazy(() => import("./pages/Plan"));
const Carnet = lazy(() => import("./pages/Carnet"));
const Objectifs = lazy(() => import("./pages/Objectifs"));
const StatsCarnet = lazy(() => import("./pages/StatsCarnet"));
const Sources = lazy(() => import("./pages/Sources"));
const Profil = lazy(() => import("./pages/Profil"));

// ── SVG Icons ──────────────────────────────────────────────────────────────
const Icon = {
  Accueil: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9.5z" />
    </svg>
  ),
  Carnet: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M5 4a2 2 0 012-2h11v18H7a2 2 0 00-2 2V4z" />
      <path d="M5 20a2 2 0 012-2h11M9 7h6M9 11h4" />
    </svg>
  ),
  Plan: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2" />
    </svg>
  ),
  Objectifs: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  ),
  Sources: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
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
};

// Carnet de suivi : navigation principale (sidebar + barre mobile)
const NAV = [
  { to: "/",          label: "Accueil",   IconC: Icon.Accueil },
  { to: "/plan",      label: "Plan",      IconC: Icon.Plan },
  { to: "/carnet",    label: "Carnet",    IconC: Icon.Carnet },
  { to: "/objectifs", label: "Objectifs", IconC: Icon.Objectifs },
  { to: "/stats",     label: "Stats",     IconC: Icon.Stats },
  { to: "/sources",   label: "Sources",   IconC: Icon.Sources },
  { to: "/profil",    label: "Profil",    IconC: Icon.Profil },
];

function SidebarLink({ to, label, IconC }) {
  return (
    <NavLink to={to} end={to === "/"}
      className={({ isActive }) => clsx(
        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
        isActive
          ? "glass-sm text-brand dark:text-brand font-semibold"
          : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:font-semibold hover:bg-white/40 dark:hover:bg-white/8 hover:border hover:border-white/60 dark:hover:border-white/20 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.7),inset_1px_0_0_rgba(255,255,255,0.3),inset_-1px_0_0_rgba(255,255,255,0.2)]"
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
        <Icon.Carnet />
      </div>
    </div>
  );
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();

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

      <Route path="/*" element={
        <RequireAuth>
            <div className="min-h-screen flex" style={{ overflowX: "clip" }}>

              {/* ── Sidebar desktop ── */}
              <aside className="hidden md:flex flex-col w-56 shrink-0 border-r glass-nav px-3 py-6 gap-1 fixed top-0 left-0 h-full z-20 overflow-y-auto">
                <NavLink to="/" className="block px-4 mb-6 hover:opacity-75 transition-opacity">
                  <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Suivi</p>
                  <h1 className="text-lg font-bold bg-gradient-to-r from-violet-600 to-indigo-500 dark:from-violet-300 dark:to-indigo-300 bg-clip-text text-transparent mt-0.5">Mon carnet</h1>
                  {user && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                      {user.prenom} {user.nom}
                    </p>
                  )}
                </NavLink>
                {NAV.map(n => <SidebarLink key={n.to} {...n} />)}
              </aside>

              {/* ── Header mobile — flottant, sans fond visible ── */}
              <header
                className="md:hidden fixed left-0 right-0 z-20 flex items-center px-5"
                style={{
                  top: 0,
                  paddingTop: "env(safe-area-inset-top)",
                  height: "calc(3.25rem + env(safe-area-inset-top))",
                  pointerEvents: "none",
                }}
              >
                <NavLink
                  to="/"
                  className="flex items-center gap-2"
                  style={{ pointerEvents: "auto" }}
                >
                  <span className="text-xl drop-shadow-md">⚡</span>
                  <span className="text-base font-bold drop-shadow-md bg-gradient-to-r from-violet-600 to-indigo-500 dark:from-violet-300 dark:to-indigo-300 bg-clip-text text-transparent">Mon carnet</span>
                </NavLink>
              </header>

              {/* ── Contenu principal ── */}
              <main
                className="flex-1 md:ml-56 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0 min-h-screen w-full min-w-0 mobile-header-offset"
                style={{ overflowX: "clip" }}
              >
                <ScrollToTop />
                <Suspense fallback={<p className="p-8 text-sm text-gray-400">Chargement…</p>}>
                <Routes>
                  <Route path="/"           element={<Accueil />} />
                  <Route path="/plan"       element={<Plan />} />
                  <Route path="/carnet"     element={<Carnet />} />
                  <Route path="/objectifs"  element={<Objectifs />} />
                  <Route path="/stats"      element={<StatsCarnet />} />
                  <Route path="/sources"    element={<Sources />} />
                  <Route path="/profil"     element={<Profil dark={dark} setDark={setDark} />} />
                  <Route path="*"           element={<Navigate to="/" replace />} />
                </Routes>
                </Suspense>
              </main>

              {/* ── Bottom nav mobile ── */}
              <BottomNav />

            </div>
        </RequireAuth>
      } />
    </Routes>
    </>
  );
}
