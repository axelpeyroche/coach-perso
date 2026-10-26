import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCarteTraces } from "../api";
import { useAuth } from "../AuthContext";
import { STYLE, Bascule, chargerMaplibre, controleRotation, tournerALaSouris } from "./CarteTrace";
import { calculerPassages, decoderTraces } from "../passages";

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
  const data = useMemo(() => {
    if (!traces) return null;
    const idx = brut.meta.flatMap(([sport, , an], i) => (sports.includes(sport) && (annee == null || an === annee) ? [i] : []));
    return { ...calculerPassages(idx.map((i) => traces[i])), nb_traces: idx.length,
      km: Math.round(idx.reduce((t, i) => t + brut.meta[i][1], 0)) };
  }, [traces, brut, sports, annee]);
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
        maxPitch: 75, attributionControl: { compact: true }, cooperativeGestures: true,
        locale: {
          "CooperativeGesturesHandler.WindowsHelpText": "Ctrl + molette pour zoomer",
          "CooperativeGesturesHandler.MacHelpText": "⌘ + molette pour zoomer",
          "CooperativeGesturesHandler.MobileHelpText": "Deux doigts pour déplacer la carte",
        },
      });
      carte.current = m;
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      m.addControl(controleRotation(), "top-right");
      tournerALaSouris(m, conteneur.current);
      // iPhone : pas de plein écran pour un élément → « pseudo » plein écran (CSS)
      const pseudo = !cadre.current.requestFullscreen && !cadre.current.webkitRequestFullscreen;
      m.addControl(new maplibregl.FullscreenControl({ container: cadre.current, pseudo }), "top-right");
      m.on("load", () => {
        m.addSource("passages", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "passages-bord", type: "line", source: "passages",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#000", "line-opacity": 0.35, "line-width": LARGEUR_BORD } });
        m.addLayer({ id: "passages", type: "line", source: "passages",
          layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "n"] },
          paint: { "line-color": COULEUR, "line-width": LARGEUR } });
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
      {data && (
        <p className="px-1 text-[12px] text-label-2 chiffres">
          {data.nb_traces} sortie{data.nb_traces > 1 ? "s" : ""} · {data.km.toLocaleString("fr-FR")} km · jusqu'à {data.max} passages au même endroit
        </p>
      )}
    </div>
  );
}
