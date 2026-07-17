import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { getTendancesPhysiologiques, getDistributionVolume, getBiometrieRecuperation } from "../api";
import Card from "../components/Card";

export default function Analytics({ dark }) {
  const { data: physio } = useQuery({ queryKey: ["tendances"], queryFn: () => getTendancesPhysiologiques() });
  const { data: volume } = useQuery({ queryKey: ["volume"], queryFn: () => getDistributionVolume() });
  const { data: recup } = useQuery({ queryKey: ["recuperation"], queryFn: () => getBiometrieRecuperation() });

  const ttStyle = {
    backgroundColor: dark ? "#1f2937" : "#ffffff",
    border: `1px solid ${dark ? "#374151" : "#e5e7eb"}`,
    borderRadius: "10px",
    color: dark ? "#f9fafb" : "#111827",
    fontSize: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
  };
  const ttLabelStyle = { color: dark ? "#9ca3af" : "#6b7280", marginBottom: 4 };

  const fmtDate = (iso) => { const [y,m,d] = iso.split("-"); return `${d}/${m}/${y}`; };
  const vmaData = physio?.vma?.map((v) => ({ date: v.date.slice(5), fullDate: v.date, vma: v.valeur })) ?? [];
  const volumeData = volume?.semaines?.map((s) => ({ sem: `S${s.numero_semaine}`, km_route: s.km_route ?? s.km_course ?? 0, km_trail: s.km_trail ?? 0, push: s.volume_muscu?.push ?? 0, pull: s.volume_muscu?.pull ?? 0, jambes: s.volume_muscu?.jambes ?? 0 })) ?? [];
  const acwaData = recup?.acwa?.map((a) => ({ sem: `S${a.semaine}`, ratio: a.ratio, aigue: a.charge_aigue_km, chronique: a.charge_chronique_km })) ?? [];
  const rpeData = recup?.tendance_rpe?.map((r) => ({ sem: `S${r.semaine}`, reel: r.rpe_reel, cible: r.rpe_cible })) ?? [];

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
                <Tooltip formatter={(v) => [`${v} km/h`, "VMA"]} labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate ? fmtDate(payload[0].payload.fullDate) : ""} contentStyle={ttStyle} labelStyle={ttLabelStyle} />
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
                <Tooltip formatter={(v, name) => [`${v} km`, name]} contentStyle={ttStyle} labelStyle={ttLabelStyle} />
                <Legend />
                <Bar dataKey="km_route" name="Route" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                <Bar dataKey="km_trail" name="Trail" stackId="a" fill="#f97316" radius={[4, 4, 0, 0]} />
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
                <Tooltip contentStyle={ttStyle} labelStyle={ttLabelStyle} />
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
                <Tooltip contentStyle={ttStyle} labelStyle={ttLabelStyle} />
                <Legend />
                <ReferenceLine y={1.5} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "⚠️ 1.5", fontSize: 11, fill: "#ef4444" }} />
                <Line type="monotone" dataKey="ratio" name="ACWA" stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="aigue" name="Aiguë (km)" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="chronique" name="Chronique (km)" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-3 px-1 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0 w-3 h-3 rounded-full bg-orange-400" />
                <span><strong className="text-gray-700 dark:text-gray-300">ACWA</strong> — ratio charge semaine / moyenne 4 sem. Entre 0.8 et 1.3 : charge équilibrée.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="mt-1 shrink-0 w-3 h-0.5 bg-red-500" style={{ borderTop: "2px dashed #ef4444" }} />
                <span><strong className="text-red-500">Limite 1.5</strong> — au-delà, la charge hebdo est trop élevée vs tes habitudes → risque de blessure.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0 w-3 h-0.5 bg-green-400 mt-1" />
                <span><strong className="text-gray-700 dark:text-gray-300">Aiguë / Chronique</strong> — km parcourus cette semaine vs moyenne glissante des 4 dernières semaines.</span>
              </div>
            </div>
          </div>
        ) : <Vide />}
      </Card>

      <Card title="😓 RPE réel vs cible">
        {rpeData.length ? (
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={rpeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sem" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} width={32} />
                <Tooltip formatter={(v, name) => [v != null ? v.toFixed(1) : "—", name]} contentStyle={ttStyle} labelStyle={ttLabelStyle} />
                <Legend />
                <Line type="monotone" dataKey="cible" name="RPE cible" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 3 }} connectNulls={false} />
                <Line type="monotone" dataKey="reel" name="RPE réel" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-3 px-1 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0 w-3 h-3 rounded-full bg-red-500" />
                <span><strong className="text-gray-700 dark:text-gray-300">RPE réel</strong> — effort ressenti après la séance (1 = très facile, 10 = effort maximal).</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0 w-3 h-3 rounded-full bg-slate-400" />
                <span><strong className="text-gray-700 dark:text-gray-300">RPE cible</strong> — effort prévu par le programme selon la zone (Z1→5, Z2→6, Z3→7, Z4→8, Z5→9). Si le réel dépasse régulièrement la cible, tu accumules de la fatigue.</span>
              </div>
            </div>
          </div>
        ) : <Vide />}
      </Card>
    </div>
  );
}

function Vide() {
  return <p className="text-sm text-gray-400 dark:text-gray-600 py-6 text-center">Aucune donnée disponible — complète des séances pour voir les graphiques.</p>;
}
