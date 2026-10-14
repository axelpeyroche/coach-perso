import { useState } from "react";
import { Link } from "react-router-dom";
import { useMesures } from "./Forme";
import StatTile from "./StatTile";
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
  const r = 50, c = 2 * Math.PI * r, ecart = parts.length > 1 ? 6 : 0;
  const rempli = (c * Math.min(score ?? 100, 100)) / 100;
  let debut = 0;
  return (
    <div className="relative w-[60px] h-[60px] md:w-[68px] md:h-[68px] shrink-0">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="16" className="text-remplissage" />
        {parts.map((p) => {
          const long = Math.max(rempli * p.part - ecart, 1);
          const el = (
            <circle key={p.cle} cx="60" cy="60" r={r} fill="none" stroke={p.couleur} strokeWidth="16" strokeLinecap="round"
              strokeDasharray={`${long} ${c}`} strokeDashoffset={-debut - ecart / 2} />
          );
          debut += rempli * p.part;
          return el;
        })}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-rounded text-[20px] font-bold tracking-[-0.02em] chiffres">
        {score != null ? Math.round(score) : "—"}
      </span>
    </div>
  );
}

// Résumé : deux tuiles, le score de la dernière nuit et sa durée avec les phases
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

  const ecartMoy = moy != null && duree != null ? Math.round((duree - moy) * 60) : null;

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Score de sommeil" color="indigo">
          <div className="flex items-center gap-2 mt-1">
            <Anneau score={score} parts={parts.length ? parts : [{ cle: "nuit", couleur: "#5856D6", part: 1 }]} />
            <div className="min-w-0">
              <p className="font-rounded text-[18px] md:text-[20px] leading-6 font-bold tracking-[-0.02em] truncate">{score != null ? niveau(score) : "—"}</p>
              <p className="text-[12px] text-label-2 truncate">{fmtDate(jour, { weekday: "short", day: "numeric", month: "short" })}</p>
            </div>
          </div>
          <button onClick={() => setInfos((v) => !v)} aria-expanded={infos} aria-label="À propos du score de sommeil"
            className="mt-auto pt-1 self-start text-[12px] text-label-2 truncate">
            {score != null ? "Intervals Companion" : "score non reçu"} · <span className="text-brand">ⓘ</span>
          </button>
        </StatTile>

        <StatTile label="Nuit" color="indigo">
          <p className="font-rounded text-[22px] md:text-[26px] leading-8 font-bold tracking-[-0.02em] chiffres truncate">{duree != null ? hm(duree) : "—"}</p>
          <p className="text-[12px] text-label-2 truncate">
            {[ecartMoy == null ? null : Math.abs(ecartMoy) < 5 ? "= moy. 28 j" : `${ecartMoy > 0 ? "+" : "−"}${hm(Math.abs(ecartMoy) / 60)} / 28 j`,
              fc != null ? `FC ${nombre(fc, 0)}` : null].filter(Boolean).join(" · ")}
          </p>
          {phases.length > 0 && (
            <>
              <div className="flex h-1.5 gap-0.5 rounded-full overflow-hidden mt-1" aria-hidden>
                {phases.map((f) => <span key={f.cle} style={{ width: `${(100 * f.h) / totalPhases}%`, background: f.couleur }} />)}
              </div>
              <ul className="text-[12px] leading-[17px] mt-0.5">
                {phases.map((f) => {
                  const pct = (100 * f.h) / totalPhases;
                  const hors = pct < f.repere[0] || pct > f.repere[1];
                  return (
                    <li key={f.cle} className="flex justify-between gap-1">
                      <span className="flex items-center gap-1 truncate">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: f.couleur }} aria-hidden />{f.label}
                      </span>
                      <span className={hors ? "text-ios-orange chiffres" : "chiffres"} title={`${Math.round(pct)} % · repère ${f.repere[0]} à ${f.repere[1]} %`}>{hm(f.h)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </StatTile>
      </div>

      {infos && (
        <div className="card p-4 mt-3 space-y-2 text-[13px] leading-[18px] text-label-2">
          <p>Le score mesure la nature réparatrice de ta nuit, sur 100 : Très élevé (96 à 100), Élevé (80 à 95), OK (70 à 79),
            Bas (50 à 69), Très bas (moins de 50). La partie colorée de l'anneau correspond au score, répartie selon le temps passé dans chaque phase.</p>
          <p>Repères chez l'adulte (part de la nuit) : profond 13 à 23 %, léger 45 à 60 %, paradoxal 20 à 25 %. Une durée en orange sort de son repère.
            Profond : récupération physique et immunité. Paradoxal : mémoire et équilibre émotionnel. Léger : transition entre les deux.</p>
          <p>Apple ne partage son propre score avec aucune autre app : celui-ci est calculé par Intervals Companion,
            il peut différer de quelques points de l'app Santé, et le détail « Coucher » et « Interruptions » n'est pas disponible.</p>
          <Link to="/analyses" className="inline-block text-brand">Voir l'évolution dans Analyses →</Link>
        </div>
      )}
    </div>
  );
}
