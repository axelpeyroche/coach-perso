import { useCallback, useEffect, useRef, useState } from "react";
import { Bascule, chargerMaplibre, controleRotation, tournerALaSouris } from "./CarteTrace";
import { nombre } from "../carnet";
import * as T from "../pages/itineraireTrace";
import { TERRAINS } from "./ProfilAltitude";

// Carte des itinéraires (propositions, retouche, création) et outils partagés : sports, GPX

export const SPORTS = [
  ["course", "Course", "🏃"], ["trail", "Trail", "⛰️"], ["randonnee", "Rando", "🥾"],
  ["velo", "Vélo route", "🚴"], ["gravel", "Gravel", "🚵"], ["vtt", "VTT", "🚵‍♂️"],
];
export const TYPE_GPX = { course: "running", trail: "trail_running", randonnee: "hiking", velo: "cycling", gravel: "cycling", vtt: "mountain_biking" };
export const COULEURS = ["#FF6B35", "#7F77DD", "#1D9E75", "#E8338A"];
export const LYON = [4.835, 45.76];
export const FONDS = [["osm", "Plan"], ["topo", "Topo"], ["ign", "IGN"], ["satellite", "Satellite"]];
// La carte s'ouvre toujours en satellite, à plat ; les anciens choix mémorisés sont oubliés
try { localStorage.removeItem("itineraires-fond"); localStorage.removeItem("itineraires-vue"); } catch { /* stockage indisponible */ }
export const TACTILE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

// Fonds gratuits et sans clé : OSM, OpenTopoMap (courbes de niveau), Plan IGN (Géoplateforme),
// imagerie Esri ; relief AWS (Terrarium) pour la 3D
export const STYLE = {
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
    // Pentes de plus de 30° (IGN, France seulement) : repérer les passages raides ou exposés
    pentes: {
      type: "raster", tileSize: 256, maxzoom: 17,
      tiles: ["https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"],
      attribution: "© IGN",
    },
    relief: {
      type: "raster-dem", tileSize: 256, maxzoom: 15, encoding: "terrarium",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    },
  },
  layers: [
    { id: "osm", type: "raster", source: "osm", layout: { visibility: "none" } },
    { id: "topo", type: "raster", source: "topo", layout: { visibility: "none" } },
    { id: "ign", type: "raster", source: "ign", layout: { visibility: "none" } },
    { id: "satellite", type: "raster", source: "satellite" },
    { id: "pentes", type: "raster", source: "pentes", layout: { visibility: "none" }, paint: { "raster-opacity": 0.6 } },
  ],
};

// ── Calculs sur un tracé ([lat, lon, alt]) ─────────────────────────────────
export const km = (v) => nombre(v, v < 10 ? 2 : 1);
export const nomSport = (s) => SPORTS.find(([k]) => k === s)?.[1] ?? "Parcours";

export function gpx(r, sport, titre) {
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
export function telecharger(r, sport, boucle) {
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

// ── Carte ──────────────────────────────────────────────────────────────────
// Couleur du tracé selon le terrain (sans terrain connu : orange de l'appli)
export const COULEUR_TERRAIN = (t) => TERRAINS[t]?.[1] ?? "#FF6B35";
// Morceaux d'un segment de même terrain : [[points], type]
function morceauxTerrain(s) {
  const res = [];
  for (let i = 0; i < s.pts.length - 1; i++) {
    const t = s.ty[i] ?? null;
    if (res.length && res.at(-1)[1] === t) res.at(-1)[0].push(s.pts[i + 1]);
    else res.push([[s.pts[i], s.pts[i + 1]], t]);
  }
  return res.length ? res : [[s.pts, s.ty[0] ?? null]];
}

// ── Récap partagé (création, parcours enregistrés) ──
const SURFACES = ["sentier", "chemin", "bitume", "hors"];
const LIBELLES = { sentier: "sentier", chemin: "chemin", bitume: "bitume", hors: "hors sentier" };

export function Chiffre({ titre, valeur, unite }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.02em] text-label-2">{titre}</p>
      <p className="text-[19px] md:text-[21px] font-semibold leading-tight chiffres truncate">
        {valeur}<span className="text-[12px] font-medium text-label-2 ml-0.5">{unite}</span>
      </p>
    </div>
  );
}

export function BarreSurfaces({ repartition }) {
  if (!repartition) return null;
  const parts = SURFACES.map((t) => [t, repartition[t] ?? 0]).filter(([, v]) => v > 0);
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 rounded-full overflow-hidden bg-remplissage" aria-hidden>
        {parts.map(([t, v]) => <span key={t} style={{ width: `${v}%`, background: TERRAINS[t][1] }} />)}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-label-2 chiffres">
        {parts.map(([t, v]) => (
          <span key={t} className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: TERRAINS[t][1] }} aria-hidden />{v} % {LIBELLES[t]}
          </span>
        ))}
      </p>
    </div>
  );
}

export const VIDE = { type: "FeatureCollection", features: [] };
export const ligneGeo = (pts, properties = {}) => ({ type: "Feature", properties, geometry: { type: "LineString", coordinates: pts.map((p) => [p[1], p[0]]) } });
export const pointGeo = (p, properties = {}) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: [p[1], p[0]] } });
export const collection = (features) => ({ type: "FeatureCollection", features });

export function Carte({ propositions, choisie, onChoisir, depart, arrivee, pointage, onPoint, cadrage,
  edition, couleurEdition, onOp, traceSurvol, onSurvol, curseur, centre, pentesIgn, cadrageEdition }) {
  const conteneur = useRef(null);
  const carte = useRef(null);
  const libre = useRef(null);
  const popup = useRef(null);
  const cadrer = useRef(() => {});
  const [prete, setPrete] = useState(false);
  const [fond, setFond] = useState("satellite");
  const [vue, setVue] = useState("2d");
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
    const masque = (k) => ap.masques.includes(k);
    // Création : le tracé prend la couleur du terrain, les tronçons en ligne droite sont en tirets
    m.getSource("edit-segs").setData(collection(ed.surface
      ? ed.e.segs.flatMap((s, k) => morceauxTerrain(s).map(([pts, t]) =>
        ligneGeo(pts, { k, c: COULEUR_TERRAIN(t), masque: masque(k) || !!s.provisoire, droite: s.mode === "droite" })))
      : ed.e.segs.map((s, k) => ligneGeo(s.pts, { k, c, masque: masque(k) }))));
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
      const debut = depart ? [depart.pos[1], depart.pos[0]] : centre ? [centre[1], centre[0]] : LYON;
      const m = new maplibregl.Map({ container: conteneur.current, style: STYLE, center: debut, zoom: depart || centre ? 13 : 11,
        maxPitch: 75, attributionControl: { compact: true } });
      carte.current = m;
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      m.addControl(controleRotation(null, () => cadrer.current()), "top-right");
      tournerALaSouris(m, conteneur.current);
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
        const plein = ["!=", ["get", "droite"], true];
        m.addLayer({ id: "edit-segs", type: "line", source: "edit-segs", layout: rond, filter: plein,
          paint: { "line-color": ["get", "c"], "line-width": 4.5, "line-opacity": ["case", ["get", "masque"], 0.3, 1] } });
        m.addLayer({ id: "edit-droites", type: "line", source: "edit-segs", layout: { "line-join": "round" }, filter: ["!", plein],
          paint: { "line-color": ["get", "c"], "line-width": 4.5, "line-dasharray": [1.6, 1.2], "line-opacity": ["case", ["get", "masque"], 0.3, 1] } });
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
          if ((props.current.edition.retirable ?? T.retirable)(e, k)) {
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
          // Clic droit ou Ctrl + glisser : la carte tourne, même depuis le tracé
          if (!touches && (e.originalEvent.button !== 0 || e.originalEvent.ctrlKey)) return;
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
  }, [fond, prete]);

  useEffect(() => {
    if (prete && carte.current) carte.current.setLayoutProperty("pentes", "visibility", pentesIgn ? "visible" : "none");
  }, [pentesIgn, prete]);

  // 3D : relief exagéré et carte inclinée ; en 2D, retour à plat et au nord
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
  // (aussi appelé par le bouton « Recentrer », d'où la référence à jour à chaque rendu)
  cadrer.current = () => {
    const m = carte.current;
    if (!m) return;
    const pts = propositions?.length ? (choisie != null ? [propositions[choisie]] : propositions).flatMap((r) => r.points)
      : props.current.edition?.e.segs.length ? props.current.edition.e.segs.flatMap((s) => s.pts)
      : [depart?.pos, arrivee?.pos].filter(Boolean);
    if (!pts.length) return;
    const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 40, maxZoom: 15, pitch: m.getPitch(), bearing: m.getBearing(), duration: 700 });
  };
  useEffect(() => {
    if (prete && propositions?.length) cadrer.current();
  }, [cadrage, choisie, prete]);
  useEffect(() => {
    if (prete && cadrageEdition) cadrer.current();
  }, [cadrageEdition, prete]);

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
