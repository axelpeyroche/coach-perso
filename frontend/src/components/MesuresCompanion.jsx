import { useState } from "react";
import clsx from "clsx";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { axeX, axeY, grille, InfoBulle, Legende, GRIS } from "./graphiques";
import Card from "./Card";
import { useMesures } from "./Forme";
import { EVEIL, heure, hm } from "./SommeilNuit";
import { fmtDate, nombre } from "../carnet";

// Données ajoutées par Intervals Companion : coucher et réveil, récupération FC 1 min, asymétrie de marche
const INDIGO = "#5856D6";
const ORANGE = "#FF9500";
const ROSE = "#FF2D55";
const VERT = "#34C759";
const SEUIL_ASYM = 8;  // % : au-delà, une démarche asymétrique de façon durable mérite attention

const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const moyenne = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const depuis = (n) => new Date(Date.now() - (n - 1) * 864e5).toLocaleDateString("sv");

function Entete({ titre, couleur, sousTitre, action }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold" style={{ color: couleur }}>{titre}</p>
        {sousTitre && <p className="text-[13px] text-label-2">{sousTitre}</p>}
      </div>
      {action}
    </div>
  );
}

const Vide = ({ children }) => <p className="text-[15px] text-label-2">{children}</p>;

// ── Régularité du sommeil : 14 nuits, du coucher au réveil ─────────────────
export function RegulariteSommeil() {
  const { data } = useMesures();
  const [choix, setChoix] = useState(null);
  if (!data) return null;
  const val = (t) => Object.fromEntries((data[t]?.points ?? []).map((p) => [p.jour, p.valeur]));
  const C = val("coucher"), R = val("lever"), E = val(EVEIL.cle);
  const nuits = Object.keys(C).filter((j) => R[j] != null && j >= depuis(14)).sort()
    .map((j) => ({ jour: j, c: C[j], r: R[j] + 24, eveil: E[j] ?? null }));

  if (nuits.length < 2) {
    return (
      <Card>
        <Entete titre="Régularité du sommeil" couleur={INDIGO} />
        <Vide>Les heures de coucher et de réveil arrivent par Intervals Companion (champs « SleepStartLocal » et « SleepEndLocal ») : il faut au moins deux nuits.</Vide>
      </Card>
    );
  }

  // Heure habituelle : moyenne des 28 dernières nuits
  const moyC = moyenne(Object.entries(C).filter(([j]) => j >= depuis(28)).map(([, v]) => v));
  const moyR = moyenne(Object.entries(R).filter(([j]) => j >= depuis(28)).map(([, v]) => v)) + 24;
  const ecartMoy = Math.round(moyenne(nuits.map((n) => Math.abs(n.c - moyC))) * 60);
  const bas = Math.floor(Math.min(...nuits.map((n) => n.c), moyC)) - 0.5;
  const haut = Math.ceil(Math.max(...nuits.map((n) => n.r), moyR)) + 0.5;
  const y = (h) => `${((h - bas) / (haut - bas)) * 100}%`;
  const reperes = [];
  for (let h = Math.ceil(bas / 2) * 2; h <= haut; h += 2) reperes.push(h);
  const sel = nuits.find((n) => n.jour === choix) ?? nuits.at(-1);

  return (
    <Card>
      <Entete titre="Régularité du sommeil" couleur={INDIGO}
        sousTitre={`${nuits.length} dernières nuits · coucher habituel ${heure(moyC)}, réveil ${heure(moyR)}`}
        action={<span className={clsx("badge text-[11px] shrink-0", ecartMoy > 45 ? "bg-ios-orange/15 text-ios-orange" : "bg-ios-green/15 text-ios-green")}>
          ± {ecartMoy} min</span>} />
      <div className="flex gap-2">
        <div className="relative w-9 shrink-0 h-[170px] text-[11px] text-label-2 chiffres" aria-hidden>
          {reperes.map((h) => (
            <span key={h} className="absolute right-0 -translate-y-1/2" style={{ top: y(h) }}>{h % 24} h</span>
          ))}
        </div>
        <div className="relative flex-1 h-[170px]">
          {reperes.map((h) => <div key={h} className="absolute inset-x-0 border-t-[0.5px] border-separateur" style={{ top: y(h) }} aria-hidden />)}
          <div className="absolute inset-x-0 border-t border-dashed" style={{ top: y(moyC), borderColor: INDIGO }} aria-hidden />
          <div className="absolute inset-x-0 border-t border-dashed" style={{ top: y(moyR), borderColor: GRIS }} aria-hidden />
          <div className="absolute inset-0 flex justify-around">
            {nuits.map((n) => {
              const decale = Math.abs(n.c - moyC) > 1;
              return (
                <button key={n.jour} onClick={() => setChoix(n.jour)} aria-label={`Nuit du ${court(n.jour)}`}
                  className="relative h-full flex-1 max-w-[22px] flex justify-center">
                  <span className={clsx("absolute w-[60%] rounded-full", n.jour === sel.jour && "ring-2 ring-label-2")}
                    style={{ top: y(n.c), height: `calc(${y(n.r)} - ${y(n.c)})`, background: decale ? ORANGE : INDIGO }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-1" aria-hidden>
        <div className="w-9 shrink-0" />
        <div className="flex-1 flex justify-around text-[10px] text-label-2 chiffres">
          {nuits.map((n) => <span key={n.jour} className="flex-1 max-w-[22px] text-center">{Number(n.jour.slice(8))}</span>)}
        </div>
      </div>
      <p className="rounded-xl bg-remplissage px-3 py-2 text-[13px] mt-3 chiffres">
        <span className="font-semibold">Nuit du {fmtDate(sel.jour, { weekday: "short", day: "numeric", month: "short" })}</span>
        {" · "}C {heure(sel.c)} → R {heure(sel.r)}
        {sel.eveil != null && <> · <span style={{ color: EVEIL.couleur }}>éveillé {hm(sel.eveil)}</span></>}
      </p>
      <Legende items={[{ label: "Coucher habituel", couleur: INDIGO }, { label: "Coucher décalé de plus d'1 h", couleur: ORANGE }]} />
      <p className="text-[12px] text-label-2 mt-3">Se coucher et se lever à heure fixe, même le week-end, aide autant la récupération que la durée de la nuit.
        L'écart affiché est la moyenne, sur ces nuits, entre l'heure du coucher et ton heure habituelle (28 j). Touche une nuit pour son détail.</p>
    </Card>
  );
}

// Petite courbe des valeurs
function Courbe({ valeurs, couleur }) {
  if (valeurs.length < 2) return null;
  const min = Math.min(...valeurs), et = Math.max(...valeurs) - min || 1;
  const pts = valeurs.map((v, i) => `${(i / (valeurs.length - 1)) * 100},${22 - ((v - min) / et) * 20}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="block w-full h-6 mt-2" aria-hidden>
      <polyline fill="none" stroke={couleur} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

function Chiffre({ valeur, unite, sous }) {
  return (
    <>
      <p className="font-rounded text-[28px] leading-8 font-bold chiffres">{valeur}<span className="text-[14px] font-semibold text-label-2 ml-1">{unite}</span></p>
      {sous && <p className="text-[13px] text-label-2">{sous}</p>}
    </>
  );
}

// ── Récupération FC 1 min : baisse de la FC dans la minute après l'effort ──
export function RecupFc() {
  const { data } = useMesures();
  const m = data?.recup_fc;
  if (!data) return null;
  const pts = (m?.points ?? []).filter((p) => p.jour >= depuis(90));
  const d = m?.moy_7j != null && m?.moy_28j != null ? m.moy_7j - m.moy_28j : null;
  return (
    <Card>
      <Entete titre="Récupération FC 1 min" couleur={ROSE}
        sousTitre={m?.derniere ? `après la séance du ${court(m.derniere.jour)}` : "pas encore reçue"}
        action={d != null && Math.abs(d) >= 2 ? (
          <span className={clsx("badge text-[11px] shrink-0", d > 0 ? "bg-ios-green/15 text-ios-green" : "bg-ios-orange/15 text-ios-orange")}>
            {d > 0 ? "En progrès" : "En baisse"}
          </span>
        ) : null} />
      {m?.derniere ? (
        <>
          <Chiffre valeur={nombre(m.derniere.valeur, 0)} unite="bpm"
            sous={[m.moy_28j != null && `28 j : ${nombre(m.moy_28j, 0)} bpm`, d != null && `7 j : ${d > 0 ? "+" : ""}${nombre(d, 0)}`].filter(Boolean).join(" · ")} />
          <Courbe valeurs={pts.map((p) => p.valeur)} couleur={ROSE} />
        </>
      ) : <Vide>Elle arrive après une séance enregistrée avec la montre : Companion mesure la baisse de la FC dans la minute qui suit l'arrêt.</Vide>}
      <p className="text-[12px] text-label-2 mt-3">Battements perdus dans la minute qui suit l'arrêt de l'effort. Plus c'est élevé, mieux le cœur récupère :
        une baisse durable de cette valeur peut signaler de la fatigue. Moins de 12 bpm est considéré comme faible.</p>
    </Card>
  );
}

// ── Asymétrie de marche ────────────────────────────────────────────────────
const recentsAuDessus = (m) => {
  const pts = (m?.points ?? []).filter((p) => p.jour >= depuis(7)).slice(-3);
  return pts.length === 3 && pts.every((p) => p.valeur > SEUIL_ASYM);
};

export function AsymetrieMarche() {
  const { data } = useMesures();
  const m = data?.asymetrie_marche;
  if (!data) return null;
  const pts = (m?.points ?? []).filter((p) => p.jour >= depuis(90)).map((p) => ({ ...p, label: court(p.jour) }));
  const alerte = recentsAuDessus(m);
  return (
    <Card>
      <Entete titre="Asymétrie de marche" couleur={alerte ? ORANGE : VERT}
        sousTitre={m?.derniere ? `${court(m.derniere.jour)}${m.moy_28j != null ? ` · 28 j : ${nombre(m.moy_28j, 1)} %` : ""}` : "pas encore reçue"}
        action={m?.derniere ? (
          <span className={clsx("badge text-[11px] shrink-0", alerte ? "bg-ios-orange/15 text-ios-orange" : "bg-ios-green/15 text-ios-green")}>
            {alerte ? "À surveiller" : "Normale"}
          </span>
        ) : null} />
      {m?.derniere ? (
        <>
          <Chiffre valeur={nombre(m.derniere.valeur, 1)} unite="%" />
          {pts.length > 1 && (
            <ResponsiveContainer width="100%" height={120} className="mt-2">
              <LineChart data={pts} margin={{ left: 0, right: 0, top: 4 }}>
                <CartesianGrid {...grille} />
                <XAxis dataKey="label" {...axeX} minTickGap={32} />
                <YAxis {...axeY} width={28} domain={[0, (x) => Math.max(SEUIL_ASYM + 2, Math.ceil(x))]} allowDecimals={false} />
                <Tooltip content={<InfoBulle format={(v) => `${nombre(v, 1)} %`} />} />
                <ReferenceLine y={SEUIL_ASYM} stroke={ORANGE} strokeDasharray="4 4" />
                <Line dataKey="valeur" name="Asymétrie" stroke={VERT} strokeWidth={2} dot={{ r: 1.5, strokeWidth: 0, fill: VERT }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      ) : <Vide>Active « Walking asymmetry » dans Intervals Companion : elle est mesurée par l'iPhone pendant la marche.</Vide>}
      <p className="text-[12px] text-label-2 mt-3">Écart de durée entre les pas gauche et droit, mesuré par l'iPhone en marchant. Sous {SEUIL_ASYM} % c'est habituel ;
        plusieurs jours au-dessus peuvent trahir une douleur ou une blessure qui fait boiter, même légèrement.</p>
    </Card>
  );
}

// Accueil : alerte quand les 3 dernières mesures de la semaine dépassent le seuil
export function AlerteMarche() {
  const { data } = useMesures();
  const m = data?.asymetrie_marche;
  if (!recentsAuDessus(m)) return null;
  return (
    <Card className="bg-ios-orange/[0.12]">
      <p className="text-[15px] font-semibold text-ios-orange">Démarche asymétrique</p>
      <p className="text-[13px] text-label-2 mt-0.5">
        Ton asymétrie de marche dépasse {SEUIL_ASYM} % depuis plusieurs jours (dernière mesure {nombre(m.derniere.valeur, 1)} %).
        Une douleur à une jambe ou au pied ? Mieux vaut alléger les séances qui la sollicitent.
      </p>
    </Card>
  );
}
