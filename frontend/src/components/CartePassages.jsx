import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCarteTraces } from "../api";
import { useAuth } from "../AuthContext";
import { STYLE, Bascule, chargerMaplibre, controleRotation, tournerALaSouris } from "./CarteTrace";
import { cadresTraces, calculerPassages, decoderTraces, tracesPassantPar, traitTroncon, tronconClique } from "../passages";
import { getActivite } from "../api";
import { sportInfo } from "../carnet";
import FicheActivite from "./FicheActivite";

const TACTILE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const SPORTS = [["course", "Course"], ["trail", "Trail"], ["velo", "Vélo"], ["marche", "Marche"], ["randonnee", "Rando"]];
const PAR_DEFAUT = ["course", "trail", "velo", "marche", "randonnee"];
// Paliers de passages (bornes basses) → couleur du trait
const PALIERS = [
  [1, "1", "#64D2FF"], [2, "2", "#30D158"], [3, "3–4", "#FFD60A"], [5, "5–9", "#FF9F0A"],
  [10, "10–19", "#FF453A"], [20, "20–49", "#FF2DAA"], [50, "50+", "#8E5CFF"],
];
const COULEUR = ["match", ["get", "n"], ...PALIERS.flatMap(([n, , c]) => [n, c]), "#64D2FF"];
const LARGEUR = ["interpolate", ["linear"], ["zoom"], 9, 1.2, 13, 2.2, 16, 4];
const LARGEUR_BORD = ["interpolate", ["linear"], ["zoom"], 9, 2.4, 13, 3.6, 16, 5.5];
const ZOOM_DOMICILE = 11.5;
const VIDE = { type: "FeatureCollection", features: [] };
const OPACITE_ESTOMPEE = 0.06;   // tracés qui ne passent pas par le tronçon cliqué

const dureeTexte = (s) => {
  if (!s) return null;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};
const jourTexte = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR",
  { weekday: "short", day: "numeric", month: "short", year: iso.slice(0, 4) === String(new Date().getFullYear()) ? undefined : "numeric" });

// Liste des séances passées par le tronçon cliqué
function PanneauPassage({ seances, lieu, sportListe, setSportListe, onFermer, onOuvrir }) {
  const parSport = Object.entries(seances.reduce((o, s) => ({ ...o, [s.sport]: (o[s.sport] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]);
  const liste = sportListe ? seances.filter((s) => s.sport === sportListe) : seances;
  const km = Math.round(liste.reduce((t, s) => t + s.km, 0));
  const puce = (actif) => `shrink-0 px-2.5 py-0.5 rounded-full text-[12px] font-semibold ${actif ? "bg-white text-black" : "bg-white/15 text-white/85"}`;
  return (
    <div className="panneau-passage absolute z-20 inset-x-0 bottom-0 max-h-[58%] sm:inset-x-auto sm:top-0 sm:right-0 sm:max-h-none sm:w-72
      flex flex-col bg-black/80 backdrop-blur text-white sm:border-l border-t sm:border-t-0 border-white/10">
      <div className="px-3 pt-2.5 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[15px] font-semibold chiffres">
            {liste.length} séance{liste.length > 1 ? "s" : ""} ici{km > 0 && <span className="font-normal text-white/60"> · {km.toLocaleString("fr-FR")} km</span>}
          </p>
          <button type="button" onClick={onFermer} aria-label="Fermer la liste" className="h-7 w-7 grid place-items-center rounded-full bg-white/15 text-[13px]">✕</button>
        </div>
        {lieu && <p className="text-[12px] text-white/60 truncate">{lieu}</p>}
        {parSport.length > 1 && (
          <div className="flex gap-1.5 mt-2 overflow-x-auto">
            <button type="button" className={puce(!sportListe)} onClick={() => setSportListe(null)}>Tout</button>
            {parSport.map(([sp, n]) => (
              <button type="button" key={sp} className={puce(sportListe === sp)} onClick={() => setSportListe(sportListe === sp ? null : sp)}>
                {sportInfo(sp).label} {n}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        {liste.length === 0 && <li className="px-3 py-3 text-[13px] text-white/60">Aucune séance ici avec ces filtres.</li>}
        {liste.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onOuvrir(s.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left border-b border-white/[0.07] hover:bg-white/10 active:bg-white/15">
              <span className="text-[17px] leading-none" aria-hidden="true">{sportInfo(s.sport).emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold truncate">{s.titre || sportInfo(s.sport).label}</span>
                <span className="block text-[11.5px] text-white/60 chiffres">
                  {[jourTexte(s.jour), s.km > 0 && `${s.km.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`, dureeTexte(s.duree)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="text-white/40 text-[13px]" aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Recherche d'une ville ou d'un lieu (Photon / OpenStreetMap : gratuit, sans clé).
function RechercheLieu({ onChoix, centre }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [sel, setSel] = useState(0);
  const [cherche, setCherche] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes([]); setCherche(false); return; }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setCherche(true);
      try {
        const c = centre?.();
        const proche = c ? `&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&zoom=8` : "";
        const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(t)}&lang=fr&limit=10${proche}`, { signal: ctrl.signal });
        const j = await r.json();
        const vus = new Set();
        setRes((j.features ?? []).map((f) => {
          const p = f.properties;
          const lieu = [p.city !== p.name && p.city, p.county !== p.name && p.state !== p.county && p.county, p.state !== p.name && p.state, p.country]
            .filter(Boolean).join(", ");
          return { id: `${p.osm_type}${p.osm_id}`, nom: p.name ?? t, lieu, centre: f.geometry.coordinates,
            cadre: p.extent && [[p.extent[0], p.extent[3]], [p.extent[2], p.extent[1]]] };
        }).filter((r) => {   // une même ville revient souvent en plusieurs exemplaires (commune, arrondissement…)
          const k = `${r.nom}|${r.lieu}`;
          return !vus.has(k) && vus.add(k);
        }).slice(0, 6));
        setSel(0); setOuvert(true); setCherche(false);
      } catch (e) { if (e.name !== "AbortError") setCherche(false); }
    }, 300);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [q]);
  const choisir = (r) => { onChoix(r); setQ(r.nom); setOuvert(false); };
  const clavier = (e) => {
    if (!ouvert || !res.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % res.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + res.length) % res.length); }
    else if (e.key === "Enter") { e.preventDefault(); choisir(res[sel]); }
    else if (e.key === "Escape") setOuvert(false);
  };
  return (
    <div className="relative w-full sm:w-64">
      <div className="flex items-center gap-1.5 rounded-[9px] bg-black/55 backdrop-blur px-2.5 py-1">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-white/70" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" />
        </svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={clavier} onFocus={() => res.length && setOuvert(true)}
          onBlur={() => setTimeout(() => setOuvert(false), 150)} placeholder="Aller à une ville…" type="search"
          className="w-full min-w-0 bg-transparent text-[13px] font-semibold text-white placeholder:text-white/60 outline-none" />
      </div>
      {cherche && (
        <p className="absolute z-10 mt-1 w-full rounded-[10px] bg-black/80 backdrop-blur px-2.5 py-1.5 text-[12px] text-white/70">Recherche…</p>
      )}
      {!cherche && ouvert && q.trim().length >= 2 && !res.length && (
        <p className="absolute z-10 mt-1 w-full rounded-[10px] bg-black/80 backdrop-blur px-2.5 py-1.5 text-[12px] text-white/70">Aucun lieu trouvé</p>
      )}
      {!cherche && ouvert && res.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-[10px] bg-black/80 backdrop-blur py-1 shadow-lg">
          {res.map((r, i) => (
            <li key={r.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choisir(r)}
                className={`w-full text-left px-2.5 py-1.5 ${i === sel ? "bg-white/15" : ""}`}>
                <span className="block text-[13px] font-semibold text-white truncate">{r.nom}</span>
                {r.lieu && <span className="block text-[11px] text-white/60 truncate">{r.lieu}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Tous les tracés sur une carte, colorés selon le nombre de passages au même endroit.
export default function CartePassages({ annee: fixe } = {}) {
  const cadre = useRef(null);
  const conteneur = useRef(null);
  const carte = useRef(null);
  const [visible, setVisible] = useState(false);
  const [prete, setPrete] = useState(false);
  const [fond, setFond] = useState("satellite");
  const [vue, setVue] = useState("2d");
  const [sports, setSports] = useState(PAR_DEFAUT);
  const [choisie, setAnnee] = useState(null);   // null = toutes les années
  const annee = fixe ?? choisie;   // année imposée par le Bilan
  // Adresse du Profil : centre de la carte (sauf dans le Bilan, cadré sur les tracés de l'année)
  const { user } = useAuth();
  const lat = user?.adresse_lat, lon = user?.adresse_lon;
  const domicile = useMemo(() => (lat != null && lon != null ? [lon, lat] : null), [lat, lon]);
  const centrerDomicile = fixe == null ? domicile : null;
  // Tous les tracés sont chargés une fois ; changer de filtre ne fait que recalculer ici.
  const { data: brut, isLoading, isError } = useQuery({
    queryKey: ["carte-traces"], queryFn: getCarteTraces, enabled: visible, staleTime: 10 * 60 * 1000,
  });
  const traces = useMemo(() => (brut ? decoderTraces(brut.traces) : null), [brut]);
  const cadres = useMemo(() => (traces ? cadresTraces(traces) : null), [traces]);
  const idx = useMemo(() => (brut
    ? brut.meta.flatMap(([sport, , an], i) => (sports.includes(sport) && (annee == null || an === annee) ? [i] : []))
    : null), [brut, sports, annee]);
  const data = useMemo(() => {
    if (!traces || !idx) return null;
    return { ...calculerPassages(idx.map((i) => traces[i])), nb_traces: idx.length,
      km: Math.round(idx.reduce((t, i) => t + brut.meta[i][1], 0)) };
  }, [traces, brut, idx]);

  // Tronçon cliqué : seuls les tracés qui y passent restent en couleur, les séances sont listées
  const [troncon, setTroncon] = useState(null);
  const [lieu, setLieu] = useState(null);
  const [sportListe, setSportListe] = useState(null);
  const [fiche, setFiche] = useState(null);
  const passants = useMemo(() => (troncon && idx ? tracesPassantPar(traces, cadres, idx, troncon) : null),
    [troncon, idx, traces, cadres]);
  const seances = useMemo(() => (passants
    ? passants.map((i) => {
      const [sport, km, , id, jour, titre, duree] = brut.meta[i];
      return { i, sport, km, id, jour, titre, duree };
    }).sort((a, b) => (a.jour < b.jour ? 1 : a.jour > b.jour ? -1 : b.id - a.id))
    : null), [passants, brut]);
  const visibles = useMemo(() => (seances && sportListe ? seances.filter((s) => s.sport === sportListe) : seances), [seances, sportListe]);
  const selection = useMemo(() => (visibles ? calculerPassages(visibles.map((s) => traces[s.i])) : null), [visibles, traces]);
  const fermer = () => { setTroncon(null); setSportListe(null); setLieu(null); };
  // Un clic choisit le tronçon le plus proche (lu par la référence : le gestionnaire de la carte reste à jour)
  const surClic = useRef(null);
  surClic.current = (e) => {
    const m = carte.current;
    if (!m || !traces || !idx?.length) return;
    // Tolérance de 12 px à l'écran, convertie en mètres au zoom courant
    const mpp = (40_075_016 * Math.cos(e.lngLat.lat * Math.PI / 180)) / (512 * 2 ** m.getZoom());
    const t = tronconClique(traces, cadres, idx, [e.lngLat.lng, e.lngLat.lat], Math.max(12 * mpp, 8));
    if (!t) return;
    setTroncon(t); setSportListe(null); setLieu(null);
  };
  // Nom de la rue ou du lieu (Photon, au mieux)
  useEffect(() => {
    if (!troncon) return;
    const ctrl = new AbortController();
    fetch(`https://photon.komoot.io/reverse?lat=${troncon.q[1].toFixed(5)}&lon=${troncon.q[0].toFixed(5)}&lang=fr&limit=1`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => {
        const p = j.features?.[0]?.properties;
        if (p) setLieu([p.street ?? p.name, p.city ?? p.district].filter(Boolean).filter((v, k, a) => a.indexOf(v) === k).join(", ") || null);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [troncon]);
  // Classe posée à la main : React ne doit pas écraser celle du plein écran de MapLibre
  useEffect(() => { cadre.current?.classList.toggle("carte-liste", !!troncon); }, [troncon]);
  // Fiche de la séance : on sort du plein écran pour qu'elle s'affiche par-dessus la page
  const ouvrir = async (id) => {
    const bouton = cadre.current?.querySelector(".maplibregl-ctrl-shrink");
    if (bouton) bouton.click();
    try { setFiche(await getActivite(id)); } catch { /* séance supprimée entre-temps */ }
  };
  const annees = useMemo(() => (brut ? [...new Set(brut.meta.map((m) => m[2]).filter(Boolean))].sort((a, b) => b - a) : []), [brut]);

  // Ne charge les tracés (≈ 400 Ko) que lorsqu'elle arrive à l'écran
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "200px" });
    if (cadre.current) obs.observe(cadre.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !conteneur.current) return;
    let annule = false;
    (async () => {
      const maplibregl = await chargerMaplibre();
      if (annule) return;
      const m = new maplibregl.Map({
        container: conteneur.current, style: STYLE,
        ...(centrerDomicile ? { center: centrerDomicile, zoom: ZOOM_DOMICILE } : { center: [2.5, 46.5], zoom: 4.5 }),
        // Molette seule pour zoomer à la souris ; au doigt, deux doigts pour que la page défile encore
        maxPitch: 75, attributionControl: { compact: true }, cooperativeGestures: TACTILE,
        locale: { "CooperativeGesturesHandler.MobileHelpText": "Pince ou tape deux fois pour zoomer, deux doigts pour déplacer" },
      });
      carte.current = m;
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      m.addControl(controleRotation(), "top-right");
      tournerALaSouris(m, conteneur.current);
      // iPhone : pas de plein écran pour un élément → « pseudo » plein écran (CSS)
      const pseudo = !cadre.current.requestFullscreen && !cadre.current.webkitRequestFullscreen;
      const ecran = new maplibregl.FullscreenControl({ container: cadre.current, pseudo });
      m.addControl(ecran, "top-right");
      // En sortant du plein écran, le navigateur peut ramener la page ailleurs :
      // on revient à la position d'avant, la carte réduite sous les yeux
      // Position lue au clic, avant que le navigateur ne passe en plein écran (après, elle est déjà faussée)
      let defilement = null;
      cadre.current.addEventListener("pointerdown", (e) => {
        if (e.target.closest?.(".maplibregl-ctrl-fullscreen")) defilement = window.scrollY;
      }, true);
      ecran.on("fullscreenend", () => {
        const y = defilement;
        defilement = null;
        const revenir = () => {
          const el = cadre.current;
          if (!el || el.classList.contains("maplibregl-pseudo-fullscreen") || document.fullscreenElement) return;
          if (y != null) window.scrollTo({ top: y, behavior: "instant" });
          // Toujours la carte sous les yeux, même si la page a bougé entre-temps
          const r = el.getBoundingClientRect();
          if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "center", behavior: "instant" });
        };
        // Chrome rétablit son propre défilement un peu après la sortie : on repasse derrière lui
        let fini = false;
        const stop = () => { fini = true; };
        window.addEventListener("wheel", stop, { once: true, passive: true });
        window.addEventListener("touchstart", stop, { once: true, passive: true });
        for (const t of [0, 100, 250, 500, 800, 1200]) setTimeout(() => { if (!fini) revenir(); }, t);
        setTimeout(() => { window.removeEventListener("wheel", stop); window.removeEventListener("touchstart", stop); }, 1300);
      });
      if (TACTILE) {
        // Plein écran : plus de page à faire défiler, un doigt déplace la carte
        ecran.on("fullscreenstart", () => m.cooperativeGestures.disable());
        ecran.on("fullscreenend", () => m.cooperativeGestures.enable());
        // Dès que deux doigts sont posés, le geste revient à la carte : sans ça, Safari
        // fait défiler la page (ou la zoome) si le second doigt arrive un peu après le premier.
        const deuxDoigts = (e) => { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); };
        conteneur.current.addEventListener("touchstart", deuxDoigts, { passive: false, capture: true });
        conteneur.current.addEventListener("touchmove", deuxDoigts, { passive: false, capture: true });
      }
      m.on("load", () => {
        m.addSource("passages", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "passages-bord", type: "line", source: "passages",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#000", "line-opacity": 0.35, "line-width": LARGEUR_BORD } });
        m.addLayer({ id: "passages", type: "line", source: "passages",
          layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "n"] },
          paint: { "line-color": COULEUR, "line-width": LARGEUR } });
        // Tracés passés par le tronçon cliqué, par-dessus les autres (estompés)
        m.addSource("selection", { type: "geojson", data: VIDE });
        m.addLayer({ id: "selection-bord", type: "line", source: "selection",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#000", "line-opacity": 0.45, "line-width": LARGEUR_BORD } });
        m.addLayer({ id: "selection", type: "line", source: "selection",
          layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "n"] },
          paint: { "line-color": COULEUR, "line-width": LARGEUR } });
        m.addSource("troncon", { type: "geojson", data: VIDE });
        m.addLayer({ id: "troncon", type: "line", source: "troncon",
          layout: { "line-cap": "round" },
          paint: { "line-color": "#fff", "line-opacity": 0.95,
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 5, 13, 7, 16, 10] } });
        m.on("click", (e) => surClic.current?.(e));
        // Main au survol d'un tracé (à la souris)
        m.on("mousemove", (e) => {
          const b = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]];
          m.getCanvas().style.cursor = m.queryRenderedFeatures(b, { layers: ["passages", "selection"] }).length ? "pointer" : "";
        });
        setPrete(true);
      });
    })();
    return () => { annule = true; carte.current?.remove(); carte.current = null; setPrete(false); };
  }, [visible]);

  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    m.setLayoutProperty("plan", "visibility", fond === "plan" ? "visible" : "none");
    m.setLayoutProperty("satellite", "visibility", fond === "satellite" ? "visible" : "none");
  }, [fond, prete]);

  // 3D : relief et carte inclinée ; retour à plat, nord en haut, en 2D
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    if (vue === "3d") {
      m.setTerrain({ source: "relief", exaggeration: 1.5 });
      m.easeTo({ pitch: 60, duration: 800 });
    } else {
      m.setTerrain(null);
      m.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
  }, [vue, prete]);

  // Données : on ne recadre qu'au premier affichage (ou quand l'année imposée change), pas à chaque filtre
  const cadree = useRef(null);
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m || !data) return;
    m.getSource("passages").setData({ type: "FeatureCollection", features: data.features });
    if (!centrerDomicile && cadree.current !== (fixe ?? "tout") && data.vue) {
      m.fitBounds(data.vue, { padding: 20, duration: cadree.current == null ? 0 : 600 });
      cadree.current = fixe ?? "tout";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prete, fixe]);

  // Sélection : les autres tracés s'estompent, ceux du tronçon passent devant
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    const actif = !!troncon;
    m.setPaintProperty("passages", "line-opacity", actif ? OPACITE_ESTOMPEE : 1);
    m.setPaintProperty("passages-bord", "line-opacity", actif ? 0.02 : 0.35);
    m.getSource("selection").setData(actif && selection ? { type: "FeatureCollection", features: selection.features } : VIDE);
    m.getSource("troncon").setData(actif
      ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: traitTroncon(troncon) } }
      : VIDE);
  }, [troncon, selection, prete]);

  // La vue se recadre pour montrer en entier les tracés passés par le tronçon (hors panneau)
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m || !visibles?.length) return;
    let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const v of visibles) {
      const [co, cs, ce, cn] = cadres[v.i];
      o = Math.min(o, co); s = Math.min(s, cs); e = Math.max(e, ce); n = Math.max(n, cn);
    }
    const el = m.getContainer();
    const large = window.matchMedia("(min-width: 640px)").matches;
    const padding = large
      ? { top: 40, bottom: 40, left: 40, right: 18 * 16 + 40 }
      : { top: 50, left: 24, right: 24, bottom: Math.round(el.clientHeight * 0.58) + 24 };
    // Carte trop petite pour ces marges : on garde le cadrage brut plutôt que d'échouer
    if (padding.top + padding.bottom >= el.clientHeight - 40 || padding.left + padding.right >= el.clientWidth - 40) {
      padding.top = padding.bottom = padding.left = padding.right = 16;
    }
    m.fitBounds([[o, s], [e, n]], { padding, duration: 700, maxZoom: 16 });
  }, [visibles, cadres, prete]);

  // Adresse enregistrée ou modifiée dans le Profil : la carte s'y recentre
  const centree = useRef(null);
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m || !centrerDomicile) return;
    const cle = centrerDomicile.join(",");
    if (centree.current === cle) return;
    if (centree.current == null) m.jumpTo({ center: centrerDomicile, zoom: ZOOM_DOMICILE });
    else m.flyTo({ center: centrerDomicile, zoom: ZOOM_DOMICILE, duration: 800 });
    centree.current = cle;
  }, [prete, centrerDomicile]);

  const basculer = (k) =>
    setSports((s) => (s.includes(k) ? (s.length > 1 ? s.filter((x) => x !== k) : s) : [...s, k]));

  if (isError) return null;
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {SPORTS.map(([k, label]) => (
          <button type="button" key={k} onClick={() => basculer(k)}
            className={`px-3.5 py-1.5 rounded-full text-[14px] font-semibold transition ${
              sports.includes(k) ? "bg-white text-black" : "bg-remplissage text-label-2"}`}>
            {label}
          </button>
        ))}
        {fixe == null && annees.length > 1 && (
          <select aria-label="Année" value={annee ?? ""} onChange={(e) => setAnnee(e.target.value ? Number(e.target.value) : null)}
            className="ml-auto px-3 py-1.5 rounded-full text-[14px] font-semibold bg-remplissage text-label border-0">
            <option value="">Toutes les années</option>
            {annees.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
      </div>
      <div ref={cadre} className="relative h-80 lg:h-[26rem] rounded-[14px] overflow-hidden bg-remplissage">
        <div ref={conteneur} className="w-full h-full" />
        {seances && (
          <PanneauPassage seances={seances} lieu={lieu} sportListe={sportListe} setSportListe={setSportListe}
            onFermer={fermer} onOuvrir={ouvrir} />
        )}
        {seances && (
          <button type="button" onClick={fermer}
            className="absolute z-10 left-2 bottom-[calc(58%+0.5rem)] sm:bottom-8 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-black shadow">
            ✕ Tout afficher
          </button>
        )}
        {(isLoading || !visible) && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <span className="rounded-[8px] bg-black/60 backdrop-blur px-2.5 py-1 text-[13px] font-semibold text-white">Chargement des tracés…</span>
          </div>
        )}
        <div className="champs-carte absolute top-2 left-2 right-12 flex flex-wrap items-start gap-1.5">
          <Bascule options={[["plan", "Plan"], ["satellite", "Satellite"]]} valeur={fond} onChange={setFond} />
          <Bascule options={[["2d", "2D"], ["3d", "3D"]]} valeur={vue} onChange={setVue} />
          {domicile && (
          <button type="button" title="Revenir sur l'adresse du Profil"
            onClick={() => carte.current?.flyTo({ center: domicile, zoom: ZOOM_DOMICILE, duration: 800 })}
            className="flex items-center gap-1 rounded-[9px] bg-black/55 backdrop-blur px-2.5 py-1 text-[12px] font-semibold text-white">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" fill="currentColor" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            Domicile
          </button>
          )}
          <RechercheLieu centre={() => carte.current?.getCenter()} onChoix={(r) => {
            const m = carte.current;
            if (!m) return;
            if (r.cadre) m.fitBounds(r.cadre, { padding: 10, duration: 800, maxZoom: 15 });
            else m.flyTo({ center: r.centre, zoom: 14, duration: 800 });
          }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] text-label-2 chiffres">
        <span>Passages :</span>
        {PALIERS.map(([n, label, c]) => (
          <span key={n} className="flex items-center gap-1">
            <span className="w-3.5 h-[4px] rounded-full" style={{ background: c }} />{label}
          </span>
        ))}
      </div>
      {fiche && <FicheActivite key={fiche.id} activite={fiche} onClose={() => setFiche(null)} />}
      {data && (
        <p className="px-1 text-[12px] text-label-2 chiffres">
          {data.nb_traces} sortie{data.nb_traces > 1 ? "s" : ""} · {data.km.toLocaleString("fr-FR")} km · jusqu'à {data.max} passages au même endroit
          {!seances && " · touche un tracé pour voir les séances passées par là"}
        </p>
      )}
    </div>
  );
}
