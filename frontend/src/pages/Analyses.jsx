import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, ComposedChart, Area, ScatterChart, Scatter, ZAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import clsx from "clsx";
import Card from "../components/Card";
import Page from "../components/Page";
import { Section, Segmente } from "../components/ui";
import { axeX, axeY, grille, curseur, InfoBulle, Legende, GRIS } from "../components/graphiques";
import PoidsAnalyse from "../components/Poids";
import { RegulariteSommeil, RecupFc, AsymetrieMarche } from "../components/MesuresCompanion";
import api, { getAnalyses } from "../api";
import { fmtAllureSec, fmtDate, fmtDuree, nombre, sportInfo } from "../carnet";

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

function Graphe({ titre, couleur, sousTitre, action, children, note, className }) {
  return (
    <Card className={className}>
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
        <Graphe className="h-full" titre="Forme, fatigue, fraîcheur" couleur={BLEU} sousTitre="Moyennes exponentielles 42 j / 7 j de la charge"
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
        <Graphe className="h-full" titre="Temps par zone" couleur={VERT} sousTitre="% du temps hebdomadaire · 26 semaines">
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
          <Graphe className="h-full" titre="Variabilité cardiaque" couleur={VIOLET} sousTitre="90 jours · bande = ta normale (réf. ± 1 écart-type)">
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
    </>
  );
}

// ── Sommeil ───────────────────────────────────────────────────────────────
// Moyennes sur la période (la dernière nuit est détaillée dans le Résumé)
const moy7 = (m, unite, d = 0) => (m?.moy_7j != null ? `7 j : ${nombre(m.moy_7j, d)} ${unite}` : null);

// Phases (champs personnalisés remplis par Intervals Companion), en heures. La dernière nuit est détaillée dans le Résumé.
const PHASES = [
  { cle: "sommeil_profond", label: "Profond", couleur: INDIGO },
  { cle: "sommeil_leger", label: "Léger", couleur: BLEU },
  { cle: "sommeil_paradoxal", label: "Paradoxal", couleur: CYAN },
];
const aPhases = (p) => PHASES.some((f) => p[f.cle] != null);
// Temps éveillé pendant la nuit (hors durée de sommeil), empilé au-dessus des phases
const EVEIL = { cle: "sommeil_eveil", label: "Éveillé", couleur: "#FF7A6B" };
const hm = (h) => fmtDuree(Math.round(h * 60) * 60);

// Résumé des 28 dernières nuits : une ligne de colonnes sur ordinateur, score en tête sur téléphone
const Point = ({ couleur }) => <span aria-hidden className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: couleur }} />;
const Lab = ({ couleur, children }) => (
  <p className="flex items-center gap-1.5 text-[12px] text-label-2 truncate">{couleur && <Point couleur={couleur} />}{children}</p>
);
const Sous = ({ children }) => <p className="text-[11px] text-label-2 truncate min-h-[16px]">{children}</p>;
const Chiffre = ({ children, unite, petit }) => (
  <p className={clsx("font-rounded font-bold chiffres truncate", petit ? "text-[17px]" : "text-[22px] leading-7")}>
    {children}{unite && <span className={clsx("text-label-2 ml-1", petit ? "text-[11px] font-normal" : "text-[13px] font-semibold")}>{unite}</span>}
  </p>
);

function Courbe({ valeurs, couleur }) {
  if (valeurs.length < 2) return <div className="h-3.5 mt-0.5" />;
  const min = Math.min(...valeurs), et = Math.max(...valeurs) - min || 1;
  const pts = valeurs.map((v, i) => `${(i / (valeurs.length - 1)) * 100},${12 - ((v - min) / et) * 10}`).join(" ");
  return (
    <svg viewBox="0 0 100 14" preserveAspectRatio="none" className="block w-full h-3.5 mt-0.5" aria-hidden>
      <polyline fill="none" stroke={couleur} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

function Anneau({ score, taille, texte }) {
  const c = 2 * Math.PI * 15;
  return (
    <svg viewBox="0 0 36 36" style={{ width: taille, height: taille }} className="shrink-0" aria-hidden>
      <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3.5" className="stroke-remplissage" />
      <circle cx="18" cy="18" r="15" fill="none" stroke={VIOLET} strokeWidth="3.5" strokeLinecap="round"
        strokeDasharray={`${(Math.max(0, Math.min(score, 100)) / 100) * c} ${c}`} transform="rotate(-90 18 18)" />
      {texte && <text x="18" y="21.5" textAnchor="middle" className="fill-label font-rounded font-bold" style={{ fontSize: 10 }}>{Math.round(score)}</text>}
    </svg>
  );
}

// Durée moyenne sur une échelle de 10 h, trait au repère de 7 h
const JaugeDuree = ({ h }) => (
  <div className="relative h-[5px] rounded-full bg-remplissage overflow-hidden mt-1.5" aria-hidden>
    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(h / 10, 1) * 100}%`, background: INDIGO }} />
    <div className="absolute inset-y-0 left-[70%] w-[1.5px] bg-label-2" />
  </div>
);

function ResumeNuits({ s, points }) {
  const iso = (decalage) => new Date(Date.now() - decalage * 864e5).toLocaleDateString("sv");
  const depuis28 = iso(27);
  const serie = (cle) => points.filter((p) => p.jour >= depuis28 && p[cle] != null).map((p) => p[cle]);
  const parJour = Object.fromEntries(points.map((p) => [p.jour, p.sommeil]));
  const semaine = Array.from({ length: 7 }, (_, i) => parJour[iso(6 - i)]);
  const score = s?.score_sommeil?.derniere ? s.score_sommeil : null;
  const scoreAnneau = score ? score.moy_28j ?? score.derniere.valeur : null;
  const val = (v) => (v != null ? nombre(v, 0) : "—");
  const duree = s?.moy_28j != null ? hm(s.moy_28j) : "—";
  const avec7 = (m, unite) => `${unite}${m?.moy_7j != null ? ` · 7 j : ${nombre(m.moy_7j, 0)}` : ""}`;

  return (
    <Card pad={false} className="px-4 py-3.5 lg:px-1">
      <div className="hidden lg:block">
        <div className="flex items-baseline justify-between gap-3 px-3.5 pb-2">
          <p className="text-[13px] font-semibold">🌙 Tes nuits · 28 jours</p>
          <p className="text-[11px] text-label-2">7 j = moyenne des 7 dernières nuits</p>
        </div>
        <div className={clsx("grid divide-x-[0.5px] divide-separateur", score ? "grid-cols-5" : "grid-cols-4")}>
          <div className="px-3.5 min-w-0">
            <Lab couleur={INDIGO}>Durée</Lab>
            <Chiffre>{duree}</Chiffre>
            {s?.moy_28j != null && <JaugeDuree h={s.moy_28j} />}
            <div className="mt-1"><Sous>{s?.moy_7j != null ? `7 j : ${hm(s.moy_7j)} · repère 7 h` : "repère 7 h"}</Sous></div>
          </div>
          <div className="px-3.5 min-w-0">
            <Lab couleur={ORANGE}>Nuits courtes</Lab>
            <Chiffre unite={`/ ${s?.nb_7j ?? 0}`}>{s?.nuits_courtes_7j ?? 0}</Chiffre>
            <div className="flex gap-[3px] mt-1.5" aria-hidden>
              {semaine.map((h, i) => (
                <span key={i} className={clsx("flex-1 h-[5px] rounded-sm", h == null && "bg-remplissage")}
                  style={h != null ? { background: h < 7 ? ORANGE : INDIGO } : undefined} />
              ))}
            </div>
            <div className="mt-1"><Sous>moins de 7 h · 7 j</Sous></div>
          </div>
          <div className="px-3.5 min-w-0">
            <Lab couleur={ROSE}>FC sommeil</Lab>
            <Chiffre unite="bpm">{val(s?.fc_sommeil?.moy_28j)}</Chiffre>
            <Courbe valeurs={serie("fc_sommeil")} couleur={ROSE} />
            <Sous>{moy7(s?.fc_sommeil, "bpm")}</Sous>
          </div>
          <div className="px-3.5 min-w-0">
            <Lab couleur={CYAN}>SpO2 nocturne</Lab>
            <Chiffre unite="%">{val(s?.spo2?.moy_28j)}</Chiffre>
            <Courbe valeurs={serie("spo2")} couleur={CYAN} />
            <Sous>{moy7(s?.spo2, "%")}</Sous>
          </div>
          {score && (
            <div className="px-3.5 min-w-0 flex items-center gap-2">
              <Anneau score={scoreAnneau} taille={40} />
              <div className="min-w-0">
                <Lab couleur={VIOLET}>Score</Lab>
                <Chiffre>{val(score.moy_28j)}</Chiffre>
                <Sous>{moy7(score, "/100")}</Sous>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="lg:hidden">
        <div className="flex items-center gap-3">
          {score ? <Anneau score={scoreAnneau} taille={58} texte />
            : <span aria-hidden className="w-[58px] h-[58px] rounded-full bg-remplissage grid place-items-center text-2xl shrink-0">🌙</span>}
          <div className="flex-1 min-w-0">
            <Lab>{score && "🌙 "}Tes nuits · 28 jours</Lab>
            <Chiffre unite="par nuit">{duree}</Chiffre>
            {s?.moy_28j != null && <JaugeDuree h={s.moy_28j} />}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5 mt-3 pt-2.5 border-t-[0.5px] border-separateur">
          <div className="min-w-0">
            <Lab couleur={INDIGO}>7 derniers jours</Lab>
            <Chiffre petit unite={`· ${s?.nuits_courtes_7j ?? 0} nuit${(s?.nuits_courtes_7j ?? 0) > 1 ? "s" : ""} < 7 h`}>
              {s?.moy_7j != null ? hm(s.moy_7j) : "—"}
            </Chiffre>
          </div>
          {score ? (
            <div className="min-w-0">
              <Lab couleur={VIOLET}>Score 7 j</Lab>
              <Chiffre petit unite="/100">{val(score.moy_7j)}</Chiffre>
            </div>
          ) : (
            <div className="min-w-0">
              <Lab couleur={ORANGE}>Nuits mesurées 7 j</Lab>
              <Chiffre petit>{s?.nb_7j ?? 0}</Chiffre>
            </div>
          )}
          <div className="min-w-0">
            <Lab couleur={ROSE}>FC sommeil</Lab>
            <Chiffre petit unite={avec7(s?.fc_sommeil, "bpm")}>{val(s?.fc_sommeil?.moy_28j)}</Chiffre>
          </div>
          <div className="min-w-0">
            <Lab couleur={CYAN}>SpO2</Lab>
            <Chiffre petit unite={avec7(s?.spo2, "%")}>{val(s?.spo2?.moy_28j)}</Chiffre>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Nuits({ r }) {
  const nuits = useMemo(() => (r?.points ?? [])
    .filter((p) => p.sommeil != null || p.fc_sommeil != null || aPhases(p))
    .slice(-60)
    .map((p) => {
      if (!aPhases(p)) return { ...p, label: court(p.jour), duree: p.sommeil };
      // Temps de sommeil non classé dans une phase (écart entre la durée et la somme des phases)
      const reste = (p.sommeil ?? 0) - PHASES.reduce((t, f) => t + (p[f.cle] ?? 0), 0);
      return { ...p, label: court(p.jour), sommeil_autre: reste > 0.05 ? reste : null };
    }), [r]);
  const avecPhases = nuits.some(aPhases);
  const s = r?.sommeil;
  if (!nuits.length) {
    return <Card><Vide>Pas encore de nuit enregistrée : garde ta montre la nuit, le sommeil arrive par Intervals.icu à la synchro du matin.</Vide></Card>;
  }
  const spo2 = nuits.filter((p) => p.spo2 != null);
  const score = nuits.filter((p) => p.score_sommeil != null);
  const aFc = nuits.some((p) => p.fc_sommeil != null);
  const aEveil = nuits.some((p) => p[EVEIL.cle] != null);
  return (
    <>
      <ResumeNuits s={s} points={r?.points ?? []} />
      <Graphe titre="Durée et FC de la nuit" couleur={INDIGO}
        sousTitre={`${nuits.length} dernière${nuits.length > 1 ? "s" : ""} nuit${nuits.length > 1 ? "s" : ""} · barres = durée${avecPhases ? " par phase" : ""}${aEveil ? " + temps éveillé en haut" : ""}, ligne = FC moyenne pendant le sommeil`}
        note="Une FC nocturne plus haute que d'habitude signale souvent fatigue, stress, alcool ou maladie qui couve. Repère : 7 h de sommeil (pointillés).">
        {avecPhases && <Legende items={[...PHASES.map((f) => ({ label: f.label, couleur: f.couleur })), { label: "Sans phase", couleur: GRIS },
          ...(aEveil ? [{ label: EVEIL.label, couleur: EVEIL.couleur }] : [])]} />}
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={nuits} margin={{ left: 0, right: 0, top: 4 }}>
            <CartesianGrid {...grille} />
            <XAxis dataKey="label" {...axeX} minTickGap={32} />
            <YAxis yAxisId="h" {...axeY} domain={[0, (m) => Math.max(10, Math.ceil(m))]} allowDecimals={false} />
            {aFc && <YAxis yAxisId="fc" orientation="right" {...axeY} domain={["dataMin - 3", "dataMax + 3"]} />}
            <Tooltip cursor={curseur} content={<InfoBulle format={(v, p) => (p.dataKey === "fc_sommeil" ? `${nombre(v, 0)} bpm` : hm(v))} />} />
            <ReferenceLine yAxisId="h" y={7} stroke={GRIS} strokeDasharray="4 4" />
            <Bar yAxisId="h" dataKey="duree" name={avecPhases ? "Sans phase" : "Sommeil"} stackId="n" fill={avecPhases ? GRIS : INDIGO} fillOpacity={0.8} maxBarSize={10} />
            {avecPhases && PHASES.map((f) => (
              <Bar key={f.cle} yAxisId="h" dataKey={f.cle} name={f.label} stackId="n" fill={f.couleur} maxBarSize={10} />
            ))}
            {avecPhases && <Bar yAxisId="h" dataKey="sommeil_autre" name="Sans phase" stackId="n" fill={GRIS} maxBarSize={10} />}
            {aEveil && <Bar yAxisId="h" dataKey={EVEIL.cle} name={EVEIL.label} stackId="n" fill={EVEIL.couleur} maxBarSize={10} />}
            {aFc && <Line yAxisId="fc" dataKey="fc_sommeil" name="FC sommeil" stroke={ROSE} strokeWidth={2} dot={{ r: 2, strokeWidth: 0, fill: ROSE }} connectNulls />}
          </ComposedChart>
        </ResponsiveContainer>
      </Graphe>
      <div className="grid gap-3 lg:grid-cols-2">
        <Graphe titre="SpO2 nocturne" couleur={CYAN} sousTitre="saturation moyenne en oxygène pendant la nuit"
          note="Normalement entre 95 et 100 %. Des nuits régulièrement sous 93 % méritent d'en parler à un médecin.">
          {spo2.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={spo2} margin={{ left: 0, right: 0, top: 4 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="label" {...axeX} minTickGap={32} />
                <YAxis {...axeY} domain={[(min) => Math.min(Math.floor(min) - 1, 94), 100]} />
                <Tooltip cursor={ligneCurseur} content={<InfoBulle format={(v) => `${nombre(v, 0)} %`} />} />
                <ReferenceLine y={95} stroke={GRIS} strokeDasharray="4 4" />
                <Line dataKey="spo2" name="SpO2" stroke={CYAN} strokeWidth={2} dot={{ r: 2, strokeWidth: 0, fill: CYAN }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          ) : <Vide>Pas de SpO2 transmise pour ces nuits.</Vide>}
        </Graphe>
        <Graphe titre="Score de sommeil" couleur={VIOLET} sousTitre={score.length ? "sur 100, calculé par Intervals Companion" : "pas encore reçu"}
          note="Apple ne partage son propre score avec aucune autre app : celui-ci est calculé par Intervals Companion à partir de la nuit, il peut donc différer de quelques points de celui de l'app Santé.">
          {score.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={score} margin={{ left: 0, right: 0, top: 4 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="label" {...axeX} minTickGap={32} />
                <YAxis {...axeY} domain={[0, 100]} />
                <Tooltip cursor={curseur} content={<InfoBulle format={(v) => `${nombre(v, 0)} / 100`} />} />
                <Bar dataKey="score_sommeil" name="Score" fill={VIOLET} radius={[3, 3, 0, 0]} maxBarSize={10} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Vide>Active « Sleep score » dans l'app Intervals Companion : le score arrivera à la synchro suivante.</Vide>}
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

const DISTANCES_PRED = [["5 km", 5], ["10 km", 10], ["Semi", 21.0975], ["Marathon", 42.195]];
const allureKm = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

function Course({ c }) {
  const [dist, setDist] = useState("5 km");
  const [survolPred, setSurvolPred] = useState(null);  // semaine survolée (index), sinon la dernière
  const preds = useMemo(() => (c?.predictions ?? []).filter((p) => p["5 km"] || p["10 km"]).map((p) => ({ ...p, label: court(p.semaine) })), [c]);
  const evol = useMemo(() => (c?.evolution ?? []).map((e) => ({ ...e, label: fmtDate(`${e.mois}-01`, { month: "short", year: "2-digit" }) })), [c]);
  const derives = useMemo(() => (c?.derives ?? []).map((d) => ({ ...d, label: court(d.date) })), [c]);
  const labels = c?.distances ?? ["1 km", "5 km", "10 km", "Semi"];
  if (!c || (!Object.keys(c.records ?? {}).length && !derives.length && !c.durabilites?.length)) {
    return <Card><Vide>Pas encore de sorties course ou trail avec tracé GPS.</Vide></Card>;
  }
  const pointPred = preds[survolPred ?? preds.length - 1];
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
          sousTitre={pointPred ? (survolPred == null ? "Aujourd'hui" : `Semaine du ${fmtDate(pointPred.semaine)}`) : null}
          note="Les quatre temps viennent de ta meilleure sortie des 90 jours précédents (formule de Riegel) : ils évoluent ensemble, d'où une seule courbe. Plus elle monte, plus tu vas vite ; elle reste à plat tant que cette sortie est dans la fenêtre. Survole ou touche la courbe pour voir les temps d'une semaine. Le marathon reste très optimiste sans grosses sorties longues.">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 min-w-0">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={preds} margin={{ left: 0, right: 8, top: 4 }}
                  onMouseMove={(e) => setSurvolPred(e?.activeTooltipIndex ?? null)} onMouseLeave={() => setSurvolPred(null)}>
                  <CartesianGrid {...grille} />
                  <XAxis dataKey="label" {...axeX} minTickGap={32} />
                  <YAxis hide reversed domain={[(m) => m * 0.97, (m) => m * 1.03]} />
                  <Tooltip cursor={ligneCurseur} content={() => null} />
                  <Line dataKey="10 km" stroke={BLEU} strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: BLEU, stroke: "white", strokeWidth: 2 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {pointPred && (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-2 gap-2 md:w-80 md:self-center shrink-0">
                {DISTANCES_PRED.map(([d, km]) => (
                  <Tuile key={d} label={d} value={pointPred[d] ? hms(pointPred[d]) : "—"} sub={pointPred[d] ? `${allureKm(pointPred[d] / km)}/km` : null} />
                ))}
              </div>
            )}
          </div>
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

        <Durabilite d={c.durabilites} />
      </div>
    </>
  );
}

// ── Axe du temps (points par sortie + médianes mensuelles sur le même graphique) ──
const ts = (iso) => new Date(`${iso.slice(0, 10)}T12:00`).getTime();
const moisCourt = (m) => fmtDate(`${m}-01`, { month: "short", year: "2-digit" });
const axeTemps = {
  type: "number", dataKey: "t", scale: "time", domain: ["dataMin", "dataMax"], minTickGap: 32,
  tickFormatter: (t) => new Date(t).toLocaleDateString("fr-FR", { month: "short" }),
};
// L'axe numérique passe un horodatage en libellé : on affiche celui de la ligne survolée
const InfoBulleT = (props) => <InfoBulle {...props} label={props.payload?.[0]?.payload?.label} />;
const enTemps = (pts, cle, mois, cleMois) => [
  ...pts.map((p) => ({ ...p, t: ts(p.date), label: p.titre ? `${fmtDate(p.date)} · ${p.titre}` : fmtDate(p.date) })),
  ...mois.map((m) => ({ t: ts(`${m.mois}-15`), label: `Médiane de ${fmtDate(`${m.mois}-01`, { month: "long", year: "numeric" })}`, [cleMois]: m[cle] })),
].sort((a, b) => a.t - b.t);

function Variation({ recent, ancien, sens = 1, dec = 0, unite = "" }) {
  if (recent == null || ancien == null || recent === ancien) return null;
  const d = recent - ancien;
  const bon = sens === 0 ? null : d * sens > 0;
  return (
    <span className={clsx("font-semibold", bon == null ? "text-label-2" : bon ? "text-ios-green" : "text-ios-red")}>
      {d > 0 ? "▲" : "▼"} {nombre(Math.abs(d), dec)}{unite && ` ${unite}`}
    </span>
  );
}

// ── Monotonie et contrainte (Foster) ──────────────────────────────────────
const MONOTONIE = {
  varie: { cls: "bg-ios-green/15 text-ios-green", label: "Semaine variée" },
  surveiller: { cls: "bg-ios-orange/15 text-ios-orange", label: "À surveiller" },
  uniforme: { cls: "bg-ios-red/15 text-ios-red", label: "Trop uniforme" },
};

function Monotonie({ m }) {
  const data = useMemo(() => (m?.semaines ?? []).map((s) => ({ ...s, label: court(s.semaine) })), [m]);
  const a = m?.actuel;
  if (!data.length && !a) return null;
  const niv = a?.niveau ? MONOTONIE[a.niveau] : null;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card>
        <p className="text-[13px] font-semibold text-label-2">Monotonie · 7 derniers jours</p>
        <p className="font-rounded text-[34px] leading-10 font-bold chiffres mt-1">{a?.monotonie != null ? nombre(a.monotonie, 1) : "—"}</p>
        {niv && <span className={clsx("badge text-[12px]", niv.cls)}>{niv.label}</span>}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Tuile label="Charge 7 j" value={a ? nombre(a.charge, 0) : "—"} />
          <Tuile label="Contrainte" value={a?.contrainte != null ? nombre(a.contrainte, 0) : "—"}
            sub={a?.contrainte_pct != null ? `${signe(a.contrainte_pct)} % vs 12 sem.` : null} />
        </div>
        <p className="text-[12px] text-label-3 mt-3">
          Monotonie = charge moyenne du jour ÷ son écart-type sur la semaine. Au-dessus de 2, les jours se ressemblent trop :
          alterne vraies journées faciles (ou repos) et séances dures. Contrainte = charge × monotonie : un pic au-dessus de ta normale précède souvent maladie ou blessure.
        </p>
      </Card>
      <div className="lg:col-span-2 min-w-0">
        <Graphe className="h-full" titre="Contrainte et monotonie" couleur={ORANGE} sousTitre="Par semaine complète · 26 semaines">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="label" {...axeX} minTickGap={24} />
              <YAxis yAxisId="c" {...axeY} width={44} />
              <YAxis yAxisId="m" orientation="right" {...axeY} domain={[0, (x) => Math.max(3, Math.ceil(x))]} width={28} />
              <Tooltip cursor={curseur} content={<InfoBulle format={(v, p) => nombre(v, p.dataKey === "monotonie" ? 1 : 0)} />} />
              <ReferenceLine yAxisId="m" y={2} stroke={ROUGE} strokeDasharray="4 4" />
              <Bar yAxisId="c" dataKey="contrainte" name="Contrainte" fill={ORANGE} fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Line yAxisId="m" dataKey="monotonie" name="Monotonie" stroke={VIOLET} strokeWidth={2.5} dot={{ r: 2, strokeWidth: 0, fill: VIOLET }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <Legende items={[{ label: "Contrainte (gauche)", couleur: ORANGE }, { label: "Monotonie (droite, seuil 2)", couleur: VIOLET }]} />
        </Graphe>
      </div>
    </div>
  );
}

// ── Signaux de la nuit (respiration, SpO2) ─────────────────────────────────
const SIGNAUX = {
  respiration: { label: "Respiration", unite: "/min", couleur: CYAN, dec: 1 },
  spo2: { label: "SpO2", unite: "%", couleur: BLEU, dec: 1 },
};

function SignauxNuit({ s }) {
  const [cle, setCle] = useState("respiration");
  const data = useMemo(() => (s?.points ?? []).map((p) => ({ ...p, label: court(p.jour) })), [s]);
  const a = s?.actuel;
  const info = SIGNAUX[cle];
  const aDonnees = data.some((p) => p[cle] != null);
  if (!a && !data.some((p) => p.respiration != null || p.spo2 != null)) {
    return (
      <Graphe titre="Signaux de la nuit" couleur={CYAN}>
        <Vide>La fréquence respiratoire et la SpO2 de la nuit arrivent par Intervals Companion : active-les dans l'app pour qu'elles soient comparées à ta normale chaque matin.</Vide>
      </Graphe>
    );
  }
  return (
    <Graphe titre="Signaux de la nuit" couleur={a?.alerte ? ROUGE : CYAN}
      sousTitre={a?.jour ? `Nuit du ${fmtDate(a.jour, { weekday: "long", day: "numeric", month: "long" })}` : "Pas de mesure ces deux dernières nuits"}
      action={a ? (
        <span className={clsx("badge text-[11px] shrink-0", a.alerte ? "bg-ios-red/15 text-ios-red" : "bg-ios-green/15 text-ios-green")}>
          {a.alerte ? "Inhabituelle" : "Normale"}
        </span>
      ) : null}
      note={`Comparés à tes 28 nuits précédentes. Une respiration plus rapide d'au moins 1 /min ou une SpO2 en baisse de 2 points (ou sous 93 %) annoncent souvent une infection qui couve, avant même les symptômes. ${s.nuits_alerte_60j} nuit(s) inhabituelle(s) sur 60 jours.`}>
      {a?.message && <p className={clsx("rounded-xl px-3 py-2 text-[13px] leading-[18px] mb-3", a.alerte ? "bg-ios-red/[0.12] text-ios-red" : "bg-remplissage text-label-2")}>{a.message}</p>}
      {a?.signaux?.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {a.signaux.map((x) => (
            <Tuile key={x.type} label={x.label}
              value={<span className={x.alerte ? "text-ios-red" : undefined}>{nombre(x.valeur, SIGNAUX[x.type]?.dec ?? 1)} {x.unite}</span>}
              sub={x.ref != null ? `normale ${nombre(x.ref, SIGNAUX[x.type]?.dec ?? 1)} · ${signe(x.ecart, 1)}` : "référence en construction"} />
          ))}
        </div>
      )}
      <Segmente className="mb-3" valeur={cle} onChange={setCle} options={Object.entries(SIGNAUX).map(([k, v]) => [k, v.label])} />
      {aDonnees ? (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ left: 0, right: 0, top: 6 }}>
            <CartesianGrid {...grille} />
            <XAxis dataKey="label" {...axeX} minTickGap={32} />
            <YAxis {...axeY} domain={["dataMin - 1", "dataMax + 1"]} width={32} tickFormatter={(v) => nombre(v, 0)} />
            <Tooltip cursor={ligneCurseur} content={<InfoBulle format={(v) => `${nombre(v, 1)} ${info.unite}`} />} />
            <Line dataKey={`${cle}_ref`} name="Ta normale" stroke={GRIS} strokeDasharray="4 4" dot={false} connectNulls />
            <Line dataKey={cle} name={info.label} stroke={info.couleur} strokeWidth={2} connectNulls isAnimationActive={false}
              dot={(p) => (p.value == null ? <g key={p.key} /> : (
                <circle key={p.key} cx={p.cx} cy={p.cy} r={p.payload.alerte ? 4 : 1.5} fill={p.payload.alerte ? ROUGE : info.couleur}
                  stroke={p.payload.alerte ? "white" : "none"} strokeWidth={1.5} />
              ))} />
          </LineChart>
        </ResponsiveContainer>
      ) : <Vide>Pas de {info.label.toLowerCase()} transmise pour ces nuits.</Vide>}
      <Legende items={[{ label: info.label, couleur: info.couleur }, { label: "Ta normale", couleur: GRIS }, { label: "Nuit inhabituelle", couleur: ROUGE }]} />
    </Graphe>
  );
}

// ── Pas quotidiens ─────────────────────────────────────────────────────────
// 3 mois : jour par jour ; 1 an : moyenne par semaine ; tout : par semaine jusqu'à 2 ans, puis par mois
const PERIODES_PAS = [["3m", "3 mois"], ["1a", "1 an"], ["tout", "Tout"]];

function Pas({ p }) {
  const [periode, setPeriode] = useState("3m");
  const milliers = (v) => (v == null ? "—" : nombre(Math.round(v), 0));
  const vue = useMemo(() => {
    if (!p?.points?.length) return null;
    if (periode === "3m") {
      return { data: p.points.slice(-90).map((x) => ({ ...x, label: court(x.jour) })), pas: "jour",
        moyenne: p.moy_90j, labelMoy: "Moyenne 90 j", sousTitre: "90 jours · ligne = moyenne 7 jours" };
    }
    const fmt = (x, opts) => ({ ...x, label: new Date(x.jour).toLocaleDateString("fr-FR", opts) });
    if (periode === "1a") {
      return { data: p.semaines.slice(-52).map((x) => fmt(x, { day: "numeric", month: "short" })), pas: "semaine",
        moyenne: p.moy_365j, labelMoy: "Moyenne 1 an", sousTitre: "12 mois · moyenne par semaine" };
    }
    const parMois = p.semaines.length > 104;
    const debutTxt = p.premier ? new Date(p.premier).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "";
    return { data: (parMois ? p.mois : p.semaines).map((x) => fmt(x, { month: "short", year: "2-digit" })),
      pas: parMois ? "mois" : "semaine", moyenne: p.moy_tout, labelMoy: "Moyenne totale",
      sousTitre: `Depuis ${debutTxt} · moyenne par ${parMois ? "mois" : "semaine"}` };
  }, [p, periode]);

  if (!vue) {
    return (
      <Graphe titre="Pas quotidiens" couleur={VERT}
        note="Dans l'app Santé : Partage › Apps › Intervals Companion, autorise « Pas ». Puis, dans Intervals Companion, active la synchro des pas : ils arrivent avec le reste à la synchro du matin.">
        <Vide>Aucun nombre de pas reçu pour l'instant.</Vide>
      </Graphe>
    );
  }
  const jour = vue.pas === "jour";
  // Graduations rondes : tous les 5 000 pas (2 500 si les valeurs restent basses)
  const max = Math.max(10000, ...vue.data.map((x) => x.pas ?? 0));
  const palier = max > 12000 ? 5000 : 2500;
  const ticks = Array.from({ length: Math.ceil(max / palier) + 1 }, (_, i) => i * palier);
  return (
    <Graphe titre="Pas quotidiens" couleur={VERT} sousTitre={vue.sousTitre}
      note="L'activité hors entraînement compte dans la fatigue : une journée à 20 000 pas la veille d'une séance dure se ressent.">
      <Segmente className="mb-3" valeur={periode} onChange={setPeriode} options={PERIODES_PAS} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Tuile label="Dernier jour" value={milliers(p.derniere?.pas)} sub={p.derniere ? court(p.derniere.jour) : null} />
        <Tuile label="Moyenne 7 j" value={milliers(p.moy_7j)} sub={p.moy_28j != null ? `28 j : ${milliers(p.moy_28j)}` : null} />
        <Tuile label={vue.labelMoy} value={milliers(vue.moyenne)} />
        <Tuile label="Jours ≥ 10 000" value={`${p.jours_10k_28j ?? 0}`} sub="sur 28 jours" />
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={vue.data} margin={{ left: 0, right: 0, top: 4 }}>
          <CartesianGrid {...grille} />
          <XAxis dataKey="label" {...axeX} minTickGap={32} />
          <YAxis {...axeY} width={36} ticks={ticks} domain={[0, ticks[ticks.length - 1]]}
            tickFormatter={(v) => `${nombre(v / 1000, v % 1000 ? 1 : 0)}k`} />
          <Tooltip cursor={curseur} content={<InfoBulle format={(v) => `${milliers(v)} pas${jour ? "" : " / jour"}`} />} />
          <ReferenceLine y={10000} stroke={GRIS} strokeDasharray="4 4" />
          <Bar dataKey="pas" name={{ jour: "Pas", semaine: "Moyenne de la semaine", mois: "Moyenne du mois" }[vue.pas]}
            fill={VERT} fillOpacity={jour ? 0.45 : 0.7} radius={[2, 2, 0, 0]} maxBarSize={jour ? 8 : 14} />
          {jour && <Line dataKey="moy7" name="Moyenne 7 j" stroke={VERT} strokeWidth={2.5} dot={false} connectNulls />}
        </ComposedChart>
      </ResponsiveContainer>
    </Graphe>
  );
}

// ── Sommeil : dette et régularité ─────────────────────────────────────────
const BESOINS = [[7, "7 h"], [7.5, "7 h 30"], [8, "8 h"], [8.5, "8 h 30"], [9, "9 h"]];

function DetteSommeil({ s }) {
  const qc = useQueryClient();
  const changer = useMutation({
    mutationFn: (besoin_sommeil_h) => api.patch("/utilisateur/infos", { besoin_sommeil_h }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analyses"] }),
  });
  const data = useMemo(() => (s?.points ?? []).map((p) => ({ ...p, label: court(p.jour) })), [s]);
  if (!s || !data.length) return null;
  const besoin = changer.isPending ? changer.variables : s.besoin_h;
  const reg = s.regularite_min;
  const verdictReg = reg == null ? null : reg <= 30 ? "régulier" : reg <= 60 ? "assez variable" : "irrégulier";
  const e = s.effet_vfc;
  const dette = (v) => (v == null ? "—" : v <= 0 ? "Aucune" : hm(v));
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card>
        <p className="text-[13px] font-semibold text-label-2">Dette de sommeil · 7 nuits</p>
        <p className={clsx("font-rounded text-[34px] leading-10 font-bold chiffres mt-1", s.dette_7j > 5 ? "text-ios-red" : s.dette_7j > 2 ? "text-ios-orange" : "text-ios-green")}>
          {dette(s.dette_7j)}
        </p>
        <p className="text-[12px] text-label-2">{s.nuits_7j} nuit(s) mesurée(s) · besoin {hm(s.besoin_h)} par nuit</p>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Tuile label="Dette 14 nuits" value={dette(s.dette_14j)} sub={s.nuits_14j ? `${s.nuits_14j} nuits mesurées` : null} />
          <Tuile label="Régularité" value={reg != null ? `± ${nombre(reg, 0)} min` : "—"} sub={verdictReg ? `durée ${verdictReg}` : "il faut 7 nuits"} />
        </div>
        {e && e.ecart_pct != null && (
          <p className="text-[13px] text-label-2 mt-3">
            Après une nuit courte (moins de {hm(s.besoin_h - 1)}), ta VFC est en moyenne à <b className="chiffres text-label">{nombre(e.vfc_courtes, 0)} ms</b> contre{" "}
            <b className="chiffres text-label">{nombre(e.vfc_normales, 0)} ms</b> après une nuit complète ({signe(e.ecart_pct)} %, {e.n_courtes} et {e.n_normales} nuits).
          </p>
        )}
        <p className="text-[13px] font-semibold text-label-2 mt-4 mb-2">Ton besoin de sommeil</p>
        <div className="overflow-x-auto scrollbar-hide">
          <Segmente valeur={besoin} onChange={(v) => v !== s.besoin_h && changer.mutate(v)} options={BESOINS} />
        </div>
        {changer.isError && <p className="text-[12px] text-ios-red mt-2">Enregistrement impossible, réessaie.</p>}
      </Card>
      <div className="lg:col-span-2 min-w-0">
        <Graphe className="h-full" titre="Durée des nuits et dette" couleur={INDIGO} sousTitre="60 jours · barres = nuit, ligne = dette cumulée sur 7 nuits"
          note="La dette additionne ce qui manque chaque nuit par rapport à ton besoin, sur les 7 dernières nuits (une nuit plus longue la rembourse en partie). Au-delà de 5 h, vigilance et récupération baissent nettement.">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="label" {...axeX} minTickGap={32} />
              <YAxis yAxisId="h" {...axeY} domain={[0, (m) => Math.max(10, Math.ceil(m))]} allowDecimals={false} width={28} />
              <YAxis yAxisId="d" orientation="right" {...axeY} width={28} allowDecimals={false} />
              <Tooltip cursor={curseur} content={<InfoBulle format={(v) => hm(v)} />} />
              <ReferenceLine yAxisId="h" y={s.besoin_h} stroke={GRIS} strokeDasharray="4 4" />
              <Bar yAxisId="h" dataKey="heures" name="Nuit" radius={[2, 2, 0, 0]} maxBarSize={10}>
                {data.map((p) => <Cell key={p.jour} fill={p.heures != null && p.heures < s.besoin_h - 1 ? ORANGE : INDIGO} fillOpacity={0.8} />)}
              </Bar>
              <Line yAxisId="d" dataKey="dette_7j" name="Dette 7 nuits" stroke={ROUGE} strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <Legende items={[{ label: "Nuit", couleur: INDIGO }, { label: `Nuit courte (< ${hm(s.besoin_h - 1)})`, couleur: ORANGE }, { label: "Dette 7 nuits (droite)", couleur: ROUGE }]} />
        </Graphe>
      </div>
    </div>
  );
}

// ── Courbe des meilleurs efforts et allure critique ────────────────────────
function EffortsDuree({ e }) {
  const data = useMemo(() => (e?.courbe ?? []).map((c) => ({
    label: c.label, actuel: c.actuel?.allure_sec_km ?? null,
    an_dernier: c.an_dernier?.allure_sec_km ?? null, record: c.record?.allure_sec_km ?? null,
  })), [e]);
  const hist = useMemo(() => (e?.historique ?? []).filter((h) => h.allure_sec_km != null).map((h) => ({ ...h, label: moisCourt(h.mois) })), [e]);
  if (!data.some((d) => d.record != null)) return null;
  const vc = e.vc, vca = e.vc_an_dernier;
  const allure = (s) => (s == null ? "—" : `${allureKm(s)}/km`);
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card>
        <p className="text-[13px] font-semibold text-label-2">Allure critique · 90 jours</p>
        <p className="font-rounded text-[34px] leading-10 font-bold chiffres mt-1">{vc ? allure(vc.allure_sec_km) : "—"}</p>
        <p className="text-[12px] text-label-2">{vc ? `${nombre(vc.vitesse_ms * 3.6, 1)} km/h · calculée sur ${vc.n} durées` : "Il faut des efforts soutenus de 3 à 20 min."}</p>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Tuile label="Réserve D′" value={vc ? `${nombre(vc.dprime_m, 0)} m` : "—"} sub="au-dessus de l'allure critique" />
          <Tuile label="Il y a un an" value={vca ? allure(vca.allure_sec_km) : "—"}
            sub={vc && vca ? <Variation recent={-vc.allure_sec_km} ancien={-vca.allure_sec_km} unite="s/km" /> : "pas d'historique"} />
        </div>
        {hist.length > 1 && (
          <div className="mt-3">
            <p className="text-[12px] text-label-2 mb-1">Évolution (90 j glissants, fin de mois)</p>
            <ResponsiveContainer width="100%" height={90}>
              <LineChart data={hist} margin={{ left: 0, right: 0, top: 4 }}>
                <XAxis dataKey="label" {...axeX} minTickGap={24} />
                <YAxis hide reversed domain={["dataMin - 5", "dataMax + 5"]} />
                <Tooltip cursor={ligneCurseur} content={<InfoBulle format={allure} />} />
                <Line dataKey="allure_sec_km" name="Allure critique" stroke={ORANGE} strokeWidth={2} dot={{ r: 2, strokeWidth: 0, fill: ORANGE }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-[12px] text-label-3 mt-3">
          L'allure critique est l'allure tenable environ 30 à 40 min : c'est ton seuil, la frontière entre effort contrôlé et effort qui s'emballe.
          D′ est la distance que tu peux courir plus vite avant d'être à bout.
        </p>
      </Card>
      <div className="lg:col-span-2 min-w-0">
        <Graphe className="h-full" titre="Courbe des meilleurs efforts" couleur={ORANGE} sousTitre="Meilleure allure tenue sur chaque durée (passages GPS)"
          note="Une courbe actuelle proche du record sur les durées longues traduit une bonne endurance ; un écart sur les durées courtes, un manque de vitesse.">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="label" {...axeX} interval={0} />
              <YAxis {...axeY} reversed domain={["dataMin - 10", "dataMax + 10"]} width={40} tickFormatter={allureKm} />
              <Tooltip cursor={ligneCurseur} content={<InfoBulle format={allure} />} />
              {vc && <ReferenceLine y={vc.allure_sec_km} stroke={ORANGE} strokeOpacity={0.5} strokeDasharray="4 4" />}
              <Line dataKey="record" name="Record" stroke={GRIS} strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2, strokeWidth: 0, fill: GRIS }} connectNulls />
              <Line dataKey="an_dernier" name="Il y a un an" stroke={CYAN} strokeWidth={1.5} dot={{ r: 2, strokeWidth: 0, fill: CYAN }} connectNulls />
              <Line dataKey="actuel" name="90 derniers jours" stroke={ORANGE} strokeWidth={3} dot={{ r: 3, strokeWidth: 0, fill: ORANGE }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          <Legende items={[{ label: "90 derniers jours", couleur: ORANGE }, { label: "Il y a un an", couleur: CYAN }, { label: "Record", couleur: GRIS }]} />
        </Graphe>
      </div>
    </div>
  );
}

// ── Efficacité aérobie ────────────────────────────────────────────────────
function Efficacite({ ef }) {
  const data = useMemo(() => enTemps(ef?.points ?? [], "ef", ef?.mois ?? [], "ef_mois"), [ef]);
  const n = ef?.points?.length ?? 0;
  if (!n) {
    return <Graphe titre="Efficacité aérobie" couleur={VERT}><Vide>Il faut des sorties d'endurance facile (20 min et plus, avec la FC) pour la suivre.</Vide></Graphe>;
  }
  return (
    <Graphe titre="Efficacité aérobie" couleur={VERT} sousTitre={`Mètres par minute pour un battement · ${n} sorties faciles`}
      note="Vitesse ÷ FC sur tes sorties en endurance (sur le plat). Si elle monte, tu cours plus vite pour le même effort cardiaque : ta base aérobie progresse. Chaleur, fatigue et dénivelé la font baisser ponctuellement, d'où la médiane mensuelle.">
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Tuile label="6 dernières sem." value={ef.recent != null ? nombre(ef.recent, 2) : "—"} />
        <Tuile label="Il y a 3-4 mois" value={ef.ancien != null ? nombre(ef.ancien, 2) : "—"} />
        <Tuile label="Tendance" value={ef.tendance_pct != null ? <span className={ef.tendance_pct >= 0 ? "text-ios-green" : "text-ios-red"}>{signe(ef.tendance_pct, 1)} %</span> : "—"}
          sub={ef.tendance_pct == null ? "pas assez de sorties" : null} />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
          <CartesianGrid {...grille} />
          <XAxis {...axeX} {...axeTemps} />
          <YAxis {...axeY} domain={["dataMin - 0.05", "dataMax + 0.05"]} width={36} tickFormatter={(v) => nombre(v, 2)} />
          <Tooltip cursor={ligneCurseur} content={<InfoBulleT format={(v) => nombre(v, 2)} />} />
          <Line dataKey="ef" name="Sortie" stroke="none" isAnimationActive={false} dot={{ r: 3, strokeWidth: 0, fill: VERT, fillOpacity: 0.45 }} activeDot={{ r: 5 }} />
          <Line dataKey="ef_mois" name="Médiane du mois" stroke={VERT} strokeWidth={2.5} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <Legende items={[{ label: "Sortie facile", couleur: VERT }, { label: "Médiane du mois", couleur: VERT }]} />
    </Graphe>
  );
}

// ── Durabilité (sorties longues) ──────────────────────────────────────────
const couleurDurab = (v) => (v < 3 ? VERT : v < 5 ? ORANGE : ROUGE);

function Durabilite({ d }) {
  const data = useMemo(() => (d ?? []).map((x) => ({ ...x, label: court(x.date) })), [d]);
  const moyRecente = data.length ? data.slice(-5).reduce((t, x) => t + x.durabilite_pct, 0) / Math.min(5, data.length) : null;
  return (
    <Graphe titre="Durabilité" couleur={VIOLET}
      sousTitre={moyRecente != null ? `Sorties de 1 h 15 et plus · 5 dernières : ${signe(moyRecente, 1)} %` : "Sorties de 1 h 15 et plus"}
      note="Perte d'efficacité (vitesse / FC) entre le premier et le dernier quart de la sortie. Sous 3 % : le moteur tient la distance ; au-delà de 5 %, l'endurance lâche en fin de sortie (alimentation, hydratation, volume de base).">
      {data.length ? (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
            <CartesianGrid {...grille} />
            <XAxis dataKey="label" {...axeX} minTickGap={24} />
            <YAxis {...axeY} unit="%" width={36} />
            <Tooltip cursor={curseur} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const x = payload[0].payload;
              return (
                <div className="glass rounded-xl px-3 py-2 text-[12px] max-w-[220px]">
                  <p className="text-label-2">{fmtDate(x.date)}</p>
                  {x.titre && <p className="font-semibold truncate">{x.titre}</p>}
                  <p className="chiffres mt-1">Durabilité : <b style={{ color: couleurDurab(x.durabilite_pct) }}>{signe(x.durabilite_pct, 1)} %</b></p>
                  <p className="chiffres text-label-2">{fmtDuree(x.duree_min * 60)} · {nombre(x.distance_km, 1)} km{x.dplus_m ? ` · ${nombre(x.dplus_m, 0)} m D+` : ""}</p>
                </div>
              );
            }} />
            <ReferenceLine y={5} stroke={ROUGE} strokeDasharray="4 4" />
            <ReferenceLine y={0} stroke={GRIS} strokeOpacity={0.5} />
            <Bar dataKey="durabilite_pct" name="Durabilité" radius={[3, 3, 3, 3]} maxBarSize={14}>
              {data.map((x) => <Cell key={`${x.activite_id}-${x.date}`} fill={couleurDurab(x.durabilite_pct)} fillOpacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : <Vide>Calculée à la synchro sur les sorties à pied d'au moins 1 h 15 avec la FC.</Vide>}
    </Graphe>
  );
}

// ── Foulée dans le temps ──────────────────────────────────────────────────
const COURTS_FOULEE = {
  cadence: "Cadence", foulee_m: "Foulée", oscillation_cm: "Oscillation",
  contact_sol_ms: "Contact", ratio_vertical_pct: "Ratio vert.", puissance_moy_w: "Puissance",
};

function Foulee({ f }) {
  const metriques = f?.metriques ?? [];
  const [cle, setCle] = useState(null);
  const m = metriques.find((x) => x.cle === cle) ?? metriques[0];
  const data = useMemo(() => {
    if (!m) return [];
    const pts = (f.points ?? []).filter((p) => p[m.cle] != null)
      .map((p) => ({ ...p, [p.comparable ? "v" : "v_autre"]: p[m.cle] }));
    return enTemps(pts, m.cle, (f.mois ?? []).filter((x) => x[m.cle] != null), "v_mois");
  }, [f, m]);
  if (!m) {
    return <Graphe titre="Foulée" couleur={CYAN}><Vide>Il faut la cadence ou la dynamique de course mesurée par la montre.</Vide></Graphe>;
  }
  const fmt = (v) => `${nombre(v, m.dec)} ${m.unite}`;
  return (
    <Graphe titre="Foulée dans le temps" couleur={CYAN}
      sousTitre={f.allure_ref_sec ? `Sorties autour de ton allure habituelle (${allureKm(f.allure_ref_sec)}/km ± 25 s) · ${f.n_comparables} sorties` : null}
      note="Seules les sorties à allure comparable comptent dans la médiane (points pleins) : à vitesse égale, une cadence qui monte, un temps de contact et une oscillation qui baissent traduisent une foulée plus économique. Les points pâles sont les autres sorties.">
      <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 mb-3">
        <Segmente valeur={m.cle} onChange={setCle} options={metriques.map((x) => [x.cle, COURTS_FOULEE[x.cle] ?? x.label])} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <p className="text-[13px] text-label-2">{m.label} · 8 dernières semaines</p>
        <p className="chiffres">
          <span className="font-rounded text-[22px] font-bold">{m.recent != null ? nombre(m.recent, m.dec) : "—"}</span>
          <span className="text-[13px] font-semibold text-label-2 ml-0.5">{m.unite}</span>
          <span className="text-[13px] ml-2">
            <Variation recent={m.recent} ancien={m.ancien} sens={m.sens} dec={m.dec} unite={m.unite} />
          </span>
        </p>
        {m.ancien != null && <p className="text-[12px] text-label-2">contre {fmt(m.ancien)} les 6 mois d'avant</p>}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
          <CartesianGrid {...grille} />
          <XAxis {...axeX} {...axeTemps} />
          <YAxis {...axeY} domain={["auto", "auto"]} width={40} tickFormatter={(v) => nombre(v, m.dec)} />
          <Tooltip cursor={ligneCurseur} content={<InfoBulleT format={fmt} />} />
          <Line dataKey="v_autre" name="Autre allure" stroke="none" isAnimationActive={false} dot={{ r: 2, strokeWidth: 0, fill: GRIS, fillOpacity: 0.35 }} activeDot={{ r: 4 }} />
          <Line dataKey="v" name="Allure comparable" stroke="none" isAnimationActive={false} dot={{ r: 3, strokeWidth: 0, fill: CYAN, fillOpacity: 0.6 }} activeDot={{ r: 5 }} />
          <Line dataKey="v_mois" name="Médiane du mois" stroke={CYAN} strokeWidth={2.5} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <Legende items={[{ label: "Allure comparable", couleur: CYAN }, { label: "Autre allure", couleur: GRIS }, { label: "Médiane du mois", couleur: CYAN }]} />
    </Graphe>
  );
}

// ── Dénivelé ──────────────────────────────────────────────────────────────
function Denivele({ d }) {
  const data = useMemo(() => (d?.semaines ?? []).map((s) => ({ ...s, label: court(s.semaine) })), [d]);
  if (!data.some((s) => s.km > 0)) return null;
  const b = d.bilan_4s, av = d.bilan_4s_avant;
  const vams = [...(d.vams ?? [])].reverse().slice(0, 5);
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <p className="text-[13px] font-semibold text-label-2">Dénivelé · 4 dernières semaines</p>
          <p className="font-rounded text-[34px] leading-10 font-bold chiffres mt-1">{nombre(b.dplus, 0)} m</p>
          <p className="text-[13px] text-label-2">
            <Variation recent={b.dplus} ancien={av?.dplus} sens={0} unite="m" /> {av ? "vs les 4 semaines d'avant" : ""}
          </p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Tuile label="Pente moyenne" value={`${nombre(b.m_par_km, 0)} m/km`} sub={av ? `avant : ${nombre(av.m_par_km, 0)} m/km` : null} />
            <Tuile label="Km-effort" value={nombre(b.km_effort, 0)} sub={`${nombre(b.km, 0)} km + D+ / 100`} />
            <Tuile label="VAM 90 j" value={d.vam_90j ? `${nombre(d.vam_90j, 0)} m/h` : "—"} sub={d.vam_max_90j ? `meilleure : ${nombre(d.vam_max_90j, 0)} m/h` : "pas de montée"} />
            <Tuile label="Km 4 sem." value={`${nombre(b.km, 0)} km`} sub={av ? `avant : ${nombre(av.km, 0)} km` : null} />
          </div>
          <p className="text-[12px] text-label-3 mt-3">
            Km-effort = km + D+ / 100 : 100 m de montée coûtent à peu près 1 km de plat. VAM = mètres gravis par heure sur les vraies montées (pente ≥ 5 %, au moins 50 m).
          </p>
        </Card>
        <div className="lg:col-span-2 min-w-0">
          <Graphe className="h-full" titre="Volume et dénivelé" couleur={VERT} sousTitre="Course, trail et randonnée · par semaine">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="label" {...axeX} minTickGap={24} />
                <YAxis yAxisId="m" {...axeY} width={44} />
                <YAxis yAxisId="km" orientation="right" {...axeY} width={32} />
                <Tooltip cursor={curseur} content={<InfoBulle format={(v, p) => (p.dataKey === "dplus" ? `${nombre(v, 0)} m` : `${nombre(v, 1)} km`)} />} />
                <Bar yAxisId="m" dataKey="dplus" name="D+" fill={VERT} fillOpacity={0.6} radius={[3, 3, 0, 0]} maxBarSize={14} />
                <Line yAxisId="km" dataKey="km" name="Km" stroke={BLEU} strokeWidth={2} dot={false} />
                <Line yAxisId="km" dataKey="km_effort" name="Km-effort" stroke={BLEU} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <Legende items={[{ label: "D+ m (gauche)", couleur: VERT }, { label: "Km et km-effort en pointillés (droite)", couleur: BLEU }]} />
          </Graphe>
        </div>
      </div>
      {vams.length > 0 && (
        <Card pad={false} className="py-1">
          <p className="px-4 pt-3 pb-1 text-[13px] font-semibold text-label-2">Dernières montées · vitesse ascensionnelle</p>
          {vams.map((v) => (
            <div key={`${v.activite_id}-${v.date}`} className="ligne">
              <span className="text-xl" aria-hidden>{sportInfo(v.sport).emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] truncate">{v.titre || sportInfo(v.sport).label}</span>
                <span className="block text-[12px] text-label-2 chiffres">{fmtDate(v.date)} · montée de {nombre(v.montee_m, 0)} m · {nombre(v.dplus_m, 0)} m D+ sur la sortie</span>
              </span>
              <span className="text-[15px] font-semibold chiffres shrink-0">{nombre(v.vam, 0)} m/h</span>
            </div>
          ))}
        </Card>
      )}
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
          <Graphe className="h-full" titre="Séances par semaine" couleur={VERT} sousTitre="Réalisées, sautées, manquées">
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
        <Graphe className="h-full" titre="Cumul depuis le 1er janvier" couleur={BLEU} sousTitre="Par semaine de l'année">
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
      <Section titre="Forme et fatigue"><FormeFatigue f={a.forme} /><Monotonie m={a.monotonie} /></Section>
      <Section titre="Récupération">
        <Recuperation r={a.recuperation} />
        <div className="grid gap-3 lg:grid-cols-2">
          <SignauxNuit s={a.signaux_nuit} />
          <Pas p={a.pas} />
          <RecupFc />
          <AsymetrieMarche />
        </div>
      </Section>
      <Section titre="Sommeil"><DetteSommeil s={a.sommeil} /><Nuits r={a.recuperation} /><RegulariteSommeil /></Section>
      <Section titre="Poids"><PoidsAnalyse /></Section>
      <Section titre="Intensité"><Zones z={a.zones} /></Section>
      <Section titre="Course à pied">
        <Vma v={a.vma} />
        <EffortsDuree e={a.efforts_duree} />
        <Course c={a.course} />
        <div className="grid gap-3 lg:grid-cols-2">
          <Efficacite ef={a.efficacite} />
          <Foulee f={a.foulee} />
        </div>
      </Section>
      <Section titre="Dénivelé"><Denivele d={a.denivele} /></Section>
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
