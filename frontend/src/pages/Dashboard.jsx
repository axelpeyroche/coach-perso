import { useQuery } from "@tanstack/react-query";
import { getBiometrieRecuperation, getTendancesPhysiologiques } from "../api";
import Card from "../components/Card";
import StatTile from "../components/StatTile";

const USER_ID = 1;

export default function Dashboard() {
  const { data: physio } = useQuery({
    queryKey: ["tendances", USER_ID],
    queryFn: () => getTendancesPhysiologiques(USER_ID),
  });

  const { data: recup } = useQuery({
    queryKey: ["recuperation", USER_ID],
    queryFn: () => getBiometrieRecuperation(USER_ID),
  });

  const derniereVMA = physio?.vma?.at(-1);
  const derniereACWA = recup?.acwa?.at(-1);
  const alerteActive = recup?.alerte_active;

  const zones = derniereVMA?.zones;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Vue d'ensemble de ta progression EPC</p>
      </div>

      {alerteActive && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Risque de blessure détecté</p>
            <p className="text-sm text-red-600 dark:text-red-300 mt-0.5">{recup?.message_alerte}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="VMA actuelle"
          value={derniereVMA ? `${derniereVMA.valeur} km/h` : "—"}
          sub="Demi-Cooper"
          color="green"
        />
        <StatTile
          label="Ratio ACWA"
          value={derniereACWA ? derniereACWA.ratio : "—"}
          sub={derniereACWA?.alerte_risque ? "⚠️ Élevé" : "Normal"}
          color={derniereACWA?.alerte_risque ? "red" : "blue"}
        />
        <StatTile
          label="Km cette semaine"
          value={derniereACWA ? `${derniereACWA.charge_aigue_km} km` : "—"}
          sub="Charge aiguë"
          color="orange"
        />
        <StatTile
          label="Moy. 4 semaines"
          value={derniereACWA ? `${derniereACWA.charge_chronique_km} km` : "—"}
          sub="Charge chronique"
          color="purple"
        />
      </div>

      {zones && (
        <Card title="Zones de vitesse actuelles">
          <div className="space-y-2">
            {[
              { z: "Z1", label: "Récupération", color: "bg-blue-400" },
              { z: "Z2", label: "Base aérobie", color: "bg-green-400" },
              { z: "Z3", label: "Tempo", color: "bg-yellow-400" },
              { z: "Z4", label: "Seuil", color: "bg-orange-400" },
              { z: "Z5", label: "VO2max", color: "bg-red-400" },
            ].map(({ z, label, color }) => (
              <div key={z} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${color}`} />
                <span className="w-6 text-xs font-semibold text-gray-700 dark:text-gray-300">{z}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 w-28">{label}</span>
                <span className="text-xs font-mono text-gray-800 dark:text-gray-200">
                  {zones[z][0]} – {zones[z][1]} km/h
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!derniereVMA && !derniereACWA && (
        <Card title="Démarrer">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Aucune donnée encore. Commence par renseigner ta première évaluation dans l'onglet{" "}
            <strong className="text-brand">Évaluation</strong> pour calculer ta VMA et tes zones.
          </p>
        </Card>
      )}
    </div>
  );
}
