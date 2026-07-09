import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSemaineCourante, journaliserSeance } from "../api";
import Card from "../components/Card";
import clsx from "clsx";


const TYPE_ICONS = { COURSE: "🏃", AMRAP: "🔥", EMOM: "⏱️", EVALUATION: "🎯", DECHARGE: "🧘", REPOS: "😴" };
const TYPE_LABELS = { COURSE: "Course", AMRAP: "AMRAP", EMOM: "EMOM", EVALUATION: "Évaluation", DECHARGE: "Décharge", REPOS: "Repos" };

const RPE_COLORS = [
  "", "text-blue-400", "text-blue-500", "text-green-400", "text-green-500",
  "text-yellow-400", "text-yellow-500", "text-orange-400", "text-orange-500",
  "text-red-400", "text-red-500",
];
const RPE_LABELS = [
  "", "Très facile", "Facile", "Modéré", "Confortable",
  "Un peu difficile", "Difficile", "Très difficile", "Très dur",
  "Extrême", "Maximum absolu",
];

function formatDuree(min) {
  if (!min) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function BadgeType({ type }) {
  return (
    <span className={clsx(
      "text-xs font-semibold px-2 py-0.5 rounded",
      type === "COURSE" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
      type === "AMRAP"  ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" :
      type === "EMOM"   ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" :
      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
    )}>
      {TYPE_ICONS[type]} {TYPE_LABELS[type]}
    </span>
  );
}

// Formulaire contextuel selon le type de séance
function FormulaireSeance({ seance, onSuccess }) {
  const qc = useQueryClient();
  const isCourse = seance.type === "COURSE";
  const isMuscu = ["AMRAP", "EMOM"].includes(seance.type);

  const [rpe, setRpe] = useState(7);
  const [champs, setChamps] = useState({});
  const [notes, setNotes] = useState("");

  const set = (k, v) => setChamps((c) => ({ ...c, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => {
      const nums = Object.fromEntries(
        Object.entries(champs)
          .filter(([, v]) => v !== "")
          .map(([k, v]) => [k, Number(v)])
      );
      return journaliserSeance(seance.id, { rpe, notes: notes || undefined, ...nums });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["semaine-courante"] });
      onSuccess();
    },
  });

  return (
    <div className="space-y-5">

      {/* Rappel de l'objectif */}
      <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <p className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Objectif planifié</p>
        {seance.duree_cible_min && <p>⏱ Durée : <strong>{formatDuree(seance.duree_cible_min)}</strong></p>}
        {seance.dplus_cible_m > 0 && <p>↑ D+ : <strong>{seance.dplus_cible_m} m</strong></p>}
        {seance.zone_cible && <p>Zone : <strong>{seance.zone_cible}</strong></p>}
        {seance.temps_limite_min && <p>⏱ Chrono : <strong>{seance.temps_limite_min} min</strong></p>}
        {seance.exercices?.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {seance.exercices.map((ex, i) => (
              <p key={i}>• {ex.nom}{ex.repetitions ? ` — ${ex.repetitions} reps` : ""}</p>
            ))}
          </div>
        )}
      </div>

      {/* Champs course */}
      {isCourse && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Réalisé</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { k: "duree_reelle_min",  label: "Durée (min)",    ph: seance.duree_cible_min ?? "65" },
              { k: "distance_reelle_km",label: "Distance (km)",  ph: "12.5", step: "0.1" },
              { k: "dplus_reel_m",      label: "D+ (m)",         ph: seance.dplus_cible_m ?? "120" },
              { k: "fc_moyenne_bpm",    label: "FC moy (bpm)",   ph: "152" },
              { k: "fc_max_bpm",        label: "FC max (bpm)",   ph: "178" },
            ].map(({ k, label, ph, step }) => (
              <div key={k}>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                <input
                  type="number" step={step} placeholder={ph} value={champs[k] ?? ""}
                  onChange={(e) => set(k, e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Champs musculation */}
      {isMuscu && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Performance</p>
          <div className="grid grid-cols-2 gap-3">
            {seance.type === "AMRAP" && (
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tours complétés</label>
                <input
                  type="number" step="0.1" placeholder="2.9" value={champs.tours_amrap_completes ?? ""}
                  onChange={(e) => set("tours_amrap_completes", e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Total reps</label>
              <input
                type="number" placeholder="180" value={champs.total_reps_enregistrees ?? ""}
                onChange={(e) => set("total_reps_enregistrees", e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
          </div>
        </div>
      )}

      {/* RPE */}
      <div>
        <div className="flex justify-between items-baseline mb-2">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Effort perçu (RPE)</label>
          <span className={clsx("text-base font-bold", RPE_COLORS[Math.round(rpe)])}>
            {rpe}/10 — <span className="text-sm font-medium">{RPE_LABELS[Math.round(rpe)]}</span>
          </span>
        </div>
        <input
          type="range" min={1} max={10} step={0.5} value={rpe}
          onChange={(e) => setRpe(parseFloat(e.target.value))}
          className="w-full accent-brand"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>1 — Très facile</span><span>10 — Maximum</span>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes & sensations</label>
        <textarea
          value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          placeholder="Sensations, contexte, douleurs, observations..."
          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="w-full py-3 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50"
      >
        {mutation.isPending ? "Enregistrement..." : "Valider la séance"}
      </button>

      {mutation.isError && (
        <p className="text-xs text-red-500 text-center">Erreur API — réessaie ou vérifie la connexion.</p>
      )}
    </div>
  );
}

export default function Journal() {
  const [seanceActive, setSeanceActive] = useState(null);
  const [seancesValidees, setSeancesValidees] = useState(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["semaine-courante"],
    queryFn: () => getSemaineCourante(),
  });

  if (isLoading) return (
    <div className="p-8 flex items-center justify-center text-gray-400">
      <span className="animate-pulse text-sm">Chargement des séances...</span>
    </div>
  );

  if (error) return (
    <div className="p-8">
      <p className="text-sm text-red-500">Impossible de charger les séances. L'API est-elle connectée ?</p>
    </div>
  );

  const { seances = [], numero_semaine, macrophase, macrocycle } = data ?? {};
  const seancesActives = seances.filter((s) => !["EVALUATION", "REPOS"].includes(s.type));

  function handleValide(id) {
    setSeancesValidees((v) => new Set([...v, id]));
    setSeanceActive(null);
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      {/* En-tête */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Journal</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {macrocycle?.nom} — Semaine {numero_semaine}
          {macrophase && <span className="ml-2 capitalize opacity-70">({macrophase})</span>}
        </p>
      </div>

      {/* Progression de la semaine */}
      <div className="flex items-center gap-2">
        {seancesActives.map((s) => {
          const fait = s.journal?.completee || seancesValidees.has(s.id);
          return (
            <div key={s.id} className={clsx(
              "w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors",
              fait ? "bg-brand text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-400"
            )}>
              {fait ? "✓" : TYPE_ICONS[s.type]}
            </div>
          );
        })}
        <span className="text-xs text-gray-400 ml-1">
          {seancesActives.filter((s) => s.journal?.completee || seancesValidees.has(s.id)).length}/{seancesActives.length} séances
        </span>
      </div>

      {/* Liste des séances */}
      <div className="space-y-3">
        {seancesActives.map((s) => {
          const fait = s.journal?.completee || seancesValidees.has(s.id);
          const ouvert = seanceActive === s.id;

          return (
            <div key={s.id} className="rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Header séance */}
              <button
                className="w-full text-left"
                onClick={() => !fait && setSeanceActive(ouvert ? null : s.id)}
              >
                <div className={clsx(
                  "flex items-center gap-3 px-4 py-3 transition-colors",
                  fait ? "bg-green-50 dark:bg-green-900/10" : "bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                )}>
                  <span className="text-xl">{TYPE_ICONS[s.type]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.titre}</p>
                      <BadgeType type={s.type} />
                    </div>
                    <div className="flex gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {s.duree_cible_min && <span>⏱ {formatDuree(s.duree_cible_min)}</span>}
                      {s.dplus_cible_m > 0 && <span>↑ {s.dplus_cible_m} m</span>}
                      {s.temps_limite_min && <span>🔥 {s.temps_limite_min} min</span>}
                    </div>
                  </div>
                  {fait ? (
                    <span className="text-green-500 font-bold text-sm shrink-0">✓ Fait</span>
                  ) : (
                    <span className={clsx("text-gray-400 text-xs shrink-0 transition-transform", ouvert ? "rotate-180" : "")}>▼</span>
                  )}
                </div>
              </button>

              {/* Résumé si déjà journalisé */}
              {fait && s.journal && (
                <div className="px-4 py-2 bg-green-50/50 dark:bg-green-900/5 border-t border-green-100 dark:border-green-900/20 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                  {s.journal.rpe && <span>RPE {s.journal.rpe}/10</span>}
                  {s.journal.notes && <span className="truncate">{s.journal.notes}</span>}
                </div>
              )}

              {/* Formulaire */}
              {ouvert && !fait && (
                <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-5 bg-white dark:bg-gray-900">
                  <FormulaireSeance seance={s} onSuccess={() => handleValide(s.id)} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {seancesActives.length === 0 && (
        <Card title="">
          <p className="text-sm text-gray-400 text-center py-4">Aucune séance prévue cette semaine.</p>
        </Card>
      )}
    </div>
  );
}
