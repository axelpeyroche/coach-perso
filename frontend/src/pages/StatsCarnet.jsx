import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import Card from "../components/Card";
import StatTile from "../components/StatTile";
import { FormeGraphiques } from "../components/Forme";
import { getStatsCarnet } from "../api";
import { SPORTS, sportInfo, fmtAllureSec, fmtDate, nombre } from "../carnet";

const axe = { fontSize: 11, fill: "#9ca3af" };
const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: "none", fontSize: 12, background: "rgba(17,24,39,0.9)", color: "#fff" },
  labelStyle: { color: "#d1d5db" },
};

const ZONES = {
  "sous-charge": { label: "Sous-charge", color: "blue", txt: "Charge de la semaine bien en dessous de ta moyenne : tu peux relancer." },
  optimale: { label: "Zone optimale", color: "green", txt: "Charge cohérente avec ce que tu encaisses habituellement." },
  vigilance: { label: "Vigilance", color: "orange", txt: "Hausse marquée de la charge : surveille la fatigue." },
  risque: { label: "Risque", color: "red", txt: "Pic de charge brutal (> 1,5× ta moyenne) : risque de blessure accru." },
};

function Heatmap({ calendrier }) {
  // 53 colonnes (semaines) × 7 lignes (lun→dim), se terminant aujourd'hui
  const { cols, max } = useMemo(() => {
    const auj = new Date();
    auj.setHours(12, 0, 0, 0);
    const fin = new Date(auj);
    fin.setDate(fin.getDate() + (7 - ((fin.getDay() + 6) % 7) - 1)); // dimanche courant
    const cols = [];
    let max = 0;
    for (let w = 52; w >= 0; w--) {
      const col = [];
      for (let d = 6; d >= 0; d--) {
        const j = new Date(fin);
        j.setDate(fin.getDate() - w * 7 - d);
        const iso = `${j.getFullYear()}-${String(j.getMonth() + 1).padStart(2, "0")}-${String(j.getDate()).padStart(2, "0")}`;
        const v = calendrier[iso] ?? 0;
        max = Math.max(max, v);
        col.push({ iso, v, futur: j > auj });
      }
      cols.push(col);
    }
    return { cols, max };
  }, [calendrier]);

  const niveau = (v) => (v === 0 ? 0 : v < max * 0.25 ? 1 : v < max * 0.5 ? 2 : v < max * 0.75 ? 3 : 4);
  const COUL = ["bg-gray-200/70 dark:bg-gray-700/60", "bg-violet-200 dark:bg-violet-900", "bg-violet-400 dark:bg-violet-700", "bg-violet-500 dark:bg-violet-500", "bg-violet-700 dark:bg-violet-300"];

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px] w-max">
        {cols.map((col, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {col.map((c) => (
              <div key={c.iso} title={`${fmtDate(c.iso)} : ${c.v} min`}
                className={`w-[11px] h-[11px] rounded-[3px] ${c.futur ? "opacity-0" : COUL[niveau(c.v)]}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StatsCarnet() {
  const [sport, setSport] = useState("");
  const [metrique, setMetrique] = useState("heures");
  const { data: s, isLoading } = useQuery({
    queryKey: ["stats-carnet", sport],
    queryFn: () => getStatsCarnet(sport || undefined),
  });

  const sportsPresents = useMemo(() => {
    if (!s) return [];
    return Object.keys(SPORTS).filter((k) => s.semaines.some((w) => w[`h_${k}`] > 0));
  }, [s]);

  const allures = useMemo(() => {
    if (!s) return [];
    // moyenne glissante sur 5 sorties pour lisser
    return s.allures.map((p, i, arr) => {
      const fen = arr.slice(Math.max(0, i - 4), i + 1);
      const moy = fen.reduce((t, x) => t + x.allure_sec_km, 0) / fen.length;
      const effs = fen.filter((x) => x.efficacite);
      return {
        ...p,
        label: fmtDate(p.date, { day: "numeric", month: "short" }),
        tendance: Math.round(moy),
        efficacite_moy: effs.length ? +(effs.reduce((t, x) => t + x.efficacite, 0) / effs.length).toFixed(3) : null,
      };
    });
  }, [s]);

  if (isLoading || !s) {
    return <div className="p-4 md:p-8"><p className="text-sm text-gray-400">Chargement…</p></div>;
  }

  const t = s.totaux;
  const zone = ZONES[s.charge.zone];
  const aucune = t.total.nb === 0;

  return (
    <div className="p-4 md:p-8 w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Statistiques</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {s.premiere_activite ? `Depuis le ${fmtDate(s.premiere_activite)}` : "Ajoute des activités pour voir tes stats"}
        </p>
      </div>

      <div className="flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1 overflow-x-auto w-fit max-w-full">
        {[["", "Tous sports"], ...Object.entries(SPORTS).map(([k, v]) => [k, `${v.emoji} ${v.label}`])].map(([k, l]) => (
          <button key={k} onClick={() => setSport(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${sport === k ? "bg-white dark:bg-gray-700 text-brand shadow-sm" : "text-gray-500 dark:text-gray-400"}`}>
            {l}
          </button>
        ))}
      </div>

      {aucune ? (
        <Card><p className="text-sm text-gray-500 text-center py-6">Aucune activité pour ce filtre.</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Cette semaine" color="purple" value={`${nombre(t.semaine.duree_h)} h`} sub={`${t.semaine.nb} séance(s) · ${nombre(t.semaine.distance_km)} km`} />
            <StatTile label="Ce mois-ci" color="blue" value={`${nombre(t.mois.duree_h)} h`} sub={`${t.mois.nb} séance(s) · ${nombre(t.mois.distance_km)} km`} />
            <StatTile label={`Année ${new Date().getFullYear()}`} color="green" value={`${nombre(t.annee.distance_km, 0)} km`} sub={`${t.annee.nb} séances · ${nombre(t.annee.duree_h, 0)} h · ${t.annee.dplus_m} m D+`} />
            <StatTile label="Régularité" color="orange" value={`${s.regularite.serie_semaines} sem.`} sub={`d'affilée · ${s.regularite.jours_actifs_28j} j actifs / 28`} />
          </div>

          {!sport && <FormeGraphiques />}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title="Volume hebdomadaire (26 semaines)"
                action={
                  <div className="flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                    {[["heures", "Heures"], ["km", "Km à pied"], ["charge", "Charge"]].map(([k, l]) => (
                      <button key={k} onClick={() => setMetrique(k)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${metrique === k ? "bg-white dark:bg-gray-700 text-brand shadow-sm" : "text-gray-500"}`}>{l}</button>
                    ))}
                  </div>
                }>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={s.semaines} margin={{ left: -20, right: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af33" vertical={false} />
                    <XAxis dataKey="label" tick={axe} interval={3} />
                    <YAxis tick={axe} />
                    <Tooltip {...tooltipStyle} />
                    {metrique === "heures" && sportsPresents.map((k) => (
                      <Bar key={k} dataKey={`h_${k}`} name={SPORTS[k].label} stackId="h" fill={SPORTS[k].couleur} />
                    ))}
                    {metrique === "km" && <Bar dataKey="km_pied" name="Km course + trail" fill="#8b5cf6" radius={[4, 4, 0, 0]} />}
                    {metrique === "charge" && <Bar dataKey="charge" name="Charge (min × RPE)" fill="#f97316" radius={[4, 4, 0, 0]} />}
                    {metrique === "heures" && sportsPresents.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <Card title="Charge d'entraînement (ACWR)">
              {s.charge.acwr == null ? (
                <p className="text-sm text-gray-500">Pas assez de données sur 28 jours.</p>
              ) : (
                <div className="space-y-3">
                  <StatTile label={zone?.label ?? "—"} color={zone?.color ?? "blue"} value={nombre(s.charge.acwr, 2)} sub="charge 7 j / moyenne hebdo 28 j" />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2.5">
                      <p className="text-[11px] text-gray-500">Aiguë (7 j)</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{s.charge.aigue_7j}</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2.5">
                      <p className="text-[11px] text-gray-500">Chronique / sem.</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{s.charge.chronique_hebdo}</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{zone?.txt}</p>
                  <p className="text-[11px] text-gray-400">Charge = minutes × RPE (RPE 5 par défaut si non renseigné).</p>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Volume mensuel (12 mois)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={s.mois} margin={{ left: -20, right: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af33" vertical={false} />
                  <XAxis dataKey="label" tick={axe} />
                  <YAxis tick={axe} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="duree_h" name="Heures" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="km_pied" name="Km à pied" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Allure à pied (tendance sur 5 sorties)">
              {allures.length < 2 ? (
                <p className="text-sm text-gray-500">Pas encore assez de sorties course/trail avec distance.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={allures} margin={{ left: 0, right: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af33" vertical={false} />
                    <XAxis dataKey="label" tick={axe} minTickGap={24} />
                    <YAxis tick={axe} reversed domain={["dataMin - 15", "dataMax + 15"]} tickFormatter={(v) => fmtAllureSec(v).replace("/km", "")} width={42} />
                    <Tooltip {...tooltipStyle} formatter={(v, n) => [fmtAllureSec(v), n]} />
                    <Line dataKey="allure_sec_km" name="Allure" stroke="#c4b5fd" dot={{ r: 2 }} strokeWidth={1} />
                    <Line dataKey="tendance" name="Tendance" stroke="#7c3aed" dot={false} strokeWidth={2.5} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {allures.some((p) => p.efficacite) && (
            <Card title="Efficacité aérobie (mètres par battement, moyenne sur 5 sorties)">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={allures.filter((p) => p.efficacite)} margin={{ left: -10, right: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af33" vertical={false} />
                  <XAxis dataKey="label" tick={axe} minTickGap={24} />
                  <YAxis tick={axe} domain={["auto", "auto"]} />
                  <Tooltip {...tooltipStyle} />
                  <Line dataKey="efficacite_moy" name="m/battement" stroke="#10b981" dot={false} strokeWidth={2.5} />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-xs text-gray-400 mt-2">Plus c'est haut, plus tu vas vite pour un même effort cardiaque : signe de progrès en endurance.</p>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Records">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {["5 km", "10 km", "Semi", "Marathon"].map((l) => {
                  const r = s.records.distances.find((x) => x.label === l);
                  return (
                    <div key={l} className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2.5">
                      <p className="text-[11px] text-gray-500">{l}</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{r?.temps_str ?? "—"}</p>
                      {r && <p className="text-[10px] text-gray-400">{r.allure_str} · {fmtDate(r.date)}</p>}
                    </div>
                  );
                })}
              </div>
              <div className="space-y-1.5">
                {s.records.autres.map((r) => (
                  <div key={r.label} className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">{r.label}</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{r.valeur} <span className="text-xs font-normal text-gray-400">· {fmtDate(r.date)}</span></span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Records estimés à partir de l'allure moyenne des sorties proches de la distance (pas de split GPS).</p>
            </Card>

            <Card title="Répartition par sport (12 mois)">
              <div className="space-y-2.5">
                {s.repartition.map((r) => {
                  const pct = (100 * r.duree_h) / Math.max(...s.repartition.map((x) => x.duree_h), 0.01);
                  const info = sportInfo(r.sport);
                  return (
                    <div key={r.sport}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700 dark:text-gray-300">{info.emoji} {r.label}</span>
                        <span className="text-gray-500">{r.nb} · {nombre(r.duree_h)} h{r.distance_km ? ` · ${nombre(r.distance_km, 0)} km` : ""}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: info.couleur }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <Card title="Calendrier d'activité (12 mois)">
            <Heatmap calendrier={s.regularite.calendrier} />
          </Card>

          <Card title="Cumuls">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[["7 jours", t["7j"]], ["28 jours", t["28j"]], ["Année", t.annee], ["Depuis le début", t.total]].map(([l, x]) => (
                <div key={l} className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2.5">
                  <p className="text-[11px] text-gray-500">{l}</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{x.nb} séances · {nombre(x.duree_h)} h</p>
                  <p className="text-[10px] text-gray-400">{nombre(x.distance_km)} km · {x.dplus_m} m D+</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
