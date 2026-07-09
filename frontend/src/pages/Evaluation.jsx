import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { creerEvaluation, enregistrerDemiCooper, enregistrerMax1Min, enregistrerAmrapBenchmark, getExercicesEvaluation, getHistoriqueEvaluations, supprimerEvaluationsIncompletes } from "../api";
import Card from "../components/Card";
import clsx from "clsx";

const USER_ID = 1;

const ETAPES = ["intro", "demi_cooper", "max_1min", "amrap", "resultats"];

export default function Evaluation() {
  const [etape, setEtape] = useState("intro");
  const [evaluationId, setEvaluationId] = useState(null);
  const [resultats, setResultats] = useState({});

  // Demi-Cooper
  const [distance, setDistance] = useState("");
  const [fcMax, setFcMax] = useState("");
  const [vmaResultat, setVmaResultat] = useState(null);

  // Max 1 min
  const [reps, setReps] = useState({});

  // AMRAP
  const [tours, setTours] = useState("");

  const { data: mouvements = [] } = useQuery({
    queryKey: ["exercices-evaluation"],
    queryFn: getExercicesEvaluation,
  });

  const { data: historiqueData } = useQuery({
    queryKey: ["evaluations-historique"],
    queryFn: () => getHistoriqueEvaluations(USER_ID),
  });
  const historique = historiqueData?.evaluations ?? [];

  const qc = useQueryClient();
  const creerMut = useMutation({ mutationFn: creerEvaluation });
  const nettoyerMut = useMutation({
    mutationFn: () => supprimerEvaluationsIncompletes(USER_ID),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evaluations-historique"] }),
  });
  const cooperMut = useMutation({ mutationFn: ({ id, data }) => enregistrerDemiCooper(id, data) });
  const max1MinMut = useMutation({ mutationFn: ({ id, data }) => enregistrerMax1Min(id, data) });
  const amrapMut = useMutation({ mutationFn: ({ id, data }) => enregistrerAmrapBenchmark(id, data) });

  async function demarrer() {
    const eval_ = await creerMut.mutateAsync({ utilisateur_id: USER_ID, est_induction: true });
    setEvaluationId(eval_.id);
    setEtape("demi_cooper");
  }

  async function validerCooper() {
    const res = await cooperMut.mutateAsync({
      id: evaluationId,
      data: { distance_metres: parseFloat(distance), fc_max: fcMax ? parseInt(fcMax) : undefined },
    });
    setVmaResultat(res);
    setResultats((r) => ({ ...r, cooper: res }));
    setEtape("max_1min");
  }

  async function valider1Min() {
    const payload = mouvements.map((m) => ({
      exercice_id: m.id,
      repetitions_realisees: parseInt(reps[m.slug] || 0),
    }));
    await max1MinMut.mutateAsync({ id: evaluationId, data: payload });
    setResultats((r) => ({ ...r, max1min: reps }));
    setEtape("amrap");
  }

  async function validerAmrap() {
    await amrapMut.mutateAsync({
      id: evaluationId,
      data: { tours_completes: parseFloat(tours) },
    });
    setResultats((r) => ({ ...r, amrap: tours }));
    setEtape("resultats");
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Évaluation</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Tests EPC — VMA, force & conditionnement</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {["Intro", "Demi-Cooper", "Max 1 min", "AMRAP 10'", "Résultats"].map((label, i) => {
          const etapes = ["intro", "demi_cooper", "max_1min", "amrap", "resultats"];
          const actif = etapes.indexOf(etape) >= i;
          return (
            <div key={label} className="flex items-center gap-2">
              <div className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold", actif ? "bg-brand text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-400")}>
                {i + 1}
              </div>
              {i < 4 && <div className={clsx("h-0.5 w-6 md:w-10", actif ? "bg-brand" : "bg-gray-200 dark:bg-gray-700")} />}
            </div>
          );
        })}
      </div>

      {etape === "intro" && (
        <Card title="Protocole EPC — Semaine 8">
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
            <p>Cette session comprend 3 tests enchaînés :</p>
            <div className="space-y-2">
              <div className="flex gap-3"><span>🏃</span><span><strong className="text-gray-900 dark:text-white">Demi-Cooper</strong> — 6 min à allure maximale. Calcule ta VMA.</span></div>
              <div className="flex gap-3"><span>💪</span><span><strong className="text-gray-900 dark:text-white">Max 1 min</strong> — 7 mouvements, 3 min de récup entre chaque.</span></div>
              <div className="flex gap-3"><span>🔥</span><span><strong className="text-gray-900 dark:text-white">AMRAP 10 min</strong> — circuit fixe EPC, score en tours.</span></div>
            </div>
          </div>
          <button onClick={demarrer} disabled={creerMut.isPending} className="mt-5 w-full py-3 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50">
            {creerMut.isPending ? "Création..." : "Démarrer l'évaluation"}
          </button>
        </Card>
      )}

      {etape === "intro" && historique.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-800 dark:text-white">Historique</h3>
            {historique.some(ev => ev.amrap_tours == null && ev.max_1min.length === 0) && (
              <button
                onClick={() => { if (window.confirm("Supprimer toutes les évaluations incomplètes ?")) nettoyerMut.mutate(); }}
                disabled={nettoyerMut.isPending}
                className="text-xs text-red-500 hover:text-red-600 dark:text-red-400 font-medium disabled:opacity-50">
                {nettoyerMut.isPending ? "Suppression..." : "Nettoyer les incomplets"}
              </button>
            )}
          </div>
          {historique.map((ev, i) => (
            <div key={ev.id} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
              {/* En-tête éval */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {ev.date.split("-").reverse().join("/")}
                  </span>
                  {i === 0 && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-medium">Dernière</span>
                  )}
                </div>
                {i > 0 && historique[i - 1].vma_kmh && ev.vma_kmh && (
                  <span className={clsx("text-xs font-semibold", historique[i - 1].vma_kmh > ev.vma_kmh ? "text-red-500" : "text-green-500")}>
                    {historique[i - 1].vma_kmh > ev.vma_kmh ? "▼" : "▲"} {Math.abs(historique[i - 1].vma_kmh - ev.vma_kmh).toFixed(1)} km/h
                  </span>
                )}
              </div>
              {/* Métriques principales */}
              <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-800">
                <div className="px-4 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">VMA</p>
                  <p className="text-lg font-bold text-brand">{ev.vma_kmh != null ? `${ev.vma_kmh} km/h` : "—"}</p>
                  {ev.distance_m && <p className="text-xs text-gray-400">{ev.distance_m} m</p>}
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">AMRAP 10'</p>
                  <p className="text-lg font-bold text-orange-500">{ev.amrap_tours != null ? `${ev.amrap_tours} tours` : "—"}</p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">Max 1 min</p>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{ev.max_1min.length > 0 ? `${ev.max_1min.length} mvts` : "—"}</p>
                </div>
              </div>
              {/* Détail Max 1 min */}
              {ev.max_1min.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {ev.max_1min.map((m) => (
                    <div key={m.nom} className="flex justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400 truncate">{m.nom}</span>
                      <span className="font-semibold text-gray-800 dark:text-gray-200 ml-2 shrink-0">{m.reps} reps</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {etape === "demi_cooper" && (
        <Card title="🏃 Demi-Cooper — 6 minutes">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Cours à allure maximale pendant 6 minutes puis entre la distance parcourue.</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Distance parcourue (mètres)</label>
              <input type="number" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="ex. 1450" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
              {distance && <p className="text-xs text-brand mt-1">VMA estimée : {(parseFloat(distance) / 100).toFixed(1)} km/h</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">FC max (optionnel)</label>
              <input type="number" value={fcMax} onChange={(e) => setFcMax(e.target.value)} placeholder="ex. 192" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <button onClick={validerCooper} disabled={!distance || cooperMut.isPending} className="w-full py-3 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50">
              {cooperMut.isPending ? "Enregistrement..." : "Valider & calculer les zones"}
            </button>
          </div>
        </Card>
      )}

      {etape === "max_1min" && (
        <Card title="💪 Max Répétitions — 1 minute par mouvement">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">3 minutes de récupération entre chaque mouvement.</p>
          {mouvements.length === 0 ? (
            <p className="text-sm text-amber-500 py-4 text-center animate-pulse">Chargement des exercices...</p>
          ) : (
            <div className="space-y-3">
              {mouvements.map((m) => (
                <div key={m.slug} className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 w-28">{m.nom}</span>
                  <input
                    type="number"
                    min={0}
                    value={reps[m.slug] || ""}
                    onChange={(e) => setReps((r) => ({ ...r, [m.slug]: e.target.value }))}
                    placeholder="reps"
                    className="w-24 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-center focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
              ))}
              <button
                onClick={valider1Min}
                disabled={max1MinMut.isPending || mouvements.some((m) => !reps[m.slug])}
                className="mt-5 w-full py-3 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50"
              >
                {max1MinMut.isPending ? "Enregistrement..." : "Valider"}
              </button>
              {mouvements.some((m) => !reps[m.slug]) && (
                <p className="text-xs text-gray-400 text-center">Remplis tous les champs avant de valider.</p>
              )}
            </div>
          )}
        </Card>
      )}

      {etape === "amrap" && (
        <Card title="🔥 AMRAP Benchmark — 10 minutes">
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1 mb-4">
            <p className="font-medium text-gray-800 dark:text-gray-200 mb-2">Circuit fixe EPC :</p>
            {["10 Tractions", "10 Pompes", "10 Squats", "10 Dips", "10 Burpees", "10 Mountain Climbers"].map((ex) => (
              <div key={ex} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-brand" /><span>{ex}</span></div>
            ))}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Score (tours) — ex. 2.9</label>
            <input type="number" step="0.1" value={tours} onChange={(e) => setTours(e.target.value)} placeholder="2.9" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <button onClick={validerAmrap} disabled={!tours || amrapMut.isPending} className="mt-5 w-full py-3 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50">
            {amrapMut.isPending ? "Enregistrement..." : "Terminer l'évaluation"}
          </button>
        </Card>
      )}

      {etape === "resultats" && (
        <Card title="✅ Évaluation complète">
          <div className="space-y-3 text-sm">
            {resultats.cooper && (
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-600 dark:text-gray-400">VMA calculée</span>
                <span className="font-bold text-brand text-lg">{resultats.cooper.vma_kmh} km/h</span>
              </div>
            )}
            {resultats.amrap && (
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-600 dark:text-gray-400">Score AMRAP 10'</span>
                <span className="font-bold text-orange-500 text-lg">{resultats.amrap} tours</span>
              </div>
            )}
            {resultats.max1min && (
              <div className="pt-2">
                <p className="text-gray-500 dark:text-gray-400 mb-2">Max 1 minute :</p>
                <div className="grid grid-cols-2 gap-2">
                  {mouvements.map((m) => (
                    <div key={m.slug} className="flex justify-between bg-gray-50 dark:bg-gray-800 px-3 py-2 rounded-lg">
                      <span className="text-gray-600 dark:text-gray-400">{m.nom}</span>
                      <span className="font-semibold text-gray-900 dark:text-white">{resultats.max1min?.[m.slug] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={() => setEtape("intro")} className="mt-5 w-full py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Nouvelle évaluation
          </button>
        </Card>
      )}
    </div>
  );
}
