import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, ComposedChart, Area, ScatterChart, Scatter, ZAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import clsx from "clsx";
import Card from "../components/Card";
import Page from "../components/Page";
import { Section, Segmente } from "../components/ui";
import { axeX, axeY, grille, curseur, InfoBulle, Legende, GRIS } from "../components/graphiques";
import { getAnalyses } from "../api";
import { fmtAllureSec, fmtDate, nombre } from "../carnet";

const BLEU = "#007AFF";
const ORANGE = "#FF9500";
const VERT = "#34C759";
const CYAN = "#32ADE6";
const ROUGE = "#FF3B30";
const VIOLET = "#AF52DE";
const ROSE = "#FF2D55";
const INDIGO = "#5856D6";
const ZONES_COUL = ["#8E8E93", BLEU, VERT, ORANGE, ROUGE];
const ANNEES_COUL = [GRIS, CYAN, VIOLET, ORANGE];
const ligneCurseur = { stroke: GRIS, strokeOpacity: 0.3 };

const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const hms = (s) => {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
const signe = (v, d = 0) => (v == null ? "—" : `${v > 0 ? "+" : ""}${nombre(v, d)}`);

const ETATS = {
  frais_plus: "bg-ios-blue/15 text-ios-blue",
  frais: "bg-ios-green/15 text-ios-green",
  neutre: "bg-remplissage text-label-2",
  productif: "bg-ios-orange/15 text-ios-orange",
  surcharge: "bg-ios-red/15 text-ios-red",
};
const RECUP = {
  vert: { cls: "bg-ios-green/15 text-ios-green", label: "Récupéré", couleur: VERT },
  orange: { cls: "bg-ios-orange/15 text-ios-orange", label: "À surveiller", couleur: ORANGE },
  rouge: { cls: "bg-ios-red/15 text-ios-red", label: "Fatigué", couleur: ROUGE },
};

function Graphe({ titre, couleur, sousTitre, action, children, note }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: couleur }}>{titre}</p>
          {sousTitre && <p className="text-[13px] text-label-2">{sousTitre}</p>}
        </div>
        {action}
      </div>
      {children}
      {note && <p className="text-[12px] text-label-2 mt-3">{note}</p>}
    </Card>
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

const Vide = ({ children }) => <p className="text-[15px] text-label-2">{children}</p>;

// ── Forme / fatigue ────────────────────────────────────────────────────────
function FormeFatigue({ f }) {
  const [periode, setPeriode] = useState(180);
  const data = useMemo(() => (f?.points ?? []).slice(-periode).map((p) => ({ ...p, label: court(p.jour) })), [f, periode]);
  if (!f?.actuel) return <Card><Vide>Pas encore assez de séances pour calculer la forme.</Vide></Card>;
  const a = f.actuel;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card>
        <p className="text-[13px] font-semibold text-label-2">Aujourd'hui</p>
        <p className="font-rounded text-[34px] leading-10 font-bold chiffres mt-1">{signe(a.tsb)}</p>
        <span className={clsx("badge text-[12px]", ETATS[a.etat.code])}>{a.etat.label}</span>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Tuile label="Forme de fond (CTL)" value={nombre(a.ctl, 0)} />
          <Tuile label="Fatigue (ATL)" value={nombre(a.atl, 0)} />
          <Tuile label="Rampe 7 j" value={signe(a.rampe_7j, 1)} sub={a.rampe_pct != null ? `${signe(a.rampe_pct)} % de CTL` : null} />
          <Tuile label="Charge du jour" value={nombre(a.charge, 0)} />
        </div>
        <p className="text-[12px] text-label-3 mt-3">
          Fraîcheur (TSB) = forme de fond − fatigue de la veille. Une rampe au-delà de +5 à +8 par semaine fait grimper le risque de blessure.
        </p>
      </Card>
      <div className="lg:col-span-2 min-w-0">
        <Graphe titre="Forme, fatigue, fraîcheur" couleur={BLEU} sousTitre="Moyennes exponentielles 42 j / 7 j de la charge"
          action={<Segmente valeur={periode} onChange={setPeriode} options={[[90, "3 m"], [180, "6 m"], [365, "1 an"]]} />}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="label" {...axeX} minTickGap={32} />
              <YAxis {...axeY} />
              <Tooltip cursor={ligneCurseur} content={<InfoBulle format={(v) => nombre(v, 0)} />} />
              <ReferenceLine y={0} stroke={GRIS} strokeOpacity={0.5} />
              <Bar dataKey="tsb" name="Fraîcheur (TSB)" fill={VERT} fillOpacity={0.35} maxBarSize={4} />
              <Area dataKey="ctl" name="Forme (CTL)" stroke={BLEU} fill={BLEU} fillOpacity={0.12} strokeWidth={2.5} dot={false} />
              <Line dataKey="atl" name="Fatigue (ATL)" stroke={ROSE} strokeWidth={1.5} dot={false} />
              {(f.reperes ?? []).filter((r) => data.some((d) => d.jour === r.jour)).map((r) => (
                <ReferenceLine key={r.jour} x={court(r.jour)} stroke={ORANGE} strokeDasharray="3 3"
                  label={{ value: r.titre, position: "insideTopLeft", fontSize: 10, fill: ORANGE }} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          <Legende items={[{ label: "Forme (CTL)", couleur: BLEU }, { label: "Fatigue (ATL)", couleur: ROSE }, { label: "Fraîcheur (TSB)", couleur: VERT }]} />
        </Graphe>
      </div>
    </div>
  );
}

// ── Zones de FC ────────────────────────────────────────────────────────────
function Zones({ z }) {
  const data = useMemo(() => (z?.semaines ?? []).filter((s) => s.couvert_min > 0).map((s) => {
    const t = s.zones_min.reduce((a, b) => a + b, 0);
    const l = { label: court(s.semaine), heures: +(s.couvert_min / 60).toFixed(1) };
    s.zones_min.forEach((m, i) => { l[`z${i + 1}`] = t ? Math.round((m / t) * 100) : 0; });
    return l;
  }), [z]);
  if (!data.length) return <Card><Vide>Aucune séance avec la fréquence cardiaque détaillée pour l'instant.</Vide></Card>;
  const b4 = z.bilan_4s, b12 = z.bilan_12s;
  const verdict = b4.bas_pct == null ? null
    : b4.bas_pct >= 75 ? "Répartition polarisée respectée : l'essentiel en endurance facile."
      : b4.bas_pct >= 60 ? "Un peu trop de temps en intensité modérée : ralentis les sorties faciles."
        : "Trop d'intensité : la majorité du temps devrait se passer en zones 1-2.";
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card>
        <p className="text-[13px] font-semibold text-label-2">Répartition 80/20</p>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <Tuile label="Facile Z1-2" value={b4.bas_pct != null ? `${b4.bas_pct} %` : "—"} sub={b12.bas_pct != null ? `12 sem. : ${b12.bas_pct} %` : null} />
          <Tuile label="Tempo Z3" value={b4.modere_pct != null ? `${b4.modere_pct} %` : "—"} sub={b12.modere_pct != null ? `12 sem. : ${b12.modere_pct} %` : null} />
          <Tuile label="Dur Z4-5" value={b4.haut_pct != null ? `${b4.haut_pct} %` : "—"} sub={b12.haut_pct != null ? `12 sem. : ${b12.haut_pct} %` : null} />
        </div>
        {verdict && <p className="text-[13px] text-label-2 mt-3">{verdict}</p>}
        {z.bornes && (
          <div className="mt-3 space-y-1">
            {z.bornes.map((x, i) => (
              <p key={x.zone} className="flex items-center gap-2 text-[12px] text-label-2 chiffres">
                <span className="w-2 h-2 rounded-full" style={{ background: ZONES_COUL[i] }} />
                Z{x.zone} · {x.min == null ? `< ${x.max}` : x.max == null ? `> ${x.min}` : `${x.min}–${x.max}`} bpm
              </p>
            ))}
          </div>
        )}
        <p className="text-[12px] text-label-3 mt-3">4 dernières semaines · {nombre(b4.couvert_min / 60)} h avec FC sur {nombre(b4.total_min / 60)} h.</p>
      </Card>
      <div className="lg:col-span-2 min-w-0">
        <Graphe titre="Temps par zone" couleur={VERT} sousTitre="% du temps hebdomadaire · 26 semaines">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="label" {...axeX} minTickGap={24} />
              <YAxis {...axeY} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" />
              <Tooltip cursor={curseur} content={<InfoBulle format={(v) => `${v} %`} />} />
              <ReferenceLine y={80} stroke={GRIS} strokeDasharray="4 4" />
              {[1, 2, 3, 4, 5].map((i) => (
                <Bar key={i} dataKey={`z${i}`} name={`Zone ${i}`} stackId="z" fill={ZONES_COUL[i - 1]} maxBarSize={14}
                  radius={i === 5 ? [4, 4, 0, 0] : 0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <Legende items={[1, 2, 3, 4, 5].map((i) => ({ label: `Z${i}`, couleur: ZONES_COUL[i - 1] }))} />
        </Graphe>
      </div>
    </div>
  );
}

// ── Récupération ──────────────────────────────────────────────────────────
function Recuperation({ r }) {
  const data = useMemo(() => (r?.points ?? []).map((p) => ({
    ...p, label: court(p.jour),
    bande: p.vfc_bas != null && p.vfc_haut != null ? [p.vfc_bas, p.vfc_haut] : null,
  })), [r]);
  const sommeil = useMemo(() => data.filter((p) => p.sommeil != null).slice(-60), [data]);
  if (!data.some((p) => p.vfc != null || p.fc_repos != null || p.sommeil != null)) {
    return <Card><Vide>Pas encore de VFC, de FC au repos ni de sommeil enregistrés.</Vide></Card>;
  }
  const a = r.actuel, s = r.sommeil;
  const st = a?.statut ? RECUP[a.statut] : null;
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <p className="text-[13px] font-semibold text-label-2">Indice du jour{a?.jour ? ` · ${court(a.jour)}` : ""}</p>
          {st ? (
            <>
              <p className="font-rounded text-[34px] leading-10 font-bold chiffres mt-1" style={{ color: st.couleur }}>{signe(a.score, 1)}</p>
              <span className={clsx("badge text-[12px]", st.cls)}>{st.label}</span>
              <p className="text-[13px] text-label-2 mt-2">{a.message}</p>
            </>
          ) : <p className="text-[15px] text-label-2 mt-2">Il faut au moins 10 jours de mesures pour établir ta référence.</p>}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Tuile label="VFC" value={a?.vfc != null ? `${nombre(a.vfc, 0)} ms` : "—"} sub={a?.vfc_ref != null ? `réf. ${nombre(a.vfc_ref, 0)} ms` : null} />
            <Tuile label="FC repos" value={a?.fc_repos != null ? `${nombre(a.fc_repos, 0)} bpm` : "—"} sub={a?.fc_ref != null ? `réf. ${nombre(a.fc_ref, 0)} bpm` : null} />
            <Tuile label="Dernière nuit" value={s?.derniere ? `${nombre(s.derniere.heures)} h` : "—"} sub={s?.derniere ? court(s.derniere.jour) : null} />
            <Tuile label="Sommeil 7 j" value={s?.moy_7j != null ? `${nombre(s.moy_7j)} h` : "—"}
              sub={s?.moy_28j != null ? `28 j : ${nombre(s.moy_28j)} h · ${s.nuits_courtes_7j} nuit(s) < 7 h` : null} />
          </div>
          <p className="text-[12px] text-label-3 mt-3">Écart à ta moyenne des 60 jours précédents (en écarts-types) : VFC haute et FC repos basse = bien récupéré.</p>
        </Card>
        <div className="lg:col-span-2 min-w-0">
          <Graphe titre="Variabilité cardiaque" couleur={VIOLET} sousTitre="90 jours · bande = ta normale (réf. ± 1 écart-type)">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="label" {...axeX} minTickGap={32} />
                <YAxis {...axeY} domain={["auto", "auto"]} />
                <Tooltip cursor={ligneCurseur} content={<InfoBulle format={(v) => (Array.isArray(v) ? `${nombre(v[0], 0)}–${nombre(v[1], 0)}` : nombre(v, 0))} />} />
                <Area dataKey="bande" name="Normale" stroke="none" fill={VIOLET} fillOpacity={0.12} />
                <Line dataKey="vfc" name="VFC (ms)" stroke={VIOLET} strokeOpacity={0.35} strokeWidth={1} dot={{ r: 1.5, strokeWidth: 0, fill: VIOLET }} connectNulls />
                <Line dataKey="vfc_moy7" name="Moyenne 7 j" stroke={VIOLET} strokeWidth={2.5} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </Graphe>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Graphe titre="FC au repos" couleur={ROSE} sousTitre="90 jours">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="label" {...axeX} minTickGap={32} />
              <YAxis {...axeY} domain={["dataMin - 2", "dataMax + 2"]} />
              <Tooltip cursor={ligneCurseur} content={<InfoBulle format={(v) => `${nombre(v, 0)} bpm`} />} />
              <Line dataKey="fc_ref" name="Référence" stroke={GRIS} strokeDasharray="4 4" dot={false} connectNulls />
              <Line dataKey="fc_repos" name="FC repos" stroke={ROSE} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </Graphe>
        <Graphe titre="Sommeil" couleur={INDIGO} sousTitre="60 dernières nuits">
          {sommeil.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={sommeil} margin={{ left: 0, right: 0, top: 4 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="label" {...axeX} minTickGap={32} />
                <YAxis {...axeY} domain={[0, "dataMax + 1"]} />
                <Tooltip cursor={curseur} content={<InfoBulle format={(v) => `${nombre(v)} h`} />} />
                <ReferenceLine y={7} stroke={GRIS} strokeDasharray="4 4" />
                <Bar dataKey="sommeil" name="Sommeil" fill={INDIGO} radius={[3, 3, 0, 0]} maxBarSize={8} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Vide>Le sommeil arrive par Intervals.icu à la prochaine synchro.</Vide>}
        </Graphe>
      </div>
    </>
  );
}

// ── Course ────────────────────────────────────────────────────────────────
// ── VMA ────────────────────────────────────────────────────────────────────
const allureVma = (vma, pct) => (vma ? fmtAllureSec(3600 / (vma * pct)) : "—");

function Vma({ v }) {
  const [semaines, setSemaines] = useState(52);
  const data = useMemo(() => (v?.points ?? []).slice(-semaines).map((p) => ({ ...p, label: court(p.semaine) })), [v, semaines]);
  if (!v?.actuelle && !v?.tests?.length) {
    return <Card><Vide>Pas encore assez de sorties (ou de tests demi-Cooper) pour estimer ta VMA.</Vide></Card>;
  }
  const act = v.actuelle?.vma, t = v.dernier_test;
  const kmh = (x) => (x == null ? "—" : `${nombre(x, 1)} km/h`);
  return (
    <Graphe titre="Évolution de la VMA" couleur={VIOLET}
      sousTitre={act ? `Estimée aujourd'hui : ${nombre(act, 1)} km/h (${allureVma(act, 1)})` : null}
      action={<Segmente valeur={semaines} onChange={setSemaines} options={[[26, "6 m"], [52, "1 an"], [104, "2 ans"]]} />}
      note={`Les points violets sont tes tests demi-Cooper (distance en 6 min × 10). Entre deux tests, la VMA est estimée chaque semaine à partir de deux sources : tes meilleurs passages GPS des 8 dernières semaines (ramenés à la VMA selon la durée tenue) et le rapport vitesse / FC de réserve de tes sorties des 4 dernières semaines. Les deux sont calés sur tes tests (×${nombre(v.calage.efforts, 2)} et ×${nombre(v.calage.fc, 2)}). C'est une estimation : un nouveau test reste la référence.`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Tuile label="VMA estimée" value={kmh(act)} sub={v.actuelle ? `semaine du ${court(v.actuelle.semaine)}` : null} />
        <Tuile label="Dernier test" value={kmh(t?.vma)} sub={t ? fmtDate(t.date) : "aucun test"} />
        <Tuile label="Allure VMA (100 %)" value={allureVma(act ?? t?.vma, 1)} sub={`90 % : ${allureVma(act ?? t?.vma, 0.9)}`} />
        <Tuile label="Endurance (65-75 %)" value={allureVma(act ?? t?.vma, 0.7)} sub={`${allureVma(act ?? t?.vma, 0.75)} → ${allureVma(act ?? t?.vma, 0.65)}`} />
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ left: 0, right: 0, top: 8 }}>
          <CartesianGrid {...grille} />
          <XAxis dataKey="label" {...axeX} minTickGap={32} />
          <YAxis {...axeY} domain={[(m) => Math.floor(m - 0.5), (m) => Math.ceil(m + 0.5)]} width={36} allowDecimals={false} />
          <Tooltip cursor={ligneCurseur} content={<InfoBulle format={(x) => `${nombre(x, 1)} km/h`} />} />
          <Line dataKey="vma_efforts" name="Meilleurs efforts" stroke={ORANGE} strokeWidth={1.5} strokeOpacity={0.55} strokeDasharray="4 3" dot={false} connectNulls />
          <Line dataKey="vma_fc" name="FC de réserve" stroke={ROSE} strokeWidth={1.5} strokeOpacity={0.55} strokeDasharray="4 3" dot={false} connectNulls />
          <Line dataKey="estimee" name="VMA estimée" stroke={VIOLET} strokeWidth={3} dot={false} connectNulls />
          <Line dataKey="test" name="Test demi-Cooper" stroke="none" isAnimationActive={false}
            dot={{ r: 6, fill: VIOLET, stroke: "white", strokeWidth: 2 }} activeDot={{ r: 7 }} />
        </ComposedChart>
      </ResponsiveContainer>
      <Legende items={[{ label: "VMA estimée", couleur: VIOLET }, { label: "Meilleurs efforts", couleur: ORANGE }, { label: "FC de réserve", couleur: ROSE }]} />
    </Graphe>
  );
}

function Course({ c }) {
  const [dist, setDist] = useState("5 km");
  const preds = useMemo(() => (c?.predictions ?? []).filter((p) => p["5 km"] || p["10 km"]).map((p) => ({ ...p, label: court(p.semaine) })), [c]);
  const evol = useMemo(() => (c?.evolution ?? []).map((e) => ({ ...e, label: fmtDate(`${e.mois}-01`, { month: "short", year: "2-digit" }) })), [c]);
  const derives = useMemo(() => (c?.derives ?? []).map((d) => ({ ...d, label: court(d.date) })), [c]);
  const foulees = useMemo(() => (c?.foulees ?? []).map((f) => ({ ...f, label: court(f.date) })), [c]);
  const labels = c?.distances ?? ["1 km", "5 km", "10 km", "Semi"];
  if (!c || (!Object.keys(c.records ?? {}).length && !derives.length && !foulees.length)) {
    return <Card><Vide>Pas encore de sorties course ou trail avec tracé GPS.</Vide></Card>;
  }
  const dernier = preds[preds.length - 1];
  return (
    <>
      <Card pad={false}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4 pb-2">
          {labels.map((l) => {
            const r = c.records[l];
            return <Tuile key={l} label={`Record ${l}`} value={r?.temps_str ?? "—"} sub={r ? `${r.allure_str} · ${fmtDate(r.date)}` : null} />;
          })}
        </div>
        <p className="text-[12px] text-label-2 px-4 pb-4 pt-1">Meilleurs passages mesurés sur les tracés GPS (fenêtre glissante), même au milieu d'une sortie plus longue.</p>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Graphe titre="Top 5" couleur={ORANGE} action={<Segmente valeur={dist} onChange={setDist} options={labels.map((l) => [l, l])} />}>
          {(c.top?.[dist] ?? []).length ? (
            <div className="-mx-4 -mb-4">
              {c.top[dist].map((e, i) => (
                <div key={`${e.activite_id}-${i}`} className="ligne">
                  <span className="w-5 text-[13px] text-label-2 chiffres">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-[15px] truncate">{e.titre || fmtDate(e.date)}</span>
                  <span className="text-right">
                    <span className="block text-[15px] font-semibold chiffres">{e.temps_str}</span>
                    <span className="block text-[12px] text-label-2 chiffres">{e.allure_str} · {fmtDate(e.date)}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : <Vide>Aucun passage sur {dist} pour l'instant.</Vide>}
        </Graphe>

        <Graphe titre="Meilleur temps par mois" couleur={ORANGE} sousTitre={dist}>
          {evol.some((e) => e[dist]) ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={evol} margin={{ left: 0, right: 0, top: 4 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="label" {...axeX} minTickGap={24} />
                <YAxis {...axeY} reversed domain={["dataMin - 10", "dataMax + 10"]} width={48} tickFormatter={hms} />
                <Tooltip cursor={ligneCurseur} content={<InfoBulle format={hms} />} />
                <Line dataKey={dist} name={dist} stroke={ORANGE} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: ORANGE }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          ) : <Vide>Pas encore de données sur {dist}.</Vide>}
        </Graphe>
      </div>

      {preds.length > 1 && (
        <Graphe titre="Prédictions de course" couleur={BLEU}
          sousTitre={dernier ? `Aujourd'hui : 5 km ${hms(dernier["5 km"])} · 10 km ${hms(dernier["10 km"])} · semi ${hms(dernier.Semi)} · marathon ${hms(dernier.Marathon)}` : null}
          note="Estimées chaque semaine à partir de tes sorties des 90 jours précédents (formule de Riegel). Le marathon reste très optimiste sans grosses sorties longues.">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={preds} margin={{ left: 0, right: 0, top: 4 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="label" {...axeX} minTickGap={32} />
              <YAxis yAxisId="c" {...axeY} reversed domain={["dataMin - 30", "dataMax + 30"]} width={48} tickFormatter={hms} />
              <YAxis yAxisId="l" {...axeY} orientation="left" reversed domain={["dataMin - 120", "dataMax + 120"]} width={52} tickFormatter={hms} />
              <Tooltip cursor={ligneCurseur} content={<InfoBulle format={hms} />} />
              <Line yAxisId="c" dataKey="5 km" stroke={CYAN} strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="c" dataKey="10 km" stroke={BLEU} strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="l" dataKey="Semi" stroke={VIOLET} strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="l" dataKey="Marathon" stroke={INDIGO} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          <Legende items={[{ label: "5 km (droite)", couleur: CYAN }, { label: "10 km (droite)", couleur: BLEU }, { label: "Semi (gauche)", couleur: VIOLET }, { label: "Marathon (gauche)", couleur: INDIGO }]} />
        </Graphe>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Graphe titre="Dérive cardiaque" couleur={ROUGE} sousTitre="Sorties de 40 min et plus"
          note="Perte d'efficacité (vitesse / FC) entre la 1re et la 2e moitié, hors 10 premières minutes. Sous 5 % : endurance de base solide sur cette durée.">
          {derives.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={derives} margin={{ left: 0, right: 0, top: 4 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="label" {...axeX} minTickGap={24} />
                <YAxis {...axeY} unit="%" />
                <Tooltip cursor={curseur} content={<InfoBulle format={(v) => `${nombre(v)} %`} />} />
                <ReferenceLine y={5} stroke={ROUGE} strokeDasharray="4 4" />
                <Bar dataKey="derive_pct" name="Dérive" fill={ROUGE} fillOpacity={0.8} radius={[3, 3, 3, 3]} maxBarSize={12} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Vide>Calculée à partir du flux de FC d'Intervals.icu sur les sorties d'au moins 40 min.</Vide>}
        </Graphe>

        <Graphe titre="Cadence et foulée" couleur={CYAN} sousTitre="Par sortie">
          {foulees.length ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={foulees} margin={{ left: 0, right: 0, top: 4 }}>
                  <CartesianGrid {...grille} />
                  <XAxis dataKey="label" {...axeX} minTickGap={24} />
                  <YAxis yAxisId="c" {...axeY} domain={["dataMin - 5", "dataMax + 5"]} />
                  <YAxis yAxisId="f" {...axeY} orientation="left" domain={["dataMin - 0.05", "dataMax + 0.05"]} tickFormatter={(v) => nombre(v, 2)} />
                  <Tooltip cursor={ligneCurseur} content={<InfoBulle format={(v, p) => (p.dataKey === "foulee_m" ? `${nombre(v, 2)} m` : `${nombre(v, 0)} pas/min`)} />} />
                  <Line yAxisId="c" dataKey="cadence" name="Cadence" stroke={CYAN} strokeWidth={2} dot={{ r: 1.5, strokeWidth: 0, fill: CYAN }} connectNulls />
                  <Line yAxisId="f" dataKey="foulee_m" name="Foulée" stroke={ORANGE} strokeWidth={2} dot={{ r: 1.5, strokeWidth: 0, fill: ORANGE }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
              <Legende items={[{ label: "Cadence pas/min (droite)", couleur: CYAN }, { label: "Foulée m (gauche)", couleur: ORANGE }]} />
            </>
          ) : <Vide>Il faut le nombre de pas des sorties (raccourci Santé).</Vide>}
        </Graphe>
      </div>
    </>
  );
}

// ── Respect du plan ───────────────────────────────────────────────────────
function RespectPlan({ p }) {
  const data = useMemo(() => (p?.semaines ?? []).map((s) => ({
    ...s, label: court(s.semaine),
    h_prevue: +(s.duree_prevue_min / 60).toFixed(1), h_reelle: +(s.duree_reelle_min / 60).toFixed(1),
  })), [p]);
  if (!data.length) return <Card><Vide>Aucune séance prévue sur les 26 dernières semaines.</Vide></Card>;
  const b4 = p.bilan_4s, b12 = p.bilan_12s;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><Tuile label="Réalisées · 4 sem." value={b4.taux != null ? `${b4.taux} %` : "—"} sub={`${b4.realisees}/${b4.realisees + b4.sautees + b4.manquees} · 12 sem. : ${b12.taux ?? "—"} %`} /></Card>
        <Card><Tuile label="Sautées / manquées" value={`${b4.sautees} / ${b4.manquees}`} sub={`12 sem. : ${b12.sautees} / ${b12.manquees}`} /></Card>
        <Card><Tuile label="Durée vs prévu" value={b4.ecart_duree_pct != null ? `${signe(b4.ecart_duree_pct)} %` : "—"} sub={`12 sem. : ${b12.ecart_duree_pct != null ? signe(b12.ecart_duree_pct) + " %" : "—"}`} /></Card>
        <Card><Tuile label="RPE cible → réel" value={b4.nb_rpe ? `${nombre(b4.rpe_cible_moy)} → ${nombre(b4.rpe_reel_moy)}` : "—"} sub={b12.nb_rpe ? `12 sem. : ${nombre(b12.rpe_cible_moy)} → ${nombre(b12.rpe_reel_moy)}` : null} /></Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2 min-w-0">
          <Graphe titre="Séances par semaine" couleur={VERT} sousTitre="Réalisées, sautées, manquées">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="label" {...axeX} minTickGap={24} />
                <YAxis {...axeY} allowDecimals={false} />
                <Tooltip cursor={curseur} content={<InfoBulle />} />
                <Bar dataKey="realisees" name="Réalisées" stackId="s" fill={VERT} maxBarSize={14} />
                <Bar dataKey="sautees" name="Sautées" stackId="s" fill={ORANGE} maxBarSize={14} />
                <Bar dataKey="manquees" name="Manquées" stackId="s" fill={ROUGE} maxBarSize={14} />
                <Bar dataKey="a_venir" name="À venir" stackId="s" fill={GRIS} fillOpacity={0.35} maxBarSize={14} radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
            <Legende items={[{ label: "Réalisées", couleur: VERT }, { label: "Sautées", couleur: ORANGE }, { label: "Manquées", couleur: ROUGE }, { label: "À venir", couleur: GRIS }]} />
          </Graphe>
        </div>
        <Card pad={false} className="py-1">
          <p className="px-4 pt-3 pb-1 text-[13px] font-semibold text-label-2">Par sport · 12 semaines</p>
          {p.par_sport.length ? p.par_sport.map((s) => (
            <div key={s.sport} className="ligne">
              <span className="flex-1 text-[15px]">{s.label}</span>
              <span className="text-right">
                <span className="block text-[15px] font-semibold chiffres">{s.taux != null ? `${s.taux} %` : "—"}</span>
                <span className="block text-[12px] text-label-2 chiffres">
                  {s.realisees}/{s.prevues} · durée {s.ecart_duree_pct != null ? `${signe(s.ecart_duree_pct)} %` : "—"}
                </span>
              </span>
            </div>
          )) : <p className="px-4 pb-3 text-[15px] text-label-2">Rien sur 12 semaines.</p>}
        </Card>
      </div>
      <Graphe titre="Durée prévue vs réalisée" couleur={BLEU} sousTitre="Heures par semaine (séances rapprochées du plan)">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ left: 0, right: 0, top: 4 }} barGap={2}>
            <CartesianGrid {...grille} />
            <XAxis dataKey="label" {...axeX} minTickGap={24} />
            <YAxis {...axeY} />
            <Tooltip cursor={curseur} content={<InfoBulle format={(v) => `${nombre(v)} h`} />} />
            <Bar dataKey="h_prevue" name="Prévu" fill={GRIS} fillOpacity={0.45} radius={[3, 3, 0, 0]} maxBarSize={10} />
            <Bar dataKey="h_reelle" name="Réalisé" fill={BLEU} radius={[3, 3, 0, 0]} maxBarSize={10} />
          </BarChart>
        </ResponsiveContainer>
        <Legende items={[{ label: "Prévu", couleur: GRIS }, { label: "Réalisé", couleur: BLEU }]} />
      </Graphe>
    </>
  );
}

// ── Comparaison annuelle ──────────────────────────────────────────────────
const METRIQUES = [
  ["heures", "Heures", "h"], ["km_pied", "Km à pied", "km"], ["km", "Km total", "km"],
  ["dplus", "D+", "m"], ["charge", "Charge", ""], ["seances", "Séances", ""],
];

function Annuel({ y }) {
  const [m, setM] = useState("heures");
  if (!y?.annees?.length) return <Card><Vide>Pas encore d'historique.</Vide></Card>;
  const unite = METRIQUES.find((x) => x[0] === m)[2];
  const coul = (i) => (i === y.annees.length - 1 ? BLEU : ANNEES_COUL[(y.annees.length - 1 - i) % ANNEES_COUL.length]);
  const cour = y.a_date[y.a_date.length - 1];
  const prec = y.a_date[y.a_date.length - 2];
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2 min-w-0">
        <Graphe titre="Cumul depuis le 1er janvier" couleur={BLEU} sousTitre="Par semaine de l'année">
          <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 mb-3">
            <Segmente valeur={m} onChange={setM} options={METRIQUES.map(([k, l]) => [k, l])} />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={y.courbes[m]} margin={{ left: 0, right: 0, top: 4 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="semaine" {...axeX} tickFormatter={(s) => `S${s}`} minTickGap={24} />
              <YAxis {...axeY} width={44} />
              <Tooltip cursor={ligneCurseur} labelFormatter={(s) => `Semaine ${s}`}
                content={<InfoBulle format={(v) => `${nombre(v, m === "heures" ? 1 : 0)} ${unite}`} />} />
              {y.annees.map((a, i) => (
                <Line key={a} dataKey={String(a)} name={String(a)} stroke={coul(i)} dot={false}
                  strokeWidth={i === y.annees.length - 1 ? 3 : 1.5} strokeOpacity={i === y.annees.length - 1 ? 1 : 0.8} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <Legende items={y.annees.map((a, i) => ({ label: String(a), couleur: coul(i) }))} />
        </Graphe>
      </div>
      <Card pad={false} className="py-1">
        <p className="px-4 pt-3 pb-1 text-[13px] font-semibold text-label-2">À date (même jour de l'année)</p>
        {[...y.a_date].reverse().map((a) => (
          <div key={a.annee} className="ligne">
            <span className="flex-1 text-[15px] font-semibold">{a.annee}</span>
            <span className="text-right">
              <span className="block text-[15px] font-semibold chiffres">{nombre(a.heures, 0)} h · {nombre(a.km_pied, 0)} km</span>
              <span className="block text-[12px] text-label-2 chiffres">{a.seances} séances · {nombre(a.dplus, 0)} m D+</span>
            </span>
          </div>
        ))}
        {prec && prec.heures > 0 && (
          <p className="px-4 py-3 text-[13px] text-label-2">
            Volume horaire {cour.heures >= prec.heures ? "en hausse" : "en baisse"} de {nombre(Math.abs((cour.heures - prec.heures) / prec.heures * 100), 0)} % par rapport à {prec.annee} à la même date.
          </p>
        )}
      </Card>
    </div>
  );
}

// ── Corrélations ──────────────────────────────────────────────────────────
function Correlation({ c }) {
  const ok = c.r != null;
  const couleur = !ok || c.conforme == null ? GRIS : c.conforme ? VERT : ORANGE;
  return (
    <Graphe titre={c.titre} couleur={BLEU}
      sousTitre={ok ? `r = ${nombre(c.r, 2)} · ${c.force} · ${c.n} points` : `${c.n} point(s) · il en faut au moins 8`}
      action={ok && c.conforme != null ? (
        <span className={clsx("badge text-[11px] shrink-0", c.conforme ? "bg-ios-green/15 text-ios-green" : "bg-ios-orange/15 text-ios-orange")}>
          {c.conforme ? "Attendu" : "Inattendu"}
        </span>
      ) : null}
      note={c.explication}>
      {c.n ? (
        <ResponsiveContainer width="100%" height={180}>
          <ScatterChart margin={{ left: 0, right: 0, top: 4, bottom: 4 }}>
            <CartesianGrid {...grille} />
            <XAxis type="number" dataKey="x" name={c.x_label} {...axeX} domain={["auto", "auto"]} tickFormatter={(v) => nombre(v, 0)} />
            <YAxis type="number" dataKey="y" name={c.y_label} {...axeY} domain={["auto", "auto"]} width={40} tickFormatter={(v) => nombre(v, 1)} />
            <ZAxis range={[24, 24]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return (
                <div className="glass rounded-xl px-3 py-2 text-[12px]">
                  <p className="text-label-2 mb-1">{fmtDate(p.jour)}</p>
                  <p>{c.x_label} : <b className="chiffres">{nombre(p.x, 1)}</b></p>
                  <p>{c.y_label} : <b className="chiffres">{nombre(p.y, 2)}</b></p>
                </div>
              );
            }} />
            <Scatter data={c.points} fill={couleur} fillOpacity={0.6} />
          </ScatterChart>
        </ResponsiveContainer>
      ) : <Vide>Pas encore de données.</Vide>}
      <p className="text-[11px] text-label-3 mt-1">X : {c.x_label} · Y : {c.y_label}</p>
    </Graphe>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function Analyses() {
  const { data: a, isLoading, isError } = useQuery({ queryKey: ["analyses"], queryFn: getAnalyses, staleTime: 5 * 60_000 });

  if (isLoading) return <Page titre="Analyses"><p className="text-[15px] text-label-2">Calcul en cours…</p></Page>;
  if (isError || !a) return <Page titre="Analyses"><Card><Vide>Impossible de charger les analyses.</Vide></Card></Page>;

  return (
    <Page titre="Analyses" large sousTitre="Forme, récupération, performance">
      <Section titre="Forme et fatigue"><FormeFatigue f={a.forme} /></Section>
      <Section titre="Récupération"><Recuperation r={a.recuperation} /></Section>
      <Section titre="Intensité"><Zones z={a.zones} /></Section>
      <Section titre="Course à pied"><Vma v={a.vma} /><Course c={a.course} /></Section>
      <Section titre="Respect du plan"><RespectPlan p={a.plan} /></Section>
      <Section titre="Année par année"><Annuel y={a.annuel} /></Section>
      <Section titre="Corrélations">
        <div className="grid gap-3 md:grid-cols-2">
          {a.correlations.map((c) => <Correlation key={c.id} c={c} />)}
        </div>
        <p className="text-[12px] text-label-3 px-1">Corrélation n'est pas causalité : ces liens aident à repérer tes tendances personnelles, à confirmer sur la durée.</p>
      </Section>
    </Page>
  );
}
