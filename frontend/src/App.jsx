import { useState, useEffect, useLayoutEffect, useRef, lazy, Suspense } from "react";
import { Routes, Route, NavLink, Link, Navigate, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "./AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { synchroIntervals } from "./api";
import Auth from "./pages/Auth";
import { ONGLETS, ongletDe, estPoussee } from "./navigation";

// Pages chargées à la demande : chaque page (et recharts) dans son propre chunk
const Accueil = lazy(() => import("./pages/Accueil"));
const Plan = lazy(() => import("./pages/Plan"));
const Carnet = lazy(() => import("./pages/Carnet"));
const Objectifs = lazy(() => import("./pages/Objectifs"));
const StatsCarnet = lazy(() => import("./pages/StatsCarnet"));
const Analyses = lazy(() => import("./pages/Analyses"));
const Sources = lazy(() => import("./pages/Sources"));
const Profil = lazy(() => import("./pages/Profil"));
const Records = lazy(() => import("./pages/Records"));

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
  Analyses: ({ c = "w-5 h-5", f = "none" }) => (
    <svg viewBox="0 0 24 24" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={c} fill={f}>
      <path d="M3 17l5-5 4 3 8-9" />
      <path d="M15 6h5v5" />
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
  { to: "/analyses",  label: "Analyses",  IconC: Icon.Analyses, mobileHide: true },
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

// Barre compacte au défilement vers le bas (comme Musique ou News sous
// iOS 26) ; elle reprend sa taille dès qu'on remonte.
function useBarreCompacte(pathname) {
  const [compacte, setCompacte] = useState(false);
  useEffect(() => {
    setCompacte(false);
    let y0 = window.scrollY, cumul = 0;
    const f = () => {
      if (document.documentElement.classList.contains("verrou")) return;
      const y = window.scrollY, dy = y - y0;
      y0 = y;
      if (y < 80) { cumul = 0; setCompacte(false); return; }
      // Rebond élastique en bas de page : ignoré
      if (y + window.innerHeight >= document.documentElement.scrollHeight - 2) return;
      cumul = (Math.sign(dy) === Math.sign(cumul) ? cumul : 0) + dy;
      if (cumul > 28) setCompacte(true);
      else if (cumul < -28) setCompacte(false);
    };
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, [pathname]);
  return compacte;
}

// Barre d'onglets flottante en Liquid Glass (iOS 26). Toucher un onglet fait
// apparaître une lentille de verre sous le doigt ; glisser la déplace d'un
// onglet à l'autre et relâcher ouvre l'onglet visé. La pastille de sélection
// rejoint l'onglet choisi avec un ressort en s'étirant comme une goutte.
// Toucher l'onglet déjà actif remonte en haut (ou revient à sa racine).
const LENTILLE_ECHELLE_X = 1.14;   // = scale horizontal de .pastille-onglet.lentille (index.css)

function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navRef = useRef(null);
  const pastilleRef = useRef(null);
  const items = NAV.filter(n => !n.mobileHide);
  const n = items.length;
  const actif = ONGLETS.indexOf(ongletDe(pathname));
  const [glisse, setGlisse] = useState(false);   // lentille sous le doigt
  const [sous, setSous] = useState(-1);          // onglet sous le doigt
  const [cible, setCible] = useState(null);      // onglet choisi, en attendant la navigation
  const [etire, setEtire] = useState(false);
  const compacte = useBarreCompacte(pathname);
  const ignorerClic = useRef(false);
  const actifRef = useRef(actif);
  actifRef.current = actif;
  const choisi = cible ?? actif;

  // La navigation est faite : l'onglet choisi est devenu l'onglet actif
  useEffect(() => { setCible(null); }, [actif]);
  useEffect(() => {
    if (cible == null) return;
    const t = setTimeout(() => setCible(null), 1000);  // navigation annulée
    return () => clearTimeout(t);
  }, [cible]);

  // Effet « goutte » à chaque changement d'onglet
  const precedent = useRef(choisi);
  useEffect(() => {
    if (precedent.current === choisi) return;
    precedent.current = choisi;
    setEtire(false);
    const r = requestAnimationFrame(() => setEtire(true));
    const t = setTimeout(() => setEtire(false), 600);
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, [choisi]);

  // Hors geste, la pastille se pose sur l'onglet choisi (pendant le geste, la
  // position sous le doigt est écrite directement dans le style, sans rendu React).
  // Position par `left` en calc() relatif à la barre, et non par un translate en % :
  // quand la barre rétrécit au défilement, Safari iOS ne recalcule pas le
  // pourcentage du translate et la bulle des onglets 3 à 5 partait vers la droite.
  useLayoutEffect(() => {
    if (!glisse && pastilleRef.current) {
      const st = pastilleRef.current.style;
      st.left = `calc(4px + ${Math.max(choisi, 0)} * (100% - 8px) / ${n})`;
      st.translate = "0px 0";
    }
  }, [glisse, choisi, n]);

  // Pointer Events + capture : le geste reste à la barre du début à la fin
  // (touch-action: none en CSS empêche Safari de le récupérer pour défiler).
  // La lentille suit le doigt image par image ; on navigue au relâchement.
  useEffect(() => {
    const nav = navRef.current;
    const pastille = pastilleRef.current;
    if (!nav || !pastille) return;
    let enCours = null, idx = -1, x = 0, image = 0;

    const indice = (r) => Math.max(0, Math.min(n - 1, Math.floor((x - r.left - 4) / ((r.width - 8) / n))));
    const dessiner = () => {
      image = 0;
      const r = nav.getBoundingClientRect();
      // La lentille est agrandie (scale en CSS) : on la garde à 2 px des bords de la barre
      const w = pastille.offsetWidth, L = nav.clientWidth;
      const deborde = w * (LENTILLE_ECHELLE_X - 1) / 2;
      const t = Math.max(deborde - 2, Math.min(L - 6 - w - deborde, x - r.left - nav.clientLeft - 4 - w / 2));
      pastille.style.translate = `${t}px 0`;
      const i = indice(r);
      if (i !== idx) { idx = i; setSous(i); }
    };
    const debut = (e) => {
      if (enCours != null || (e.pointerType === "mouse" && e.button !== 0)) return;
      enCours = e.pointerId;
      try { nav.setPointerCapture(e.pointerId); } catch { /* navigateur ancien */ }
      pastille.classList.remove("suit");   // la lentille rejoint le doigt en glissant…
      idx = -1;
      x = e.clientX;
      setGlisse(true);
      pastille.style.left = "4px";         // pendant le geste, tout passe par le translate en px
      dessiner();
    };
    const bouge = (e) => {
      if (e.pointerId !== enCours) return;
      e.preventDefault();
      pastille.classList.add("suit");      // …puis colle au doigt, sans retard
      x = e.clientX;
      if (!image) image = requestAnimationFrame(dessiner);
    };
    const fin = (e) => {
      if (e.pointerId !== enCours) return;
      enCours = null;
      if (image) { cancelAnimationFrame(image); image = 0; }
      pastille.classList.remove("suit");
      if (e.type !== "pointerup" || idx < 0) { setGlisse(false); return; }
      // L'onglet sous le doigt au relâchement (la dernière image n'est peut-être pas dessinée)
      x = e.clientX;
      idx = indice(nav.getBoundingClientRect());
      // Le « click » qui suit est ignoré : c'est ici qu'on navigue
      ignorerClic.current = true;
      setTimeout(() => { ignorerClic.current = false; }, 400);
      const i = idx, destination = items[i].to;
      setCible(i);
      setGlisse(false);
      if (i !== actifRef.current || window.location.pathname !== destination) navigate(destination);
      else window.scrollTo({ top: 0, behavior: "smooth" });
    };

    nav.addEventListener("pointerdown", debut);
    nav.addEventListener("pointermove", bouge);
    nav.addEventListener("pointerup", fin);
    nav.addEventListener("pointercancel", fin);
    nav.addEventListener("lostpointercapture", fin);
    return () => {
      if (image) cancelAnimationFrame(image);
      nav.removeEventListener("pointerdown", debut);
      nav.removeEventListener("pointermove", bouge);
      nav.removeEventListener("pointerup", fin);
      nav.removeEventListener("pointercancel", fin);
      nav.removeEventListener("lostpointercapture", fin);
    };
  }, [navigate, n]);   // eslint-disable-line react-hooks/exhaustive-deps

  const surligne = glisse ? sous : choisi;

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 px-4 pointer-events-none"
      style={{ paddingBottom: "max(calc(env(safe-area-inset-bottom) - 8px), 14px)" }}>
      {/* La barre garde sa taille pendant le geste : sinon la lentille se décale du doigt */}
      <nav ref={navRef} aria-label="Onglets"
        className={clsx("barre-onglets glass pointer-events-auto", compacte && "compacte")}>
        <div aria-hidden ref={pastilleRef}
          className={clsx("pastille-onglet", glisse && "lentille", etire && !glisse && "etire")}
          style={{
            width: `calc((100% - 8px) / ${n})`,
            opacity: choisi < 0 && !glisse ? 0 : 1,
            // Sur un onglet du bord, la goutte s'étire vers l'intérieur de la barre
            transformOrigin: glisse ? "center" : choisi === 0 ? "left center" : choisi === n - 1 ? "right center" : "center",
          }} />
        {items.map((it, i) => (
          <Link key={it.to} to={it.to} aria-current={i === actif ? "page" : undefined}
            draggable={false}
            onClick={(e) => {
              // Souris / doigt : déjà géré au relâchement. Reste le clavier.
              if (ignorerClic.current || e.detail > 0) { e.preventDefault(); return; }
              if (i === actif) {
                e.preventDefault();
                if (pathname !== it.to) navigate(it.to);
                else window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            className={clsx("onglet", i === surligne ? "text-brand" : "text-label")}>
            <it.IconC c="w-[24px] h-[24px]" f={i === surligne ? "currentColor" : "none"} />
            <span className="onglet-libelle">{it.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

// Position de défilement mémorisée par écran : changer d'onglet puis revenir
// retrouve l'endroit où on était, comme dans une app iOS. Une page poussée
// (Objectifs, Analyses, Sources) s'ouvre toujours en haut.
function MemoireDefilement() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  const positions = useRef({});
  const courant = useRef(pathname);

  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    const f = () => {
      if (!document.documentElement.classList.contains("verrou")) positions.current[courant.current] = window.scrollY;
    };
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);

  useLayoutEffect(() => {
    courant.current = pathname;
    const y = estPoussee(pathname) && type === "PUSH" ? 0 : positions.current[pathname] ?? 0;
    window.scrollTo(0, y);
    if (y <= 0) return;
    // Contenu chargé à la demande : on réessaie le temps que la page grandisse
    let essais = 0;
    const id = setInterval(() => {
      if (Math.abs(window.scrollY - y) < 2 || ++essais > 12) clearInterval(id);
      else window.scrollTo(0, y);
    }, 50);
    const stop = () => clearInterval(id);
    window.addEventListener("touchstart", stop, { once: true });
    return () => { stop(); window.removeEventListener("touchstart", stop); };
  }, [pathname]);   // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

function RequireAuth({ children }) {
  const { token, loading } = useAuth();
  const location = useLocation();
  // Chargement qui dure : le serveur gratuit sort de veille, on le dit au lieu d'un écran muet
  const [lent, setLent] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLent(true), 3_000);
    return () => clearTimeout(t);
  }, [loading]);
  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="animate-pulse text-label-3">
        <Icon.Carnet c="w-8 h-8" />
      </div>
      {lent && (
        <p className="text-[13px] text-label-2" role="status">
          Réveil du serveur… cela peut prendre jusqu'à une minute.
        </p>
      )}
    </div>
  );
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

// Séances de la montre (Intervals.icu) : récupérées à l'ouverture et au retour sur l'app.
// Le serveur ignore l'appel si la dernière synchro date de moins d'un quart d'heure.
function SynchroIntervals() {
  const qc = useQueryClient();
  useEffect(() => {
    const lancer = () => {
      if (document.visibilityState !== "visible") return;
      synchroIntervals().then((r) => {
        if (r.nouvelles || r.completees || r.traces || r.mesures) {
          ["activites", "stats-carnet", "objectifs", "plan", "carte-traces", "intervals", "analyses", "mesures", "profil-fc", "forme-jour", "records"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        }
      }).catch(() => {});
    };
    lancer();
    document.addEventListener("visibilitychange", lancer);
    return () => document.removeEventListener("visibilitychange", lancer);
  }, [qc]);
  return null;
}

// Service worker : notifications push uniquement (aucune mise en cache).
// À l'ouverture de l'app, la pastille de l'icône est effacée.
function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then(async () => {
      const sw = await navigator.serviceWorker.ready;
      sw.active?.postMessage("clearBadge");
      navigator.clearAppBadge?.().catch(() => {});
    }).catch(() => {});
  }, []);
  return null;
}

export default function App() {
  const { user } = useAuth();
  const location = useLocation();
  const { pathname } = location;
  const typeNav = useNavigationType();

  // Apparence : "auto" suit le réglage du système (bascule clair/sombre automatique)
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      return saved === "dark" || saved === "light" ? saved : "auto";
    } catch { return "auto"; }
  });
  const [systemeSombre, setSystemeSombre] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const dark = theme === "auto" ? systemeSombre : theme === "dark";

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const suivre = (e) => setSystemeSombre(e.matches);
    mq.addEventListener("change", suivre);
    return () => mq.removeEventListener("change", suivre);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("theme", theme); } catch { /* stockage indisponible */ }
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#F2F2F7");
  }, [dark]);

  return (
    <Routes>
      <Route path="/login" element={<Auth />} />

      <Route path="/*" element={
        <RequireAuth>
            <SynchroIntervals />
            <ServiceWorker />
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

              {/* ── Contenu principal ── */}
              <main
                className="flex-1 md:ml-60 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-0 min-h-screen w-full min-w-0"
                style={{ overflowX: "clip" }}
              >
                <MemoireDefilement />
                <Suspense fallback={<p className="p-8 text-[15px] text-label-2">Chargement…</p>}>
                {/* Transition iOS : glissement depuis la droite pour une page poussée */}
                <div key={pathname} className={estPoussee(pathname) && typeNav === "PUSH" ? "vue-pousse" : "vue-fondu"}>
                <Routes>
                  <Route path="/"           element={<Accueil />} />
                  <Route path="/plan"       element={<Plan />} />
                  <Route path="/carnet"     element={<Carnet />} />
                  <Route path="/objectifs"  element={<Objectifs />} />
                  <Route path="/stats"      element={<StatsCarnet />} />
                  <Route path="/analyses"   element={<Analyses />} />
                  <Route path="/records"    element={<Records />} />
                  <Route path="/sources"    element={<Sources />} />
                  <Route path="/profil"     element={<Profil theme={theme} setTheme={setTheme} />} />
                  <Route path="*"           element={<Navigate to="/" replace />} />
                </Routes>
                </div>
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
