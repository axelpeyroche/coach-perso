import { useState } from "react";
import { Link } from "react-router-dom";
import { useMesures } from "./Forme";
import { fmtDate, fmtDuree, nombre } from "../carnet";

// Phases de la nuit (champs personnalisés remplis par Intervals Companion), en heures.
// Repères : part de la nuit chez l'adulte.
export const PHASES = [
  { cle: "sommeil_profond", label: "Profond", couleur: "#5856D6", repere: [13, 23] },
  { cle: "sommeil_leger", label: "Léger", couleur: "#007AFF", repere: [45, 60] },
  { cle: "sommeil_paradoxal", label: "Paradoxal", couleur: "#32ADE6", repere: [20, 25] },
];
export const hm = (h) => fmtDuree(Math.round(h * 60) * 60).replace(/^(\d+)h(\d+)$/, "$1 h $2");

// Niveaux de l'app Santé
function niveau(score) {
  if (score >= 96) return "Très élevé";
  if (score >= 80) return "Élevé";
  if (score >= 70) return "OK";
  if (score >= 50) return "Bas";
  return "Très bas";
}

// Anneau : la part colorée = le score sur 100, répartie entre les phases selon leur durée
function Anneau({ score, parts }) {
  const r = 46, c = 2 * Math.PI * r, ecart = parts.length > 1 ? 5 : 0;
  const rempli = (c * Math.min(score ?? 100, 100)) / 100;
  let debut = 0;
  return (
    <div className="relative w-[124px] h-[124px] shrink-0">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="14" className="text-remplissage" />
        {parts.map((p) => {
          const long = Math.max(rempli * p.part - ecart, 1);
          const el = (
            <circle key={p.cle} cx="60" cy="60" r={r} fill="none" stroke={p.couleur} strokeWidth="14" strokeLinecap="round"
              strokeDasharray={`${long} ${c}`} strokeDashoffset={-debut - ecart / 2} />
          );
          debut += rempli * p.part;
          return el;
        })}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-rounded text-[34px] font-bold tracking-[-0.02em] chiffres">
        {score != null ? Math.round(score) : "—"}
      </span>
    </div>
  );
}

function Ligne({ couleur, titre, valeur, detail, points }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-t border-separateur first:border-t-0">
      <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: couleur }} aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-semibold leading-5">{titre} :</p>
        <p className="text-[15px] leading-5">{valeur}</p>
        {detail && <p className="text-[12px] text-label-2 mt-0.5">{detail}</p>}
      </div>
      {points && <p className="text-[15px] font-semibold chiffres shrink-0">{points}</p>}
    </div>
  );
}

// Carte du Résumé : score et phases de la dernière nuit, présentés comme dans l'app Santé
export default function SommeilNuit() {
  const { data } = useMesures();
  const [infos, setInfos] = useState(false);
  if (!data) return null;
  const derniers = ["sommeil", "score_sommeil", ...PHASES.map((f) => f.cle)]
    .map((t) => data[t]?.derniere?.jour).filter(Boolean).sort();
  const jour = derniers.at(-1);
  // Seulement la nuit récente (3 jours) : l'historique est dans Analyses
  if (!jour || (Date.now() - new Date(jour)) / 86400000 > 3) return null;
  const du = (t) => data[t]?.points?.find((p) => p.jour === jour)?.valeur ?? null;

  const score = du("score_sommeil");
  const duree = du("sommeil");
  const phases = PHASES.map((f) => ({ ...f, h: du(f.cle) })).filter((f) => f.h != null);
  const totalPhases = phases.reduce((t, f) => t + f.h, 0);
  const parts = phases.map((f) => ({ ...f, part: f.h / totalPhases }));
  const moy = data.sommeil?.moy_28j;
  const fc = du("fc_sommeil");

  return (
    <section className="card p-4 md:p-5 min-w-0" aria-label="Score de sommeil">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[#5856D6]">Score de sommeil</h3>
        <span className="text-[13px] text-label-2">
          {fmtDate(jour, { weekday: "short", day: "numeric", month: "short" })}
        </span>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[auto_1fr] md:gap-8 md:items-center">
        <div className="flex items-center gap-4">
          <Anneau score={score} parts={parts.length ? parts : [{ cle: "nuit", couleur: "#5856D6", part: 1 }]} />
          <div>
            <p className="font-rounded text-[28px] leading-8 font-bold tracking-[-0.02em]">
              {score != null ? niveau(score) : "Sans score"}
            </p>
            <p className="text-[13px] text-label-2 mt-0.5">{score != null ? "score Intervals Companion" : "score non reçu pour cette nuit"}</p>
          </div>
        </div>

        <div>
          {duree != null && (
            <Ligne couleur="#8E8E93" titre="Durée" valeur={hm(duree)}
              detail={[moy != null && `${duree >= moy ? "+" : "−"}${hm(Math.abs(duree - moy))} par rapport à ta moyenne 28 j`,
                fc != null && `FC ${nombre(fc, 0)} bpm`].filter(Boolean).join(" · ") || null} />
          )}
          {phases.map((f) => {
            const pct = Math.round((100 * f.h) / totalPhases);
            const [a, b] = f.repere;
            return (
              <Ligne key={f.cle} couleur={f.couleur} titre={f.label} valeur={hm(f.h)}
                detail={`repère ${a} à ${b} % de la nuit${pct < a ? " · en dessous" : pct > b ? " · au-dessus" : ""}`}
                points={`${pct} %`} />
            );
          })}
          {!phases.length && (
            <p className="text-[13px] text-label-2 py-2">Phases non reçues pour cette nuit : vérifie que Intervals Companion les synchronise.</p>
          )}
        </div>
      </div>

      <button className="mt-2 text-[15px] text-brand" onClick={() => setInfos((v) => !v)} aria-expanded={infos}>
        {infos ? "Masquer" : "À propos du score de sommeil"}
      </button>
      {infos && (
        <div className="mt-2 space-y-2 text-[13px] leading-[18px] text-label-2">
          <p>Le score mesure la nature réparatrice de ta nuit, sur 100 : Très élevé (96 à 100), Élevé (80 à 95), OK (70 à 79),
            Bas (50 à 69), Très bas (moins de 50). La partie colorée de l'anneau correspond au score, répartie selon le temps passé dans chaque phase.</p>
          <p>Apple ne partage son propre score avec aucune autre app : celui-ci est calculé par Intervals Companion
            à partir de la même nuit, il peut donc différer de quelques points de l'app Santé. Pour la même raison,
            le détail « Coucher » et « Interruptions » d'Apple n'est pas disponible ici.</p>
          <p><strong className="text-label">Profond</strong> : récupération physique et immunité.{" "}
            <strong className="text-label">Paradoxal</strong> : mémoire et équilibre émotionnel.{" "}
            <strong className="text-label">Léger</strong> : l'essentiel de la nuit, la transition entre les deux.</p>
          <Link to="/analyses" className="inline-block text-brand">Voir l'évolution dans Analyses →</Link>
        </div>
      )}
    </section>
  );
}
