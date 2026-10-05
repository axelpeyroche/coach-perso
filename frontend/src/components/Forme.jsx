import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import Card from "./Card";
import StatTile from "./StatTile";
import { getMesures } from "../api";
import { fmtDate, nombre } from "../carnet";

// sens = 1 si une hausse est bon signe, -1 si une baisse l'est (FC au repos) ;
// seuil = écart 7 j / 28 j au-delà duquel on alerte
const META = {
  fc_repos: { couleur: "#ef4444", tuile: "red", sens: -1, seuil: 2 },
  vfc: { couleur: "#10b981", tuile: "green", sens: 1, seuil: 5 },
  vo2max: { couleur: "#6366f1", tuile: "blue", sens: 1, seuil: 1 },
};

export function useMesures() {
  return useQuery({ queryKey: ["mesures"], queryFn: () => getMesures(365) });
}

function ecart(m) {
  if (!m?.moy_7j || !m?.moy_28j) return null;
  const d = m.moy_7j - m.moy_28j;
  return { d, bon: d * META[m.cle].sens > -META[m.cle].seuil };
}

const avecCles = (data) =>
  data ? Object.keys(META).filter((k) => data[k]?.points?.length).map((k) => ({ cle: k, ...data[k] })) : [];

// Tuiles compactes (accueil) : dernière valeur + tendance 7 j vs 28 j
export function FormeTuiles() {
  const { data } = useMesures();
  const mesures = avecCles(data);
  if (!mesures.length) return null;
  return (
    <div className="grid grid-cols-3 gap-3">
      {mesures.map((m) => {
        const e = ecart(m);
        return (
          <StatTile key={m.cle} label={m.label} color={META[m.cle].tuile}
            value={`${nombre(m.derniere.valeur, m.cle === "vo2max" ? 1 : 0)} ${m.unite === "ml/kg/min" ? "" : m.unite}`}
            sub={e ? `${e.d > 0 ? "▲" : e.d < 0 ? "▼" : "="} ${nombre(Math.abs(e.d))} vs 28 j${e.bon ? "" : " ⚠️"}` : fmtDate(m.derniere.jour)} />
        );
      })}
    </div>
  );
}

const axe = { fontSize: 11, fill: "#9ca3af" };
const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: "none", fontSize: 12, background: "rgba(17,24,39,0.9)", color: "#fff" },
  labelStyle: { color: "#d1d5db" },
};

function Courbe({ m }) {
  // valeur du jour + moyenne glissante 7 points pour lisser le bruit quotidien
  const pts = useMemo(() => m.points.map((p, i, arr) => {
    const fen = arr.slice(Math.max(0, i - 6), i + 1);
    return { ...p, label: fmtDate(p.jour, { day: "numeric", month: "short" }), moy: +(fen.reduce((t, x) => t + x.valeur, 0) / fen.length).toFixed(1) };
  }), [m]);
  const c = META[m.cle].couleur;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{m.label}</p>
        <p className="text-xs text-gray-500">
          7 j : <b>{nombre(m.moy_7j)}</b> · 28 j : <b>{nombre(m.moy_28j)}</b> · 90 j : <b>{nombre(m.moy_90j)}</b> {m.unite}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={pts} margin={{ left: -20, right: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af33" vertical={false} />
          <XAxis dataKey="label" tick={axe} minTickGap={32} />
          <YAxis tick={axe} domain={["dataMin - 2", "dataMax + 2"]} allowDecimals={false} tickFormatter={(v) => Math.round(v)} />
          <Tooltip {...tooltipStyle} />
          <Line dataKey="valeur" name="Jour" stroke={`${c}66`} dot={false} strokeWidth={1} />
          <Line dataKey="moy" name="Moyenne 7 j" stroke={c} dot={false} strokeWidth={2.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Carte complète (stats) : une courbe par mesure
export function FormeGraphiques() {
  const { data } = useMesures();
  const mesures = avecCles(data);
  if (!mesures.length) return null;
  return (
    <Card title="Forme (Apple Santé, 12 mois)">
      <div className="grid gap-5 lg:grid-cols-3">
        {mesures.map((m) => <Courbe key={m.cle} m={m} />)}
      </div>
      <p className="text-xs text-gray-400 mt-3">
        FC au repos qui monte ou VFC qui baisse durablement (7 j vs 28 j) : fatigue, stress ou début de maladie, à surveiller avant d'enchaîner les grosses séances.
      </p>
    </Card>
  );
}
