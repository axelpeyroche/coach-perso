import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTrace } from "../api";

// Fonds gratuits, sans clé : plan OSM, imagerie Esri, relief AWS (Terrarium) pour la 3D.
const STYLE = {
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

function Bascule({ options, valeur, onChange }) {
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

// Carte du tracé GPS d'une activité : plan ou satellite, 2D ou 3D (relief).
export default function CarteTrace({ activiteId }) {
  const conteneur = useRef(null);
  const carte = useRef(null);
  const [prete, setPrete] = useState(false);
  const [fond, setFond] = useState("plan");
  const [vue, setVue] = useState("2d");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["trace", activiteId], queryFn: () => getTrace(activiteId), staleTime: Infinity,
  });

  useEffect(() => {
    if (!data?.points?.length || !conteneur.current) return;
    let annule = false;
    (async () => {
      const [{ default: maplibregl }] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
      if (annule) return;
      const coords = data.points.map((p) => [p[1], p[0]]);
      const bornes = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
      const m = new maplibregl.Map({
        container: conteneur.current, style: STYLE, bounds: bornes,
        fitBoundsOptions: { padding: 30 }, maxPitch: 75, attributionControl: { compact: true },
      });
      carte.current = m;
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      m.addControl(new maplibregl.FullscreenControl(), "top-right");
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
        setPrete(true);
      });
    })();
    return () => { annule = true; carte.current?.remove(); carte.current = null; setPrete(false); };
  }, [data]);

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
      m.easeTo({ pitch: 60, duration: 800 });
    } else {
      m.setTerrain(null);
      m.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
  }, [vue, prete]);

  if (isError) return null;
  return (
    <div className="space-y-1.5">
      <div className="relative h-64 rounded-[14px] overflow-hidden bg-remplissage">
        <div ref={conteneur} className="absolute inset-0" />
        {isLoading && <p className="absolute inset-0 grid place-items-center text-[13px] text-label-2">Chargement du tracé…</p>}
        <div className="absolute top-2 left-2 flex flex-col gap-1.5 items-start">
          <Bascule options={[["plan", "Plan"], ["satellite", "Satellite"]]} valeur={fond} onChange={setFond} />
          <Bascule options={[["2d", "2D"], ["3d", "3D"]]} valeur={vue} onChange={setVue} />
        </div>
      </div>
      {data && (
        <p className="text-[12px] text-label-2 text-center chiffres">
          Tracé GPS · {data.distance_km?.toFixed(2).replace(".", ",")} km
          {data.dplus_m != null && ` · ${data.dplus_m} m D+`}
        </p>
      )}
    </div>
  );
}
