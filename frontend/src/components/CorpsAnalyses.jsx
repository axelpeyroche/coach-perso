// Ce que le carnet apprend du corps sur la durée : tendance de la VFC, fenêtre de sommeil,
// effet des séances sur la nuit, temps de récupération, chaleur, saisons, composition corporelle.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList,
} from "recharts";
import clsx from "clsx";
import Card from "./Card";
import Feuille from "./Feuille";
import Aide from "./Aide";
import { Segmente } from "./ui";
import { axeX, axeY, grille, curseur, InfoBulle, Legende, GRIS } from "./graphiques";
import { getMensurations, putMensurations, completerMeteo } from "../api";
import { fmtAllureSec, fmtDate, nombre } from "../carnet";

const VIOLET = "#AF52DE";
const INDIGO = "#5856D6";
const VERT = "#34C759";
const ORANGE = "#FF9500";
const ROUGE = "#FF3B30";
const CYAN = "#32ADE6";
const BLEU = "#007AFF";

const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const signe = (v, d = 0) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nombre(Math.abs(v), d)}`);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
// Heure décimale (23,5 ou 31,5 après minuit) → « 23 h 30 »
const heure = (h) => {
  if (h == null) return "—";
  const m = ((Math.round(h * 60) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};
const duree = (h) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};

function Entete({ titre, couleur, sousTitre, aide, action }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold flex items-center gap-1" style={{ color: couleur }}>
          <span className="truncate">{titre}</span><Aide sujet={aide} />
        </p>
        {sousTitre && <p className="text-[13px] text-label-2">{sousTitre}</p>}
      </div>
      {action}
    </div>
  );
}

function Tuile({ label, value, sub, className }) {
  return (
    <div className={clsx("tuile px-3 py-2.5 min-w-0", className)}>
      <p className="text-[12px] text-label-2 truncate">{label}</p>
      <p className="font-rounded text-[17px] font-bold chiffres truncate">{value}</p>
      {sub && <p className="text-[11px] text-label-2 truncate">{sub}</p>}
    </div>
  );
}

const Vide = ({ children }) => <p className="text-[15px] text-label-2">{children}</p>;
const Message = ({ children, ton }) => (
  <p className={clsx("rounded-xl px-3 py-2 text-[13px] leading-[18px]",
    ton === "alerte" ? "bg-ios-orange/[0.12] text-ios-orange" : ton === "bien" ? "bg-ios-green/[0.12] text-ios-green" : "bg-remplissage text-label-2")}>
    {children}
  </p>
);

// ── 1.6 Tendance de la VFC ────────────────────────────────────────────────
const POSITIONS = {
  dans: { label: "Dans ta plage", cls: "bg-ios-green/15 text-ios-green", couleur: VERT },
  sous: { label: "Sous ta plage", cls: "bg-ios-red/15 text-ios-red", couleur: ROUGE },
  dessus: { label: "Au-dessus", cls: "bg-ios-blue/15 text-ios-blue", couleur: BLEU },
};

export function TendanceVfc({ t }) {
  const data = useMemo(() => (t?.points ?? []).map((p) => ({ ...p, label: court(p.jour) })), [t]);
  if (!t) return null;
  const [bas, haut] = t.plage;
  const marge = Math.max((haut - bas) * 0.75, 2);
  const min = bas - marge, max = haut + marge;
  const pos = (v) => `${(100 * (Math.min(Math.max(v, min), max) - min)) / (max - min)}%`;
  const p = POSITIONS[t.position] ?? POSITIONS.dans;
  return (
    <Card>
      <Entete titre="Tendance de la VFC sur 7 jours" couleur={VIOLET} aide="vfc_tendance"
        sousTitre={`${pluriel(t.n, "mesure")} cette semaine · plage = ta normale des 60 derniers jours`}
        action={<span className={clsx("badge text-[11px] shrink-0", p.cls)}>{p.label}</span>} />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-center">
        <div>
          {/* Bandeau : plage normale en vert, moyenne 7 jours en repère plein, semaine précédente en repère creux */}
          <div className="relative h-9 mt-1" role="img"
            aria-label={`Moyenne 7 jours ${nombre(t.moy7, 0)} ms, plage normale de ${nombre(bas, 0)} à ${nombre(haut, 0)} ms`}>
            <div className="absolute inset-x-0 top-3 h-3 rounded-full bg-remplissage" />
            <div className="absolute top-3 h-3 rounded-full" style={{ left: pos(bas), width: `calc(${pos(haut)} - ${pos(bas)})`, background: VERT, opacity: 0.35 }} />
            {t.moy7_prec != null && (
              <span className="absolute top-[9px] w-[18px] h-[18px] -ml-[9px] rounded-full border-2 bg-surface" style={{ left: pos(t.moy7_prec), borderColor: GRIS }} />
            )}
            <span className="absolute top-[7px] w-[22px] h-[22px] -ml-[11px] rounded-full border-[3px] border-white shadow" style={{ left: pos(t.moy7), background: p.couleur }} />
          </div>
          <div className="relative h-4 text-[11px] text-label-3 chiffres">
            <span className="absolute -translate-x-1/2" style={{ left: pos(bas) }}>{nombre(bas, 0)}</span>
            <span className="absolute -translate-x-1/2" style={{ left: pos(haut) }}>{nombre(haut, 0)} ms</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Tuile label="Moyenne 7 jours" value={`${nombre(t.moy7, 0)} ms`}
              sub={t.moy7_prec != null ? `sem. précédente ${nombre(t.moy7_prec, 0)} ms` : null} />
            <Tuile label="Variabilité (CV)" value={<span className={t.instable ? "text-ios-orange" : undefined}>{nombre(t.cv7, 1)} %</span>}
              sub={t.cv_habituel != null ? `habituelle ${nombre(t.cv_habituel, 1)} %` : null} />
          </div>
        </div>
        <div className="min-w-0">
          <Message ton={t.position === "sous" || t.instable ? "alerte" : "bien"}>{t.message}</Message>
          {data.length > 6 && (
            <div className="mt-3">
              <p className="text-[12px] text-label-2 mb-1">Variabilité d'un jour à l'autre (CV sur 7 j), 90 jours</p>
              <ResponsiveContainer width="100%" height={110}>
                <LineChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
                  <CartesianGrid {...grille} />
                  <XAxis dataKey="label" {...axeX} minTickGap={40} />
                  <YAxis {...axeY} width={30} domain={[0, "auto"]} tickFormatter={(v) => nombre(v, 0)} />
                  <Tooltip cursor={{ stroke: GRIS, strokeOpacity: 0.3 }} content={<InfoBulle format={(v) => `${nombre(v, 1)} %`} />} />
                  {t.cv_habituel != null && <ReferenceLine y={t.cv_habituel} stroke={GRIS} strokeDasharray="4 4" />}
                  <Line dataKey="cv7" name="CV 7 j" stroke={VIOLET} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── 1.8 Fenêtre de sommeil et chronotype ──────────────────────────────────
export function FenetreSommeil({ c }) {
  if (!c) {
    return (
      <Card>
        <Entete titre="Fenêtre de sommeil" couleur={INDIGO} aide="chronotype" />
        <Vide>Il faut au moins 7 nuits avec heures de coucher et de réveil (Intervals Companion) pour connaître ton rythme naturel et te conseiller une heure de coucher.</Vide>
      </Card>
    );
  }
  const blocs = [["Semaine", c.semaine], ["Week-end", c.weekend]].filter(([, b]) => b);
  const tous = blocs.map(([, b]) => b);
  const bas = Math.floor(Math.min(...tous.map((b) => b.coucher), c.coucher_ce_soir)) - 1;
  const haut = Math.ceil(Math.max(...tous.map((b) => b.lever + 24))) + 1;
  const x = (h) => `${((h - bas) / (haut - bas)) * 100}%`;
  const reperes = [];
  for (let h = Math.ceil(bas / 2) * 2; h <= haut; h += 2) reperes.push(h);
  const ref = c.semaine ?? c.tout;
  const jl = c.jetlag_min;
  return (
    <Card>
      <Entete titre="Fenêtre de sommeil" couleur={INDIGO} aide="chronotype"
        sousTitre={`${pluriel(c.nuits, "nuit")} sur 8 semaines`}
        action={<span className="badge text-[11px] shrink-0" style={{ color: INDIGO, background: `${INDIGO}26` }}>{c.chronotype_label}</span>} />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-center">
        <div className="min-w-0">
          {/* Frise : une barre par type de nuit, trait vert = coucher conseillé ce soir */}
          <div className="relative pt-1 pb-5">
            <div className="space-y-2">
              {blocs.map(([nom, b], i) => (
                <div key={nom} className="flex items-center gap-2">
                  <span className="w-[62px] shrink-0 text-[12px] text-label-2">{nom}</span>
                  <div className="relative flex-1 h-7 rounded-lg bg-remplissage overflow-hidden">
                    <div className="absolute inset-y-0 rounded-lg flex items-center justify-between px-1.5 text-[11px] font-semibold text-white chiffres whitespace-nowrap overflow-hidden"
                      style={{ left: x(b.coucher), width: `calc(${x(b.lever + 24)} - ${x(b.coucher)})`, background: INDIGO, opacity: i ? 0.65 : 1 }}>
                      <span>{heure(b.coucher).replace(" h ", ":")}</span><span>{heure(b.lever).replace(" h ", ":")}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="absolute inset-y-0 left-[70px] right-0 pointer-events-none">
              <span className="absolute top-0 bottom-4 w-0.5 -ml-px rounded-full" style={{ left: x(c.coucher_ce_soir), background: VERT }} />
              {reperes.map((h, i) => (
                <span key={h} className={clsx("absolute bottom-0 text-[10px] text-label-3 chiffres whitespace-nowrap", i === reperes.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: x(h) }}>{h % 24} h</span>
              ))}
            </div>
          </div>
          <Legende items={[{ label: "Nuit habituelle", couleur: INDIGO }, { label: "Coucher conseillé ce soir", couleur: VERT }]} />
        </div>
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Tuile label="Coucher conseillé" value={<span className="text-ios-green">{heure(c.coucher_ce_soir)}</span>}
              sub={c.avance_min ? `ce soir · ${c.avance_min} min plus tôt` : `ce soir · pour ${duree(c.besoin_h)}`} />
            <Tuile label="Coucher habituel" value={heure(ref.coucher)} sub={`réveil ${heure(ref.lever)}`} />
            <Tuile label="Milieu de nuit libre" value={heure(c.milieu_libre)} sub={c.chronotype_label.toLowerCase()} />
            <Tuile label="Écart week-end"
              value={jl == null ? "—" : <span className={Math.abs(jl) >= 60 ? "text-ios-orange" : undefined}>{signe(jl)} min</span>}
              sub={jl == null ? "pas assez de nuits" : Math.abs(jl) >= 60 ? "jet-lag social marqué" : "rythme régulier"} />
          </div>
          <Message ton={c.avance_min || (jl != null && Math.abs(jl) >= 60) ? "alerte" : undefined}>{c.conseil}</Message>
        </div>
      </div>
    </Card>
  );
}

// ── 1.9 Effet des séances sur la nuit ─────────────────────────────────────
const METRIQUES_NUIT = {
  vfc: { label: "VFC", dec: 1, seuil: 1.5 },
  fc_nuit: { label: "FC nuit", dec: 1, seuil: 1 },
  profond: { label: "Profond", dec: 0, seuil: 5 },
  duree: { label: "Durée", dec: 0, seuil: 10 },
};

export function EffetNuit({ e }) {
  if (!e?.lignes?.length) {
    return (
      <Card>
        <Entete titre="Effet des séances sur la nuit" couleur={INDIGO} aide="effet_nuit" />
        <Vide>Pas encore assez de nuits mesurées après chaque type de séance (au moins 4 par type) pour comparer.</Vide>
      </Card>
    );
  }
  const ms = e.metriques.filter((m) => e.lignes.some((l) => l[m.cle] != null));
  const cols = { gridTemplateColumns: `minmax(0,1fr) repeat(${ms.length}, 4.75rem)` };
  const cellule = (l, m) => {
    const v = l[m.cle], info = METRIQUES_NUIT[m.cle];
    const bon = v != null && Math.abs(v) >= info.seuil ? (v * m.sens > 0 ? "text-ios-green" : "text-ios-red") : "";
    return (
      <div key={m.cle} className="min-w-0 2xl:text-right">
        <p className="2xl:hidden text-[11px] text-label-3 truncate">{info.label}</p>
        <p className={clsx("text-[15px] font-semibold chiffres whitespace-nowrap", v == null ? "text-label-3" : bon)}>
          {v == null ? "—" : signe(v, info.dec)}<span className="text-[11px] font-normal text-label-3 ml-0.5 2xl:hidden">{v == null ? "" : m.unite}</span>
        </p>
      </div>
    );
  };
  return (
    <Card>
      <Entete titre="Effet des séances sur la nuit" couleur={INDIGO} aide="effet_nuit"
        sousTitre="Écart à ta normale, la nuit et le matin qui suivent" />
      <Message>{e.phrase}</Message>
      <div className="hidden 2xl:grid gap-2 mt-3 pb-1.5 text-[12px] text-label-2 border-b border-separateur" style={cols}>
        <span>Journée</span>
        {ms.map((m) => <span key={m.cle} className="text-right">{METRIQUES_NUIT[m.cle].label} <span className="text-label-3">({m.unite})</span></span>)}
      </div>
      <div className="divide-y divide-separateur mt-1 2xl:mt-0">
        {e.lignes.map((l) => (
          <div key={l.cle} className="py-2.5 2xl:grid 2xl:items-center 2xl:gap-2" style={cols}>
            <p className="text-[15px] leading-5 min-w-0">
              {l.label} <span className="text-[12px] text-label-3 whitespace-nowrap">· {pluriel(l.n, "nuit")}</span>
            </p>
            <div className="grid gap-2 mt-1.5 2xl:mt-0 2xl:contents" style={{ gridTemplateColumns: `repeat(${ms.length}, minmax(0,1fr))` }}>
              {ms.map((m) => cellule(l, m))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-label-3 mt-2">Vert : meilleur que ta normale. Rouge : moins bon. Sans couleur : écart trop faible pour compter.</p>
    </Card>
  );
}

// ── 1.10 Temps de récupération personnel ──────────────────────────────────
export function TempsRecuperation({ r }) {
  if (!r?.types?.length) {
    return (
      <Card>
        <Entete titre="Ton temps de récupération" couleur={VERT} aide="temps_recuperation" />
        <Vide>Il faut au moins 3 séances dures suivies de matins mesurés (VFC, FC au repos) pour estimer en combien de jours tu reviens dans ta normale.</Vide>
      </Card>
    );
  }
  const max = Math.max(3, ...r.types.map((t) => t.moyenne));
  return (
    <Card>
      <Entete titre="Ton temps de récupération" couleur={VERT} aide="temps_recuperation"
        sousTitre="Jours avant de retrouver ton indice de récupération habituel" />
      <div className="space-y-3.5">
        {r.types.map((t) => {
          const couleur = t.moyenne >= 2 ? ORANGE : VERT;
          return (
            <div key={t.cle}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[15px] min-w-0 truncate">{t.label} <span className="text-[12px] text-label-3">· {t.n}</span></p>
                <p className="font-rounded text-[17px] font-bold chiffres shrink-0">{nombre(t.moyenne, 1)} <span className="text-[12px] font-semibold text-label-2">j</span></p>
              </div>
              <div className="h-2 rounded-full bg-remplissage overflow-hidden mt-1">
                <div className="h-full rounded-full" style={{ width: `${Math.max(4, (100 * t.moyenne) / max)}%`, background: couleur }} />
              </div>
              <p className="text-[12px] text-label-2 mt-1">
                Remis dès le lendemain {t.lendemain_pct} % du temps{t.lent_pct ? ` · 3 jours ou plus : ${t.lent_pct} %` : ""}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-3"><Message>{r.message}</Message></div>
    </Card>
  );
}

// ── 1.11 Chaleur et altitude ──────────────────────────────────────────────
const tranche = (l) => l.replace("Moins de ", "< ").replace(" et plus", " +").replace(" à ", "–").replace(" °C", "°");

function CompleterMeteo({ n }) {
  const qc = useQueryClient();
  const [reste, setReste] = useState(n);
  const mut = useMutation({
    mutationFn: completerMeteo,
    onSuccess: (d) => { setReste(d.restantes); qc.invalidateQueries({ queryKey: ["analyses"] }); },
  });
  if (!reste) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <button type="button" className="btn-teinte !py-1.5 !px-3 text-[13px]" disabled={mut.isPending} onClick={() => mut.mutate()}>
        {mut.isPending ? "Recherche de la météo…" : `Retrouver la météo de ${pluriel(reste, "sortie")}`}
      </button>
      <p className="text-[12px] text-label-3 min-w-0">
        {mut.isError ? "Service météo injoignable, réessaie plus tard." : "Par lots de 6 sorties, à partir de leur tracé GPS."}
      </p>
    </div>
  );
}

export function Chaleur({ c }) {
  if (!c) return null;
  if (!c.suffisant) {
    return (
      <Card>
        <Entete titre="Chaleur et altitude" couleur={ORANGE} aide="chaleur" />
        <Vide>
          Il faut au moins {c.min_n} sorties de course avec météo, dont {c.min_chaud} à 20 °C ou plus, pour mesurer ce que la chaleur te coûte.
          Pour l'instant : {pluriel(c.n, "sortie")}, dont {c.n_chaud ?? 0} au chaud.
        </Vide>
        <CompleterMeteo n={c.manquantes} />
      </Card>
    );
  }
  const cout = c.cout_bpm_par_degre;
  const sensible = cout >= 0.3;
  const data = c.tranches.map((t) => ({ ...t, court: tranche(t.label) }));
  const fcs = data.map((t) => t.fc);
  return (
    <Card>
      <Entete titre="Chaleur et altitude" couleur={ORANGE} aide="chaleur"
        sousTitre={`${pluriel(c.n, "sortie")} de course avec météo, à allure égale`} />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-center">
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Tuile label={`Par degré au-dessus de ${nombre(c.temp_neutre, 0)} °C`}
              value={<span className={sensible ? "text-ios-orange" : undefined}>{Math.abs(cout) < 0.05 ? "≈ 0" : signe(cout, 1)} bpm</span>} sub="à allure égale" />
            <Tuile label="À 25 °C" value={sensible ? `+${c.bpm_a_25} bpm` : "≈ 0 bpm"}
              sub={sensible && c.perte_allure_25 ? `ou ${c.perte_allure_25} s/km de moins` : "même allure"} />
            {sensible && c.perte_allure_25 != null && (
              <Tuile label="Même effort à 25 °C" value={`${fmtAllureSec(c.allure_moy + c.perte_allure_25)} /km`} sub={`au lieu de ${fmtAllureSec(c.allure_moy)} /km`} />
            )}
            {c.altitude && (
              <Tuile label={`Au-dessus de ${nombre(c.altitude.seuil_m, 0)} m`} value={`${signe(c.altitude.ecart_bpm, 1)} bpm`} sub={pluriel(c.altitude.n, "sortie")} />
            )}
          </div>
          <Message ton={sensible ? "alerte" : undefined}>{c.message}</Message>
          <CompleterMeteo n={c.manquantes} />
        </div>
        <div className="min-w-0">
          <p className="text-[12px] text-label-2 mb-1">FC moyenne ramenée à ton allure moyenne, par température</p>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={data} margin={{ left: 0, right: 0, top: 18 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="court" {...axeX} interval={0} />
              <YAxis {...axeY} width={34} domain={[Math.floor(Math.min(...fcs) - 6), Math.ceil(Math.max(...fcs) + 3)]} allowDecimals={false} />
              <Tooltip cursor={curseur} content={(p) => <InfoBulle {...p} label={p.payload?.[0]?.payload ? `${p.payload[0].payload.label} · ${pluriel(p.payload[0].payload.n, "sortie")}` : null} format={(v) => `${nombre(v, 0)} bpm`} />} />
              <Bar dataKey="fc" name="FC à allure égale" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {data.map((t, i) => <Cell key={t.label} fill={i >= data.length - 2 && sensible ? ORANGE : CYAN} fillOpacity={0.85} />)}
                <LabelList dataKey="fc" position="top" formatter={(v) => nombre(v, 0)} style={{ fontSize: 11, fill: GRIS }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

// ── 1.12 Tendances longues, saison par saison ─────────────────────────────
const COULEURS_LONGUES = { fc_repos: "#FF2D55", vfc: VIOLET, vo2max: BLEU, poids: INDIGO };
const COURTS_LONGUES = { fc_repos: "FC repos", vfc: "VFC", vo2max: "VO2max", poids: "Poids" };

export function TendancesLongues({ t }) {
  const [choix, setChoix] = useState(null);
  const ms = t?.metriques ?? [];
  if (!ms.length) {
    return (
      <Card>
        <Entete titre="Saison après saison" couleur={BLEU} aide="tendances_longues" />
        <Vide>Dès que deux saisons de mesures seront enregistrées (FC au repos, VFC, VO2max, poids), tu verras ici leur évolution de fond.</Vide>
      </Card>
    );
  }
  const m = ms.find((x) => x.cle === choix) ?? ms[0];
  const couleur = COULEURS_LONGUES[m.cle] ?? BLEU;
  const saisons = m.saisons.slice(-12);
  const der = saisons.at(-1);
  const ton = (v) => (v == null || !m.sens || Math.abs(v) < 10 ** -m.decimales ? undefined : v * m.sens > 0 ? "text-ios-green" : "text-ios-red");
  const amp = Math.max(m.max - m.min, 1);
  const dTend = Math.abs(m.tendance_an ?? 0) < 1 ? 2 : 1;
  const uCourt = m.unite && m.unite !== "ml/kg/min" ? `${m.unite} · ` : "";
  return (
    <Card>
      <Entete titre="Saison après saison" couleur={couleur} aide="tendances_longues"
        sousTitre={`${m.label} · moyenne de chaque saison`}
        action={ms.length > 1 ? <Segmente className="hidden sm:flex shrink-0" valeur={m.cle} onChange={setChoix} options={ms.map((x) => [x.cle, COURTS_LONGUES[x.cle] ?? x.label])} /> : null} />
      {ms.length > 1 && <Segmente className="sm:hidden mb-3" valeur={m.cle} onChange={setChoix} options={ms.map((x) => [x.cle, COURTS_LONGUES[x.cle] ?? x.label])} />}
      <div className="grid gap-4 lg:grid-cols-3 lg:items-center">
        <div className="grid grid-cols-3 lg:grid-cols-1 gap-2">
          <Tuile label={der.label} value={`${nombre(der.moy, m.decimales)} ${m.unite === "ml/kg/min" ? "" : m.unite}`} sub={pluriel(der.n, "mesure")} />
          <Tuile label="Sur un an" value={<span className={ton(m.sur_un_an)}>{signe(m.sur_un_an, m.decimales)}</span>}
            sub={m.sur_un_an == null ? "pas de saison jumelle" : `${uCourt}même saison`} />
          <Tuile label="Tendance" value={<span className={ton(m.tendance_an)}>{signe(m.tendance_an, dTend)}</span>} sub={`${uCourt}par an`} />
        </div>
        <div className="lg:col-span-2 min-w-0">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={saisons} margin={{ left: 0, right: 0, top: 18 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="court" {...axeX} interval={saisons.length > 7 ? "preserveStartEnd" : 0} minTickGap={4} />
              <YAxis {...axeY} width={34} domain={[Math.floor(m.min - amp * 0.6), Math.ceil(m.max + amp * 0.25)]} allowDecimals={false} />
              <Tooltip cursor={curseur} content={(p) => <InfoBulle {...p} label={p.payload?.[0]?.payload ? `${p.payload[0].payload.label} · ${pluriel(p.payload[0].payload.n, "mesure")}` : null} format={(v) => `${nombre(v, m.decimales)} ${m.unite}`} />} />
              <Bar dataKey="moy" name={m.label} radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {saisons.map((s, i) => <Cell key={s.cle} fill={couleur} fillOpacity={i === saisons.length - 1 ? 1 : 0.45} />)}
                {saisons.length <= 8 && <LabelList dataKey="moy" position="top" formatter={(v) => nombre(v, m.decimales)} style={{ fontSize: 11, fill: GRIS }} />}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="text-[12px] text-label-3 mt-2">Compare une saison à la même un an plus tôt : la chaleur de l'été ou la coupure de l'hiver faussent la comparaison d'une saison à la suivante.</p>
    </Card>
  );
}

// ── 1.7 Composition corporelle ────────────────────────────────────────────
function SaisieMensurations({ compo, onClose }) {
  const qc = useQueryClient();
  const [jour, setJour] = useState(compo.aujourdhui);
  const duJour = (j) => Object.fromEntries(compo.types.map((t) => {
    const p = (compo.series[t.type] ?? []).find((x) => x.jour === j);
    return [t.type, p ? String(p.valeur).replace(".", ",") : ""];
  }));
  const [valeurs, setValeurs] = useState(() => duJour(compo.aujourdhui));
  const [erreur, setErreur] = useState("");
  const lire = (s) => (s.trim() === "" ? null : parseFloat(s.replace(",", ".")));
  const initiales = duJour(jour);
  const mut = useMutation({
    mutationFn: () => {
      // Seuls les champs modifiés partent ; un champ vidé retire la mesure du jour
      const envoi = {};
      for (const t of compo.types) if (valeurs[t.type] !== initiales[t.type]) envoi[t.type] = lire(valeurs[t.type]);
      return putMensurations({ jour, valeurs: envoi });
    },
    onSuccess: (d) => {
      qc.setQueryData(["corps", "mensurations"], d);
      qc.invalidateQueries({ queryKey: ["analyses"] });
      onClose();
    },
    onError: (e) => setErreur(e?.response?.data?.detail && typeof e.response.data.detail === "string" ? e.response.data.detail : "Enregistrement impossible. Vérifie les valeurs."),
  });
  const change = compo.types.some((t) => valeurs[t.type] !== initiales[t.type]);
  const invalide = compo.types.some((t) => { const v = lire(valeurs[t.type]); return v != null && !(v >= t.min && v <= t.max); });
  return (
    <Feuille titre="Mesures du corps" onClose={onClose}
      action={<button type="button" className="btn-primaire" disabled={!change || invalide || mut.isPending} onClick={() => { setErreur(""); mut.mutate(); }}>Enregistrer</button>}>
      <label className="block space-y-1">
        <span className="text-[13px] text-label-2 px-1">Mesures du</span>
        <input type="date" className="champ w-full" value={jour} max={compo.aujourdhui}
          onChange={(e) => { const j = e.target.value || compo.aujourdhui; setJour(j); setValeurs(duJour(j)); }} />
      </label>
      <div className="grid gap-3 grid-cols-2">
        {compo.types.map((t) => {
          const v = lire(valeurs[t.type]);
          const hors = v != null && !(v >= t.min && v <= t.max);
          const der = compo.derniers[t.type];
          return (
            <label key={t.type} className="block space-y-1 min-w-0">
              <span className="text-[13px] text-label-2 px-1 block truncate">{t.label} ({t.unite})</span>
              <input type="text" inputMode="decimal" className={clsx("champ w-full", hors && "!text-ios-red")} value={valeurs[t.type]}
                placeholder={der ? nombre(der.valeur, 1) : "—"} aria-invalid={hors}
                onChange={(e) => setValeurs((s) => ({ ...s, [t.type]: e.target.value }))} />
            </label>
          );
        })}
      </div>
      {invalide && <p className="text-[13px] text-ios-red">Une valeur sort des bornes plausibles.</p>}
      {erreur && <p className="text-[13px] text-ios-red">{erreur}</p>}
      <p className="text-[12px] text-label-3">
        Remplis seulement ce que tu mesures. Mensurations : le matin, mètre ruban à plat sans serrer, toujours au même endroit
        (taille au niveau du nombril, hanches au plus large). Masse grasse : toujours la même balance, à jeun. Vider un champ retire la mesure de ce jour.
      </p>
    </Feuille>
  );
}

export function CompositionCorporelle() {
  const { data: compo } = useQuery({ queryKey: ["corps", "mensurations"], queryFn: getMensurations });
  const [saisie, setSaisie] = useState(false);
  const [choix, setChoix] = useState(null);
  if (!compo) return null;
  const bouton = <button type="button" onClick={() => setSaisie(true)} className="btn-teinte !py-1.5 !px-3 text-[13px] shrink-0">+ Mesure</button>;
  const feuille = saisie && <SaisieMensurations compo={compo} onClose={() => setSaisie(false)} />;
  const suivis = compo.types.filter((t) => compo.derniers[t.type]);
  if (!suivis.length) {
    return (
      <Card>
        <Entete titre="Composition corporelle" couleur={VIOLET} aide="composition" action={bouton} />
        <Vide>Le poids seul ne dit pas si tu perds du gras ou du muscle. Note ta masse grasse (balance à impédance) ou ton tour de taille toutes les 2 à 4 semaines pour le savoir.</Vide>
        {feuille}
      </Card>
    );
  }
  const d = compo.derives ?? {};
  const depuis = (x) => (x?.ecart != null && x.depuis ? `${signe(x.ecart, 1)} depuis le ${court(x.depuis)}` : x ? court(x.jour) : null);
  const mg = compo.derniers.masse_grasse;
  const tuiles = [];
  if (mg) {
    tuiles.push(<Tuile key="mg" label="Masse grasse" value={`${nombre(mg.valeur, 1)} %`} sub={depuis(mg)} />);
    if (d.masse_maigre_kg != null) {
      tuiles.push(<Tuile key="mm" label="Masse maigre" value={`${nombre(d.masse_maigre_kg, 1)} kg`}
        sub={d.masse_maigre_ecart != null ? <span className={d.masse_maigre_ecart <= -0.5 ? "text-ios-orange" : undefined}>{signe(d.masse_maigre_ecart, 1)} kg</span> : "muscle, os, eau"} />);
      tuiles.push(<Tuile key="mgk" label="Graisse" value={`${nombre(d.masse_grasse_kg, 1)} kg`}
        sub={d.masse_grasse_ecart != null ? `${signe(d.masse_grasse_ecart, 1)} kg` : null} />);
    }
  }
  for (const t of suivis.filter((x) => x.type !== "masse_grasse")) {
    const x = compo.derniers[t.type];
    tuiles.push(<Tuile key={t.type} label={t.label} value={`${nombre(x.valeur, 1)} ${t.unite}`} sub={depuis(x)} />);
  }
  if (d.taille_stature != null) {
    tuiles.push(<Tuile key="ts" label="Taille ÷ stature" value={<span className={d.taille_stature_ok ? "text-ios-green" : "text-ios-orange"}>{nombre(d.taille_stature, 2)}</span>}
      sub={d.taille_stature_ok ? "sous 0,50 : bien" : "repère : sous 0,50"} />);
  }
  if (d.taille_hanches != null) tuiles.push(<Tuile key="th" label="Taille ÷ hanches" value={nombre(d.taille_hanches, 2)} />);

  const tracables = suivis.filter((t) => (compo.series[t.type] ?? []).length >= 2);
  const type = tracables.find((t) => t.type === choix) ?? tracables[0];
  const serie = type ? compo.series[type.type].map((p) => ({ ...p, label: fmtDate(p.jour, { day: "numeric", month: "short", year: "2-digit" }) })) : [];
  // Gras et muscle : la lecture qui compte quand le poids bouge
  let lecture = null;
  if (d.masse_maigre_ecart != null && d.masse_grasse_ecart != null) {
    const g = d.masse_grasse_ecart, m = d.masse_maigre_ecart;
    if (g <= -0.3 && m >= -0.3) lecture = ["bien", `Tu as perdu ${nombre(-g, 1)} kg de graisse en gardant ton muscle : c'est la bonne direction.`];
    else if (m <= -0.5 && g > m) lecture = ["alerte", `Tu as perdu ${nombre(-m, 1)} kg de masse maigre : mange assez de protéines et garde la musculation pour ne pas perdre de muscle.`];
    else if (g >= 0.5) lecture = [undefined, `La graisse a pris ${nombre(g, 1)} kg sur la période.`];
    else lecture = [undefined, "Composition stable sur la période."];
  }
  return (
    <Card>
      <Entete titre="Composition corporelle" couleur={VIOLET} aide="composition" action={bouton}
        sousTitre={mg ? `Masse grasse du ${court(mg.jour)}${mg.source === "intervals" ? " · reçue d'Intervals" : ""}` : "Mensurations"} />
      <div className={clsx("grid gap-4", type && "lg:grid-cols-2 lg:items-start")}>
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">{tuiles}</div>
          {lecture && <Message ton={lecture[0]}>{lecture[1]}</Message>}
        </div>
        {type && (
          <div className="min-w-0">
            {tracables.length > 1 && (
              <select className="champ !w-auto !py-1.5 text-[13px] mb-2" value={type.type} onChange={(e) => setChoix(e.target.value)} aria-label="Mesure affichée">
                {tracables.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            )}
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={serie} margin={{ left: 0, right: 8, top: 6 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="label" {...axeX} minTickGap={28} interval="preserveStartEnd" padding={{ left: 12, right: 12 }} />
                <YAxis {...axeY} width={34} domain={[(v) => Math.floor(v - 1), (v) => Math.ceil(v + 1)]} allowDecimals={false} tickFormatter={(v) => nombre(v, 0)} />
                <Tooltip cursor={{ stroke: GRIS, strokeOpacity: 0.3 }} content={<InfoBulle format={(v) => `${nombre(v, 1)} ${type.unite}`} />} />
                <Line dataKey="valeur" name={type.label} stroke={VIOLET} strokeWidth={2.5} dot={{ r: 3, fill: VIOLET, strokeWidth: 0 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {feuille}
    </Card>
  );
}
