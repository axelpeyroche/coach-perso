import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import Page from "../components/Page";
import ConfirmDialog from "../components/ConfirmDialog";
import { Bascule, chargerMaplibre } from "../components/CarteTrace";
import { Interrupteur, Segmente } from "../components/ui";
import {
  creerFavoriItineraire, getAlluresItineraire, getFavoriItineraire, getFavorisItineraire, getItineraires,
  modifierFavoriItineraire, proposerItineraires, renommerFavoriItineraire, supprimerFavoriItineraire, tracerItineraire,
} from "../api";
import { nombre } from "../carnet";
import * as T from "./itineraireTrace";

// ── Réglages ───────────────────────────────────────────────────────────────
const SPORTS = [
  ["course", "Course", "🏃"], ["trail", "Trail", "⛰️"], ["randonnee", "Rando", "🥾"],
  ["velo", "Vélo route", "🚴"], ["gravel", "Gravel", "🚵"], ["vtt", "VTT", "🚵‍♂️"],
];
const A_PIED = ["course", "trail", "randonnee"];
// « Privilégier les sentiers » n'a de sens que là où le profil change
const AVEC_SENTIERS = ["course"];
// Sports classés d'abord sur la part de chemins (le bitume est pénalisé côté serveur)
const HORS_BITUME = ["trail", "randonnee", "gravel", "vtt"];
// Boucle : le départ peut être déplacé jusqu'à ce rayon pour trouver une zone de chemins
const RAYONS = [["0", "Ici"], ["2", "2 km"], ["5", "5 km"], ["10", "10 km"], ["15", "15 km"]];
const rayonDefaut = (s) => (HORS_BITUME.includes(s) ? "5" : "0");
const DEFAUTS = {
  course: [10, 100], trail: [18, 650], randonnee: [15, 500], velo: [60, 600], gravel: [45, 500], vtt: [30, 700],
};
// Sports du carnet → sport d'itinéraire (lien depuis une séance du Plan)
const DEPUIS_CARNET = { course: "course", trail: "trail", randonnee: "randonnee", marche: "randonnee", velo: "velo" };
const TYPE_GPX = { course: "running", trail: "trail_running", randonnee: "hiking", velo: "cycling", gravel: "cycling", vtt: "mountain_biking" };
const COULEURS = ["#FF6B35", "#7F77DD", "#1D9E75", "#E8338A"];
const LYON = [4.835, 45.76];
// Sorties du carnet qui servent à estimer le temps
const BASES = { course: "de course", trail: "de trail", randonnee: "de rando", marche: "de marche", velo: "de vélo" };
const FONDS = [["osm", "Plan"], ["topo", "Topo"], ["ign", "IGN"], ["satellite", "Satellite"]];
// Fond et vue 2D / 3D retenus d'une visite à l'autre
const lirePref = (cle, defaut, valides) => {
  try { const v = localStorage.getItem(cle); return valides.includes(v) ? v : defaut; } catch { return defaut; }
};
const ecrirePref = (cle, v) => { try { localStorage.setItem(cle, v); } catch { /* stockage indisponible */ } };
const TACTILE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

// Fonds gratuits et sans clé : OSM, OpenTopoMap (courbes de niveau), Plan IGN (Géoplateforme),
// imagerie Esri ; relief AWS (Terrarium) pour la 3D
const STYLE = {
  version: 8,
  sources: {
    osm: { type: "raster", tileSize: 256, maxzoom: 19, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap" },
    topo: {
      type: "raster", tileSize: 256, maxzoom: 17,
      tiles: ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
      attribution: "© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)",
    },
    ign: {
      type: "raster", tileSize: 256, maxzoom: 19,
      tiles: ["https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"],
      attribution: "© IGN",
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
    { id: "osm", type: "raster", source: "osm" },
    { id: "topo", type: "raster", source: "topo", layout: { visibility: "none" } },
    { id: "ign", type: "raster", source: "ign", layout: { visibility: "none" } },
    { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
  ],
};

// ── Calculs sur un tracé ([lat, lon, alt]) ─────────────────────────────────
function profil(points) {
  let d = 0;
  return points.map((p, i) => { if (i) d += T.distM(points[i - 1], p); return [d / 1000, p[2] ?? 0]; });
}
const km = (v) => nombre(v, v < 10 ? 2 : 1);
const nomSport = (s) => SPORTS.find(([k]) => k === s)?.[1] ?? "Parcours";

function gpx(r, sport, titre) {
  const echap = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const pts = r.points.map(([lat, lon, ele]) =>
    `<trkpt lat="${lat}" lon="${lon}">${ele != null ? `<ele>${ele}</ele>` : ""}</trkpt>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Carnet" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${echap(titre)}</name></metadata>
<trk><name>${echap(titre)}</name><type>${TYPE_GPX[sport] ?? "running"}</type><trkseg>
${pts}
</trkseg></trk>
</gpx>
`;
}

// Enregistre un vrai .gpx : sur iPhone il arrive dans Fichiers, d'où on l'ouvre dans WorkOutDoors
function telecharger(r, sport, boucle) {
  const titre = r.nom ?? `${boucle ? "Boucle" : "Parcours"} ${nomSport(sport).toLowerCase()} ${km(r.distance_km)} km ${r.dplus_m} m D+`;
  const base = r.nom
    ? r.nom.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60)
    : `carnet-${sport}-${String(r.distance_km).replace(".", ",")}km-${r.dplus_m}m`;
  const nom = `${base || "parcours"}.gpx`;
  const fichier = new File([gpx(r, sport, titre)], nom, { type: "application/gpx+xml" });
  const url = URL.createObjectURL(fichier);
  const a = document.createElement("a");
  a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Recherche d'adresse (Photon / OpenStreetMap : gratuit, sans clé) ───────
function RechercheAdresse({ placeholder, proche, onChoix }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 3) { setRes([]); return; }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const pres = proche ? `&lat=${proche[0].toFixed(3)}&lon=${proche[1].toFixed(3)}` : "";
        const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(t)}&lang=fr&limit=6${pres}`, { signal: ctrl.signal });
        const j = await r.json();
        setRes((j.features ?? []).map((f) => {
          const p = f.properties;
          const lieu = [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.postcode, p.city !== p.name && p.city]
            .filter(Boolean).join(" ");
          return { id: `${p.osm_type}${p.osm_id}`, nom: p.name ?? lieu ?? t, lieu, pos: [f.geometry.coordinates[1], f.geometry.coordinates[0]] };
        }));
        setOuvert(true);
      } catch { /* requête annulée ou hors ligne */ }
    }, 300);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [q]);
  return (
    <div className="relative flex-1 min-w-0">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} type="search"
        onFocus={() => res.length && setOuvert(true)} onBlur={() => setTimeout(() => setOuvert(false), 150)}
        className="w-full bg-transparent text-[16px] md:text-[15px] outline-none placeholder:text-label-3" />
      {ouvert && res.length > 0 && (
        <ul className="absolute z-30 left-[-2.75rem] right-[-1rem] mt-3 card py-1 shadow-lg">
          {res.map((r) => (
            <li key={r.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChoix({ pos: r.pos, nom: r.nom }); setQ(r.nom); setOuvert(false); }}
                className="w-full text-left px-4 py-2 active:bg-remplissage md:hover:bg-remplissage/60">
                <span className="block text-[15px] truncate">{r.nom}</span>
                {r.lieu && <span className="block text-[12px] text-label-2 truncate">{r.lieu}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const Icone = ({ d, className = "text-label-2" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    className={`w-5 h-5 shrink-0 ${className}`} aria-hidden>{d}</svg>
);
const I_POSITION = <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="7.5" /></>;
const I_RECHERCHE = <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>;
const I_EPINGLE = <><path d="M12 21s-6-5.6-6-11a6 6 0 1112 0c0 5.4-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" /></>;
const Coche = () => <Icone className="text-brand" d={<path d="M5 12.5l4.5 4.5L19 7.5" />} />;

// Choix d'un point : position GPS, adresse ou toucher la carte
function ChoixPoint({ titre, point, setPoint, pointage, setPointage, cle, gps, proche }) {
  const [etatGps, setEtatGps] = useState(null);
  const localiser = () => {
    if (!navigator.geolocation) { setEtatGps("Position indisponible sur cet appareil."); return; }
    setEtatGps("Localisation…");
    navigator.geolocation.getCurrentPosition(
      (p) => { setPoint({ pos: [p.coords.latitude, p.coords.longitude], nom: "Ma position", mode: "gps" }); setEtatGps(null); },
      () => setEtatGps("Position refusée : autorise la localisation, ou choisis une adresse."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };
  const mode = pointage === cle ? "carte" : point?.mode;
  return (
    <div>
      <h2 className="entete-liste">{titre}</h2>
      <div className="card py-0.5">
        {gps && (
          <button type="button" onClick={localiser} className="ligne w-full text-left" style={{ "--inset": "3rem" }}>
            <Icone d={I_POSITION} className="text-brand" />
            <span className="flex-1 text-[16px] md:text-[15px]">Ma position</span>
            {mode === "gps" && <Coche />}
          </button>
        )}
        <div className="ligne" style={{ "--inset": "3rem" }}>
          <Icone d={I_RECHERCHE} />
          <RechercheAdresse placeholder="Adresse ou lieu" proche={proche}
            onChoix={(p) => { setPoint({ ...p, mode: "adresse" }); setPointage(null); }} />
          {mode === "adresse" && <Coche />}
        </div>
        <button type="button" onClick={() => setPointage(pointage === cle ? null : cle)} className="ligne w-full text-left">
          <Icone d={I_EPINGLE} />
          <span className="flex-1 text-[16px] md:text-[15px]">
            {pointage === cle ? "Touche la carte…" : "Sur la carte"}
          </span>
          {mode === "carte" && <Coche />}
        </button>
      </div>
      <p className="px-4 pt-1.5 text-[13px] text-label-2 truncate">
        {etatGps ?? (point ? `${point.nom ?? "Point choisi"} · ${point.pos[0].toFixed(4)}, ${point.pos[1].toFixed(4)}` : "Aucun point choisi")}
      </p>
    </div>
  );
}

// ── Profil d'altitude ──────────────────────────────────────────────────────
// Terrain le long du tracé : route = deux traits pleins, chemin = trait plein sous des pointillés,
// sentier = pointillés seuls (la couleur double le motif)
const TERRAINS = { bitume: ["Route", "#8E8E93"], chemin: ["Chemin", "#A2845E"], sentier: ["Sentier", "#30A46C"] };

// Trait d'un tronçon : décalé de part et d'autre du tracé pour la route et le chemin
function Trait({ type, d }) {
  const c = TERRAINS[type]?.[1] ?? "#8E8E93";
  const p = { d, fill: "none", stroke: c, strokeLinejoin: "round" };
  if (type === "bitume") {
    return <><path {...p} strokeWidth={1.5} transform="translate(0,-1.9)" /><path {...p} strokeWidth={1.5} transform="translate(0,1.9)" /></>;
  }
  if (type === "chemin") {
    return <><path {...p} strokeWidth={1.5} strokeDasharray="4 3" transform="translate(0,-1.9)" /><path {...p} strokeWidth={1.6} transform="translate(0,1.9)" /></>;
  }
  return <path {...p} strokeWidth={3} strokeDasharray="0.1 4.5" strokeLinecap="round" />;
}

function LegendeTerrain({ terrains }) {
  const presents = Object.keys(TERRAINS).filter((t) => terrains.some((x) => x[2] === t));
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-label-2">
      {presents.map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <svg width={20} height={10} aria-hidden><Trait type={t} d="M1,5 L19,5" /></svg>
          {TERRAINS[t][0]}
        </span>
      ))}
    </p>
  );
}

function LegendePente() {
  return (
    <p className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-label-2 chiffres">
      {T.PENTES.map(([, l, c]) => (
        <span key={l} className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: c }} aria-hidden />{l}
        </span>
      ))}
    </p>
  );
}

const lireModeProfil = () => {
  try { return localStorage.getItem("itineraires-profil") === "pente" ? "pente" : "terrain"; } catch { return "terrain"; }
};

function Profil({ points, couleur, hauteur = 26, detail = false, terrains, mode = "terrain", setMode, curseur = null, onCurseur }) {
  const prof = useMemo(() => profil(points), [points]);
  // Largeur réelle en pixels : les pointillés et traits doubles gardent leurs proportions
  const boite = useRef(null);
  const [L, setL] = useState(300);
  useEffect(() => {
    const el = boite.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setL(Math.max(60, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const total = prof.at(-1)?.[0] || 1;
  const alts = prof.map((p) => p[1]);
  const min = Math.min(...alts), max = Math.max(...alts), ecart = Math.max(max - min, 20);
  const H = hauteur, marge = detail ? 4 : 2;
  const yDe = (a) => H - marge - ((a - min) / ecart) * (H - 2 * marge);
  const pas = Math.max(1, Math.floor(prof.length / 400));
  // [km, x, y, indice du point]
  const pts = [];
  prof.forEach(([d, a], i) => { if (i % pas === 0 || i === prof.length - 1) pts.push([d, (d / total) * L, yDe(a), i]); });
  const chemin = (liste) => liste.map(([, x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  const ligne = chemin(pts);
  // Kilomètres BRouter recalés sur la distance du profil
  const k = terrains?.length ? total / (terrains.at(-1)[1] || total) : 1;
  const pente = useMemo(() => (detail ? T.pentes(prof) : null), [detail, prof]);
  const enPente = detail && mode === "pente";

  // Découpe de la courbe par terrain
  const troncons = useMemo(() => {
    if (!detail || enPente || !terrains?.length) return [];
    const res = [];
    let i = 0;
    for (const [a, b, t] of terrains) {
      const fin = b * k;
      const morceau = i > 0 ? [pts[i - 1]] : [];
      while (i < pts.length && pts[i][0] <= fin) morceau.push(pts[i++]);
      if (i < pts.length) morceau.push(pts[i]);
      if (morceau.length >= 2) res.push({ a, b, t, d: `M${chemin(morceau)}` });
    }
    return res;
  }, [detail, enPente, terrains, L, H, points]);

  // Découpe par classe de pente
  const zones = useMemo(() => {
    if (!enPente) return [];
    const res = [];
    for (let j = 0; j < pts.length - 1; j++) {
      const c = T.classePente(pente[pts[j][3]]);
      if (res.length && res.at(-1).c === c) res.at(-1).pts.push(pts[j + 1]);
      else res.push({ c, pts: [pts[j], pts[j + 1]] });
    }
    return res;
  }, [enPente, pente, L, H, points]);

  // Curseur : le doigt (ou la souris) sur le profil donne le point le plus proche
  const indice = (clientX) => {
    const r = boite.current.getBoundingClientRect();
    const d = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * total;
    let lo = 0, hi = prof.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (prof[mid][0] < d) lo = mid + 1; else hi = mid; }
    if (lo > 0 && d - prof[lo - 1][0] < prof[lo][0] - d) lo--;
    return lo;
  };
  const c = curseur != null && curseur < prof.length ? curseur : null;
  const cx = c != null ? (prof[c][0] / total) * L : 0;
  const terrainC = c != null ? terrains?.find(([, b]) => prof[c][0] <= b * k + 1e-6)?.[2] : null;
  const penteC = c != null && pente ? Math.round(pente[c]) : null;
  const gestes = onCurseur ? {
    onPointerDown: (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); onCurseur(indice(e.clientX)); },
    onPointerMove: (e) => onCurseur(indice(e.clientX)),
    onPointerLeave: (e) => { if (e.pointerType === "mouse") onCurseur(null); },
    style: { touchAction: "pan-y" },
  } : {};

  return (
    <div ref={boite}>
      <div {...gestes} className={onCurseur ? "cursor-crosshair select-none" : undefined}>
        <svg viewBox={`0 0 ${L} ${H}`} className="w-full block overflow-visible" style={{ height: H }}
          role={detail ? "img" : undefined} aria-hidden={detail ? undefined : true}
          aria-label={detail ? `Profil d'altitude ${enPente ? "et pentes" : "et terrain"} le long du parcours` : undefined}>
          {enPente ? zones.map((z, j) => {
            const col = T.PENTES[z.c][2];
            return (
              <g key={j}>
                <path d={`M${z.pts[0][1].toFixed(1)},${H} L${chemin(z.pts)} L${z.pts.at(-1)[1].toFixed(1)},${H} Z`} fill={col} fillOpacity={0.2} />
                <path d={`M${chemin(z.pts)}`} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" />
              </g>
            );
          }) : (
            <>
              <path d={`M0,${H} L${ligne} L${L},${H} Z`} fill={couleur} fillOpacity={0.15} />
              {troncons.length ? troncons.map(({ a, b, t, d }, j) => (
                <g key={j}>
                  <title>{`${TERRAINS[t]?.[0] ?? t} · ${km(a)} → ${km(b)} km`}</title>
                  <Trait type={t} d={d} />
                </g>
              )) : <path d={`M${ligne}`} fill="none" stroke={couleur} strokeWidth={1.6} />}
            </>
          )}
          {c != null && (
            <g className="text-label" pointerEvents="none">
              <line x1={cx} x2={cx} y1={0} y2={H} stroke="currentColor" strokeOpacity={0.45} strokeWidth={1} />
              <circle cx={cx} cy={yDe(prof[c][1])} r={4.5} fill={couleur} stroke="#fff" strokeWidth={2} />
            </g>
          )}
        </svg>
      </div>
      {detail && (
        <p className="flex justify-between gap-2 text-[11px] text-label-2 chiffres mt-0.5 min-h-[16px]">
          {c != null ? (
            <span className="text-label font-semibold">
              {km(prof[c][0])} km · {Math.round(prof[c][1])} m
              {penteC != null && ` · ${penteC > 0 ? "+" : penteC < 0 ? "−" : ""}${Math.abs(penteC)} %`}
              {terrainC && ` · ${TERRAINS[terrainC]?.[0] ?? terrainC}`}
            </span>
          ) : (
            <><span>{Math.round(min)} m</span><span>alt. max {Math.round(max)} m</span><span>{km(total)} km</span></>
          )}
        </p>
      )}
      {detail && (
        <div className="mt-1 flex items-center justify-between gap-2">
          {enPente ? <LegendePente /> : troncons.length > 0 ? <LegendeTerrain terrains={terrains} /> : <span />}
          {setMode && (
            <div className="flex shrink-0 rounded-[8px] bg-remplissage p-0.5 text-[11px] font-semibold" role="group" aria-label="Couleurs du profil">
              {[["terrain", "Terrain"], ["pente", "Pente"]].map(([v, l]) => (
                <button type="button" key={v} aria-pressed={mode === v} onClick={() => setMode(v)}
                  className={`px-2 py-0.5 rounded-[6px] transition ${mode === v ? "bg-surface text-label shadow-sm" : "text-label-2"}`}>
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Carte ──────────────────────────────────────────────────────────────────
const VIDE = { type: "FeatureCollection", features: [] };
const ligneGeo = (pts, properties = {}) => ({ type: "Feature", properties, geometry: { type: "LineString", coordinates: pts.map((p) => [p[1], p[0]]) } });
const pointGeo = (p, properties = {}) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: [p[1], p[0]] } });
const collection = (features) => ({ type: "FeatureCollection", features });

function Carte({ propositions, choisie, onChoisir, depart, arrivee, pointage, onPoint, cadrage,
  edition, couleurEdition, onOp, traceSurvol, onSurvol, curseur }) {
  const conteneur = useRef(null);
  const carte = useRef(null);
  const libre = useRef(null);
  const popup = useRef(null);
  const [prete, setPrete] = useState(false);
  const [fond, setFond] = useState(() => lirePref("itineraires-fond", "topo", FONDS.map(([k]) => k)));
  const [vue, setVue] = useState(() => lirePref("itineraires-vue", "2d", ["2d", "3d"]));
  // Valeurs à jour pour les gestionnaires d'événements, branchés une seule fois
  const props = useRef({});
  props.current = { pointage, onPoint, onChoisir, edition, couleurEdition, onOp, traceSurvol, onSurvol };
  // Geste en cours sur le tracé en retouche : { type: "point" | "ligne", k, x0, pos, bouge }
  const geste = useRef(null);
  const finGeste = useRef(0);

  // Tracé en retouche, avec l'aperçu en tirets pendant un glissé ou un calcul
  const dessinerEdition = useCallback(() => {
    const m = carte.current;
    if (!m?.getSource("edit-segs")) return;
    const { edition: ed, couleurEdition: c } = props.current;
    if (!ed) {
      for (const s of ["edit-segs", "edit-apercu", "edit-points"]) m.getSource(s).setData(VIDE);
      return;
    }
    const g = geste.current;
    const op = g?.bouge ? { type: g.type === "point" ? "deplacer" : "inserer", k: g.k, pos: g.pos } : ed.attente;
    const ap = T.apercu(ed.e, op);
    m.getSource("edit-segs").setData(collection(ed.e.segs.map((s, k) => ligneGeo(s.pts, { k, c, masque: ap.masques.includes(k) }))));
    m.getSource("edit-apercu").setData(collection(ap.lignes.map((l) => ligneGeo(l))));
    const n = ap.wps.length;
    m.getSource("edit-points").setData(collection(ap.wps.map((w, k) => pointGeo(w, {
      k, c, role: k === 0 ? "depart" : !ed.e.boucle && k === n - 1 ? "arrivee" : "etape",
    }))));
  }, []);

  useEffect(() => {
    let annule = false;
    (async () => {
      const maplibregl = await chargerMaplibre();
      if (annule || !conteneur.current) return;
      libre.current = maplibregl;
      const centre = depart ? [depart.pos[1], depart.pos[0]] : LYON;
      const m = new maplibregl.Map({ container: conteneur.current, style: STYLE, center: centre, zoom: depart ? 13 : 11,
        maxPitch: 75, attributionControl: { compact: true } });
      carte.current = m;
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      m.on("load", () => {
        const rond = { "line-join": "round", "line-cap": "round" };
        m.addSource("routes", { type: "geojson", data: VIDE });
        m.addLayer({ id: "routes-bord", type: "line", source: "routes", layout: rond,
          paint: { "line-color": "#fff", "line-width": ["case", ["get", "sel"], 7, 4.5], "line-opacity": ["case", ["get", "sel"], 1, 0.6] } });
        m.addLayer({ id: "routes", type: "line", source: "routes", layout: { ...rond, "line-sort-key": ["case", ["get", "sel"], 1, 0] },
          paint: { "line-color": ["get", "c"], "line-width": ["case", ["get", "sel"], 4.5, 2.5], "line-opacity": ["case", ["get", "sel"], 1, 0.55] } });
        // Retouche : larges cibles invisibles pour attraper le tracé et les points au doigt
        for (const s of ["edit-segs", "edit-apercu", "edit-points", "points", "curseur"]) m.addSource(s, { type: "geojson", data: VIDE });
        m.addLayer({ id: "edit-segs-cible", type: "line", source: "edit-segs", layout: rond,
          paint: { "line-color": "#000", "line-opacity": 0.01, "line-width": 22 } });
        m.addLayer({ id: "edit-segs-bord", type: "line", source: "edit-segs", layout: rond,
          paint: { "line-color": "#fff", "line-width": 7.5, "line-opacity": ["case", ["get", "masque"], 0.3, 1] } });
        m.addLayer({ id: "edit-segs", type: "line", source: "edit-segs", layout: rond,
          paint: { "line-color": ["get", "c"], "line-width": 4.5, "line-opacity": ["case", ["get", "masque"], 0.3, 1] } });
        m.addLayer({ id: "edit-apercu", type: "line", source: "edit-apercu", layout: rond,
          paint: { "line-color": "#1C1C1E", "line-width": 3, "line-dasharray": [0.6, 1.8] } });
        m.addLayer({ id: "points", type: "circle", source: "points",
          paint: { "circle-radius": 7, "circle-color": ["get", "c"], "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
        m.addLayer({ id: "edit-points-cible", type: "circle", source: "edit-points",
          paint: { "circle-radius": 20, "circle-color": "#000", "circle-opacity": 0.01 } });
        m.addLayer({ id: "edit-points", type: "circle", source: "edit-points", paint: {
          "circle-radius": ["match", ["get", "role"], "etape", 6.5, 8.5],
          "circle-color": ["match", ["get", "role"], "depart", "#34C759", "arrivee", "#1C1C1E", "#fff"],
          "circle-stroke-color": ["match", ["get", "role"], "etape", ["get", "c"], "#fff"],
          "circle-stroke-width": 3,
        } });
        m.addLayer({ id: "curseur", type: "circle", source: "curseur",
          paint: { "circle-radius": 7, "circle-color": ["get", "c"], "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });

        m.on("click", "routes", (e) => {
          const p = props.current;
          if (!p.pointage && !p.edition) p.onChoisir(e.features[0].properties.i);
        });
        m.on("mouseenter", "routes", () => { if (!props.current.edition) m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "routes", () => { if (!props.current.edition) m.getCanvas().style.cursor = ""; });

        // ── Gestes de retouche ──
        const fermerPopup = () => { popup.current?.remove(); popup.current = null; };
        const ouvrirPopup = (k) => {
          const e = props.current.edition.e, w = e.wps[k];
          const div = document.createElement("div");
          div.style.color = "#1C1C1E";
          if (T.retirable(e, k)) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "btn-danger btn-sm";
            b.textContent = "Retirer ce point";
            b.onclick = () => { fermerPopup(); props.current.onOp({ type: "retirer", k }); };
            div.appendChild(b);
          } else {
            div.className = "text-[13px] px-1";
            div.textContent = k === 0
              ? `${e.boucle ? "Départ et arrivée" : "Départ"} : fais-le glisser pour le déplacer.`
              : "Arrivée : fais-la glisser pour la déplacer.";
          }
          fermerPopup();
          popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, maxWidth: "240px" })
            .setLngLat([w[1], w[0]]).setDOMContent(div).addTo(m);
        };
        const annulerGeste = () => { if (geste.current) { geste.current = null; dessinerEdition(); } };
        const lacher = () => {
          const g = geste.current;
          geste.current = null;
          if (!g) return;
          finGeste.current = Date.now();
          const p = props.current;
          if (!p.edition || p.edition.attente) { dessinerEdition(); return; }
          if (g.bouge) p.onOp({ type: g.type === "point" ? "deplacer" : "inserer", k: g.k, pos: g.pos });
          else if (g.type === "point") ouvrirPopup(g.k);
          else p.onOp({ type: "couper", k: g.k, pos: g.pos });
        };
        let dernierToucher = 0;
        const appuyer = (e) => {
          const ed = props.current.edition;
          const touches = e.originalEvent.touches;
          if (touches) dernierToucher = Date.now();
          // Après un toucher, le navigateur simule aussi la souris : ce second geste est ignoré
          else if (Date.now() - dernierToucher < 1000) return;
          if (!ed || ed.attente || props.current.pointage) return;
          if (touches && touches.length > 1) { annulerGeste(); return; }
          const wp = m.queryRenderedFeatures(e.point, { layers: ["edit-points-cible"] })[0];
          const seg = !wp && m.queryRenderedFeatures(e.point, { layers: ["edit-segs-cible"] })[0];
          if (!wp && !seg) return;
          e.preventDefault(); // pas de déplacement de la carte : c'est le tracé qu'on attrape
          geste.current = { type: wp ? "point" : "ligne", k: (wp ?? seg).properties.k, x0: e.point, pos: [e.lngLat.lat, e.lngLat.lng], bouge: false };
          if (!touches) window.addEventListener("mouseup", lacher, { once: true });
        };
        let raf = 0, dernier = null;
        const survoler = (e) => {
          const p = props.current;
          if (p.edition && !p.edition.attente) {
            const sur = m.queryRenderedFeatures(e.point, { layers: ["edit-points-cible", "edit-segs-cible"] }).length;
            m.getCanvas().style.cursor = sur ? "pointer" : "crosshair";
          }
          if (!p.onSurvol || !p.traceSurvol?.length) return;
          dernier = e;
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            const pts = props.current.traceSurvol;
            if (!pts?.length) return;
            const { i } = T.plusProche(pts, [dernier.lngLat.lat, dernier.lngLat.lng]);
            const px = m.project([pts[i][1], pts[i][0]]);
            props.current.onSurvol(Math.hypot(px.x - dernier.point.x, px.y - dernier.point.y) < 40 ? i : null);
          });
        };
        const bouger = (e) => {
          const g = geste.current;
          if (!g) { if (e.type === "mousemove") survoler(e); return; }
          if (e.originalEvent.touches?.length > 1) { annulerGeste(); return; }
          g.pos = [e.lngLat.lat, e.lngLat.lng];
          if (!g.bouge && Math.hypot(e.point.x - g.x0.x, e.point.y - g.x0.y) < 6) return;
          g.bouge = true;
          dessinerEdition();
        };
        m.on("mousedown", appuyer);
        m.on("touchstart", appuyer);
        m.on("mousemove", bouger);
        m.on("touchmove", bouger);
        m.on("touchend", () => { dernierToucher = Date.now(); lacher(); });
        m.on("touchcancel", annulerGeste);
        m.on("mouseout", () => props.current.onSurvol?.(null));

        m.on("click", (e) => {
          const p = props.current;
          if (p.pointage) { p.onPoint([e.lngLat.lat, e.lngLat.lng]); return; }
          if (!p.edition) return;
          // Le clic qui suit un glissé ou un toucher sur le tracé est déjà traité
          if (Date.now() - finGeste.current < 500 || p.edition.attente) return;
          if (popup.current) { fermerPopup(); return; }
          if (m.queryRenderedFeatures(e.point, { layers: ["edit-points-cible", "edit-segs-cible"] }).length) return;
          p.onOp({ type: "ajouter", pos: [e.lngLat.lat, e.lngLat.lng] });
        });
        setPrete(true);
      });
      // La carte peut naître cachée (téléphone) : on la redimensionne quand elle apparaît
      const ro = new ResizeObserver(() => m.resize());
      ro.observe(conteneur.current);
      m.once("remove", () => ro.disconnect());
    })();
    return () => { annule = true; carte.current?.remove(); carte.current = null; setPrete(false); };
  }, []);

  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    for (const [f] of FONDS) m.setLayoutProperty(f, "visibility", f === fond ? "visible" : "none");
    ecrirePref("itineraires-fond", fond);
  }, [fond, prete]);

  // 3D : relief exagéré et carte inclinée ; en 2D, retour à plat et au nord
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    ecrirePref("itineraires-vue", vue);
    if (vue === "3d") {
      m.setTerrain({ source: "relief", exaggeration: 1.5 });
      m.easeTo({ pitch: 60, duration: 800 });
    } else {
      m.setTerrain(null);
      m.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
  }, [vue, prete]);

  useEffect(() => {
    if (prete && carte.current) carte.current.getCanvas().style.cursor = pointage ? "crosshair" : edition ? "crosshair" : "";
  }, [pointage, !!edition, prete]);

  // Retouche : dessin du tracé et des points ; la bulle se ferme quand le tracé change
  useEffect(() => {
    if (!prete || !carte.current) return;
    popup.current?.remove();
    popup.current = null;
    dessinerEdition();
  }, [edition, couleurEdition, prete]);

  // Points de départ et d'arrivée
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    const f = [[depart, "#34C759"], [arrivee, "#1C1C1E"]].filter(([p]) => p).map(([p, c]) => pointGeo(p.pos, { c }));
    // Départ déplacé vers une zone de chemins : un point à la couleur de la proposition
    if (!edition) {
      (propositions ?? []).forEach((r, i) => {
        if (r.depart && r.approche_km >= 0.3) f.push(pointGeo(r.depart, { c: COULEURS[i % COULEURS.length] }));
      });
    }
    m.getSource("points").setData(collection(f));
    if (depart && !propositions?.length) m.easeTo({ center: [depart.pos[1], depart.pos[0]], zoom: Math.max(m.getZoom(), 12.5) });
  }, [depart, arrivee, propositions, !!edition, prete]);

  // Tracés proposés (masqués pendant la retouche : seul le tracé retouché reste)
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    const f = edition ? [] : (propositions ?? []).map((r, i) => ligneGeo(r.points, { i, c: COULEURS[i % COULEURS.length], sel: i === choisie }));
    m.getSource("routes").setData(collection(f));
  }, [propositions, choisie, !!edition, prete]);

  // Point de la courbe d'altitude sous le doigt
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m) return;
    m.getSource("curseur").setData(curseur ? collection([pointGeo(curseur.pos, { c: curseur.c })]) : VIDE);
  }, [curseur, prete]);

  // Cadrage sur le tracé choisi (ou sur toutes les propositions) quand le résultat ou le choix change
  useEffect(() => {
    const m = carte.current;
    if (!prete || !propositions?.length) return;
    const pts = (choisie != null ? [propositions[choisie]] : propositions).flatMap((r) => r.points);
    const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40, pitch: m.getPitch(), bearing: m.getBearing(), duration: 700 });
  }, [cadrage, choisie, prete]);

  return (
    <div className={`relative rounded-[14px] overflow-hidden bg-remplissage transition-[height] ${edition ? "h-[56vh] md:h-[560px]" : "h-[300px] md:h-[440px]"}`}>
      <div ref={conteneur} className="w-full h-full" />
      <div className="absolute top-2 left-2 flex flex-col items-start gap-1.5">
        <Bascule options={FONDS} valeur={fond} onChange={setFond} />
        <Bascule options={[["2d", "2D"], ["3d", "3D"]]} valeur={vue} onChange={setVue} />
      </div>
      {pointage && (
        <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/65 backdrop-blur px-3 py-1.5 text-[13px] font-semibold text-white whitespace-nowrap">
          Touche la carte pour placer {pointage === "depart" ? "le départ" : "l'arrivée"}
        </p>
      )}
      {edition?.attente && (
        <p className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 rounded-full bg-black/65 backdrop-blur px-3 py-1.5 text-[13px] font-semibold text-white whitespace-nowrap" role="status">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
          Calcul du tracé…
        </p>
      )}
    </div>
  );
}

// ── Retouche ───────────────────────────────────────────────────────────────
function PanneauRetouche({ edition, stats, allure, onAnnuler, onRevenir, onTerminer }) {
  const t = T.duree(T.tempsEstime(stats, allure));
  const change = edition.e !== edition.initial;
  const verbe = TACTILE ? "Touche" : "Clique sur";
  const aide = [
    [`${verbe} la carte`, " : le tracé passe par là."],
    ["Fais glisser un point ou le tracé", " pour le déplacer."],
    [`${verbe} un point`, ` pour le retirer.${TACTILE ? "" : " Ctrl+Z annule."}`],
  ];
  return (
    <div className="card p-4 space-y-3">
      <div>
        <p className="text-[12px] font-semibold text-label-2">Retouche du tracé</p>
        <p className="text-[18px] font-semibold chiffres">
          {km(stats.distance_km)} km · {stats.dplus_m} m D+
          {t && <span className="font-normal text-label-2"> · ≈ {t}</span>}
        </p>
        {change && (
          <p className="text-[12px] text-label-2 chiffres">Avant : {km(edition.avant.distance_km)} km · {edition.avant.dplus_m} m D+</p>
        )}
      </div>
      {edition.erreur && <p className="text-[13px] text-ios-red" role="alert">{edition.erreur}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onAnnuler} disabled={!edition.pile.length || !!edition.attente} className="btn-gris btn-sm">
          ↶ Annuler
        </button>
        <button type="button" onClick={onRevenir} disabled={!change || !!edition.attente} className="btn-texte !text-[13px] whitespace-nowrap">
          Revenir à l'original
        </button>
        <button type="button" onClick={onTerminer} disabled={!!edition.attente} className="btn-primaire btn-sm ml-auto">
          Terminer
        </button>
      </div>
      <ul className="space-y-1 text-[13px] text-label-2">
        {aide.map(([a, b]) => (
          <li key={a} className="flex gap-2"><span aria-hidden className="text-brand">•</span><span><b className="font-semibold text-label">{a}</b>{b}</span></li>
        ))}
      </ul>
    </div>
  );
}

// ── Proposition ────────────────────────────────────────────────────────────
function Pastille({ r, distance, dplus, boucle }) {
  const pastille = "inline-flex items-center h-[20px] px-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap";
  if (!boucle || (!distance && dplus == null)) return null;
  const ed = distance ? r.distance_km - distance : 0;
  const eh = dplus != null ? r.dplus_m - dplus : 0;
  const okD = !distance || Math.abs(ed) <= Math.max(0.5, distance * 0.05);
  const okH = dplus == null || Math.abs(eh) <= Math.max(30, dplus * 0.12);
  if (okD && okH) return <span className={`${pastille} bg-ios-green/15 text-ios-green`}>Au plus près</span>;
  const signe = (v) => (v > 0 ? "+" : "−");
  return (
    <>
      {!okD && <span className={`${pastille} bg-ios-orange/15 text-ios-orange`}>{signe(ed)}{km(Math.abs(ed))} km</span>}
      {!okH && <span className={`${pastille} bg-ios-orange/15 text-ios-orange`}>{signe(eh)}{Math.abs(Math.round(eh))} m D+</span>}
    </>
  );
}

function Repartition({ r, sport }) {
  const parts = [["sentier", "sentier"], ["chemin", "chemin"], ["bitume", "bitume"]]
    .map(([k, l]) => [r.repartition?.[k] ?? 0, l, k]).filter(([v]) => v >= 5);
  if (!parts.length) return null;
  return (
    <span className="text-[12px] text-label-2 chiffres">
      {parts.map(([v, l, k], j) => (
        <span key={k}>
          {j > 0 && " · "}
          <span className={k === "bitume" && HORS_BITUME.includes(sport) && v > 25 ? "text-ios-orange font-semibold" : ""}>{v} % {l}</span>
        </span>
      ))}
    </span>
  );
}

function IconeGpx() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

function BoutonGpx({ r, i, sport, boucle }) {
  return (
    <button type="button" onClick={() => telecharger(r, sport, boucle)} className="btn-teinte btn-sm shrink-0 gap-1"
      aria-label={`Enregistrer le GPX de la proposition ${i + 1}`}>
      <IconeGpx />GPX
    </button>
  );
}

function ChampNom({ nom, onValider, onAnnuler }) {
  const [v, setV] = useState(nom);
  const valider = () => { const t = v.trim(); if (t && t !== nom) onValider(t.slice(0, 120)); else onAnnuler(); };
  return (
    <input autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={120} aria-label="Nom du parcours"
      onKeyDown={(e) => { if (e.key === "Enter") valider(); if (e.key === "Escape") onAnnuler(); }} onBlur={valider}
      className="w-full rounded-[8px] bg-remplissage px-2 py-1 text-[16px] md:text-[14px] font-semibold outline-none" />
  );
}

function Proposition({ r, i, choisie, onChoisir, sport, distance, dplus, boucle, allure, enRetouche,
  modeProfil, setModeProfil, curseur, onCurseur, onModifier, onEnregistrer, enregistrement, renommage,
  onRenommer, onNommer, onSupprimer }) {
  const couleur = COULEURS[i % COULEURS.length];
  const sel = i === choisie;
  const temps = T.duree(T.tempsEstime(r, allure));
  return (
    <div className={`ligne !items-stretch flex-col !gap-1.5 !py-3 ${sel ? "rounded-[12px]" : ""}`}
      style={sel ? { boxShadow: `inset 0 0 0 2px ${couleur}` } : undefined}>
      <div className="flex items-center gap-3">
        {renommage ? (
          <div className="flex-1 min-w-0 pl-6">
            <ChampNom nom={r.nom ?? ""} onValider={onNommer} onAnnuler={() => onRenommer(false)} />
          </div>
        ) : (
          <button type="button" onClick={() => onChoisir(sel ? null : i)} className="flex-1 min-w-0 flex items-start gap-3 text-left">
            <span className="w-3 h-3 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: couleur }} aria-hidden />
            <span className="flex-1 min-w-0">
              {r.nom && <span className="block text-[13px] font-semibold text-label-2 truncate">★ {r.nom}</span>}
              <span className="block text-[16px] font-semibold chiffres">
                {km(r.distance_km)} km · {r.dplus_m} m D+
                {temps && <span className="font-normal text-label-2"> · ≈ {temps}</span>}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                {enRetouche && (
                  <span className="inline-flex items-center h-[20px] px-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap bg-brand/15 text-brand">En retouche</span>
                )}
                {!enRetouche && r.retouche && (
                  <span className="inline-flex items-center h-[20px] px-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap bg-brand/15 text-brand">Retouché</span>
                )}
                {!r.retouche && !enRetouche && <Pastille r={r} distance={distance} dplus={dplus} boucle={boucle} />}
                {r.approche_km >= 0.3 && (
                  <span className="inline-flex items-center h-[20px] px-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap bg-remplissage text-label-2">
                    Départ à {km(r.approche_km)} km
                  </span>
                )}
                <Repartition r={r} sport={sport} />
              </span>
            </span>
          </button>
        )}
        {!enRetouche && <BoutonGpx r={r} i={i} sport={sport} boucle={boucle} />}
      </div>
      <div className="pl-6">
        {sel ? (
          <Profil points={r.points} couleur={couleur} hauteur={78} detail terrains={r.terrains}
            mode={modeProfil} setMode={setModeProfil} curseur={curseur} onCurseur={onCurseur} />
        ) : (
          <button type="button" onClick={() => onChoisir(i)} className="block w-full text-left" aria-hidden tabIndex={-1}>
            <Profil points={r.points} couleur={couleur} hauteur={26} />
          </button>
        )}
      </div>
      {sel && !enRetouche && (
        <div className="pl-6 pt-1 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onModifier} className="btn-gris btn-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
              <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
            </svg>
            Modifier le tracé
          </button>
          {r.favori_id && !r.modifie ? (
            <span className="inline-flex items-center gap-1 h-8 px-3 text-[13px] font-semibold text-brand">★ Enregistré</span>
          ) : (
            <button type="button" onClick={onEnregistrer} disabled={enregistrement} className="btn-teinte btn-sm">
              {enregistrement ? "Enregistrement…" : r.favori_id ? "★ Mettre à jour" : "☆ Enregistrer"}
            </button>
          )}
          {r.favori_id && !renommage && (
            <>
              <button type="button" onClick={() => onRenommer(true)} className="btn-texte !text-[13px]">Renommer</button>
              <button type="button" onClick={onSupprimer} className="btn-texte !text-[13px] !text-ios-red">Supprimer</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function messageRetouche(e) {
  if (e?.response?.status === 429) return "Beaucoup de retouches d'affilée : patiente quelques secondes.";
  if (e?.code === "ECONNABORTED") return "Le calcul prend trop de temps. Réessaie dans un instant.";
  const d = e?.response?.data?.detail;
  return typeof d === "string" ? `${d} Essaie un point un peu plus loin.` : "Tracé impossible par ce point. Essaie un peu plus loin.";
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Itineraires() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const sportInitial = DEPUIS_CARNET[params.get("sport")] ?? (SPORTS.some(([k]) => k === params.get("sport")) ? params.get("sport") : "trail");
  const [sport, setSport] = useState(sportInitial);
  const [boucle, setBoucle] = useState(true);
  const [distance, setDistance] = useState(params.get("distance") ?? String(DEFAUTS[sportInitial][0]));
  const [dplus, setDplus] = useState(params.get("dplus") ?? (params.get("distance") ? "" : String(DEFAUTS[sportInitial][1])));
  const [sentiers, setSentiers] = useState(sportInitial === "course");
  const [eviterRoutes, setEviterRoutes] = useState(false);
  const [rayon, setRayon] = useState(rayonDefaut(sportInitial));
  const [depart, setDepart] = useState(null);
  const [arrivee, setArrivee] = useState(null);
  const [pointage, setPointage] = useState(null); // "depart" | "arrivee" | null
  const [resultat, setResultat] = useState(null);
  const [choisie, setChoisie] = useState(null);
  const [essai, setEssai] = useState(0);
  const [erreur, setErreur] = useState(null);
  const [vue, setVue] = useState("recherche"); // téléphone : « recherche » puis « resultats »
  const [edition, setEdition] = useState(null);
  const [curseur, setCurseur] = useState(null);
  const [modeProfil, setModeProfilBrut] = useState(lireModeProfil);
  const [renommage, setRenommage] = useState(null);
  const [aSupprimer, setASupprimer] = useState(null);
  const [erreurFavori, setErreurFavori] = useState(null);
  const [tousFavoris, setTousFavoris] = useState(false);
  const haut = useRef(null);
  const zoneCarte = useRef(null);
  const editionRef = useRef(edition);
  editionRef.current = edition;

  const { data: statut } = useQuery({ queryKey: ["itineraires"], queryFn: getItineraires, staleTime: 300_000 });
  const { data: allures } = useQuery({ queryKey: ["itineraires-allures"], queryFn: getAlluresItineraire, staleTime: 600_000 });
  const { data: favoris } = useQuery({ queryKey: ["itineraires-favoris"], queryFn: getFavorisItineraire, staleTime: 60_000 });

  const setModeProfil = (v) => {
    setModeProfilBrut(v);
    try { localStorage.setItem("itineraires-profil", v); } catch { /* stockage indisponible */ }
  };

  const changerSport = (s) => {
    setSport(s);
    if (!params.get("distance")) { setDistance(String(DEFAUTS[s][0])); setDplus(String(DEFAUTS[s][1])); }
    setSentiers(s === "course");
    setRayon(rayonDefaut(s));
  };

  const afficher = (res) => {
    setEdition(null);
    setRenommage(null);
    setCurseur(null);
    setErreurFavori(null);
    setResultat({ id: Date.now(), ...res });
    setChoisie(res.propositions.length ? 0 : null);
    setVue("resultats");
    haut.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const demande = useMutation({
    mutationFn: (n) => proposerItineraires({
      sport, depart: depart.pos, arrivee: boucle ? null : arrivee?.pos,
      distance_km: boucle ? Number(String(distance).replace(",", ".")) : null,
      dplus_m: dplus === "" ? null : Math.round(Number(dplus)),
      sentiers: AVEC_SENTIERS.includes(sport) && sentiers,
      eviter_routes: sport === "course" && eviterRoutes,
      essai: n,
      rayon_km: boucle ? Number(rayon) : 0,
    }),
    onSuccess: (r, n) => {
      afficher({
        ...r, boucle, sport,
        distance: boucle ? Number(String(distance).replace(",", ".")) : null,
        dplus: dplus === "" ? null : Number(dplus),
        rayon: boucle ? Number(rayon) : 0,
        sentiers: AVEC_SENTIERS.includes(sport) && sentiers,
        nomDepart: depart?.mode === "adresse" ? depart.nom : null,
      });
      setEssai(n);
    },
    onError: (e) => setErreur(e?.response?.data?.detail?.toString?.()
      ?? (e?.code === "ECONNABORTED" ? "Le calcul prend trop de temps. Réessaie dans un instant." : "Calcul impossible pour le moment.")),
  });

  const lancer = (n = 0) => {
    setErreur(null);
    if (!depart) { setErreur("Choisis un point de départ."); return; }
    if (!boucle && !arrivee) { setErreur("Choisis un point d'arrivée."); return; }
    const d = Number(String(distance).replace(",", "."));
    if (boucle && !(d > 0.5)) { setErreur("Indique la distance de la boucle (en km)."); return; }
    setPointage(null);
    demande.mutate(n);
  };

  const poser = (pos) => {
    const p = { pos, nom: "Point sur la carte", mode: "carte" };
    if (pointage === "arrivee") setArrivee(p); else setDepart(p);
    setPointage(null);
  };

  const resultats = resultat?.propositions ?? [];
  const majProposition = (i, patch) => setResultat((res) => res && {
    ...res, propositions: res.propositions.map((p, j) => (j === i ? { ...p, ...patch } : p)),
  });

  // ── Retouche du tracé ──
  const trace = useMemo(() => (edition ? T.assembler(edition.e) : null), [edition?.e]);
  const traceStats = useMemo(() => (trace ? T.decrire(trace.points, trace.types) : null), [trace]);
  const affichees = useMemo(() => resultats.map((r, i) => (edition?.i === i && trace
    ? { ...r, ...traceStats, points: trace.points } : r)), [resultats, edition?.i, trace, traceStats]);

  const commencer = (i) => {
    const e0 = T.decouper(resultats[i], resultat.boucle, A_PIED.includes(resultat.sport));
    const t0 = T.assembler(e0), avant = T.decrire(t0.points, t0.types);
    setChoisie(i);
    setCurseur(null);
    setRenommage(null);
    setEdition({ i, e: e0, initial: e0, pile: [], attente: null, erreur: null, avant });
    setTimeout(() => zoneCarte.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const executer = async (op) => {
    const ed = editionRef.current;
    if (!ed || ed.attente) return;
    let o = op;
    if (o.type === "ajouter") o = { type: "inserer", k: T.segmentPlusProche(ed.e, o.pos), pos: o.pos };
    if (o.type === "couper") {
      const e = T.couper(ed.e, o.k, o.pos);
      if (e) setEdition({ ...ed, e, pile: [...ed.pile, ed.e].slice(-50), erreur: null });
      return;
    }
    if (o.type === "retirer" && !T.retirable(ed.e, o.k)) return;
    setEdition({ ...ed, attente: o, erreur: null });
    try {
      const res = await tracerItineraire({ sport: resultat.sport, points: T.demandeRetouche(ed.e, o), sentiers: !!resultat.sentiers });
      setEdition((cur) => (cur && cur.e === ed.e
        ? { ...cur, e: T.appliquerRetouche(ed.e, o, res), pile: [...cur.pile, ed.e].slice(-50), attente: null }
        : cur));
    } catch (err) {
      setEdition((cur) => cur && { ...cur, attente: null, erreur: messageRetouche(err) });
    }
  };

  const annuler = () => setEdition((ed) => (ed && ed.pile.length && !ed.attente
    ? { ...ed, e: ed.pile.at(-1), pile: ed.pile.slice(0, -1), erreur: null } : ed));
  const revenir = () => setEdition((ed) => (ed && ed.e !== ed.initial && !ed.attente
    ? { ...ed, e: ed.initial, pile: [...ed.pile, ed.e], erreur: null } : ed));
  const terminer = () => {
    const ed = editionRef.current;
    if (!ed) return;
    if (ed.e !== ed.initial) {
      const t = T.assembler(ed.e), d = T.decrire(t.points, t.types);
      majProposition(ed.i, {
        points: t.points, terrains: d.terrains, repartition: d.repartition, distance_km: d.distance_km, dplus_m: d.dplus_m,
        etapes: t.etapes, depart: t.points[0].slice(0, 2), modifie: true, retouche: true,
      });
    }
    setEdition(null);
    setCurseur(null);
  };

  useEffect(() => {
    if (!edition) return;
    const f = (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !ev.target.closest?.("input, textarea")) {
        ev.preventDefault();
        annuler();
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [!!edition]);

  const choisir = (i) => {
    if (editionRef.current) terminer();
    setRenommage(null);
    setChoisie(i);
    setCurseur(null);
  };

  // ── Parcours enregistrés ──
  const nomAuto = (r) => `${resultat.boucle ? "Boucle" : "Parcours"} ${nomSport(resultat.sport).toLowerCase()} ${km(r.distance_km)} km${
    resultat.nomDepart ? ` · ${resultat.nomDepart}` : ""}`.slice(0, 120);
  const corpsFavori = (r) => ({
    nom: r.nom ?? nomAuto(r), sport: resultat.sport, boucle: resultat.boucle, distance_km: r.distance_km, dplus_m: r.dplus_m,
    points: r.points, terrains: r.terrains ?? [], repartition: r.repartition ?? null,
    etapes: (r.etapes?.length ?? 0) <= 100 ? (r.etapes ?? []) : [], depart: r.depart ?? null,
  });
  const erreurApi = (e, defaut) => setErreurFavori(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : defaut);
  const invaliderFavoris = () => qc.invalidateQueries({ queryKey: ["itineraires-favoris"] });

  const enregistrer = useMutation({
    mutationFn: ({ i, r }) => (r.favori_id ? modifierFavoriItineraire(r.favori_id, corpsFavori(r)) : creerFavoriItineraire(corpsFavori(r)))
      .then((f) => ({ i, f })),
    onSuccess: ({ i, f }) => { setErreurFavori(null); majProposition(i, { favori_id: f.id, nom: f.nom, modifie: false }); invaliderFavoris(); },
    onError: (e) => erreurApi(e, "Enregistrement impossible pour le moment."),
  });
  const renommer = useMutation({
    mutationFn: ({ i, id, nom }) => renommerFavoriItineraire(id, nom).then((f) => ({ i, f })),
    onSuccess: ({ i, f }) => { setErreurFavori(null); majProposition(i, { nom: f.nom }); invaliderFavoris(); },
    onError: (e) => erreurApi(e, "Renommage impossible pour le moment."),
  });
  const supprimer = useMutation({
    mutationFn: ({ id }) => supprimerFavoriItineraire(id),
    onSuccess: (_, { i }) => { setErreurFavori(null); majProposition(i, { favori_id: null, nom: null }); setASupprimer(null); invaliderFavoris(); },
    onError: (e) => { setASupprimer(null); erreurApi(e, "Suppression impossible pour le moment."); },
  });
  const ouvrir = useMutation({
    mutationFn: getFavoriItineraire,
    onSuccess: (f) => {
      afficher({
        propositions: [{
          points: f.points, terrains: f.terrains, repartition: f.repartition, etapes: f.etapes,
          distance_km: f.distance_km, dplus_m: f.dplus_m, depart: f.depart, favori_id: f.id, nom: f.nom,
        }],
        boucle: f.boucle, sport: f.sport, distance: null, dplus: null, rayon: 0, sentiers: false, source: null, favori: true,
      });
      setEssai(0);
    },
    onError: (e) => erreurApi(e, "Ouverture impossible pour le moment."),
  });

  const enCours = demande.isPending;
  // Chrono pendant le calcul (quelques secondes, plus si le serveur public est chargé)
  const [secondes, setSecondes] = useState(0);
  useEffect(() => {
    if (!enCours) return;
    setSecondes(0);
    const id = setInterval(() => setSecondes((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [enCours]);
  const calcul = `Calcul des itinéraires… ${secondes} s`;
  const allure = resultat ? allures?.[resultat.sport] : null;
  const pointsChoisis = choisie != null ? affichees[choisie]?.points : null;
  const couleurChoisie = COULEURS[(choisie ?? 0) % COULEURS.length];
  const posCurseur = curseur != null && pointsChoisis?.[curseur] ? { pos: pointsChoisis[curseur], c: couleurChoisie } : null;
  const listeFavoris = tousFavoris ? favoris : favoris?.slice(0, 6);

  return (
    <Page titre="Itinéraires" sousTitre="Boucles et parcours GPX" large>
      <div ref={haut} className="scroll-mt-24" />
      {statut && !statut.disponible && (
        <div className="card p-4 text-[14px] text-label-2">
          Le calcul d'itinéraires n'est pas disponible pour le moment.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[340px_minmax(0,1fr)] md:items-start">
        {/* ── Recherche ── */}
        <div className={`space-y-5 ${vue === "resultats" ? "hidden md:block" : ""}`}>
          <div>
            <h2 className="entete-liste">Sport</h2>
            <div className="grid grid-cols-3 gap-2">
              {SPORTS.map(([k, l, e]) => (
                <button type="button" key={k} onClick={() => changerSport(k)}
                  className={`h-[58px] rounded-[12px] flex flex-col items-center justify-center gap-0.5 text-[13px] font-semibold transition active:scale-95 ${sport === k ? "bg-brand text-white" : "card text-label"}`}>
                  <span className="text-[18px] leading-5" aria-hidden>{e}</span>{l}
                </button>
              ))}
            </div>
          </div>

          <Segmente options={[["boucle", "Boucle"], ["ab", "Aller simple A → B"]]} valeur={boucle ? "boucle" : "ab"}
            onChange={(v) => { setBoucle(v === "boucle"); if (v === "boucle") setArrivee(null); }} className="w-full" />

          <ChoixPoint titre="Départ" cle="depart" gps point={depart} setPoint={setDepart}
            pointage={pointage} setPointage={setPointage} />
          {boucle && (
            <div>
              <h2 className="entete-liste">Départ jusqu'à</h2>
              <Segmente options={RAYONS} valeur={rayon} onChange={setRayon} className="w-full" />
              <p className="px-4 pt-1.5 text-[13px] text-label-2">
                {rayon === "0" ? "La boucle part du point choisi." : `La boucle peut partir jusqu'à ${rayon} km du point choisi, là où il y a le plus de chemins.`}
              </p>
            </div>
          )}
          {!boucle && (
            <ChoixPoint titre="Arrivée" cle="arrivee" point={arrivee} setPoint={setArrivee}
              pointage={pointage} setPointage={setPointage} proche={depart?.pos} />
          )}

          {boucle && (
            <div>
              <h2 className="entete-liste">Objectifs</h2>
              <div className="grid grid-cols-2 gap-3">
                <label className="card px-4 py-2.5 block">
                  <span className="block text-[12px] font-semibold text-label-2">Distance</span>
                  <span className="flex items-baseline gap-1">
                    <input inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} aria-label="Distance en km"
                      className="w-full min-w-0 bg-transparent font-rounded text-[24px] font-bold chiffres outline-none" />
                    <span className="text-[14px] text-label-2">km</span>
                  </span>
                </label>
                <label className="card px-4 py-2.5 block">
                  <span className="block text-[12px] font-semibold text-label-2">D+ visé</span>
                  <span className="flex items-baseline gap-1">
                    <input inputMode="numeric" value={dplus} onChange={(e) => setDplus(e.target.value.replace(/\D/g, ""))} aria-label="Dénivelé positif en mètres"
                      placeholder="libre" className="w-full min-w-0 bg-transparent font-rounded text-[24px] font-bold chiffres outline-none placeholder:text-label-3 placeholder:text-[17px]" />
                    <span className="text-[14px] text-label-2">m</span>
                  </span>
                </label>
              </div>
              <p className="px-4 pt-1.5 text-[13px] text-label-2">Le D+ dépend du relief autour du départ : les propositions s'en approchent sans garantie.</p>
            </div>
          )}

          {(AVEC_SENTIERS.includes(sport) || sport === "course") && (
            <div className="card py-0.5">
              {AVEC_SENTIERS.includes(sport) && (
                <div className="ligne">
                  <span className="flex-1 text-[16px] md:text-[15px]">Privilégier les sentiers</span>
                  <Interrupteur actif={sentiers} onChange={setSentiers} label="Privilégier les sentiers" />
                </div>
              )}
              {sport === "course" && (
                <div className="ligne">
                  <span className="flex-1 text-[16px] md:text-[15px]">Éviter les routes</span>
                  <Interrupteur actif={eviterRoutes} onChange={setEviterRoutes} label="Éviter les routes" />
                </div>
              )}
            </div>
          )}

          {HORS_BITUME.includes(sport) && (
            <p className="px-4 -mt-2 text-[13px] text-label-2">
              {{ vtt: "VTT", trail: "Trail", gravel: "Gravel", randonnee: "Rando" }[sport]} : chemins et sentiers d'abord, les tracés sur bitume passent en dernier.
            </p>
          )}

          {erreur && <p className="px-1 text-[14px] text-ios-red" role="alert">{erreur}</p>}
          <button type="button" onClick={() => lancer(0)} disabled={enCours} className="btn-primaire w-full">
            {enCours ? calcul : "Proposer des itinéraires"}
          </button>

          {favoris?.length > 0 && (
            <div>
              <h2 className="entete-liste">Mes parcours</h2>
              <div className="card py-0.5">
                {listeFavoris.map((f) => (
                  <button type="button" key={f.id} onClick={() => ouvrir.mutate(f.id)} disabled={ouvrir.isPending}
                    className="ligne w-full text-left" style={{ "--inset": "3rem" }}>
                    <span className="w-5 text-center text-[17px] shrink-0" aria-hidden>{SPORTS.find(([k]) => k === f.sport)?.[2] ?? "📍"}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] truncate">{f.nom}</span>
                      <span className="block text-[12px] text-label-2 chiffres">
                        {km(f.distance_km)} km · {f.dplus_m} m D+ · {f.boucle ? "boucle" : "aller simple"}
                      </span>
                    </span>
                    {ouvrir.isPending && ouvrir.variables === f.id
                      ? <span className="w-4 h-4 rounded-full border-2 border-label-3 border-t-brand animate-spin" aria-label="Ouverture" />
                      : <span className="text-[18px] text-label-3" aria-hidden>›</span>}
                  </button>
                ))}
              </div>
              {favoris.length > 6 && (
                <button type="button" onClick={() => setTousFavoris(!tousFavoris)} className="btn-texte px-4 pt-1.5 !text-[13px]">
                  {tousFavoris ? "Afficher moins" : `Afficher les ${favoris.length} parcours`}
                </button>
              )}
            </div>
          )}
          {vue === "recherche" && erreurFavori && <p className="px-1 text-[14px] text-ios-red md:hidden" role="alert">{erreurFavori}</p>}
        </div>

        {/* ── Carte et propositions ── */}
        <div className={`space-y-4 min-w-0 ${vue === "recherche" && !pointage ? "hidden md:block" : ""}`}>
          {vue === "resultats" && !edition && (
            <button type="button" onClick={() => setVue("recherche")} className="btn-texte md:hidden">
              ‹ Modifier la recherche
            </button>
          )}
          <div ref={zoneCarte} className="scroll-mt-16 md:scroll-mt-4">
            <Carte propositions={affichees} choisie={choisie} onChoisir={choisir} cadrage={resultat?.id}
              depart={resultat?.favori ? null : depart} arrivee={boucle && !resultat?.favori ? null : arrivee}
              pointage={pointage} onPoint={poser}
              edition={edition} couleurEdition={COULEURS[(edition?.i ?? 0) % COULEURS.length]} onOp={executer}
              traceSurvol={pointsChoisis} onSurvol={TACTILE ? null : setCurseur} curseur={posCurseur} />
          </div>

          {edition && traceStats && (
            <PanneauRetouche edition={edition} stats={traceStats} allure={allure}
              onAnnuler={annuler} onRevenir={revenir} onTerminer={terminer} />
          )}

          {resultat && (
            resultats.length ? (
              <div>
                <h2 className="entete-liste">
                  {resultat.favori ? "Parcours enregistré" : `${resultats.length} proposition${resultats.length > 1 ? "s" : ""}`}
                </h2>
                {!resultat.favori && HORS_BITUME.includes(resultat.sport) && Math.min(...resultats.map((r) => r.repartition?.bitume ?? 0)) > 30 && (
                  <p className="mb-2 rounded-[12px] bg-ios-orange/15 px-4 py-2.5 text-[13px] text-label">
                    Peu de chemins dans cette zone : toutes les boucles ont plus de 30 % de bitume.
                    {resultat.boucle && resultat.rayon < 15
                      ? "Élargis « Départ jusqu'à » ou place le départ plus près des sentiers avec « Sur la carte »."
                      : "Place le départ plus près des sentiers (parc, colline, lisière) avec « Sur la carte »."}
                  </p>
                )}
                <div className="card py-0.5">
                  {affichees.map((r, i) => (
                    <Proposition key={`${resultat.id}-${i}`} r={r} i={i} choisie={choisie} onChoisir={choisir}
                      sport={resultat.sport} distance={resultat.distance} dplus={resultat.dplus} boucle={resultat.boucle}
                      allure={allure} enRetouche={edition?.i === i}
                      modeProfil={modeProfil} setModeProfil={setModeProfil}
                      curseur={i === choisie ? curseur : null} onCurseur={setCurseur}
                      onModifier={() => commencer(i)}
                      onEnregistrer={() => enregistrer.mutate({ i, r })}
                      enregistrement={enregistrer.isPending && enregistrer.variables?.i === i}
                      renommage={renommage === i} onRenommer={(v) => setRenommage(v ? i : null)}
                      onNommer={(nom) => { setRenommage(null); renommer.mutate({ i, id: r.favori_id, nom }); }}
                      onSupprimer={() => setASupprimer(i)} />
                  ))}
                </div>
                {erreurFavori && <p className="px-4 pt-2 text-[13px] text-ios-red" role="alert">{erreurFavori}</p>}
                <div className="flex items-center justify-between gap-3 px-4 pt-2">
                  <p className="text-[12px] text-label-2">
                    {resultat.favori ? "Données © OpenStreetMap" : `Tracés ${resultat.source ?? "BRouter"} · données © OpenStreetMap`}
                  </p>
                  {!resultat.favori && (
                    <button type="button" onClick={() => lancer(essai + 1)} disabled={enCours} className="btn-texte shrink-0">
                      {enCours ? `Calcul… ${secondes} s` : "Autres propositions"}
                    </button>
                  )}
                </div>
                {allure && (
                  <p className="px-4 pt-1 text-[12px] text-label-2">
                    Temps estimé {allure.seances
                      ? `d'après tes ${allure.seances} dernières sorties ${BASES[allure.base] ?? ""}${allure.base !== resultat.sport && !(resultat.sport === "randonnee" && allure.base === "marche") ? " (allure ajustée)" : ""}`
                      : "sur une allure type, faute de sorties récentes"}
                    {" "}: 100 m de D+ comptent comme {allure.effort_dplus > 1 ? "1,5 km" : "1 km"}.
                  </p>
                )}
              </div>
            ) : (
              <p className="card p-4 text-[14px] text-label-2">Aucun itinéraire trouvé. Essaie un autre point de départ ou une autre distance.</p>
            )
          )}
          {!resultat && (
            <p className="hidden md:block px-1 text-[13px] text-label-2">
              Choisis un départ, la distance et le D+, puis lance la recherche : 3 à 4 propositions s'affichent ici, chacune exportable en GPX et modifiable à la main.
            </p>
          )}
          {vue === "resultats" && erreur && <p className="px-1 text-[14px] text-ios-red md:hidden" role="alert">{erreur}</p>}
        </div>
      </div>

      <ConfirmDialog open={aSupprimer != null} title="Supprimer ce parcours ?"
        message={aSupprimer != null ? `« ${resultats[aSupprimer]?.nom ?? "Parcours"} » sera retiré de tes parcours enregistrés. Le tracé reste affiché tant que tu ne quittes pas la page.` : ""}
        confirmLabel="Supprimer" cancelLabel="Annuler" danger pending={supprimer.isPending}
        onConfirm={() => supprimer.mutate({ i: aSupprimer, id: resultats[aSupprimer]?.favori_id })}
        onCancel={() => setASupprimer(null)} />
    </Page>
  );
}
