import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { axeX, axeY, grille, InfoBulle } from "./graphiques";
import Card from "./Card";
import { Section } from "./ui";
import StatTile from "./StatTile";
import { getMesures } from "../api";
import { fmtDate, nombre } from "../carnet";

// sens = 1 si une hausse est bon signe, -1 si une baisse l'est (FC au repos) ;
// seuil = écart 7 j / 28 j au-delà duquel on alerte
const META = {
  fc_repos: { court: "FC repos", couleur: "#FF2D55", tuile: "pink", sens: -1, seuil: 2 },
  vfc: { court: "VFC", couleur: "#5856D6", tuile: "indigo", sens: 1, seuil: 5 },
  vo2max: { court: "VO2max", couleur: "#34C759", tuile: "green", sens: 1, seuil: 1 },
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
          <StatTile key={m.cle} label={META[m.cle].court} color={META[m.cle].tuile}
            value={<>
              {nombre(m.derniere.valeur, m.cle === "vo2max" ? 1 : 0)}
              {m.unite !== "ml/kg/min" && <span className="text-[13px] font-semibold text-label-2 ml-0.5">{m.unite}</span>}
            </>}
            sub={e ? `${e.d > 0 ? "▲" : e.d < 0 ? "▼" : "="} ${nombre(Math.abs(e.d))} / 28 j${e.bon ? "" : " ⚠️"}` : fmtDate(m.derniere.jour)} />
        );
      })}
    </div>
  );
}

function Courbe({ m }) {
  // valeur du jour + moyenne glissante 7 points pour lisser le bruit quotidien
  const pts = useMemo(() => m.points.map((p, i, arr) => {
    const fen = arr.slice(Math.max(0, i - 6), i + 1);
    return { ...p, label: fmtDate(p.jour, { day: "numeric", month: "short" }), moy: +(fen.reduce((t, x) => t + x.valeur, 0) / fen.length).toFixed(1) };
  }), [m]);
  const c = META[m.cle].couleur;
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-semibold" style={{ color: c }}>{m.label}</p>
      <p className="mt-0.5 chiffres">
        <span className="font-rounded text-[26px] font-bold tracking-[-0.02em]">{nombre(m.moy_7j)}</span>
        <span className="text-[13px] text-label-2 ml-1">{m.unite} · moy. 7 j</span>
      </p>
      <p className="text-[12px] text-label-2 chiffres">28 j : {nombre(m.moy_28j)} · 90 j : {nombre(m.moy_90j)}</p>
      <ResponsiveContainer width="100%" height={140} className="mt-2">
        <LineChart data={pts} margin={{ left: 0, right: 0, top: 4 }}>
          <CartesianGrid {...grille} />
          <XAxis dataKey="label" {...axeX} minTickGap={40} />
          <YAxis {...axeY} domain={["dataMin - 2", "dataMax + 2"]} allowDecimals={false} tickFormatter={(v) => Math.round(v)} />
          <Tooltip content={<InfoBulle />} cursor={{ stroke: "#8E8E93", strokeOpacity: 0.4 }} />
          <Line dataKey="valeur" name="Jour" stroke={c} strokeOpacity={0.3} dot={false} strokeWidth={1} />
          <Line dataKey="moy" name="Moyenne 7 j" stroke={c} dot={false} strokeWidth={2.5} strokeLinecap="round" activeDot={{ r: 4, strokeWidth: 0 }} />
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
    <Section titre="Forme" action={<span className="text-[13px] text-label-2">Montre · 12 mois</span>}>
      <Card>
        <div className="grid gap-6 lg:grid-cols-3">
          {mesures.map((m) => <Courbe key={m.cle} m={m} />)}
        </div>
        <p className="text-[12px] text-label-2 mt-4">
          FC au repos qui monte ou VFC qui baisse durablement (7 j vs 28 j) : fatigue, stress ou début de maladie, à surveiller avant d'enchaîner les grosses séances.
        </p>
      </Card>
    </Section>
  );
}
