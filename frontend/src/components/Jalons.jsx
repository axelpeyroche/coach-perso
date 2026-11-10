import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "./Card";
import Aide from "./Aide";
import FicheActivite from "./FicheActivite";
import { Section } from "./ui";
import { Faits } from "./BilanBlocs";
import { axeX, axeY, grille, GRIS, InfoBulle, Legende } from "./graphiques";
import { getActivite, getJalons } from "../api";
import { fmtDate, nombre } from "../carnet";

const BLEU = "rgb(var(--blue))", ORANGE = "rgb(var(--orange))";
const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const long = (iso) => fmtDate(iso, { day: "numeric", month: "short", year: "numeric" });
const val = (v, unite) => `${nombre(v, 0)}${unite ? ` ${unite}` : ""}`;

function Cumul({ a }) {
  const ecart = a.precedent_a_date != null ? Math.round(a.actuel - a.precedent_a_date) : null;
  const o = a.objectif;
  const retard = o ? Math.round(a.actuel - o.attendu_a_date) : null;
  return (
    <Card>
      <p className="text-[13px] font-semibold text-label-2 flex items-center gap-1.5">
        Cumul {a.annee}{a.sport_label ? ` · ${a.sport_label}` : ""} <Aide sujet="cumul_annuel" />
      </p>
      <p className="font-rounded chiffres text-[30px] font-bold leading-tight mt-0.5">
        {nombre(a.actuel, 0)} <span className="text-[17px] font-semibold text-label-2">km</span>
      </p>
      <p className="text-[13px] text-label-2">
        {[ecart != null && `${ecart >= 0 ? "+" : "−"}${nombre(Math.abs(ecart), 0)} km par rapport à ${a.annee - 1} à la même date`,
          a.projection && `à ce rythme, ${nombre(a.projection, 0)} km fin décembre`].filter(Boolean).join(" · ")}
      </p>
      <div className="h-[190px] mt-3 -mr-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={a.points} margin={{ top: 6, right: 0, bottom: 0, left: 4 }}>
            <CartesianGrid {...grille} />
            <XAxis dataKey="jour" {...axeX} interval="preserveStartEnd" minTickGap={34}
              tickFormatter={(j) => fmtDate(j, { month: "short" })} />
            <YAxis {...axeY} width={40} tickFormatter={(v) => nombre(v, 0)} />
            <Tooltip content={<InfoBulle format={(v) => `${nombre(v, 0)} km`} />} labelFormatter={court} />
            {a.precedent_total != null && <Line name={String(a.annee - 1)} dataKey="precedent" stroke={GRIS} strokeWidth={1.6} dot={false} isAnimationActive={false} />}
            {o && <Line name="Objectif" dataKey="objectif" stroke={ORANGE} strokeWidth={1.6} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
            <Line name={String(a.annee)} dataKey="actuel" stroke={BLEU} strokeWidth={2.6} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legende items={[
        { label: String(a.annee), couleur: BLEU },
        ...(a.precedent_total != null ? [{ label: `${a.annee - 1} (${nombre(a.precedent_total, 0)} km)`, couleur: GRIS }] : []),
        ...(o ? [{ label: `Objectif ${nombre(o.cible, 0)} km`, couleur: ORANGE }] : []),
      ]} />
      {o && (
        <p className="text-[13px] mt-2.5">
          {retard >= 0 ? `En avance de ${nombre(retard, 0)} km sur l'objectif « ${o.titre} ».`
            : `${nombre(-retard, 0)} km de retard sur l'objectif « ${o.titre} » : il faut ${nombre(o.rythme_requis_sem, 1)} km par semaine d'ici la fin de l'année.`}
        </p>
      )}
    </Card>
  );
}

function Paliers({ metriques, ouvrir }) {
  return (
    <Card pad={false}>
      <p className="px-4 pt-3.5 text-[13px] font-semibold text-label-2 flex items-center gap-1.5">Depuis le début <Aide sujet="jalons" /></p>
      <div className="divide-y-[0.5px] divide-separateur">
        {metriques.map((m) => {
          const p = m.prochain, d = m.franchis[0];
          return (
            <div key={m.cle} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px]">{m.label}</span>
                <b className="text-[17px] chiffres">{val(m.total, m.unite)}</b>
              </div>
              {p && (
                <>
                  <div className="h-[6px] rounded-full bg-remplissage overflow-hidden mt-2" role="img"
                    aria-label={`${Math.round(p.avancement * 100)} % du chemin vers ${val(p.valeur, m.unite)}`}>
                    <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, p.avancement * 100)}%` }} />
                  </div>
                  <p className="text-[12px] text-label-2 mt-1.5 chiffres">
                    Prochain cap : {val(p.valeur, m.unite)} · encore {val(p.reste, m.unite)}
                    {p.estimation ? ` · vers le ${long(p.estimation)} à ton rythme actuel` : ""}
                  </p>
                </>
              )}
              {d && (
                <button type="button" className="text-[12px] text-brand mt-0.5 chiffres text-left" onClick={() => ouvrir(d.activite_id)}>
                  Dernier cap : {val(d.valeur, m.unite)} franchi le {long(d.date)}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// Séries de semaines actives, cumul de l'année et caps franchis
export default function Jalons() {
  const { data: j } = useQuery({ queryKey: ["jalons"], queryFn: getJalons, staleTime: 5 * 60_000 });
  const [fiche, setFiche] = useState(null);
  if (!j || !j.nb) return null;
  const ouvrir = async (id) => {
    try { setFiche(await getActivite(id)); } catch { /* séance supprimée entre-temps */ }
  };
  const s = j.semaines;
  return (
    <Section titre="Séries et caps">
      <div className="grid gap-3 lg:grid-cols-2 items-start">
        <div className="space-y-3 min-w-0">
          <Card pad={false}>
            <p className="px-4 pt-3.5 pb-2.5 text-[13px] font-semibold text-label-2 flex items-center gap-1.5">Semaines actives d'affilée <Aide sujet="serie_semaines" /></p>
            <Faits items={[
              [`${s.actuelle} sem.`, s.actuelle && !s.semaine_en_cours_active ? "en cours · rien encore cette semaine" : "série en cours"],
              [`${s.record} sem.`, s.actuelle === s.record && s.record > 0 ? "c'est ton record" : `record${s.record_fin ? ` · jusqu'au ${long(s.record_fin)}` : ""}`],
            ]} />
          </Card>
          <Cumul a={j.annee} />
        </div>
        <Paliers metriques={j.metriques} ouvrir={ouvrir} />
      </div>
      {fiche && <FicheActivite key={fiche.id} activite={fiche} onClose={() => setFiche(null)} />}
    </Section>
  );
}
