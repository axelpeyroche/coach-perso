import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCarteTraces } from "../api";
import { STYLE, Bascule } from "./CarteTrace";
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
const LYON = [[4.77, 45.70], [4.92, 45.81]]; // Lyon et Villeurbanne

// Tous les tracés sur une carte, colorés selon le nombre de passages au même endroit.
export default function CartePassages() {
  const cadre = useRef(null);
  const conteneur = useRef(null);
  const carte = useRef(null);
  const [visible, setVisible] = useState(false);
  const [prete, setPrete] = useState(false);
  const [fond, setFond] = useState("satellite");
  const [sports, setSports] = useState(PAR_DEFAUT);
  // Tous les tracés sont chargés une fois ; changer de filtre ne fait que recalculer ici.
  const { data: brut, isLoading, isError } = useQuery({
    queryKey: ["carte-traces"], queryFn: getCarteTraces, enabled: visible, staleTime: 10 * 60 * 1000,
  });
  const traces = useMemo(() => (brut ? decoderTraces(brut.traces) : null), [brut]);
  const data = useMemo(() => {
    if (!traces) return null;
    const idx = brut.meta.flatMap(([sport], i) => (sports.includes(sport) ? [i] : []));
    return { ...calculerPassages(idx.map((i) => traces[i])), nb_traces: idx.length,
      km: Math.round(idx.reduce((t, i) => t + brut.meta[i][1], 0)) };
  }, [traces, brut, sports]);

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
      const [{ default: maplibregl }] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
      if (annule) return;
      const m = new maplibregl.Map({
        container: conteneur.current, style: STYLE, center: [2.5, 46.5], zoom: 4.5,
        attributionControl: { compact: true }, cooperativeGestures: true,
        locale: {
          "CooperativeGesturesHandler.WindowsHelpText": "Ctrl + molette pour zoomer",
          "CooperativeGesturesHandler.MacHelpText": "⌘ + molette pour zoomer",
          "CooperativeGesturesHandler.MobileHelpText": "Deux doigts pour déplacer la carte",
        },
      });
      carte.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.addControl(new maplibregl.FullscreenControl({ container: cadre.current }), "top-right");
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

  // Données : on ne recadre qu'au premier affichage, pas à chaque changement de filtre
  const cadree = useRef(false);
  useEffect(() => {
    const m = carte.current;
    if (!prete || !m || !data) return;
    m.getSource("passages").setData({ type: "FeatureCollection", features: data.features });
    if (!cadree.current && data.vue) {
      m.fitBounds(data.vue, { padding: 20, duration: 0 });
      cadree.current = true;
    }
  }, [data, prete]);

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
      </div>
      <div ref={cadre} className="relative h-80 lg:h-[26rem] rounded-[14px] overflow-hidden bg-remplissage">
        <div ref={conteneur} className="w-full h-full" />
        {(isLoading || !visible) && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <span className="rounded-[8px] bg-black/60 backdrop-blur px-2.5 py-1 text-[13px] font-semibold text-white">Chargement des tracés…</span>
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <Bascule options={[["plan", "Plan"], ["satellite", "Satellite"]]} valeur={fond} onChange={setFond} />
          <button type="button" onClick={() => carte.current?.fitBounds(LYON, { padding: 10, duration: 800 })}
            className="flex items-center gap-1 rounded-[9px] bg-black/55 backdrop-blur px-2.5 py-1 text-[12px] font-semibold text-white">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" fill="currentColor" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            Lyon
          </button>
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
          {data.nb_traces} sorties · {data.km.toLocaleString("fr-FR")} km · jusqu'à {data.max} passages au même endroit
        </p>
      )}
    </div>
  );
}
