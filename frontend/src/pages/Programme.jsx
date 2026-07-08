import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSemainesMacrocycle } from "../api";
import Card from "../components/Card";
import clsx from "clsx";

const MACROCYCLE_ID = 1;

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

export default function Programme() {
  const [semaineSel, setSemaineSel] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["macrocycle", MACROCYCLE_ID],
    queryFn: () => getSemainesMacrocycle(MACROCYCLE_ID),
  });

  if (isLoading) return <PageLoader />;
  if (error) return <ErreurAPI />;

  const semaines = data?.semaines ?? [];
  const semaine = semaineSel !== null ? semaines[semaineSel] : semaines[0];

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Programme</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Macrocycle {data?.numero_cycle} — {data?.date_debut} → {data?.date_fin}
        </p>
      </div>

      {/* Sélecteur semaines */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {semaines.map((s, i) => (
          <button
            key={s.numero_semaine}
            onClick={() => setSemaineSel(i)}
            className={clsx(
              "shrink-0 flex flex-col items-center px-3 py-2 rounded-xl border text-xs font-medium transition-colors",
              (semaineSel === null && i === 0) || semaineSel === i
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
          <div className="flex items-center gap-3">
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
                <Card key={s.id} title="">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl leading-none">{TYPE_ICONS[s.type] ?? "📌"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{s.titre || s.type}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.date}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {s.zone_cible && (
                          <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs font-mono text-gray-600 dark:text-gray-400">
                            {s.zone_cible}
                          </span>
                        )}
                        {s.distance_cible_km && (
                          <span className="text-xs text-gray-500">{s.distance_cible_km} km</span>
                        )}
                        {s.temps_limite_min && (
                          <span className="text-xs text-gray-500">{s.temps_limite_min} min</span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
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

function ErreurAPI() {
  return (
    <div className="p-8">
      <p className="text-sm text-red-500">Impossible de charger le programme. L'API est-elle connectée ?</p>
    </div>
  );
}
