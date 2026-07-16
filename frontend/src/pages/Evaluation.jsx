import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getHistoriqueEvaluations, modifierEvaluation, supprimerEvaluation } from "../api";
import Card from "../components/Card";
import clsx from "clsx";


function ModalEditerEval({ ev, onClose }) {
  const qc = useQueryClient();
  const [distance, setDistance] = useState(ev.distance_m != null ? String(ev.distance_m) : "");
  const [amrap, setAmrap]       = useState(ev.amrap_tours != null ? String(ev.amrap_tours) : "");
  const [reps, setReps]         = useState(
    Object.fromEntries(ev.max_1min.map(m => [m.nom, String(m.reps)]))
  );

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {};
      if (distance !== "" && parseFloat(distance) !== ev.distance_m)
        payload.distance_metres = parseFloat(distance);
      if (amrap !== "" && parseFloat(amrap) !== ev.amrap_tours)
        payload.amrap_tours = parseFloat(amrap);
      if (ev.max_1min.length > 0)
        payload.max_1min = ev.max_1min.map(m => ({
          exercice_id: m.exercice_id,
          repetitions: parseInt(reps[m.nom] ?? m.reps),
        }));
      return modifierEvaluation(ev.id, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["evaluations-historique"] });
      qc.invalidateQueries({ queryKey: ["tendances"] });
      onClose();
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => supprimerEvaluation(ev.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["evaluations-historique"] });
      qc.invalidateQueries({ queryKey: ["tendances"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            Modifier — {ev.date.split("-").reverse().join("/")}
          </h3>
          <button
            onClick={() => { if (window.confirm("Supprimer cette évaluation ?")) deleteMut.mutate(); }}
            disabled={deleteMut.isPending}
            className="text-red-400 hover:text-red-600 transition-colors text-sm font-medium px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
            {deleteMut.isPending ? "…" : "Supprimer"}
          </button>
        </div>

        {ev.distance_m != null && (
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Distance Demi-Cooper (m)</label>
            <input type="number" value={distance} onChange={e => setDistance(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            {distance && <p className="text-xs text-brand mt-1">VMA → {(parseFloat(distance) / 100).toFixed(1)} km/h</p>}
          </div>
        )}

        {ev.amrap_tours != null && (
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">AMRAP 10' (tours)</label>
            <input type="number" step="0.5" value={amrap} onChange={e => setAmrap(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
        )}

        {ev.max_1min.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Max 1 min</p>
            <div className="grid grid-cols-2 gap-2">
              {ev.max_1min.map(m => (
                <div key={m.nom}>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 truncate">{m.nom}</label>
                  <input type="number" value={reps[m.nom] ?? ""} onChange={e => setReps(r => ({ ...r, [m.nom]: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">Annuler</button>
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="px-5 py-2 rounded-xl bg-brand text-white font-semibold text-sm disabled:opacity-50">
            {saveMut.isPending ? "…" : "Enregistrer"}
          </button>
        </div>
        {(saveMut.isError || deleteMut.isError) && <p className="text-xs text-red-500 text-center">Erreur — réessaie.</p>}
      </div>
    </div>
  );
}

export default function Evaluation() {
  const [evalEnEdition, setEvalEnEdition] = useState(null);

  const { data: historiqueData } = useQuery({
    queryKey: ["evaluations-historique"],
    queryFn: () => getHistoriqueEvaluations(),
  });
  const historique = historiqueData?.evaluations ?? [];

  // Aligner les évaluations par date : une ligne = une date où au moins un test a été fait
  // On groupe par date (même si chaque éval peut avoir les 3 tests ou seulement certains)
  // En pratique chaque entrée de historique contient potentiellement les 3 types

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Évaluation</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Tests — VMA, force & conditionnement</p>
      </div>

      {/* Explication des 3 tests */}
      <Card title="Protocole d'évaluation">
        <div className="space-y-4 text-sm text-gray-600 dark:text-gray-400">
          <div className="flex gap-3">
            <span className="text-xl shrink-0">🏃</span>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">Demi-Cooper — 6 minutes</p>
              <p className="mt-0.5">Cours à allure maximale pendant 6 minutes. Mesure la distance parcourue pour calculer ta VMA (formule : distance en mètres ÷ 100).</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="text-xl shrink-0">💪</span>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">Max 1 min — 7 mouvements</p>
              <p className="mt-0.5">Maximum de répétitions en 1 minute par exercice (Tractions, Dips, Pompes, Abdos, Squats, Pistol G & D). 3 minutes de récupération entre chaque mouvement.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="text-xl shrink-0">🔥</span>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">AMRAP 10 min — circuit fixe</p>
              <p className="mt-0.5">Maximum de tours en 10 minutes : 10 Tractions · 10 Pompes · 10 Squats · 10 Dips · 10 Burpees · 10 Mountain Climbers. Score en tours (ex. 2.9).</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Historique des performances */}
      {historique.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white">Historique des performances</h3>

          {/* Table 3 colonnes */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* En-tête */}
            <div className="grid grid-cols-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <div className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Date</div>
              <div className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-center">🏃 Demi-Cooper</div>
              <div className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-center">💪 Max 1 min</div>
              <div className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-center">🔥 AMRAP 10'</div>
            </div>

            {/* Lignes */}
            {historique.map((ev, i) => (
              <div key={ev.id}
                className={clsx(
                  "grid grid-cols-4 items-start border-b border-gray-100 dark:border-gray-800 last:border-0",
                  i % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/50 dark:bg-gray-800/30"
                )}>
                {/* Date + bouton modifier */}
                <div className="px-3 py-3 flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-800 dark:text-white">
                    {ev.date.split("-").reverse().join("/")}
                  </span>
                  {i === 0 && (
                    <span className="inline-block px-1.5 py-0.5 rounded-full text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-medium w-fit">
                      Dernière
                    </span>
                  )}
                  <button
                    onClick={() => setEvalEnEdition(ev)}
                    className="text-gray-400 hover:text-brand transition-colors p-0.5 rounded w-fit"
                    title="Modifier">
                    ✏️
                  </button>
                </div>

                {/* Demi-Cooper */}
                <div className="px-3 py-3 text-center">
                  {ev.vma_kmh != null ? (
                    <>
                      <p className="text-sm font-bold text-brand">{ev.vma_kmh} km/h</p>
                      {ev.distance_m && <p className="text-xs text-gray-400 mt-0.5">{ev.distance_m} m</p>}
                    </>
                  ) : (
                    <span className="text-sm text-gray-300 dark:text-gray-600">—</span>
                  )}
                </div>

                {/* Max 1 min */}
                <div className="px-3 py-3">
                  {ev.max_1min.length > 0 ? (
                    <div className="space-y-0.5">
                      {ev.max_1min.map(m => (
                        <div key={m.nom} className="flex justify-between text-xs gap-1">
                          <span className="text-gray-500 dark:text-gray-400 truncate">{m.nom}</span>
                          <span className="font-semibold text-gray-800 dark:text-gray-200 shrink-0">{m.reps}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-300 dark:text-gray-600">—</span>
                  )}
                </div>

                {/* AMRAP */}
                <div className="px-3 py-3 text-center">
                  {ev.amrap_tours != null ? (
                    <p className="text-sm font-bold text-orange-500">{ev.amrap_tours} tours</p>
                  ) : (
                    <span className="text-sm text-gray-300 dark:text-gray-600">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {historique.length === 0 && (
        <div className="text-center py-10 text-gray-400 dark:text-gray-600 text-sm">
          Aucune évaluation enregistrée.<br />
          Valide une séance d'évaluation dans le Programme pour saisir tes performances.
        </div>
      )}

      {evalEnEdition && (
        <ModalEditerEval ev={evalEnEdition} onClose={() => setEvalEnEdition(null)} />
      )}
    </div>
  );
}
