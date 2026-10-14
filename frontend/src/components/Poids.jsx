import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea,
} from "recharts";
import Card from "./Card";
import ModalPoids from "./ModalPoids";
import { Segmente } from "./ui";
import { axeX, axeY, grille, InfoBulle, Legende, GRIS } from "./graphiques";
import { getHistoriquePoids } from "../api";
import { useAuth } from "../AuthContext";
import { fmtDate, nombre } from "../carnet";

const VIOLET = "#AF52DE";
const VERT = "#34C759";
const JOUR = 86400000;

// Classes de l'OMS
export const ZONES_IMC = [
  { max: 18.5, label: "insuffisance pondérale", court: "Maigreur", couleur: "#32ADE6" },
  { max: 25, label: "corpulence normale", court: "Normal", couleur: VERT },
  { max: 30, label: "surpoids", court: "Surpoids", couleur: "#FF9500" },
  { max: Infinity, label: "obésité", court: "Obésité", couleur: "#FF3B30" },
];

export function imc(poids, tailleCm) {
  if (!poids || !tailleCm) return null;
  const valeur = poids / (tailleCm / 100) ** 2;
  return { valeur, zone: ZONES_IMC.find((z) => valeur < z.max) };
}

const t = (iso) => new Date(`${iso}T12:00`).getTime();
const kg = (v, d = 1) => `${nombre(v, d)} kg`;
const ecart = (v) => (v == null ? "—" : Math.abs(v) < 0.05 ? "stable" : `${v > 0 ? "+" : "−"}${nombre(Math.abs(v), 1)} kg`);

// Pesée la plus proche, au plus tard `jours` avant la dernière (sinon la première)
function variation(points, jours) {
  if (points.length < 2) return null;
  const dernier = points.at(-1);
  const borne = dernier.t - jours * JOUR;
  const avant = [...points].reverse().find((p) => p.t <= borne);
  if (!avant) return null;
  return dernier.poids - avant.poids;
}

const PERIODES = [["3m", "3 mois"], ["1a", "1 an"], ["tout", "Tout"]];
const DUREES = { "3m": 92, "1a": 366, tout: Infinity };

// Jauge d'IMC : 16 à 34, bandes OMS, repère à la valeur
function JaugeImc({ valeur }) {
  const min = 16, max = 34;
  const pos = (v) => `${(100 * (Math.min(Math.max(v, min), max) - min)) / (max - min)}%`;
  let debut = min;
  return (
    <div className="mt-2">
      <div className="relative h-2 flex gap-0.5 rounded-full overflow-hidden">
        {ZONES_IMC.map((z) => {
          const fin = Math.min(z.max, max);
          const el = <span key={z.label} style={{ width: `${(100 * (fin - debut)) / (max - min)}%`, background: z.couleur, opacity: 0.85 }} />;
          debut = fin;
          return el;
        })}
      </div>
      <div className="relative h-3">
        <span className="absolute -top-[13px] w-3.5 h-3.5 -ml-[7px] rounded-full bg-white border-2 border-label shadow" style={{ left: pos(valeur) }} aria-hidden />
      </div>
      <div className="relative h-4 text-[10px] text-label-3 chiffres">
        {[18.5, 25, 30].map((v) => <span key={v} className="absolute -translate-x-1/2" style={{ left: pos(v) }}>{nombre(v, v % 1 ? 1 : 0)}</span>)}
      </div>
    </div>
  );
}

export default function PoidsAnalyse() {
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ["historique-poids"], queryFn: getHistoriquePoids });
  const [periode, setPeriode] = useState("3m");
  const [saisie, setSaisie] = useState(false);

  const points = useMemo(() => {
    const ps = (data?.points ?? []).map((p) => ({ ...p, t: t(p.date) })).sort((a, b) => a.t - b.t);
    // Moyenne glissante sur 4 semaines : pesées des 28 derniers jours
    return ps.map((p) => {
      const fen = ps.filter((q) => q.t <= p.t && q.t > p.t - 28 * JOUR);
      return { ...p, moy: fen.reduce((s, q) => s + q.poids, 0) / fen.length };
    });
  }, [data]);

  const taille = data?.taille_cm ?? user?.taille_cm;
  const bouton = (
    <button onClick={() => setSaisie(true)} className="btn-teinte !py-1.5 !px-3 text-[13px] shrink-0">+ Pesée</button>
  );
  const modal = saisie && <ModalPoids initialValue={user?.poids_kg} onClose={() => setSaisie(false)} />;

  if (!data) return null;
  if (!points.length) {
    return (
      <Card>
        <p className="text-[15px] text-label-2">Aucune pesée enregistrée. Note ton poids régulièrement (même heure, à jeun) pour suivre son évolution ici.</p>
        <div className="mt-3">{bouton}</div>
        {modal}
      </Card>
    );
  }

  const dernier = points.at(-1);
  const debut = dernier.t - DUREES[periode] * JOUR;
  const visibles = points.filter((p) => p.t >= debut);
  // Toujours un point de départ sur la période : la dernière pesée avant, pour ne pas couper la courbe
  const avant = points.filter((p) => p.t < debut).at(-1);
  const serie = avant && periode !== "tout" ? [avant, ...visibles] : visibles;
  const valeurs = serie.flatMap((p) => [p.poids, p.moy]);
  const bas = Math.floor(Math.min(...valeurs) - 0.8), haut = Math.ceil(Math.max(...valeurs) + 0.8);
  const x0 = periode === "tout" ? serie[0].t : Math.max(debut, serie[0].t);
  const x1 = Math.max(dernier.t, x0 + 7 * JOUR);

  const v4 = variation(points, 28), v13 = variation(points, 91);
  const sur = points.filter((p) => p.t >= dernier.t - 365 * JOUR);
  const min = sur.reduce((a, p) => (p.poids < a.poids ? p : a));
  const max = sur.reduce((a, p) => (p.poids > a.poids ? p : a));
  const i = imc(dernier.poids, taille);
  // Plage de poids d'un IMC « normal » pour cette taille
  const normal = taille ? [18.5 * (taille / 100) ** 2, 25 * (taille / 100) ** 2] : null;
  const fmtX = (v) => fmtDate(new Date(v).toISOString().slice(0, 10), x1 - x0 > 200 * JOUR ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold" style={{ color: VIOLET }}>Poids · {fmtDate(dernier.date, { day: "numeric", month: "short" })}</p>
          {bouton}
        </div>
        <p className="font-rounded text-[34px] leading-10 font-bold chiffres mt-1">
          {nombre(dernier.poids, 1)}<span className="text-[17px] font-semibold text-label-2 ml-1">kg</span>
        </p>
        <p className="text-[13px] text-label-2">Tendance 4 sem. : <span className="chiffres">{kg(dernier.moy)}</span></p>

        <div className="grid grid-cols-2 gap-2 mt-3">
          <Tuile label="Sur 4 semaines" value={ecart(v4)} />
          <Tuile label="Sur 3 mois" value={ecart(v13)} />
          <Tuile label="Min. sur 12 mois" value={kg(min.poids)} sub={fmtDate(min.date, { day: "numeric", month: "short", year: "2-digit" })} />
          <Tuile label="Max. sur 12 mois" value={kg(max.poids)} sub={fmtDate(max.date, { day: "numeric", month: "short", year: "2-digit" })} />
        </div>

        <div className="mt-4">
          <p className="text-[13px] font-semibold text-label-2">Indice de masse corporelle</p>
          {i ? (
            <>
              <p className="mt-0.5 flex items-baseline gap-2">
                <span className="font-rounded text-[22px] font-bold chiffres">{nombre(i.valeur, 1)}</span>
                <span className="text-[13px] font-semibold" style={{ color: i.zone.couleur }}>{i.zone.label}</span>
              </p>
              <JaugeImc valeur={i.valeur} />
              <p className="text-[12px] text-label-3 mt-1">
                Poids ÷ taille² ({nombre(taille, 0)} cm). L'IMC ne distingue pas muscle et graisse : chez un sportif musclé, il peut surestimer la corpulence.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-label-2 mt-0.5">
              Renseigne ta taille dans le <Link to="/profil" className="text-brand">Profil</Link> (Modifier mes informations) pour le calculer.
            </p>
          )}
        </div>
      </Card>

      <div className="lg:col-span-2 min-w-0">
        <Card className="h-full">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: VIOLET }}>Évolution du poids</p>
              <p className="text-[13px] text-label-2">{visibles.length} pesée{visibles.length > 1 ? "s" : ""} · trait plein = moyenne 4 sem.</p>
            </div>
            <Segmente valeur={periode} onChange={setPeriode} options={PERIODES} />
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={serie} margin={{ left: 0, right: 0, top: 6 }}>
              <defs>
                <linearGradient id="degradePoids" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={VIOLET} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={VIOLET} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...grille} />
              {normal && (
                <ReferenceArea y1={Math.max(normal[0], bas)} y2={Math.min(normal[1], haut)} fill={VERT} fillOpacity={0.07}
                  ifOverflow="hidden" />
              )}
              <XAxis dataKey="t" type="number" scale="time" domain={[x0, x1]} tickFormatter={fmtX} {...axeX} minTickGap={36} allowDataOverflow />
              <YAxis {...axeY} domain={[bas, haut]} allowDecimals={false} tickFormatter={(v) => nombre(v, 0)} />
              <Tooltip cursor={{ stroke: GRIS, strokeOpacity: 0.3 }}
                content={(p) => <InfoBulle {...p} label={p.label != null ? fmtDate(new Date(p.label).toISOString().slice(0, 10), { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : null}
                  format={(v) => kg(v)} />} />
              <Area dataKey="poids" name="Pesée" type="monotone" stroke={VIOLET} strokeOpacity={0.35} strokeWidth={1}
                fill="url(#degradePoids)" baseValue={bas}
                dot={{ r: serie.length > 60 ? 1.5 : 3, fill: VIOLET, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
              <Line dataKey="moy" name="Moyenne 4 sem." type="monotone" stroke={VIOLET} strokeWidth={3} dot={false} activeDot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <Legende items={[
            { label: "Pesées", couleur: `${VIOLET}88` },
            { label: "Moyenne 4 semaines", couleur: VIOLET },
            ...(normal ? [{ label: `IMC normal (${nombre(normal[0], 0)}–${nombre(normal[1], 0)} kg)`, couleur: `${VERT}66` }] : []),
          ]} />
        </Card>
      </div>
      {modal}
    </div>
  );
}

function Tuile({ label, value, sub }) {
  return (
    <div className="tuile px-3 py-2.5 min-w-0">
      <p className="text-[12px] text-label-2 truncate">{label}</p>
      <p className="font-rounded text-[17px] font-bold chiffres truncate">{value}</p>
      {sub && <p className="text-[11px] text-label-2 truncate">{sub}</p>}
    </div>
  );
}
