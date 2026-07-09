import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMacrocycles, getSemainesMacrocycle } from "../api";
import Card from "../components/Card";
import clsx from "clsx";

const PHASE_COLORS = {
  surcharge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  decharge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  evaluation: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

const TYPE_ICONS = {
  COURSE: "🏃",
  AMRAP: "🔥",
  EMOM: "⏱️",
  EVALUATION: "🎯",
  DECHARGE: "🧘",
  REPOS: "😴",
};

const ZONE_COLORS = {
  Z1: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  Z2: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Z3: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  Z4: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  Z5: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export default function Programme() {
  const [macrocycleId, setMacrocycleId] = useState(null);
  const [semaineSel, setSemaineSel] = useState(null);
  const [seanceOuverte, setSeanceOuverte] = useState(null);

  const { data: macrocycles = [], isLoading: loadingMC } = useQuery({
    queryKey: ["macrocycles"],
    queryFn: () => getMacrocycles(1),
  });

  const mcId = macrocycleId ?? macrocycles[0]?.id ?? null;
  const mcSelectionne = macrocycles.find((mc) => mc.id === mcId) ?? macrocycles[0];

  const { data, isLoading, error } = useQuery({
    queryKey: ["macrocycle", mcId],
    queryFn: () => getSemainesMacrocycle(mcId),
    enabled: !!mcId,
  });

  if (loadingMC) return <PageLoader />;
  if (!loadingMC && macrocycles.length === 0)
    return <ErreurAPI message="Aucun macrocycle trouvé. L'API est-elle démarrée ? Appelez /api/admin/reseed puis /api/admin/seed-seances via Swagger." />;
  if (isLoading) return <PageLoader />;
  if (error) return <ErreurAPI message={`Erreur chargement semaines : ${error.message}`} />;

  const semaines = data?.semaines ?? [];
  const idxSel = semaineSel !== null ? semaineSel : 0;
  const semaine = semaines[idxSel];

  function handleMacrocycle(id) {
    setMacrocycleId(id);
    setSemaineSel(null);
    setSeanceOuverte(null);
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Programme</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          EPC — 2 macrocycles × 8 semaines
        </p>
      </div>

      {/* Sélecteur macrocycle */}
      {macrocycles.length > 1 && (
        <div className="flex gap-2">
          {macrocycles.map((mc) => (
            <button
              key={mc.id}
              onClick={() => handleMacrocycle(mc.id)}
              className={clsx(
                "px-4 py-2 rounded-xl text-sm font-semibold border transition-colors",
                mc.id === mcId
                  ? "border-brand bg-brand/10 text-brand dark:bg-brand/20"
                  : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300"
              )}
            >
              {mc.nom}
            </button>
          ))}
        </div>
      )}

      {mcSelectionne && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {mcSelectionne.date_debut} → {mcSelectionne.date_fin}
        </p>
      )}

      {/* Sélecteur semaines */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {semaines.map((s, i) => (
          <button
            key={s.numero_semaine}
            onClick={() => { setSemaineSel(i); setSeanceOuverte(null); }}
            className={clsx(
              "shrink-0 flex flex-col items-center px-3 py-2 rounded-xl border text-xs font-medium transition-colors",
              idxSel === i
                ? "border-brand bg-brand/10 text-brand dark:bg-brand/20"
                : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
            )}
          >
            <span className="font-bold">S{s.numero_semaine}</span>
            <span className="capitalize mt-0.5 opacity-70">
              {s.macrophase === "surcharge" ? "↑" : s.macrophase === "decharge" ? "↓" : "★"}
            </span>
          </button>
        ))}
      </div>

      {semaine && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={clsx("px-3 py-1 rounded-full text-xs font-semibold capitalize", PHASE_COLORS[semaine.macrophase])}>
              {semaine.macrophase}
            </span>
            {semaine.objectif_km_course && (
              <span className="text-xs text-gray-500 dark:text-gray-400">🏃 {semaine.objectif_km_course} km</span>
            )}
            {semaine.objectif_amrap_min && (
              <span className="text-xs text-gray-500 dark:text-gray-400">🔥 AMRAP {semaine.objectif_amrap_min} min</span>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {semaine.seances?.length ? (
              semaine.seances.map((s) => (
                <div key={s.id}>
                  <button
                    className="w-full text-left"
                    onClick={() => setSeanceOuverte(seanceOuverte === s.id ? null : s.id)}
                  >
                    <Card title="">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl leading-none">{TYPE_ICONS[s.type] ?? "📌"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.titre || s.type}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.date}</p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {s.zone_cible && (
                              <span className={clsx("px-2 py-0.5 rounded text-xs font-mono font-semibold", ZONE_COLORS[s.zone_cible] ?? "bg-gray-100 text-gray-600")}>
                                {s.zone_cible}
                              </span>
                            )}
                            {s.duree_cible_min && (
                              <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                                ⏱ {s.duree_cible_min >= 60
                                  ? `${Math.floor(s.duree_cible_min / 60)}h${s.duree_cible_min % 60 ? String(s.duree_cible_min % 60).padStart(2, "0") : ""}`
                                  : `${s.duree_cible_min} min`}
                              </span>
                            )}
                            {s.dplus_cible_m > 0 && (
                              <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                                ↑ {s.dplus_cible_m} m
                              </span>
                            )}
                            {s.temps_limite_min && (
                              <span className="px-2 py-0.5 rounded bg-brand/10 text-brand text-xs font-semibold">
                                {s.temps_limite_min} min chrono
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={clsx("text-gray-400 transition-transform text-xs mt-1", seanceOuverte === s.id ? "rotate-180" : "")}>▼</span>
                      </div>
                    </Card>
                  </button>

                  {seanceOuverte === s.id && (
                    <div className="mt-1 mx-1 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4 space-y-4">

                      {/* Résumé durée pour EMOM / AMRAP */}
                      {(s.type === "EMOM" || s.type === "AMRAP") && s.temps_limite_min && (
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{s.type === "EMOM" ? "⏱️" : "🔥"}</span>
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {s.type} — {s.temps_limite_min} minutes
                          </span>
                        </div>
                      )}

                      {/* Liste exercices EMOM / AMRAP */}
                      {s.exercices?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                            {s.type === "EMOM" ? "Exercices (EMOM)" : s.type === "AMRAP" ? "Circuit AMRAP" : "Exercices"}
                          </p>
                          <div className="divide-y divide-gray-100 dark:divide-gray-700 rounded-lg overflow-hidden border border-gray-100 dark:border-gray-700">
                            {s.exercices.map((ex, idx) => (
                              <div key={idx} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-800 text-sm">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400 w-4 text-right">{idx + 1}.</span>
                                  <span className="font-medium text-gray-800 dark:text-gray-200">{ex.nom}</span>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  {ex.repetitions && (
                                    <span className="px-2 py-0.5 rounded bg-brand/10 text-brand text-xs font-bold">
                                      {ex.repetitions} reps
                                    </span>
                                  )}
                                  {ex.duree_sec && !ex.repetitions && (
                                    <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold">
                                      {ex.duree_sec} sec
                                    </span>
                                  )}
                                  {ex.tempo && (
                                    <span className="text-xs font-mono text-gray-400">{ex.tempo}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Instructions / description détaillée */}
                      {s.description && (
                        <details className="group">
                          <summary className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide cursor-pointer select-none list-none flex items-center gap-1">
                            <span className="group-open:rotate-90 inline-block transition-transform">▶</span> Instructions détaillées
                          </summary>
                          <pre className="mt-2 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                            {s.description}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-600 col-span-2">Aucune séance planifiée pour cette semaine.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PageLoader() {
  return (
    <div className="p-8 flex items-center justify-center text-gray-400">
      <span className="animate-pulse text-sm">Chargement du programme...</span>
    </div>
  );
}

function ErreurAPI({ message }) {
  return (
    <div className="p-8 space-y-2">
      <p className="text-sm text-red-500 font-semibold">Erreur de chargement</p>
      <p className="text-xs text-gray-400">{message ?? "Impossible de charger le programme. L'API est-elle connectée ?"}</p>
    </div>
  );
}
