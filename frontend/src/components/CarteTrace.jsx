import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTerrains, getTrace } from "../api";
import Profil from "./ProfilAltitude";

const TYPES_TERRAIN = { sentier: "sentier", chemin: "chemin", bitume: "route" };

// maplibre 6 (ESM) : le worker est un fichier à part, à servir depuis nos propres assets
export async function chargerMaplibre() {
  const [maplibregl, { default: worker }] = await Promise.all([
    import("maplibre-gl"),
    import("maplibre-gl/dist/maplibre-gl-worker.mjs?url"),
    import("maplibre-gl/dist/maplibre-gl.css"),
  ]);
  maplibregl.setWorkerUrl(worker);
  return maplibregl;
}

// Fonds gratuits, sans clé : plan OSM, imagerie Esri, relief AWS (Terrarium) pour la 3D.
export const STYLE = {
  version: 8,
  sources: {
    plan: {
      type: "raster", tileSize: 256, maxzoom: 19,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      attribution: "© OpenStreetMap",
    },
    satellite: {
      type: "raster", tileSize: 256, maxzoom: 19,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
    relief: {
      type: "raster-dem", tileSize: 256, maxzoom: 15, encoding: "terrarium",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    },
  },
  layers: [
    { id: "plan", type: "raster", source: "plan" },
    { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
  ],
};

// Boutons pour tourner la carte : plus simple que le geste à deux doigts ou le clic droit,
// plus un bouton « Recentrer » (s'il est fourni) qui garde l'angle et l'inclinaison
const FLECHE = (sens) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin:auto${sens > 0 ? ";transform:scaleX(-1)" : ""}"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 3v4.5h4.5"/></svg>`;
const CADRE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin:auto"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="2.5"/></svg>`;
export function controleRotation(auDebut, recentrer) {
  let boite, cible = null;
  return {
    onAdd(m) {
      boite = document.createElement("div");
      boite.className = "maplibregl-ctrl maplibregl-ctrl-group";
      for (const [sens, titre] of [[-1, "Tourner la carte à gauche"], [1, "Tourner la carte à droite"]]) {
        const b = document.createElement("button");
        b.type = "button"; b.title = titre; b.setAttribute("aria-label", titre);
        b.style.color = "#333";
        b.innerHTML = FLECHE(sens);
        b.addEventListener("click", () => {
          auDebut?.();
          // Clics rapprochés : on repart de l'angle visé, pas de l'angle en cours d'animation
          cible = (m.isMoving() && cible != null ? cible : m.getBearing()) + sens * 45;
          m.easeTo({ bearing: cible, duration: 450 });
        });
        boite.appendChild(b);
      }
      if (recentrer) {
        const b = document.createElement("button");
        const titre = "Recentrer sur le tracé";
        b.type = "button"; b.title = titre; b.setAttribute("aria-label", titre);
        b.style.color = "#333";
        b.innerHTML = CADRE;
        b.addEventListener("click", () => { auDebut?.(); recentrer(); });
        boite.appendChild(b);
      }
      return boite;
    },
    onRemove() { boite?.remove(); },
  };
}
// Molette et pavé tactile : deux doigts à l'horizontale ou Shift + molette pour tourner,
// Alt + molette pour incliner ; rotation à deux doigts sur le pavé d'un Mac (Safari).
// Écouté en capture sur le conteneur pour passer avant le zoom de MapLibre.
export function tournerALaSouris(m, el, auDebut) {
  el.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return; // pincement du pavé tactile : zoom
    const k = e.deltaMode === 1 ? 16 : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    const horizontal = Math.abs(dx) > 1.5 * Math.abs(dy);
    if (!e.shiftKey && !e.altKey && !horizontal) return;
    e.preventDefault();
    e.stopPropagation();
    auDebut?.();
    const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (e.altKey) m.setPitch(Math.max(0, Math.min(m.getMaxPitch(), m.getPitch() - d * 0.15)));
    else m.setBearing(m.getBearing() + d * 0.2);
  }, { capture: true, passive: false });
  let cap0 = 0;
  el.addEventListener("gesturestart", (e) => { e.preventDefault(); auDebut?.(); cap0 = m.getBearing(); });
  el.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    if (Math.abs(e.rotation) > 3) m.setBearing(cap0 - e.rotation);
  });
}
export function Bascule({ options, valeur, onChange }) {
  return (
    <div className="flex rounded-[9px] bg-black/55 backdrop-blur p-0.5 text-[12px] font-semibold">
      {options.map(([k, label]) => (
        <button type="button" key={k} onClick={() => onChange(k)}
          className={`px-2.5 py-1 rounded-[7px] transition ${valeur === k ? "bg-white text-black" : "text-white"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Survol : position et cap le long du tracé ──────────────────────────────
const RAD = Math.PI / 180;
function distM(a, b) {
  const x = (b[0] - a[0]) * RAD * Math.cos(((a[1] + b[1]) / 2) * RAD), y = (b[1] - a[1]) * RAD;
  return 6371000 * Math.hypot(x, y);
}
function preparer(points) {
  const coords = points.map((p) => [p[1], p[0]]);
  const cumul = [0];
  for (let i = 1; i < coords.length; i++) cumul.push(cumul[i - 1] + distM(coords[i - 1], coords[i]));
  return { coords, cumul, temps: points.map((p) => p[3] ?? 0), total: cumul.at(-1) };
}
// Point situé à `d` mètres du départ (interpolé entre deux points du tracé).
function pointA(g, d) {
  let lo = 0, hi = g.cumul.length - 1;
  while (hi - lo > 1) { const mi = (lo + hi) >> 1; if (g.cumul[mi] <= d) lo = mi; else hi = mi; }
  const f = Math.min(1, Math.max(0, (d - g.cumul[lo]) / (g.cumul[hi] - g.cumul[lo] || 1)));
  const a = g.coords[lo], b = g.coords[hi];
  return { i: lo, pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t: g.temps[lo] + (g.temps[hi] - g.temps[lo]) * f };
}
function cap(a, b) {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return Math.atan2(y, x) / RAD;
}
// La caméra MapLibre est d'autant plus proche du sol que la carte est petite : on dézoome
// en proportion pour garder la même hauteur de vue qu'en plein écran (sinon elle traverse le relief).
function cameraSurvol(m, km) {
  const h = m.getContainer().clientHeight || 700;
  const zoom = (km < 25 ? 15.3 : 14.4) + Math.log2(Math.min(1, h / 700));
  return { zoom, pitch: h < 450 ? 55 : 62 };
}
// Distance caméra → point visé (m) à ce zoom : MapLibre place la caméra à 0,5 / tan(fov / 2) hauteurs d'écran.
function distanceCamera(m, zoom, lat) {
  const h = m.getContainer().clientHeight || 700;
  const fov = (m.getVerticalFieldOfView?.() ?? 36.87) * RAD;
  return (h / 2 / Math.tan(fov / 2)) * (40075016.686 * Math.cos(lat * RAD)) / (512 * 2 ** zoom);
}
// Inclinaison la plus forte (≤ `base`) pour laquelle la ligne caméra → curseur reste au-dessus du relief :
// dans les grosses pentes, la caméra se redresse (elle monte) au lieu de traverser la montagne.
const MARGE_RELIEF = 60;
function pitchDegage(m, pos, alt, bearing, zoom, base) {
  const L = distanceCamera(m, zoom, pos[1]);
  const b = bearing * RAD, kLat = 1 / 111320, kLon = 1 / (111320 * Math.cos(pos[1] * RAD));
  for (let p = base; p > 20; p -= 4) {
    const D = L * Math.sin(p * RAD), H = L * Math.cos(p * RAD);
    const libre = [0.2, 0.4, 0.6, 0.8, 1].every((f) => {
      const x = f * D; // en arrière du curseur, côté caméra
      const z = m.queryTerrainElevation([pos[0] - Math.sin(b) * x * kLon, pos[1] - Math.cos(b) * x * kLat]);
      return z == null || alt + f * H >= z + MARGE_RELIEF;
    });
    if (libre) return p;
  }
  return 20;
}
const chrono = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
};

// Carte du tracé GPS d'une activité : plan ou satellite, 2D ou 3D (relief).
export default function CarteTrace({ activiteId }) {
  const conteneur = useRef(null);
  const cadre = useRef(null);
  const carte = useRef(null);
  const geo = useRef(null);
  const survol = useRef({ d: 0, cap: null, alt: null, pitch: null, raf: 0, dernier: 0, actif: false, maj: 0 });
  const [lecture, setLecture] = useState(false);
  const [vitesse, setVitesse] = useState(1); // ×1 ou ×2
  const vitesseRef = useRef(1);
  const [plein, setPlein] = useState(false);
  const [progres, setProgres] = useState(null); // { f, km, t } pendant un survol
  const [prete, setPrete] = useState(false);
  const [fond, setFond] = useState("satellite");
  const [vue, setVue] = useState("2d");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["trace", activiteId], queryFn: () => getTrace(activiteId), staleTime: Infinity,
  });
  // Profil d'altitude sous la carte (seulement si le tracé a des altitudes)
  const avecAltitude = !!data?.points?.some((p) => p[2] != null);
  const { data: terrain } = useQuery({
    queryKey: ["terrains", activiteId], queryFn: () => getTerrains(activiteId), staleTime: Infinity,
    enabled: avecAltitude, retry: false,
  });
  const [repere, setRepere] = useState(null); // indice du point montré par le doigt sur le profil

  useEffect(() => {
    if (!data?.points?.length || !conteneur.current) return;
    let annule = false;
    (async () => {
      const maplibregl = await chargerMaplibre();
      if (annule) return;
      geo.current = preparer(data.points);
      const { coords } = geo.current;
      const bornes = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
      const m = new maplibregl.Map({
        container: conteneur.current, style: STYLE, bounds: bornes,
        fitBoundsOptions: { padding: 30 }, maxPitch: 75, attributionControl: { compact: true },
      });
      carte.current = m;
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      // Tourner à la main met le survol en pause, comme un glissé
      const arreter = () => survol.current.actif && pause();
      m.addControl(controleRotation(arreter, () =>
        m.fitBounds(bornes, { padding: 30, bearing: m.getBearing(), pitch: m.getPitch(), duration: 700 })), "top-right");
      tournerALaSouris(m, conteneur.current, arreter);
      // iPhone : pas de plein écran pour un élément → « pseudo » plein écran (CSS), à l'entrée comme à la sortie
      const pseudo = !cadre.current.requestFullscreen && !cadre.current.webkitRequestFullscreen;
      const ecran = new maplibregl.FullscreenControl({ container: cadre.current, pseudo });
      ecran.on("fullscreenstart", () => setPlein(true));
      ecran.on("fullscreenend", () => setPlein(false));
      m.addControl(ecran, "top-right");
      m.on("load", () => {
        m.addSource("trace", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: coords } } });
        m.addLayer({ id: "trace-bord", type: "line", source: "trace",
          layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 6 } });
        m.addLayer({ id: "trace", type: "line", source: "trace",
          layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#FF3B30", "line-width": 3.5 } });
        m.addSource("bouts", { type: "geojson", data: { type: "FeatureCollection", features: [
          { type: "Feature", properties: { c: "#34C759" }, geometry: { type: "Point", coordinates: coords[0] } },
          { type: "Feature", properties: { c: "#1C1C1E" }, geometry: { type: "Point", coordinates: coords.at(-1) } },
        ] } });
        m.addLayer({ id: "bouts", type: "circle", source: "bouts",
          paint: { "circle-radius": 6, "circle-color": ["get", "c"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
        const vide = { type: "FeatureCollection", features: [] };
        m.addSource("parcouru", { type: "geojson", data: vide });
        m.addLayer({ id: "parcouru", type: "line", source: "parcouru",
          layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#FF3B30", "line-width": 4.5 } });
        m.addSource("curseur", { type: "geojson", data: vide });
        m.addLayer({ id: "curseur", type: "circle", source: "curseur",
          paint: { "circle-radius": 7, "circle-color": "#FF3B30", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
        m.addSource("repere", { type: "geojson", data: vide });
        m.addLayer({ id: "repere", type: "circle", source: "repere",
          paint: { "circle-radius": 6, "circle-color": "#FF3B30", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
        m.on("dragstart", () => survol.current.actif && pause());
        setPrete(true);
      });
    })();
    return () => { annule = true; cancelAnimationFrame(survol.current.raf); survol.current.actif = false; carte.current?.remove(); carte.current = null; setPrete(false); };
  }, [data]);

  // Point du profil sous le doigt, repéré sur la carte
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    const p = repere != null ? data.points[repere] : null;
    m.getSource("repere").setData({ type: "FeatureCollection", features: p
      ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p[1], p[0]] } }] : [] });
  }, [repere, prete]);

  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    m.setLayoutProperty("plan", "visibility", fond === "plan" ? "visible" : "none");
    m.setLayoutProperty("satellite", "visibility", fond === "satellite" ? "visible" : "none");
  }, [fond, prete]);

  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    if (vue === "3d") {
      m.setTerrain({ source: "relief", exaggeration: 1.5 });
      if (!survol.current.actif) m.easeTo({ pitch: 60, duration: 800 });
    } else {
      m.setTerrain(null);
      if (!survol.current.actif) m.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
  }, [vue, prete]);

  // Place le curseur à `d` mètres et colore la partie déjà parcourue.
  function afficher(d) {
    const m = carte.current, g = geo.current;
    const p = pointA(g, d);
    m.getSource("parcouru").setData({ type: "Feature", geometry: { type: "LineString", coordinates: [...g.coords.slice(0, p.i + 1), p.pos] } });
    m.getSource("curseur").setData({ type: "Feature", geometry: { type: "Point", coordinates: p.pos } });
    return p;
  }

  // Altitude du relief sous le point (la caméra doit la viser, sinon le curseur est décentré).
  function altitude(pos) {
    return carte.current?.queryTerrainElevation(pos) ?? 0;
  }

  function attenuer(oui) {
    const m = carte.current;
    m.setPaintProperty("trace", "line-opacity", oui ? 0.35 : 1);
    m.setPaintProperty("trace-bord", "line-opacity", oui ? 0.35 : 1);
  }

  function pause() {
    const s = survol.current;
    cancelAnimationFrame(s.raf);
    s.actif = false;
    setLecture(false);
  }

  // Fin du survol : retour à la vue d'ensemble.
  function terminer() {
    pause();
    survol.current.d = 0;
    setTimeout(() => {
      const m = carte.current, g = geo.current;
      if (survol.current.actif || !m) return;
      m.getSource("parcouru").setData({ type: "FeatureCollection", features: [] });
      m.getSource("curseur").setData({ type: "FeatureCollection", features: [] });
      attenuer(false);
      setProgres(null);
      const lon = g.coords.map((c) => c[0]), lat = g.coords.map((c) => c[1]);
      m.fitBounds([[Math.min(...lon), Math.min(...lat)], [Math.max(...lon), Math.max(...lat)]],
        { padding: 30, bearing: 0, pitch: m.getTerrain() ? 60 : 0, duration: 1500 });
    }, 1200);
  }

  function jouer() {
    const m = carte.current, g = geo.current, s = survol.current;
    if (!m || !g || g.total < 50) return;
    const km = g.total / 1000;
    const duree = Math.min(75000, Math.max(20000, km * 3500)); // durée du survol (ms)
    const avance = Math.max(120, g.total * 0.015);              // la caméra vise ce point devant
    s.actif = true;
    setLecture(true);
    setVue("3d");
    attenuer(true);
    const depart = afficher(s.d);
    if (s.cap == null || s.d === 0) s.cap = cap(depart.pos, pointA(g, s.d + avance).pos);
    s.alt = null;
    s.pitch = null;
    const boucle = (ts) => {
      if (!s.actif) return;
      const dt = Math.min(100, ts - (s.dernier || ts));
      s.dernier = ts;
      s.d = Math.min(g.total, s.d + (g.total * dt * vitesseRef.current) / duree);
      const p = afficher(s.d);
      const c = cap(p.pos, pointA(g, s.d + avance).pos);
      s.cap += (((((c - s.cap) % 360) + 540) % 360) - 180) * Math.min(1, dt / 700); // virages lissés
      const z = altitude(p.pos);
      s.alt = s.alt == null ? z : s.alt + (z - s.alt) * Math.min(1, dt / 250); // lissé
      // Inclinaison dégagée du relief, ici et un peu plus loin (anticipation), lissée :
      // la caméra se redresse vite devant une pente et revient doucement ensuite.
      const cadrage = cameraSurvol(m, km);
      const loin = pointA(g, s.d + avance).pos;
      const cible = Math.min(pitchDegage(m, p.pos, s.alt, s.cap, cadrage.zoom, cadrage.pitch),
        pitchDegage(m, loin, altitude(loin), s.cap, cadrage.zoom, cadrage.pitch));
      s.pitch = s.pitch == null ? cible : s.pitch + (cible - s.pitch) * Math.min(1, dt / (cible < s.pitch ? 300 : 1500));
      m.jumpTo({ center: p.pos, elevation: s.alt, bearing: s.cap, zoom: cadrage.zoom, pitch: s.pitch });
      if (ts - s.maj > 120 || s.d >= g.total) { s.maj = ts; setProgres({ f: s.d / g.total, km: s.d / 1000, t: p.t }); }
      if (s.d >= g.total) { terminer(); return; }
      s.raf = requestAnimationFrame(boucle);
    };
    // Approche de la caméra, puis départ
    const vue0 = cameraSurvol(m, km);
    s.pitch = pitchDegage(m, depart.pos, altitude(depart.pos), s.cap, vue0.zoom, vue0.pitch);
    m.flyTo({ center: depart.pos, elevation: altitude(depart.pos), zoom: vue0.zoom, pitch: s.pitch, bearing: s.cap, duration: s.d === 0 ? 2000 : 600, essential: true });
    m.once("moveend", () => { if (s.actif) { s.dernier = 0; s.raf = requestAnimationFrame(boucle); } });
  }

  // Clic sur la barre de progression : se place à cet endroit du tracé.
  function chercher(e) {
    const g = geo.current, s = survol.current;
    if (!g || !prete) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    s.d = f * g.total;
    attenuer(true);
    const p = afficher(s.d);
    setProgres({ f, km: s.d / 1000, t: p.t });
    if (!s.actif) carte.current.easeTo({ center: p.pos, elevation: altitude(p.pos), duration: 400 });
  }

  if (isError) return null;
  return (
    <div className="space-y-1.5">
      {/* className fixe : MapLibre y ajoute lui-même « maplibregl-pseudo-fullscreen » (plein écran sur iPhone) */}
      <div ref={cadre} className="relative h-72 rounded-[14px] overflow-hidden bg-remplissage">
        <div ref={conteneur} className="w-full h-full" />
        {isLoading && <p className="absolute inset-0 grid place-items-center text-[13px] text-label-2">Chargement du tracé…</p>}
        <div style={plein ? { top: "calc(env(safe-area-inset-top) + 8px)" } : undefined}
          className={`absolute top-2 left-2 flex flex-col gap-1.5 items-start transition-opacity ${lecture ? "opacity-0 pointer-events-none" : ""}`}>
          <Bascule options={[["plan", "Plan"], ["satellite", "Satellite"]]} valeur={fond} onChange={setFond} />
          <Bascule options={[["2d", "2D"], ["3d", "3D"]]} valeur={vue} onChange={setVue} />
        </div>
        {prete && (
          <div style={plein ? { bottom: "calc(env(safe-area-inset-bottom) + 12px)" } : undefined}
            className="absolute bottom-3 left-2 flex items-center gap-2">
            <button type="button" onClick={() => (lecture ? pause() : jouer())}
              aria-label={lecture ? "Pause" : "Survoler le tracé"}
              className="w-9 h-9 grid place-items-center rounded-full bg-black/55 backdrop-blur text-white active:scale-95 transition">
              {lecture ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12" rx="1" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5v11a.8.8 0 0 0 1.2.7l9-5.5a.8.8 0 0 0 0-1.4l-9-5.5A.8.8 0 0 0 3 1.5z" /></svg>
              )}
            </button>
            {(lecture || progres) && (
              <button type="button" onClick={() => { const v = vitesse === 1 ? 2 : 1; vitesseRef.current = v; setVitesse(v); }}
                aria-label={`Vitesse ×${vitesse === 1 ? 2 : 1}`}
                className={`h-9 px-3 rounded-full backdrop-blur text-[13px] font-semibold chiffres active:scale-95 transition ${vitesse === 2 ? "bg-white text-black" : "bg-black/55 text-white"}`}>
                ×2
              </button>
            )}
            {progres && (
              <span className="rounded-[8px] bg-black/55 backdrop-blur px-2 py-1 text-[12px] font-semibold text-white chiffres">
                {progres.km.toFixed(1).replace(".", ",")} km · {chrono(progres.t)}
              </span>
            )}
          </div>
        )}
        {prete && (
          <div onClick={chercher} style={plein ? { bottom: "env(safe-area-inset-bottom)" } : undefined}
            className="absolute bottom-0 inset-x-0 h-2.5 flex items-end cursor-pointer">
            <div className="h-[3px] w-full bg-black/30">
              <div className="h-full bg-[#FF3B30]" style={{ width: `${(progres?.f ?? 0) * 100}%` }} />
            </div>
          </div>
        )}
      </div>
      {data && (
        <p className="text-[12px] text-label-2 text-center chiffres">
          Tracé GPS · {data.distance_km?.toFixed(2).replace(".", ",")} km
          {data.dplus_m != null && ` · ${data.dplus_m} m D+`}
          {terrain?.repartition && Object.entries(TYPES_TERRAIN)
            .filter(([k]) => terrain.repartition[k] > 0)
            .map(([k, l]) => ` · ${terrain.repartition[k]} % ${l}`).join("")}
        </p>
      )}
      {avecAltitude && (
        <div className="card p-4 space-y-2 !mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold">Dénivelé</h3>
            {data.dplus_m != null && <p className="text-[13px] text-label-2 chiffres">{data.dplus_m} m D+</p>}
          </div>
          <Profil points={data.points} couleur="#FF3B30" hauteur={78} detail terrains={terrain?.terrains}
            curseur={repere} onCurseur={setRepere} />
        </div>
      )}
    </div>
  );
}
