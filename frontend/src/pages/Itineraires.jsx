import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import Page from "../components/Page";
import { Bascule, chargerMaplibre } from "../components/CarteTrace";
import { Interrupteur, Segmente } from "../components/ui";
import { getItineraires, proposerItineraires } from "../api";
import { nombre } from "../carnet";

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

// Fonds gratuits et sans clé : OSM, OpenTopoMap (courbes de niveau), Plan IGN (Géoplateforme)
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
  },
  layers: [
    { id: "osm", type: "raster", source: "osm" },
    { id: "topo", type: "raster", source: "topo", layout: { visibility: "none" } },
    { id: "ign", type: "raster", source: "ign", layout: { visibility: "none" } },
  ],
};

// ── Calculs sur un tracé ([lat, lon, alt]) ─────────────────────────────────
const RAD = Math.PI / 180;
function distM(a, b) {
  const x = (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD), y = (b[0] - a[0]) * RAD;
  return 6371000 * Math.hypot(x, y);
}
function profil(points) {
  let d = 0;
  return points.map((p, i) => { if (i) d += distM(points[i - 1], p); return [d / 1000, p[2] ?? 0]; });
}
const km = (v) => nombre(v, v < 10 ? 2 : 1);

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
  const nomSport = SPORTS.find(([k]) => k === sport)?.[1] ?? "Parcours";
  const titre = `${boucle ? "Boucle" : "Parcours"} ${nomSport.toLowerCase()} ${km(r.distance_km)} km ${r.dplus_m} m D+`;
  const nom = `carnet-${sport}-${String(r.distance_km).replace(".", ",")}km-${r.dplus_m}m.gpx`;
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
    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-label-2">
      {presents.map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <svg width={20} height={10} aria-hidden><Trait type={t} d="M1,5 L19,5" /></svg>
          {TERRAINS[t][0]}
        </span>
      ))}
    </p>
  );
}

function Profil({ points, couleur, hauteur = 26, detail = false, terrains }) {
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
  const pas = Math.max(1, Math.floor(prof.length / 400));
  const pts = prof.filter((_, i) => i % pas === 0 || i === prof.length - 1)
    .map(([d, a]) => [d, (d / total) * L, H - marge - ((a - min) / ecart) * (H - 2 * marge)]);
  const chemin = (liste) => liste.map(([, x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  const ligne = chemin(pts);

  // Découpe de la courbe par terrain (kilomètres BRouter recalés sur la distance du profil)
  const troncons = useMemo(() => {
    if (!detail || !terrains?.length) return [];
    const k = total / (terrains.at(-1)[1] || total);
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
  }, [detail, terrains, L, H, points]);

  return (
    <div ref={boite}>
      <svg viewBox={`0 0 ${L} ${H}`} className="w-full block" style={{ height: H }}
        role={troncons.length ? "img" : undefined} aria-hidden={troncons.length ? undefined : true}
        aria-label={troncons.length ? "Profil d'altitude et terrain le long du parcours" : undefined}>
        <path d={`M0,${H} L${ligne} L${L},${H} Z`} fill={couleur} fillOpacity={0.15} />
        {troncons.length ? troncons.map(({ a, b, t, d }, j) => (
          <g key={j}>
            <title>{`${TERRAINS[t]?.[0] ?? t} · ${km(a)} → ${km(b)} km`}</title>
            <Trait type={t} d={d} />
          </g>
        )) : <path d={`M${ligne}`} fill="none" stroke={couleur} strokeWidth={1.6} />}
      </svg>
      {detail && (
        <p className="flex justify-between text-[11px] text-label-2 chiffres mt-0.5">
          <span>{Math.round(min)} m</span><span>alt. max {Math.round(max)} m</span><span>{km(total)} km</span>
        </p>
      )}
      {troncons.length > 0 && <LegendeTerrain terrains={terrains} />}
    </div>
  );
}

// ── Carte ──────────────────────────────────────────────────────────────────
function Carte({ propositions, choisie, onChoisir, depart, arrivee, pointage, onPoint }) {
  const conteneur = useRef(null);
  const carte = useRef(null);
  const [prete, setPrete] = useState(false);
  const [fond, setFond] = useState("topo");
  const pointageRef = useRef(pointage);
  pointageRef.current = pointage;
  const onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;
  const onChoisirRef = useRef(onChoisir);
  onChoisirRef.current = onChoisir;

  useEffect(() => {
    let annule = false;
    (async () => {
      const maplibregl = await chargerMaplibre();
      if (annule || !conteneur.current) return;
      const centre = depart ? [depart.pos[1], depart.pos[0]] : LYON;
      const m = new maplibregl.Map({ container: conteneur.current, style: STYLE, center: centre, zoom: depart ? 13 : 11,
        attributionControl: { compact: true } });
      carte.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.on("load", () => {
        const vide = { type: "FeatureCollection", features: [] };
        m.addSource("routes", { type: "geojson", data: vide });
        m.addLayer({ id: "routes-bord", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#fff", "line-width": ["case", ["get", "sel"], 7, 4.5], "line-opacity": ["case", ["get", "sel"], 1, 0.6] } });
        m.addLayer({ id: "routes", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["case", ["get", "sel"], 1, 0] },
          paint: { "line-color": ["get", "c"], "line-width": ["case", ["get", "sel"], 4.5, 2.5], "line-opacity": ["case", ["get", "sel"], 1, 0.55] } });
        m.addSource("points", { type: "geojson", data: vide });
        m.addLayer({ id: "points", type: "circle", source: "points",
          paint: { "circle-radius": 7, "circle-color": ["get", "c"], "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
        m.on("click", "routes", (e) => { if (!pointageRef.current) onChoisirRef.current(e.features[0].properties.i); });
        m.on("mouseenter", "routes", () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "routes", () => { m.getCanvas().style.cursor = ""; });
        m.on("click", (e) => { if (pointageRef.current) onPointRef.current([e.lngLat.lat, e.lngLat.lng]); });
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
    if (!prete) return;
    for (const f of ["osm", "topo", "ign"]) m.setLayoutProperty(f, "visibility", f === fond ? "visible" : "none");
  }, [fond, prete]);

  useEffect(() => {
    if (prete) carte.current.getCanvas().style.cursor = pointage ? "crosshair" : "";
  }, [pointage, prete]);

  // Points de départ et d'arrivée
  useEffect(() => {
    const m = carte.current;
    if (!prete) return;
    const f = [[depart, "#34C759"], [arrivee, "#1C1C1E"]].filter(([p]) => p)
      .map(([p, c]) => ({ type: "Feature", properties: { c }, geometry: { type: "Point", coordinates: [p.pos[1], p.pos[0]] } }));
    // Départ déplacé vers une zone de chemins : un point à la couleur de la proposition
    (propositions ?? []).forEach((r, i) => {
      if (r.depart && r.approche_km >= 0.3) {
        f.push({ type: "Feature", properties: { c: COULEURS[i % COULEURS.length] }, geometry: { type: "Point", coordinates: [r.depart[1], r.depart[0]] } });
      }
    });
    m.getSource("points").setData({ type: "FeatureCollection", features: f });
    if (depart && !propositions?.length) m.easeTo({ center: [depart.pos[1], depart.pos[0]], zoom: Math.max(m.getZoom(), 12.5) });
  }, [depart, arrivee, propositions, prete]);

  // Tracés proposés
  useEffect(() => {
    const m = carte.current;
    if (!prete) return;
    const f = (propositions ?? []).map((r, i) => ({
      type: "Feature", properties: { i, c: COULEURS[i % COULEURS.length], sel: i === choisie },
      geometry: { type: "LineString", coordinates: r.points.map((p) => [p[1], p[0]]) },
    }));
    m.getSource("routes").setData({ type: "FeatureCollection", features: f });
  }, [propositions, choisie, prete]);

  // Cadrage sur le tracé choisi (ou sur toutes les propositions)
  useEffect(() => {
    const m = carte.current;
    if (!prete || !propositions?.length) return;
    const pts = (choisie != null ? [propositions[choisie]] : propositions).flatMap((r) => r.points);
    const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40, duration: 700 });
  }, [propositions, choisie, prete]);

  return (
    <div className="relative h-[300px] md:h-[440px] rounded-[14px] overflow-hidden bg-remplissage">
      <div ref={conteneur} className="w-full h-full" />
      <div className="absolute top-2 left-2">
        <Bascule options={[["osm", "OSM"], ["topo", "Topo"], ["ign", "IGN"]]} valeur={fond} onChange={setFond} />
      </div>
      {pointage && (
        <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/65 backdrop-blur px-3 py-1.5 text-[13px] font-semibold text-white whitespace-nowrap">
          Touche la carte pour placer {pointage === "depart" ? "le départ" : "l'arrivée"}
        </p>
      )}
    </div>
  );
}

// ── Proposition ────────────────────────────────────────────────────────────
function Pastille({ r, distance, dplus, boucle }) {
  const pastille = "inline-flex items-center h-[20px] px-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap";
  if (!boucle) return null;
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

function Proposition({ r, i, choisie, onChoisir, sport, distance, dplus, boucle }) {
  const couleur = COULEURS[i % COULEURS.length];
  const sel = i === choisie;
  return (
    <div className={`ligne !items-stretch flex-col !gap-1.5 !py-3 ${sel ? "rounded-[12px]" : ""}`}
      style={sel ? { boxShadow: `inset 0 0 0 2px ${couleur}` } : undefined}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onChoisir(sel ? null : i)} className="flex-1 min-w-0 flex items-start gap-3 text-left">
          <span className="w-3 h-3 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: couleur }} aria-hidden />
          <span className="flex-1 min-w-0">
            <span className="block text-[16px] font-semibold chiffres">{km(r.distance_km)} km · {r.dplus_m} m D+</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <Pastille r={r} distance={distance} dplus={dplus} boucle={boucle} />
              {r.approche_km >= 0.3 && (
                <span className="inline-flex items-center h-[20px] px-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap bg-remplissage text-label-2">
                  Départ à {km(r.approche_km)} km
                </span>
              )}
              <Repartition r={r} sport={sport} />
            </span>
          </span>
        </button>
        <BoutonGpx r={r} i={i} sport={sport} boucle={boucle} />
      </div>
      <button type="button" onClick={() => onChoisir(sel ? null : i)} className="pl-6 text-left" aria-hidden tabIndex={-1}>
        <Profil points={r.points} couleur={couleur} hauteur={sel ? 70 : 26} detail={sel} terrains={r.terrains} />
      </button>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Itineraires() {
  const [params] = useSearchParams();
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
  const haut = useRef(null);

  const { data: statut } = useQuery({ queryKey: ["itineraires"], queryFn: getItineraires, staleTime: 300_000 });

  const changerSport = (s) => {
    setSport(s);
    if (!params.get("distance")) { setDistance(String(DEFAUTS[s][0])); setDplus(String(DEFAUTS[s][1])); }
    setSentiers(s === "course");
    setRayon(rayonDefaut(s));
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
      setResultat({ ...r, boucle, distance: boucle ? Number(String(distance).replace(",", ".")) : null, dplus: dplus === "" ? null : Number(dplus), sport, rayon: boucle ? Number(rayon) : 0 });
      setChoisie(r.propositions.length ? 0 : null);
      setEssai(n);
      setVue("resultats");
      haut.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const resultats = resultat?.propositions ?? [];

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
        </div>

        {/* ── Carte et propositions ── */}
        <div className={`space-y-4 min-w-0 ${vue === "recherche" && !pointage ? "hidden md:block" : ""}`}>
          {vue === "resultats" && (
            <button type="button" onClick={() => setVue("recherche")} className="btn-texte md:hidden">
              ‹ Modifier la recherche
            </button>
          )}
          <Carte propositions={resultats} choisie={choisie} onChoisir={setChoisie}
            depart={depart} arrivee={boucle ? null : arrivee} pointage={pointage} onPoint={poser} />

          {resultat && (
            resultats.length ? (
              <div>
                <h2 className="entete-liste">{resultats.length} proposition{resultats.length > 1 ? "s" : ""}</h2>
                {HORS_BITUME.includes(resultat.sport) && Math.min(...resultats.map((r) => r.repartition?.bitume ?? 0)) > 30 && (
                  <p className="mb-2 rounded-[12px] bg-ios-orange/15 px-4 py-2.5 text-[13px] text-label">
                    Peu de chemins dans cette zone : toutes les boucles ont plus de 30 % de bitume.
                    {resultat.boucle && resultat.rayon < 15
                      ? "Élargis « Départ jusqu'à » ou place le départ plus près des sentiers avec « Sur la carte »."
                      : "Place le départ plus près des sentiers (parc, colline, lisière) avec « Sur la carte »."}
                  </p>
                )}
                <div className="card py-0.5">
                  {resultats.map((r, i) => (
                    <Proposition key={`${essai}-${i}`} r={r} i={i} choisie={choisie} onChoisir={setChoisie}
                      sport={resultat.sport} distance={resultat.distance} dplus={resultat.dplus} boucle={resultat.boucle} />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 px-4 pt-2">
                  <p className="text-[12px] text-label-2">Tracés {resultat.source ?? "BRouter"} · données © OpenStreetMap</p>
                  <button type="button" onClick={() => lancer(essai + 1)} disabled={enCours} className="btn-texte shrink-0">
                    {enCours ? `Calcul… ${secondes} s` : "Autres propositions"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="card p-4 text-[14px] text-label-2">Aucun itinéraire trouvé. Essaie un autre point de départ ou une autre distance.</p>
            )
          )}
          {!resultat && (
            <p className="hidden md:block px-1 text-[13px] text-label-2">
              Choisis un départ, la distance et le D+, puis lance la recherche : 3 à 4 propositions s'affichent ici, chacune exportable en GPX.
            </p>
          )}
          {vue === "resultats" && erreur && <p className="px-1 text-[14px] text-ios-red md:hidden" role="alert">{erreur}</p>}
        </div>
      </div>
    </Page>
  );
}
