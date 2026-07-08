import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { journaliserSeance } from "../api";
import Card from "../components/Card";
import clsx from "clsx";

const USER_ID = 1;

const CHAMPS_COURSE = [
  { key: "distance_reelle_km", label: "Distance (km)", type: "number", step: "0.1", placeholder: "12.5" },
  { key: "duree_reelle_min", label: "Durée (min)", type: "number", placeholder: "65" },
  { key: "dplus_reel_m", label: "D+ (m)", type: "number", placeholder: "120" },
  { key: "fc_moyenne_bpm", label: "FC moy (bpm)", type: "number", placeholder: "152" },
  { key: "fc_max_bpm", label: "FC max (bpm)", type: "number", placeholder: "178" },
];

const CHAMPS_MUSCU = [
  { key: "tours_amrap_completes", label: "Tours AMRAP", type: "number", step: "0.1", placeholder: "2.9" },
  { key: "total_reps_enregistrees", label: "Total reps", type: "number", placeholder: "180" },
];

export default function Journal() {
  const [seanceId, setSeanceId] = useState("");
  const [typeSeance, setTypeSeance] = useState("COURSE");
  const [rpe, setRpe] = useState(7);
  const [champs, setChamps] = useState({});
  const [notes, setNotes] = useState("");
  const [succes, setSucces] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      journaliserSeance(seanceId, {
        utilisateur_id: USER_ID,
        rpe,
        notes: notes || undefined,
        ...Object.fromEntries(
          Object.entries(champs)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, parseFloat(v) || parseInt(v)])
        ),
      }),
    onSuccess: () => {
      setSucces(true);
      setChamps({});
      setNotes("");
      setTimeout(() => setSucces(false), 3000);
    },
  });

  const champsAffiches = typeSeance === "COURSE" ? CHAMPS_COURSE : CHAMPS_MUSCU;

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Journal</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Enregistre ta séance du jour</p>
      </div>

      {succes && (
        <div className="rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-700 dark:text-green-400 font-medium">
          ✅ Séance enregistrée avec succès !
        </div>
      )}

      <Card title="Détails de la séance">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">ID séance</label>
              <input
                type="number"
                value={seanceId}
                onChange={(e) => setSeanceId(e.target.value)}
                placeholder="1"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Type</label>
              <select
                value={typeSeance}
                onChange={(e) => setTypeSeance(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="COURSE">Course</option>
                <option value="AMRAP">AMRAP / EMOM</option>
              </select>
            </div>
          </div>

          {/* RPE */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">RPE (effort perçu)</label>
              <span className={clsx("text-sm font-bold", rpe <= 4 ? "text-blue-500" : rpe <= 6 ? "text-green-500" : rpe <= 8 ? "text-orange-500" : "text-red-500")}>
                {rpe}/10
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={rpe}
              onChange={(e) => setRpe(parseFloat(e.target.value))}
              className="w-full accent-brand"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>Très facile</span>
              <span>Maximum</span>
            </div>
          </div>

          {/* Champs dynamiques */}
          <div className="grid grid-cols-2 gap-3">
            {champsAffiches.map(({ key, label, type, step, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                <input
                  type={type}
                  step={step}
                  value={champs[key] ?? ""}
                  onChange={(e) => setChamps((c) => ({ ...c, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Sensations, contexte, observations..."
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          <button
            onClick={() => mutation.mutate()}
            disabled={!seanceId || mutation.isPending}
            className="w-full py-3 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? "Enregistrement..." : "Enregistrer la séance"}
          </button>

          {mutation.isError && (
            <p className="text-xs text-red-500 text-center">Erreur — vérifie l'ID de séance et la connexion API.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
