import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCarteTraces } from "../api";
import { STYLE, Bascule } from "./CarteTrace";

const SPORTS = [["course", "Course"], ["trail", "Trail"], ["velo", "Vélo"]];
// Paliers de passages (bornes basses renvoyées par l'API) → couleur du trait
const PALIERS = [
  [1, "1", "#64D2FF"], [2, "2", "#30D158"], [3, "3–4", "#FFD60A"], [5, "5–9", "#FF9F0A"],
  [10, "10–19", "#FF453A"], [20, "20–49", "#FF2DAA"], [50, "50+", "#8E5CFF"],
];
const COULEUR = ["match", ["get", "n"], ...PALIERS.flatMap(([n, , c]) => [n, c]), "#64D2FF"];
const LARGEUR = ["interpolate", ["linear"], ["zoom"], 9, 1.2, 13, 2.2, 16, 4];
const LARGEUR_BORD = ["interpolate", ["linear"], ["zoom"], 9, 2.4, 13, 3.6, 16, 5.5];

// Tous les tracés sur une carte, colorés selon le nombre de passages au même endroit.
export default function CartePassages() {
  const cadre = useRef(null);
  const conteneur = useRef(null);
  const carte = useRef(null);
  const [visible, setVisible] = useState(false);
  const [prete, setPrete] = useState(false);
  const [fond, setFond] = useState("plan");
  const [sports, setSports] = useState(SPORTS.map(([k]) => k));
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["carte-traces", sports], queryFn: () => getCarteTraces(sports),
    enabled: visible, staleTime: 10 * 60 * 1000, placeholderData: (prec) => prec,
  });

  // Ne charge la carte (≈ 300 Ko) que lorsqu'elle arrive à l'écran
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
          <p className="absolute inset-0 grid place-items-center text-[13px] text-label-2">Chargement des tracés…</p>
        )}
        <div className="absolute top-2 left-2">
          <Bascule options={[["plan", "Plan"], ["satellite", "Satellite"]]} valeur={fond} onChange={setFond} />
        </div>
        {isFetching && !isLoading && (
          <span className="absolute bottom-2 left-2 rounded-[8px] bg-black/55 backdrop-blur px-2 py-1 text-[12px] font-semibold text-white">
            Mise à jour…
          </span>
        )}
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
