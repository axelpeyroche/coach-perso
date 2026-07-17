import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import {
  getTendancesPhysiologiques, getDistributionVolume, getBiometrieRecuperation,
  getZonesFC, getAllureEndurance, getPredictionCourse, getRecords,
  getEvenements, getSeancesSemaine,
} from "../api";
import Card from "../components/Card";

function LineCursor({ x, y, width, height }) {
  return <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height} stroke="#9ca3af" strokeWidth={1} />;
}

function WeekTick({ x, y, payload, data, dark }) {
  const entry = data?.find(d => d.sem === payload.value);
  const c1 = dark ? "#9ca3af" : "#6b7280";
  const c2 = dark ? "#6b7280" : "#9ca3af";
  return (
    <g transform={`translate(${x},${y + 4})`}>
      <text x={0} y={0} dy={0} textAnchor="middle" fontSize={11} fontWeight={600} fill={c1}>{payload.value}</text>
      {entry?.label && <text x={0} y={0} dy={14} textAnchor="middle" fontSize={9} fill={c2}>{entry.label}</text>}
    </g>
  );
}

// Convertit des minutes décimales en "h:mm" ou "m:ss"
function fmtTemps(min) {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

function fmtAllure(minKm) {
  if (minKm == null) return "—";
  const m = Math.floor(minKm);
  const s = Math.round((minKm - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

const TYPE_SEANCE_EMOJI = {
  COURSE: "🏃", EMOM: "⏱️", AMRAP: "🔁", EVALUATION: "🧪",
  GYM_UPPER: "💪", GYM_LOWER: "🦵", GYM_FULL: "🏋️", DECHARGE: "🌿", BLESSURE: "🩹",
};

// ─── Modal détail semaine ───────────────────────────────────────────────────

function ModalSemaine({ numero, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ["seances-semaine", numero],
    queryFn: () => getSeancesSemaine(numero),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Semaine {numero}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {isLoading ? (
          <p className="text-sm text-gray-400 py-4 text-center">Chargement…</p>
        ) : !data?.seances?.length ? (
          <p className="text-sm text-gray-400 py-4 text-center">Aucune séance cette semaine.</p>
        ) : (
          <div className="space-y-2">
            {data.seances.map(s => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5">
                <span className="text-lg shrink-0">{TYPE_SEANCE_EMOJI[s.type_seance] ?? "📋"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.titre ?? s.type_seance}</p>
                  <p className="text-xs text-gray-400">
                    {s.date.split("-").reverse().join("/")}
                    {s.zone_cible ? ` · ${s.zone_cible}` : ""}
                    {s.distance_km ? ` · ${s.distance_km} km` : ""}
                    {s.duree_min ? ` · ${s.duree_min} min` : ""}
                    {s.rpe != null ? ` · RPE ${s.rpe}` : ""}
                  </p>
                </div>
                <span className={`text-xs font-semibold shrink-0 ${s.completee ? "text-green-500" : "text-gray-300 dark:text-gray-600"}`}>
                  {s.completee ? "✓ Faite" : "À faire"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page Stats ─────────────────────────────────────────────────────────────

const ZONE_FC_COLORS = { Z1: "#60a5fa", Z2: "#4ade80", Z3: "#facc15", Z4: "#fb923c", Z5: "#f87171" };

export default function Analytics({ dark }) {
  const { data: physio } = useQuery({ queryKey: ["tendances"], queryFn: () => getTendancesPhysiologiques() });
  const { data: volume } = useQuery({ queryKey: ["volume"], queryFn: () => getDistributionVolume() });
  const { data: recup } = useQuery({ queryKey: ["recuperation"], queryFn: () => getBiometrieRecuperation() });
  const { data: zonesFC } = useQuery({ queryKey: ["zones-fc"], queryFn: getZonesFC });
  const { data: allure } = useQuery({ queryKey: ["allure-endurance"], queryFn: getAllureEndurance });
  const { data: prediction } = useQuery({ queryKey: ["prediction-course"], queryFn: getPredictionCourse });
  const { data: records } = useQuery({ queryKey: ["records"], queryFn: getRecords });
  const { data: evenements } = useQuery({ queryKey: ["evenements"], queryFn: getEvenements });

  const [periode, setPeriode] = useState("all"); // "4" | "8" | "all"
  const [semaineDetail, setSemaineDetail] = useState(null);

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
  const fmtJM = (iso) => { const [,m,d] = iso.split("-"); return `${d}/${m}`; };
  const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  const vmaData = physio?.vma?.map((v) => ({ date: fmtDate(v.date), vma: v.valeur })) ?? [];
  const volumeDataFull = volume?.semaines?.map((s) => {
    const label = s.date_debut ? `${fmtJM(s.date_debut)} - ${fmtJM(addDays(s.date_debut, 6))}` : "";
    return { sem: `S${s.numero_semaine}`, num: s.numero_semaine, dateDebut: s.date_debut, label, km_route: s.km_route ?? s.km_course ?? 0, km_trail: s.km_trail ?? 0, push: s.volume_muscu?.push ?? 0, pull: s.volume_muscu?.pull ?? 0, jambes: s.volume_muscu?.jambes ?? 0 };
  }) ?? [];

  // Filtre de période
  const nSem = periode === "all" ? volumeDataFull.length : parseInt(periode);
  const volumeData = volumeDataFull.slice(-nSem);

  // Plage de semaines commune à tous les graphiques
  const allSems = volumeData.map(s => s.sem);
  const semDateMap = Object.fromEntries(volumeData.map(s => [s.sem, s.dateDebut]));
  const mkLabel = (sem) => semDateMap[sem] ? `${fmtJM(semDateMap[sem])} - ${fmtJM(addDays(semDateMap[sem], 6))}` : "";

  const acwaByWeek = Object.fromEntries((recup?.acwa ?? []).map(a => [`S${a.semaine}`, a]));
  const acwaData = allSems.map(sem => ({
    sem, label: mkLabel(sem),
    ratio:     acwaByWeek[sem]?.ratio               ?? null,
    aigue:     acwaByWeek[sem]?.charge_aigue_km     ?? null,
    chronique: acwaByWeek[sem]?.charge_chronique_km ?? null,
  }));

  const rpeByWeek = Object.fromEntries((recup?.tendance_rpe ?? []).map(r => [`S${r.semaine}`, r]));
  const rpeData = allSems.map(sem => ({
    sem, label: mkLabel(sem),
    reel:  rpeByWeek[sem]?.rpe_reel  ?? null,
    cible: rpeByWeek[sem]?.rpe_cible ?? null,
  }));

  const zonesFCByWeek = Object.fromEntries((zonesFC?.semaines ?? []).map(z => [`S${z.numero_semaine}`, z]));
  const zonesFCData = allSems.map(sem => ({
    sem, label: mkLabel(sem),
    Z1: zonesFCByWeek[sem]?.Z1 ?? 0, Z2: zonesFCByWeek[sem]?.Z2 ?? 0,
    Z3: zonesFCByWeek[sem]?.Z3 ?? 0, Z4: zonesFCByWeek[sem]?.Z4 ?? 0,
    Z5: zonesFCByWeek[sem]?.Z5 ?? 0,
  }));
  const hasZonesFC = zonesFCData.some(z => z.Z1 + z.Z2 + z.Z3 + z.Z4 + z.Z5 > 0);

  const allureData = allure?.points?.map(p => ({ date: fmtDate(p.date), allure: p.allure_min_km, fc: p.fc_moyenne, km: p.distance_km })) ?? [];

  const predData = prediction?.predictions?.map(p => ({ date: fmtDate(p.date), predit: p.temps_predit_min, vma: p.vma })) ?? [];
  const objectifTemps = prediction?.objectif?.objectif_temps_min ?? null;

  // Événements par semaine (annotations)
  const evtsBySem = {};
  for (const e of evenements?.evenements ?? []) {
    const key = `S${e.semaine}`;
    if (allSems.includes(key)) evtsBySem[key] = e;
  }

  // Clic sur un graphique hebdo → détail de la semaine
  const handleChartClick = (state) => {
    if (state?.activeLabel) {
      const num = parseInt(String(state.activeLabel).replace("S", ""));
      if (!isNaN(num)) setSemaineDetail(num);
    }
  };

  const refLinesEvts = Object.entries(evtsBySem).map(([sem, e]) => (
    <ReferenceLine key={sem} x={sem} stroke={e.type === "course" ? "#ef4444" : "#8b5cf6"} strokeDasharray="4 4"
      label={{ value: e.label, position: "top", fontSize: 10, fill: e.type === "course" ? "#ef4444" : "#8b5cf6" }} />
  ));

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Statistiques</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Tendances physiologiques et charge d'entraînement</p>
        </div>
        {/* Filtre de période */}
        <div className="flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
          {[["4", "4 sem"], ["8", "8 sem"], ["all", "Tout"]].map(([val, label]) => (
            <button key={val} onClick={() => setPeriode(val)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${periode === val ? "bg-white dark:bg-gray-700 text-brand shadow-sm" : "text-gray-500 dark:text-gray-400"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Records personnels */}
      {records && records.seances_completees > 0 && (
        <Card title="🏆 Records & jalons">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              records.plus_longue_sortie && { label: "Plus longue sortie", val: `${records.plus_longue_sortie.km} km`, sub: fmtDate(records.plus_longue_sortie.date) },
              records.plus_gros_dplus && { label: "Plus gros D+", val: `${records.plus_gros_dplus.m} m`, sub: fmtDate(records.plus_gros_dplus.date) },
              records.plus_longue_duree && { label: "Plus longue durée", val: fmtTemps(records.plus_longue_duree.min), sub: fmtDate(records.plus_longue_duree.date) },
              records.meilleure_semaine && { label: "Meilleure semaine", val: `${records.meilleure_semaine.km} km`, sub: `S${records.meilleure_semaine.semaine}` },
              records.vma_max && { label: "VMA max", val: `${records.vma_max} km/h`, sub: "Demi-Cooper" },
              { label: "Régularité", val: `${records.streak_semaines} sem.`, sub: `${records.seances_completees} séances faites` },
            ].filter(Boolean).map(({ label, val, sub }) => (
              <div key={label} className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2.5">
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-base font-black text-gray-900 dark:text-white mt-0.5">{val}</p>
                <p className="text-xs text-gray-400">{sub}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="📈 Progression VMA (km/h)">
        {vmaData.length ? (
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={vmaData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={32} />
                <Tooltip formatter={(v) => [`${v} km/h`, "VMA"]} contentStyle={ttStyle} labelStyle={ttLabelStyle} />
                <Line type="monotone" dataKey="vma" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <Vide />}
      </Card>

      {/* Prédiction temps de course */}
      {predData.length > 0 && prediction?.objectif && (
        <Card title={`🎯 Prédiction — ${prediction.objectif.nom}`}>
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={predData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={40} tickFormatter={fmtTemps} />
                <Tooltip formatter={(v, name) => [fmtTemps(v), name]} contentStyle={ttStyle} labelStyle={ttLabelStyle} />
                <Legend />
                {objectifTemps && (
                  <ReferenceLine y={objectifTemps} stroke="#22c55e" strokeDasharray="4 4"
                    label={{ value: `🏁 Objectif ${fmtTemps(objectifTemps)}`, fontSize: 11, fill: "#22c55e", position: "insideTopRight" }} />
                )}
                <Line type="monotone" dataKey="predit" name="Temps prédit" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-2 px-1 text-xs text-gray-500 dark:text-gray-400">
              Temps estimé sur <strong className="text-gray-700 dark:text-gray-300">{prediction.objectif.distance_km} km{prediction.objectif.dplus_m ? ` (D+ ${prediction.objectif.dplus_m} m)` : ""}</strong> d'après
              chaque test VMA. Quand la courbe passe sous la ligne verte, ton objectif est à portée.
            </p>
          </div>
        </Card>
      )}

      <Card title="🏃 Volume course hebdomadaire (km)">
        {volumeData.length ? (
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={volumeData} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sem" height={40} tick={<WeekTick data={volumeData} dark={dark} />} />
                <YAxis tick={{ fontSize: 11 }} width={32} />
                <Tooltip formatter={(v, name) => [`${v} km`, name]} contentStyle={ttStyle} labelStyle={ttLabelStyle} cursor={<LineCursor />} />
                <Legend />
                {refLinesEvts}
                <Bar dataKey="km_route" name="Route" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} activeBar={{ fill: '#16a34a' }} />
                <Bar dataKey="km_trail" name="Trail" stackId="a" fill="#f97316" radius={[4, 4, 0, 0]} activeBar={{ fill: '#ea580c' }} />
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-1 px-1 text-xs text-gray-400 text-center">Clique sur une semaine pour voir le détail des séances</p>
          </div>
        ) : <Vide />}
      </Card>

      {/* Zones FC */}
      {hasZonesFC && (
        <Card title="❤️ Temps par zone cardiaque (min)">
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={zonesFCData} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sem" height={40} tick={<WeekTick data={zonesFCData} dark={dark} />} />
                <YAxis tick={{ fontSize: 11 }} width={32} />
                <Tooltip formatter={(v, name) => [`${v} min`, name]} contentStyle={ttStyle} labelStyle={ttLabelStyle} cursor={<LineCursor />} />
                <Legend />
                {["Z1", "Z2", "Z3", "Z4", "Z5"].map((z, i) => (
                  <Bar key={z} dataKey={z} name={z} stackId="fc" fill={ZONE_FC_COLORS[z]} radius={i === 4 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-2 px-1 text-xs text-gray-500 dark:text-gray-400">
              Temps estimé par zone FC d'après la fréquence cardiaque moyenne de tes séances. Pour progresser en aérobie,
              vise <strong className="text-gray-700 dark:text-gray-300">~80 % du temps en Z1–Z2</strong> et 20 % en Z3+.
            </p>
          </div>
        </Card>
      )}

      {/* Allure endurance */}
      {allureData.length >= 2 && (
        <Card title="🐢 Allure des sorties endurance (Z1/Z2)">
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={allureData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={["auto", "auto"]} reversed tick={{ fontSize: 11 }} width={44} tickFormatter={(v) => fmtAllure(v).replace("/km", "")} />
                <Tooltip formatter={(v, name) => name === "Allure" ? [fmtAllure(v), name] : [v ? `${v} bpm` : "—", name]} contentStyle={ttStyle} labelStyle={ttLabelStyle} />
                <Legend />
                <Line type="monotone" dataKey="allure" name="Allure" stroke="#14b8a6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-2 px-1 text-xs text-gray-500 dark:text-gray-400">
              Allure moyenne de tes sorties faciles — l'axe est inversé : <strong className="text-gray-700 dark:text-gray-300">plus la courbe monte, plus tu vas vite</strong> au
              même effort. C'est le meilleur signe de progression aérobie entre deux tests VMA.
            </p>
          </div>
        </Card>
      )}

      <Card title="💪 Répartition musculaire (séries)">
        {volumeData.length ? (
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={volumeData} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sem" height={40} tick={<WeekTick data={volumeData} dark={dark} />} />
                <YAxis tick={{ fontSize: 11 }} width={32} />
                <Tooltip contentStyle={ttStyle} labelStyle={ttLabelStyle} cursor={<LineCursor />} />
                <Legend />
                <Bar dataKey="push" name="Push" fill="#f97316" radius={[4, 4, 0, 0]} activeBar={{ fill: '#ea580c' }} />
                <Bar dataKey="pull" name="Pull" fill="#3b82f6" radius={[4, 4, 0, 0]} activeBar={{ fill: '#2563eb' }} />
                <Bar dataKey="jambes" name="Jambes" fill="#a855f7" radius={[4, 4, 0, 0]} activeBar={{ fill: '#9333ea' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <Vide />}
      </Card>

      <Card title="⚡ Ratio ACWA — Charge aiguë / chronique">
        {acwaData.length ? (
          <div className="w-full overflow-x-hidden">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={acwaData} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sem" height={40} padding={{ left: 30, right: 30 }} tick={<WeekTick data={acwaData} dark={dark} />} />
                <YAxis tick={{ fontSize: 11 }} width={32} />
                <Tooltip formatter={(v, name) => [v != null ? Number(v).toFixed(2) : "—", name]} contentStyle={ttStyle} labelStyle={ttLabelStyle} />
                <Legend />
                <ReferenceLine y={1.5} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "⚠️ 1.5", fontSize: 11, fill: "#ef4444" }} />
                {refLinesEvts}
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
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={rpeData} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sem" height={40} padding={{ left: 30, right: 30 }} tick={<WeekTick data={rpeData} dark={dark} />} />
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

      {semaineDetail != null && <ModalSemaine numero={semaineDetail} onClose={() => setSemaineDetail(null)} />}
    </div>
  );
}

function Vide() {
  return <p className="text-sm text-gray-400 dark:text-gray-600 py-6 text-center">Aucune donnée disponible — complète des séances pour voir les graphiques.</p>;
}
