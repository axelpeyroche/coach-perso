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
  Accueil: ({ c = "w-5 h-5", f = "none" }) => (
    <svg viewBox="0 0 24 24" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={c} fill={f}>
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9.5z" />
    </svg>
  ),
  Carnet: ({ c = "w-5 h-5", f = "none" }) => (
    <svg viewBox="0 0 24 24" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={c} fill={f}>
      <path d="M5 4a2 2 0 012-2h11v18H7a2 2 0 00-2 2V4z" />
      <path d="M5 20a2 2 0 012-2h11M9 7h6M9 11h4" />
    </svg>
  ),
  Plan: ({ c = "w-5 h-5", f = "none" }) => (
    <svg viewBox="0 0 24 24" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={c} fill={f}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2" />
    </svg>
  ),
  Objectifs: ({ c = "w-5 h-5", f = "none" }) => (
    <svg viewBox="0 0 24 24" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={c} fill={f}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  ),
  Sources: ({ c = "w-5 h-5", f = "none" }) => (
    <svg viewBox="0 0 24 24" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={c} fill={f}>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </svg>
  ),
  Stats: ({ c = "w-5 h-5", f = "none" }) => (
    <svg viewBox="0 0 24 24" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={c} fill={f}>
      <path d="M3 20h18M7 20V10M12 20V4M17 20v-7" />
    </svg>
  ),
  Profil: ({ c = "w-5 h-5", f = "none" }) => (
    <svg viewBox="0 0 24 24" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={c} fill={f}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
};

// Carnet de suivi : navigation principale. Sur mobile, la barre d'onglets
// garde 5 entrées (règle iOS) ; Objectifs et Sources s'ouvrent depuis
// l'accueil et le profil.
const NAV = [
  { to: "/",          label: "Résumé",    IconC: Icon.Accueil },
  { to: "/plan",      label: "Plan",      IconC: Icon.Plan },
  { to: "/carnet",    label: "Carnet",    IconC: Icon.Carnet },
  { to: "/objectifs", label: "Objectifs", IconC: Icon.Objectifs, mobileHide: true },
  { to: "/stats",     label: "Stats",     IconC: Icon.Stats },
  { to: "/sources",   label: "Sources",   IconC: Icon.Sources, mobileHide: true },
  { to: "/profil",    label: "Profil",    IconC: Icon.Profil },
];

function SidebarLink({ to, label, IconC }) {
  return (
    <NavLink to={to} end={to === "/"}
      className={({ isActive }) => clsx(
        "flex items-center gap-3 px-3 h-9 rounded-[10px] text-[14px] transition-colors",
        isActive
          ? "bg-remplissage text-label font-semibold"
          : "text-label hover:bg-remplissage/60"
      )}>
      {({ isActive }) => (
        <>
          <span className={isActive ? "text-brand" : "text-label-2"}><IconC f={isActive ? "currentColor" : "none"} /></span>
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

// Barre d'onglets flottante en Liquid Glass (iOS 26) : icône + libellé,
// pastille de verre sous l'onglet actif, glisser le doigt pour changer d'onglet
function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navRef = useRef(null);
  const items = NAV.filter(n => !n.mobileHide);

  // Index de l'onglet actif (route la plus spécifique) ; -1 sur une page hors barre
  const activeIdx = items.findIndex(n =>
    n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)
  );

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
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 px-4 pointer-events-none"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}>
      <nav ref={navRef} className="glass pointer-events-auto relative flex h-[62px] rounded-full p-1">
        {/* Pastille de verre sous l'onglet actif */}
        {activeIdx >= 0 && (
          <div
            className="absolute top-1 bottom-1 left-1 rounded-full bg-remplissage transition-transform duration-300 ease-[cubic-bezier(0.3,1.3,0.5,1)] pointer-events-none"
            style={{
              width: `calc((100% - 0.5rem) / ${items.length})`,
              transform: `translateX(${activeIdx * 100}%)`,
            }}
          />
        )}
        {items.map((n, i) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}
            className={clsx(
              "relative z-10 flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors duration-200",
              i === activeIdx ? "text-brand" : "text-label"
            )}>
            <n.IconC c="w-[23px] h-[23px]" f={i === activeIdx ? "currentColor" : "none"} />
            <span className="text-[10px] font-semibold leading-none">{n.label}</span>
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
      <div className="animate-pulse text-label-3">
        <Icon.Carnet c="w-8 h-8" />
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#F2F2F7");
  }, [dark]);

  return (
    <Routes>
      <Route path="/login" element={<Auth />} />

      <Route path="/*" element={
        <RequireAuth>
            <div className="min-h-screen flex" style={{ overflowX: "clip" }}>

              {/* ── Sidebar desktop ── */}
              <aside className="hidden md:flex flex-col w-60 shrink-0 border-r-[0.5px] border-separateur bg-surface/70 backdrop-blur-xl px-3 py-6 gap-0.5 fixed top-0 left-0 h-full z-20 overflow-y-auto">
                <NavLink to="/" className="block px-3 mb-5">
                  <h1 className="text-[22px] font-bold tracking-[-0.02em]">Carnet</h1>
                  {user && (
                    <p className="text-[13px] text-label-2 truncate">
                      {user.prenom} {user.nom}
                    </p>
                  )}
                </NavLink>
                {NAV.map(n => <SidebarLink key={n.to} {...n} />)}
              </aside>

              {/* ── Bord supérieur mobile : floute le contenu sous la barre d'état ── */}
              <div className="md:hidden fixed top-0 left-0 right-0 z-20 glass-bord-haut pointer-events-none"
                style={{ height: "calc(env(safe-area-inset-top) + 10px)" }} />

              {/* ── Contenu principal ── */}
              <main
                className="flex-1 md:ml-60 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0 min-h-screen w-full min-w-0"
                style={{ overflowX: "clip" }}
              >
                <ScrollToTop />
                <Suspense fallback={<p className="p-8 text-[15px] text-label-2">Chargement…</p>}>
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

              {/* ── Barre d'onglets mobile ── */}
              <BottomNav />

            </div>
        </RequireAuth>
      } />
    </Routes>
  );
}
