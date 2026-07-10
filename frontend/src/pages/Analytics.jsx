import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { getTendancesPhysiologiques, getDistributionVolume, getBiometrieRecuperation } from "../api";
import Card from "../components/Card";

export default function Analytics() {
  const { data: physio } = useQuery({ queryKey: ["tendances"], queryFn: () => getTendancesPhysiologiques() });
  const { data: volume } = useQuery({ queryKey: ["volume"], queryFn: () => getDistributionVolume() });
  const { data: recup } = useQuery({ queryKey: ["recuperation"], queryFn: () => getBiometrieRecuperation() });

  const vmaData = physio?.vma?.map((v) => ({ date: v.date.slice(5), vma: v.valeur })) ?? [];
  const volumeData = volume?.semaines?.map((s) => ({ sem: `S${s.numero_semaine}`, km: s.km_course, push: s.volume_muscu?.push ?? 0, pull: s.volume_muscu?.pull ?? 0, jambes: s.volume_muscu?.jambes ?? 0 })) ?? [];
  const acwaData = recup?.acwa?.map((a) => ({ sem: `S${a.semaine}`, ratio: a.ratio, aigue: a.charge_aigue_km, chronique: a.charge_chronique_km })) ?? [];
  const rpeData = recup?.tendance_rpe?.map((r) => ({ date: r.date.slice(5), reel: r.rpe_reel, cible: r.rpe_cible })) ?? [];

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Statistiques</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Tendances physiologiques et charge d'entraînement</p>
      </div>

      <Card title="📈 Progression VMA (km/h)">
        {vmaData.length ? (
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={vmaData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={32} />
                <Tooltip formatter={(v) => [`${v} km/h`, "VMA"]} />
                <Line type="monotone" dataKey="vma" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <Vide />}
      </Card>

      <Card title="🏃 Volume course hebdomadaire (km)">
        {volumeData.length ? (
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sem" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={32} />
                <Tooltip formatter={(v) => [`${v} km`]} />
                <Bar dataKey="km" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <Vide />}
      </Card>

      <Card title="💪 Répartition musculaire (séries)">
        {volumeData.length ? (
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sem" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={32} />
                <Tooltip />
                <Legend />
                <Bar dataKey="push" name="Push" fill="#f97316" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pull" name="Pull" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="jambes" name="Jambes" fill="#a855f7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <Vide />}
      </Card>

      <Card title="⚡ Ratio ACWA — Charge aiguë / chronique">
        {acwaData.length ? (
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={acwaData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sem" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={32} />
                <Tooltip />
                <Legend />
                <ReferenceLine y={1.5} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "⚠️ 1.5", fontSize: 11, fill: "#ef4444" }} />
                <Line type="monotone" dataKey="ratio" name="ACWA" stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="aigue" name="Aiguë (km)" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="chronique" name="Chronique (km)" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <Vide />}
      </Card>

      <Card title="😓 RPE réel vs cible">
        {rpeData.length ? (
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={rpeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} width={32} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="reel" name="RPE réel" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="cible" name="RPE cible" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <Vide />}
      </Card>
    </div>
  );
}

function Vide() {
  return <p className="text-sm text-gray-400 dark:text-gray-600 py-6 text-center">Aucune donnée disponible — complète des séances pour voir les graphiques.</p>;
}
