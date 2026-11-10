// Capacités, suite : courbe allure–durée de 10 s à 3 h, profil de vitesse, équilibre des charges,
// montée et descente, seuil aérobie, repères par âge et simulateur « et si ».
import { useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import clsx from "clsx";
import Card from "./Card";
import { Chevron, Segmente } from "./ui";
import { axeX, axeY, grille, curseur, InfoBulle, Legende, GRIS } from "./graphiques";
import { Entete, Tuile, Vide, Message, VIOLET, INDIGO, VERT, ORANGE, ROUGE, CYAN, BLEU } from "./Capacites";
import { fmtAllureSec, fmtDate, nombre } from "../carnet";

const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const moisAn = (iso) => fmtDate(iso, { month: "short", year: "2-digit" });
const signe = (v, unite = " %") => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nombre(Math.abs(v), 0)}${unite}`);
const ligneCurseur = { stroke: GRIS, strokeOpacity: 0.3 };
const Bulle = ({ children, large }) => (
  <div className={clsx("glass rounded-xl px-3 py-2 text-[12px]", large ? "min-w-[190px]" : "min-w-[140px]")}>{children}</div>
);
const LigneBulle = ({ couleur, nom, children }) => (
  <p className="flex items-center justify-between gap-3">
    <span className="flex items-center gap-1.5 text-label">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: couleur }} />{nom}
    </span>
    <span className="font-semibold chiffres whitespace-nowrap">{children}</span>
  </p>
);

// ── 2.5 Courbe allure–durée ────────────────────────────────────────────────
const GRADUATIONS = [10, 60, 300, 1200, 3600, 10800];
const NOMS_GRADUATIONS = { 10: "10 s", 60: "1 min", 300: "5 min", 1200: "20 min", 3600: "1 h", 10800: "3 h" };

function BulleCourbe({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const series = [["Cette saison", d.p.saison, BLEU], ["Saison précédente", d.p.precedente, CYAN], ["Record", d.p.record, GRIS]];
  return (
    <Bulle large>
      <p className="text-label-2 mb-1">Sur {d.label}</p>
      {series.filter(([, e]) => e).map(([nom, e, couleur]) => (
        <LigneBulle key={nom} nom={nom} couleur={couleur}>{fmtAllureSec(e.allure_sec_km)} · {nombre(e.kmh, 1)} km/h</LigneBulle>
      ))}
      {d.modele != null && <LigneBulle nom="Modèle" couleur={ORANGE}>{fmtAllureSec(3600 / d.modele)}</LigneBulle>}
      {!d.teste && d.p.record && <p className="text-ios-orange mt-1">Pas d'effort proche de ton niveau depuis 90 jours</p>}
    </Bulle>
  );
}

function PointSaison({ cx, cy, payload }) {
  if (cx == null || cy == null || payload.saison == null) return <g />;
  return payload.teste
    ? <circle cx={cx} cy={cy} r={3.5} fill={BLEU} />
    : <circle cx={cx} cy={cy} r={4} fill="var(--fond-carte, #fff)" stroke={ORANGE} strokeWidth={2} />;
}

function CelluleEffort({ e, fort }) {
  if (!e) return <span className="text-label-3">—</span>;
  return (
    <span className="min-w-0">
      <span className={clsx("chiffres block", fort && "font-semibold")}>{fmtAllureSec(e.allure_sec_km)}</span>
      <span className="text-[11px] text-label-2 block leading-[14px]">{moisAn(e.date)}</span>
    </span>
  );
}

export function CourbeAllure({ c, className }) {
  const [detail, setDetail] = useState(false);
  const data = useMemo(() => (c?.points ?? []).map((p) => ({
    sec: p.sec, label: p.label, saison: p.saison?.kmh ?? null, precedente: p.precedente?.kmh ?? null,
    record: p.record?.kmh ?? null, modele: p.modele_kmh, teste: p.teste, p,
  })), [c]);
  if (!c) return null;
  if (!data.length) {
    return (
      <Card className={className}>
        <Entete titre="Courbe allure–durée" couleur={BLEU} aide="courbe_allure" />
        <Vide>Il faut des séances de course avec tracé GPS pour la dessiner.</Vide>
      </Card>
    );
  }
  const prog = c.progression_pct;
  const absentes = [...c.non_testees, ...c.jamais];
  return (
    <Card className={className}>
      <Entete titre="Courbe allure–durée" couleur={BLEU} aide="courbe_allure"
        sousTitre={`Ta meilleure allure sur chaque durée, de 10 s à 3 h${prog != null ? ` · ${signe(prog)} sur la saison précédente` : ""}`} />
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data} margin={{ left: 4, right: 0, top: 6 }}>
          <CartesianGrid {...grille} />
          <XAxis dataKey="sec" type="number" scale="log" domain={[10, 10800]} ticks={GRADUATIONS} {...axeX}
            tickFormatter={(s) => NOMS_GRADUATIONS[s]} interval={0} padding={{ left: 16, right: 12 }} />
          <YAxis {...axeY} domain={[(min) => Math.floor((min - 1) / 5) * 5, (max) => Math.ceil((max + 1) / 5) * 5]} tickCount={6}
            allowDecimals={false} tickFormatter={(v) => nombre(v, 0)} width={30} />
          <Tooltip cursor={ligneCurseur} content={<BulleCourbe />} />
          <Line dataKey="record" stroke={GRIS} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="precedente" stroke={CYAN} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="modele" stroke={ORANGE} strokeWidth={1.5} strokeDasharray="2 3" dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="saison" stroke={BLEU} strokeWidth={3} dot={<PointSaison />} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <Legende items={[
        { label: "Cette saison (12 mois)", couleur: BLEU }, ...(c.a_precedente ? [{ label: "Saison précédente", couleur: CYAN }] : []),
        { label: "Record", couleur: GRIS }, ...(c.modele ? [{ label: "Modèle allure critique", couleur: ORANGE }] : []),
      ]} />
      <p className="text-[11px] text-label-2 mt-1">Axe vertical en km/h ; touche la courbe pour lire l'allure.</p>
      {absentes.length > 0 && (
        <div className="mt-3">
          <Message ton="alerte">
            <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-ios-orange align-[-1px] mr-1.5" />
            Pas testées récemment : <strong className="font-semibold">{absentes.join(", ")}</strong>. Sur ces durées, la courbe repose sur des efforts
            de plus de 3 mois ou en dessous de ton niveau : un effort franc les remettrait à jour.
          </Message>
        </div>
      )}
      <button type="button" onClick={() => setDetail(!detail)} aria-expanded={detail}
        className="mt-3 flex items-center gap-1 text-[13px] font-semibold text-brand">
        {detail ? "Masquer le détail" : "Voir le détail par durée"}
        <span className={clsx("transition-transform", detail && "rotate-90")}><Chevron /></span>
      </button>
      {detail && (
        <div className="mt-2 text-[13px]">
          <div className="grid grid-cols-[4.2rem_1fr_1fr] sm:grid-cols-[5rem_1fr_1fr_1fr] gap-x-2 text-[11px] font-medium text-label-2 pb-1 border-b border-separateur">
            <span>Durée</span><span>Saison</span><span className="hidden sm:block">Précédente</span><span>Record</span>
          </div>
          {c.points.filter((p) => p.record).map((p) => (
            <div key={p.sec} className="grid grid-cols-[4.2rem_1fr_1fr] sm:grid-cols-[5rem_1fr_1fr_1fr] gap-x-2 py-1.5 border-b border-separateur last:border-0 items-start">
              <span className="font-medium flex items-center gap-1.5">
                {p.label}{!p.teste && <span className="w-2 h-2 rounded-full border-2 border-ios-orange shrink-0" title="Pas testée récemment" />}
              </span>
              <CelluleEffort e={p.saison} fort />
              <span className="hidden sm:block"><CelluleEffort e={p.precedente} /></span>
              <CelluleEffort e={p.record} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── 2.6 Profil de vitesse ─────────────────────────────────────────────────
export function ProfilVitesse({ v }) {
  if (!v) return null;
  if (!v.disponible) {
    return <Card><Entete titre="Profil de vitesse" couleur={VIOLET} aide="profil_vitesse" /><Vide>{v.raison}</Vide></Card>;
  }
  return (
    <Card>
      <Entete titre="Profil de vitesse" couleur={VIOLET} aide="profil_vitesse"
        sousTitre={`${v.type_label} · ta vitesse max vaut ${nombre(v.ratio, 2)} fois ta VMA`} />
      <div className="grid grid-cols-3 gap-2">
        <Tuile label="Vitesse max" value={<>{nombre(v.vmax_kmh, 1)}<span className="text-[12px] font-semibold text-label-2 ml-0.5">km/h</span></>}
          sub={`sur ${v.source} · ${court(v.date)}`} />
        <Tuile label="VMA" value={<>{nombre(v.vma_kmh, 1)}<span className="text-[12px] font-semibold text-label-2 ml-0.5">km/h</span></>}
          sub="tenable 5 à 6 min" />
        <Tuile label="Réserve" value={<>+{nombre(v.reserve_kmh, 1)}<span className="text-[12px] font-semibold text-label-2 ml-0.5">km/h</span></>}
          sub="au-dessus de la VMA" />
      </div>
      <div className="mt-4 px-1">
        <div className="relative h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${CYAN}, ${INDIGO}, ${VIOLET})` }}>
          <span className="absolute top-1/2 w-[18px] h-[18px] rounded-full bg-white shadow-md -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${v.position_pct}%`, border: `3px solid ${INDIGO}` }} />
        </div>
        <div className="flex justify-between text-[11px] text-label-2 mt-2"><span>Endurant</span><span>Équilibré</span><span>Rapide</span></div>
      </div>
      <p className="text-[13px] font-semibold mt-3">Ce que ça change pour tes séances</p>
      <ul className="mt-1 space-y-1">
        {v.implications.map((t) => (
          <li key={t} className="text-[13px] leading-[18px] text-label flex gap-2"><span className="text-label-3">•</span><span>{t}</span></li>
        ))}
      </ul>
      {v.note && <div className="mt-3"><Message ton="alerte">{v.note}</Message></div>}
    </Card>
  );
}

// ── 2.8 Équilibre des charges ─────────────────────────────────────────────
const DISCIPLINES = [["course", "Course", ORANGE], ["muscu", "Musculation", VIOLET], ["autre", "Autres sports", CYAN]];

export function EquilibreCharges({ c }) {
  const data = useMemo(() => (c?.semaines ?? []).map((s) => ({ ...s, label: court(s.fin) })), [c]);
  if (!c) return null;
  if (!data.length) {
    return <Card><Entete titre="Équilibre des charges" couleur={ORANGE} aide="equilibre_charges" /><Vide>Il manque des séances sur les 12 dernières semaines : l'équilibre se calcule dès qu'elles sont enregistrées.</Vide></Card>;
  }
  const d = c.dernier;
  const maxIdx = Math.max(...data.map((s) => Math.max(s.idx_meca ?? 0, s.idx_cardio ?? 0)));
  const pasIdx = maxIdx > 200 ? 100 : 50;
  const hautIdx = Math.max(150, Math.ceil(maxIdx / pasIdx) * pasIdx);
  const ecart =(v) => (v == null ? "pas d'habitude encore" : `${signe(v)} par rapport à ton habitude`);
  return (
    <Card>
      <Entete titre="Équilibre des charges" couleur={ORANGE} aide="equilibre_charges"
        sousTitre="Par discipline, et ce que les jambes encaissent à côté de ce que le cœur fournit" />
      <div className="grid grid-cols-2 gap-2">
        <Tuile label="Jambes · 7 jours" value={<>{nombre(d.km, 1)} km<span className="text-[12px] font-semibold text-label-2 ml-1">D− {nombre(d.dmoins, 0)} m</span></>}
          sub={ecart(d.ecart_meca_pct)} />
        <Tuile label="Cœur · 7 jours" value={<>{nombre(d.cardio, 0)}<span className="text-[12px] font-semibold text-label-2 ml-1">de charge</span></>}
          sub={ecart(d.ecart_cardio_pct)} />
      </div>
      {c.message && <div className="mt-2"><Message ton={c.message.ton}>{c.message.texte}</Message></div>}
      <div className="grid gap-x-5 gap-y-4 lg:grid-cols-2 mt-4">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-label-2 mb-1">Jambes et cœur, base 100 = ta moyenne</p>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={data} margin={{ left: 4, right: 0, top: 6 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="label" {...axeX} minTickGap={28} />
              <YAxis {...axeY} width={30} domain={[0, hautIdx]} ticks={Array.from({ length: hautIdx / pasIdx + 1 }, (_, i) => i * pasIdx)} />
              <Tooltip cursor={ligneCurseur} content={<InfoBulle format={(v) => `${v}`} />} />
              <ReferenceLine y={100} stroke={GRIS} strokeOpacity={0.6} strokeDasharray="4 4" />
              <Line dataKey="idx_cardio" name="Cœur" stroke={ROUGE} strokeWidth={2} dot={{ r: 2, strokeWidth: 0, fill: ROUGE }} isAnimationActive={false} />
              <Line dataKey="idx_meca" name="Jambes" stroke={ORANGE} strokeWidth={3} dot={{ r: 2.5, strokeWidth: 0, fill: ORANGE }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <Legende items={[{ label: "Jambes (km à pied + D− ÷ 100)", couleur: ORANGE }, { label: "Cœur (charge hors musculation)", couleur: ROUGE }]} />
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-label-2 mb-1">Charge par discipline, par tranche de 7 jours</p>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={data} margin={{ left: 4, right: 0, top: 6 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="label" {...axeX} minTickGap={28} />
              <YAxis {...axeY} width={38} tickFormatter={(v) => nombre(v, 0)} />
              <Tooltip cursor={curseur} content={<InfoBulle format={(v) => nombre(v, 0)} />} />
              {DISCIPLINES.map(([cle, nom, couleur], i) => (
                <Bar key={cle} dataKey={cle} name={nom} stackId="d" fill={couleur} isAnimationActive={false}
                  radius={i === DISCIPLINES.length - 1 ? [4, 4, 0, 0] : 0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <Legende items={DISCIPLINES.map(([cle, nom, couleur]) => ({ label: c.parts ? `${nom} ${c.parts[cle]} %` : nom, couleur }))} />
        </div>
      </div>
      <p className="text-[11px] text-label-2 mt-3">
        Les pourcentages portent sur les 4 dernières tranches.{c.dmoins_estime ? " Sans tracé GPS, le D− d'une séance est pris égal à son D+." : ""}
      </p>
    </Card>
  );
}

// ── 2.9 Montée et descente ────────────────────────────────────────────────
const COULEUR_SENS = { montee: ORANGE, plat: GRIS, descente: CYAN };

function LignePente({ x, maxi }) {
  const r = x.ref;
  const couleur = COULEUR_SENS[x.sens];
  return (
    <li className="py-2 border-b border-separateur last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[14px] font-medium min-w-0">{x.label}<span className="text-[12px] text-label-2 font-normal ml-1.5 whitespace-nowrap">{x.pente}</span></p>
        <p className="font-rounded text-[15px] font-bold chiffres whitespace-nowrap">{fmtAllureSec(r.allure_sec_km)}</p>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 h-2 rounded-full bg-remplissage overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, ((r.rel_pct ?? 100) / maxi) * 100)}%`, background: couleur }} />
        </div>
        <span className="text-[12px] font-semibold chiffres w-11 text-right">{r.rel_pct != null ? `${r.rel_pct} %` : "—"}</span>
      </div>
      <p className="text-[11px] text-label-2 mt-1 flex flex-wrap gap-x-2">
        <span>{nombre(r.km, 1)} km sur 12 mois</span>
        {x.sens !== "plat" && <span>· {x.sens === "montee" ? "+" : "−"}{nombre(Math.abs(r.vv_mh), 0)} m/h</span>}
        {x.ecart != null && x.ecart !== 0 && (
          <span className={x.ecart > 0 ? "text-ios-green font-medium" : "text-ios-orange font-medium"}>
            · {signe(x.ecart, " pt")} sur 3 mois
          </span>
        )}
      </p>
    </li>
  );
}

export function Pentes({ p }) {
  if (!p) return null;
  const classes = (p.classes ?? []).filter((x) => x.ref);
  if (!classes.length && !p.vam?.length) {
    return (
      <Card>
        <Entete titre="Montée et descente" couleur={ORANGE} aide="pentes" />
        <Vide>Il faut des sorties vallonnées avec tracé GPS et altitude pour comparer montée, plat et descente.</Vide>
      </Card>
    );
  }
  const maxi = Math.max(100, ...classes.map((x) => x.ref.rel_pct ?? 0));
  return (
    <Card>
      <Entete titre="Montée et descente" couleur={ORANGE} aide="pentes"
        sousTitre="Ton allure selon la pente, en % de ta vitesse sur le plat" />
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-5">
        {classes.length > 0 && <ul className="lg:col-span-3 min-w-0">{classes.map((x) => <LignePente key={x.cle} x={x} maxi={maxi} />)}</ul>}
        <div className="lg:col-span-2 min-w-0 space-y-3">
          {p.vam?.length > 0 && (
            <div>
              <p className="text-[13px] font-semibold">Meilleure montée par durée</p>
              <p className="text-[12px] text-label-2">Mètres de dénivelé par heure, sur 12 mois</p>
              <div className="grid grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3 gap-2 mt-2">
                {p.vam.map((x) => (
                  <Tuile key={x.minutes} label={x.label}
                    value={x.saison ? <>{nombre(x.saison.mh, 0)}<span className="text-[11px] font-semibold text-label-2 ml-0.5">m/h</span></> : "—"}
                    sub={x.saison && x.saison.mh >= x.record.mh ? "ton record" : `record ${nombre(x.record.mh, 0)}`} />
                ))}
              </div>
            </div>
          )}
          {p.messages.map((m) => <Message key={m.texte} ton={m.ton}>{m.texte}</Message>)}
        </div>
      </div>
    </Card>
  );
}

// ── 2.10 Seuil aérobie ────────────────────────────────────────────────────
const DERIVE_MAX = 15;
const CONFIANCES = { haute: ["Fiable", VERT], moyenne: ["Moyenne", ORANGE], faible: ["Fragile", ROUGE] };

function BulleDerive({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Bulle>
      <p className="font-semibold text-label">{d.titre || "Sortie"}</p>
      <p className="text-label-2 mb-1">{fmtDate(d.date)} · {d.duree_min} min</p>
      <LigneBulle nom="FC moyenne" couleur={GRIS}>{d.fc} bpm</LigneBulle>
      <LigneBulle nom="Dérive" couleur={d.stable ? VERT : ORANGE}>{signe(d.derive_pct)}</LigneBulle>
    </Bulle>
  );
}

export function SeuilAerobie({ s }) {
  const pts = useMemo(() => (s?.points ?? []).map((p) => ({ ...p, y: Math.max(-3, Math.min(DERIVE_MAX, p.derive_pct)) })), [s]);
  if (!s) return null;
  const conf = s.fc && CONFIANCES[s.confiance];
  const fcs = pts.map((p) => p.fc).concat(s.fc ?? [], s.z2_max ?? []);
  const bornes = fcs.length ? [Math.floor((Math.min(...fcs) - 4) / 5) * 5, Math.ceil((Math.max(...fcs) + 4) / 5) * 5] : [100, 180];
  return (
    <Card>
      <Entete titre="Seuil aérobie" couleur={VERT} aide="seuil_aerobie"
        sousTitre="La fréquence cardiaque jusqu'à laquelle tes sorties longues restent stables" />
      <div className="grid gap-x-6 gap-y-3 lg:grid-cols-3">
        <div className="min-w-0">
          {s.fc ? (
            <>
              <p className="font-rounded text-[34px] leading-10 font-bold chiffres">
                {s.borne_basse && <span className="text-[20px] text-label-2 mr-1">≥</span>}{s.fc}
                <span className="text-[15px] font-semibold text-label-2 ml-1">bpm</span>
              </p>
              <p className="text-[12px] text-label-2 flex flex-wrap items-center gap-x-2">
                <span className="flex items-center gap-1 font-medium" style={{ color: conf[1] }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: conf[1] }} />{conf[0]}
                </span>
                {s.pct_fc_max && <span>{s.pct_fc_max} % de ta FC max</span>}
              </p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <Tuile label="Sorties stables" value={`${s.nb_stables} sur ${s.nb}`} sub="dérive sous 5 %, 12 mois" />
                <Tuile label="Haut de ta zone 2" value={s.z2_max ? `${s.z2_max} bpm` : "—"} sub={s.z2_max ? signe(s.fc - s.z2_max, " bpm") + " pour le seuil" : "zones non réglées"} />
              </div>
            </>
          ) : <Vide>{s.raison}</Vide>}
          <div className="space-y-2 mt-3">
            {s.message && <Message ton={s.message.ton}>{s.message.texte}</Message>}
            {s.note && <Message>{s.note}</Message>}
          </div>
        </div>
        {pts.length >= 2 && (
          <div className="lg:col-span-2 min-w-0">
            <ResponsiveContainer width="100%" height={230}>
              <ScatterChart margin={{ left: 4, right: 0, top: 14, bottom: 0 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="fc" type="number" domain={bornes} {...axeX} tickCount={6} unit="" />
                <YAxis dataKey="y" type="number" domain={[-3, DERIVE_MAX]} ticks={[0, 5, 10, 15]} {...axeY} width={34}
                  tickFormatter={(v) => (v >= DERIVE_MAX ? "15+" : `${v} %`)} />
                <ZAxis range={[70, 70]} />
                <Tooltip cursor={{ strokeDasharray: "3 3", stroke: GRIS, strokeOpacity: 0.4 }} content={<BulleDerive />} />
                <ReferenceLine y={s.seuil_derive} stroke={GRIS} strokeDasharray="4 4" strokeOpacity={0.8} />
                {s.z2_max && <ReferenceLine x={s.z2_max} stroke={GRIS} strokeOpacity={0.5}
                  label={{ value: "Z2", position: "top", fontSize: 10, fill: GRIS }} />}
                {s.fc && <ReferenceLine x={s.fc} stroke={VERT} strokeWidth={2}
                  label={{ value: "Seuil", position: "top", fontSize: 10, fill: VERT, dx: s.z2_max && Math.abs(s.z2_max - s.fc) < 6 ? (s.fc < s.z2_max ? -14 : 14) : 0 }} />}
                <Scatter data={pts} isAnimationActive={false}>
                  {pts.map((p) => <Cell key={p.activite_id} fill={p.stable ? VERT : ORANGE} fillOpacity={0.85} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
            <Legende items={[{ label: "Sortie stable (dérive < 5 %)", couleur: VERT }, { label: "Sortie qui dérive", couleur: ORANGE }]} />
            <p className="text-[11px] text-label-2 mt-1">En abscisse la FC moyenne de la sortie, en ordonnée sa dérive cardiaque.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── 2.11 Repères par âge ──────────────────────────────────────────────────
function Jauge({ pct, couleur, repere }) {
  return (
    <div className="relative h-2 rounded-full bg-remplissage mt-2.5 mb-1">
      <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, pct))}%`, background: couleur, opacity: 0.35 }} />
      {repere != null && <span className="absolute -top-1 h-4 w-px bg-label-3" style={{ left: `${repere}%` }} />}
      <span className="absolute top-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${Math.max(3, Math.min(97, pct))}%`, background: couleur }} />
    </div>
  );
}

function Repere({ l }) {
  let jauge = null;
  if (l.cle === "vo2max") {
    jauge = <><Jauge pct={l.centile} couleur={BLEU} repere={50} />
      <div className="flex justify-between text-[10px] text-label-3"><span>5 %</span><span>médiane</span><span>95 %</span></div></>;
  } else if (l.cle === "fc_repos") {
    const [mini, , , , , maxi] = l.echelle;
    jauge = <><Jauge pct={((maxi - l.valeur_num) / (maxi - mini)) * 100} couleur={ROUGE} />
      <div className="flex justify-between text-[10px] text-label-3"><span>{maxi} bpm</span><span>60</span><span>{mini} bpm</span></div></>;
  } else if (l.cle === "dix_km") {
    jauge = <><Jauge pct={l.pct_age} couleur={ORANGE} />
      <div className="flex justify-between text-[10px] text-label-3"><span>0 %</span><span>50 %</span><span>record du monde</span></div></>;
  }
  return (
    <div className="tuile px-3 py-3 min-w-0">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-[13px] font-medium text-label-2">{l.label}</p>
        <p className="font-rounded text-[19px] font-bold chiffres">{l.valeur}</p>
      </div>
      <p className="text-[13px] font-semibold first-letter:uppercase">{l.niveau}</p>
      {jauge}
      <p className="text-[12px] text-label leading-4 mt-2">{l.texte}</p>
      <p className="text-[11px] text-label-2 leading-[14px] mt-1 first-letter:uppercase">{l.source}.</p>
    </div>
  );
}

export function Reperes({ r }) {
  if (!r) return null;
  const vo2 = r.lignes.find((l) => l.cle === "vo2max");
  const ageForme = vo2 && (vo2.age_borne === "min" ? `${vo2.age_forme} ans ou moins` : vo2.age_borne === "max" ? `${vo2.age_forme} ans ou plus` : `${vo2.age_forme} ans`);
  return (
    <Card>
      <Entete titre="Âge de forme et repères" couleur={INDIGO} aide="reperes_age"
        sousTitre="Où tu te situes par rapport aux personnes de ton âge : un repère, pas une note" />
      {vo2 && (
        <div className="rounded-2xl px-4 py-3 mb-3 flex items-center justify-between gap-4 flex-wrap" style={{ background: `${INDIGO}1A` }}>
          <div className="min-w-0">
            <p className="text-[12px] font-medium" style={{ color: INDIGO }}>Âge de forme</p>
            <p className="font-rounded text-[26px] leading-8 font-bold chiffres">{ageForme}</p>
          </div>
          <p className="text-[13px] text-label-2 leading-[18px] max-w-md flex-1 min-w-[200px]">
            Ta VO2max est celle d'une personne médiane de cet âge. Tu as {r.age} ans
            {vo2.age_borne === "min" ? " : les tables ne descendent pas plus bas." : vo2.age_forme < r.age ? ` : ${r.age - vo2.age_forme} ans de moins au compteur.` : "."}
          </p>
        </div>
      )}
      {r.lignes.length > 0
        ? <div className="grid gap-2 md:grid-cols-3">{r.lignes.map((l) => <Repere key={l.cle} l={l} />)}</div>
        : !r.manque && <Vide>Il manque une VO2max, une FC de repos ou un 10 km : ils arrivent avec la montre (Intervals.icu) ou une course chronométrée.</Vide>}
      {r.manque && <div className="mt-2"><Message>{r.manque}</Message></div>}
    </Card>
  );
}

// ── 2.12 Simulateur « et si » ─────────────────────────────────────────────
const CTL_J = 42, ATL_J = 7;
const AFFUTAGES = [["0", "Aucun"], ["1", "1 semaine"], ["2", "2 semaines"]];
const NOMS_AFFUTAGE = { 0: "Sans affûtage", 1: "Affûtage 1 semaine", 2: "Affûtage 2 semaines" };

function etat(ctl, tsb) {
  if (ctl < 5) return ["—", GRIS];
  const r = tsb / ctl;
  if (r > 0.25) return ["Très frais", CYAN];
  if (r > 0.05) return ["Frais", VERT];
  if (r > -0.10) return ["Équilibré", GRIS];
  if (r > -0.30) return ["Fatigue productive", ORANGE];
  return ["Surcharge", ROUGE];
}

const isoPlus = (iso, k) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};

// Forme (CTL), fatigue (ATL) et fraîcheur (TSB du matin) jour par jour jusqu'au jour cible
function projeter(s, jours, affutage, volume) {
  const plan = new Map(s.plan.map((p) => [p.jour, p.charge]));
  let ctl = s.ctl, atl = s.atl;
  const out = [];
  for (let k = 1; k <= jours; k++) {
    const jour = isoPlus(s.auj, k);
    const tsb = ctl - atl;
    let c = s.plan_jusqua && jour <= s.plan_jusqua ? plan.get(jour) ?? 0 : s.habitude_hebdo / 7;
    c *= 1 + volume / 100;
    const reste = jours - k;
    if (affutage === 1 && reste < 7) c *= 0.6;
    if (affutage === 2) c *= reste < 7 ? 0.5 : reste < 14 ? 0.75 : 1;
    out.push({ jour, ctl, atl, tsb, surcharge: ctl >= 5 && tsb / ctl < -0.3 });
    ctl += (c - ctl) / CTL_J;
    atl += (c - atl) / ATL_J;
  }
  return out;
}

export function Simulateur({ s }) {
  const [affutage, setAffutage] = useState("1");
  const [volume, setVolume] = useState(0);
  const [horizon, setHorizon] = useState("8");
  const jours = s?.objectif ? s.objectif.jours : Number(horizon) * 7;
  const scenarios = useMemo(() => (s?.disponible ? [0, 1, 2].map((a) => projeter(s, jours, a, volume)) : []), [s, jours, volume]);
  const data = useMemo(() => {
    if (!scenarios.length) return [];
    const proj = scenarios[Number(affutage)];
    const passe = s.passe.map((p) => ({ jour: p.jour, forme: p.ctl, fraicheur: p.tsb }));
    const der = passe[passe.length - 1];
    return [
      ...passe.slice(0, -1),
      { ...der, forme_p: der.forme, fraicheur_p: der.fraicheur },
      ...proj.map((p) => ({ jour: p.jour, forme_p: Math.round(p.ctl * 10) / 10, fraicheur_p: Math.round(p.tsb * 10) / 10 })),
    ];
  }, [scenarios, affutage, s]);
  if (!s) return null;
  if (!s.disponible) {
    return <Card><Entete titre="Simulateur « et si »" couleur={BLEU} aide="simulateur" /><Vide>Il manque un historique : il faut quelques semaines de séances enregistrées pour projeter ta forme.</Vide></Card>;
  }
  const choisi = scenarios[Number(affutage)];
  const surcharge = choisi.find((p) => p.surcharge);
  const cible = s.objectif ? `${s.objectif.titre} · ${fmtDate(s.objectif.jour)}` : `Dans ${horizon} semaines · ${fmtDate(isoPlus(s.auj, jours))}`;
  return (
    <Card>
      <Entete titre="Simulateur « et si »" couleur={BLEU} aide="simulateur"
        sousTitre={s.objectif ? `Ta forme le jour de l'objectif, dans ${jours} jours` : "Ta forme projetée selon le plan des prochaines semaines"} />
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-5">
        <div className="lg:col-span-2 min-w-0 space-y-3">
          {!s.objectif && (
            <div>
              <p className="text-[12px] font-medium text-label-2 mb-1">Horizon</p>
              <Segmente options={[["4", "4 sem."], ["8", "8 sem."], ["12", "12 sem."]]} valeur={horizon} onChange={setHorizon} />
            </div>
          )}
          <div>
            <p className="text-[12px] font-medium text-label-2 mb-1">Affûtage avant le jour cible</p>
            <Segmente options={AFFUTAGES} valeur={affutage} onChange={setAffutage} />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="sim-volume" className="text-[12px] font-medium text-label-2">Volume d'entraînement</label>
              <span className="text-[13px] font-semibold chiffres">{volume === 0 ? "comme prévu" : signe(volume)}</span>
            </div>
            <input id="sim-volume" type="range" min={-30} max={30} step={5} value={volume}
              onChange={(e) => setVolume(Number(e.target.value))} className="w-full mt-1 accent-brand" />
            <div className="flex justify-between text-[10px] text-label-3"><span>−30 %</span><span>0</span><span>+30 %</span></div>
          </div>
          <div>
            <p className="text-[12px] font-medium text-label-2 mb-1">{cible}</p>
            <ul className="space-y-1.5">
              {scenarios.map((sc, i) => {
                const f = sc[sc.length - 1];
                const [nom, couleur] = etat(f.ctl, f.tsb);
                const actif = String(i) === affutage;
                return (
                  <li key={i}>
                    <button type="button" onClick={() => setAffutage(String(i))} aria-pressed={actif}
                      className={clsx("w-full text-left rounded-xl px-3 py-2 transition-colors", actif ? "bg-brand/[0.10] ring-1 ring-brand/40" : "bg-remplissage")}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold">{NOMS_AFFUTAGE[i]}</span>
                        <span className="text-[12px] font-semibold flex items-center gap-1 whitespace-nowrap" style={{ color: couleur }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: couleur }} />{nom}
                        </span>
                      </span>
                      <span className="text-[12px] text-label-2 chiffres block mt-0.5">
                        Forme {nombre(f.ctl, 0)} ({signe(((f.ctl - s.ctl) / (s.ctl || 1)) * 100)}) · fraîcheur {signe(f.tsb, "")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <div className="lg:col-span-3 min-w-0">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ left: 4, right: 0, top: 14 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="jour" {...axeX} tickFormatter={court} minTickGap={36} />
              <YAxis {...axeY} width={34} tickFormatter={(v) => nombre(v, 0)} />
              <Tooltip cursor={ligneCurseur} content={<InfoBulle format={(v) => nombre(v, 0)} />} labelFormatter={court} />
              <ReferenceLine y={0} stroke={GRIS} strokeOpacity={0.5} />
              <ReferenceLine x={s.auj} stroke={GRIS} strokeDasharray="4 4" label={{ value: "Aujourd'hui", position: "top", fontSize: 10, fill: GRIS }} />
              <Line dataKey="forme" name="Forme" stroke={BLEU} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line dataKey="fraicheur" name="Fraîcheur" stroke={VERT} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="forme_p" name="Forme projetée" stroke={BLEU} strokeWidth={2.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line dataKey="fraicheur_p" name="Fraîcheur projetée" stroke={VERT} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <Legende items={[{ label: "Forme (charge de fond)", couleur: BLEU }, { label: "Fraîcheur", couleur: VERT }]} />
          <p className="text-[11px] text-label-2 mt-1">Trait plein : 4 dernières semaines. Pointillés : projection.</p>
          <div className="space-y-2 mt-3">
            {surcharge && <Message ton="alerte">Avec ce volume, tu passes en surcharge autour du {fmtDate(surcharge.jour, { day: "numeric", month: "long" })} : la fatigue dépasse nettement ta forme de fond.</Message>}
            <Message>
              {s.plan.length > 0
                ? `Les séances du plan sont reprises telles quelles jusqu'au ${fmtDate(s.plan_jusqua, { day: "numeric", month: "long" })} ; au-delà, `
                : "Pas de séance planifiée : "}
              la projection suppose ta charge habituelle ({nombre(s.habitude_hebdo, 0)} par semaine, moyenne des 4 dernières).
            </Message>
          </div>
        </div>
      </div>
    </Card>
  );
}
