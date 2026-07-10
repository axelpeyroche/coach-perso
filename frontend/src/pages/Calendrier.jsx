import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getToutesSemaines } from "../api";
import clsx from "clsx";


const TYPE_COLORS = {
  COURSE:     "bg-brand",
  AMRAP:      "bg-orange-500",
  EMOM:       "bg-purple-500",
  EVALUATION: "bg-yellow-500",
  DECHARGE:   "bg-blue-400",
  REPOS:      "bg-gray-300 dark:bg-gray-600",
  GYM_UPPER:  "bg-rose-500",
  GYM_LOWER:  "bg-amber-500",
  GYM_FULL:   "bg-teal-500",
};
const TYPE_ICONS = {
  COURSE: "🏃", AMRAP: "🔥", EMOM: "⏱️", EVALUATION: "🎯", DECHARGE: "🧘", REPOS: "😴",
  GYM_UPPER: "💪", GYM_LOWER: "🦵", GYM_FULL: "🏋️",
};

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MOIS  = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

function parseLocalDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default function Calendrier() {
  const today = new Date();
  const [annee,  setAnnee]  = useState(today.getFullYear());
  const [moisIdx, setMoisIdx] = useState(today.getMonth());

  const { data: raw } = useQuery({
    queryKey: ["toutes-semaines"],
    queryFn:  () => getToutesSemaines(),
  });
  const semaines = raw?.semaines ?? [];

  // Indexe les séances validées par date "YYYY-MM-DD"
  const seancesParDate = useMemo(() => {
    const map = {};
    for (const sem of semaines) {
      for (const s of sem.seances ?? []) {
        if (!s.journal?.completee || !s.date) continue;
        const key = s.date.slice(0, 10);
        if (!map[key]) map[key] = [];
        map[key].push(s);
      }
    }
    return map;
  }, [semaines]);

  // Statistiques globales (toutes dates confondues)
  const stats = useMemo(() => {
    let totalSeances = 0, totalKm = 0, totalDplus = 0;
    for (const seances of Object.values(seancesParDate)) {
      for (const s of seances) {
        if (s.type === "REPOS") continue;
        totalSeances++;
        totalKm   += s.journal?.distance_reelle_km ?? 0;
        totalDplus += s.journal?.dplus_reel_m ?? 0;
      }
    }
    return { totalSeances, totalKm: Math.round(totalKm * 10) / 10, totalDplus };
  }, [seancesParDate]);

  // Construction de la grille du mois courant
  const cellules = useMemo(() => {
    const premierJour = new Date(annee, moisIdx, 1);
    // lundi=0 … dimanche=6
    let offset = premierJour.getDay() - 1;
    if (offset < 0) offset = 6;
    const nbJours = new Date(annee, moisIdx + 1, 0).getDate();
    const cases = [];
    for (let i = 0; i < offset; i++) cases.push(null);
    for (let d = 1; d <= nbJours; d++) cases.push(d);
    return cases;
  }, [annee, moisIdx]);

  function naviguer(delta) {
    let m = moisIdx + delta;
    let a = annee;
    if (m < 0)  { m = 11; a--; }
    if (m > 11) { m = 0;  a++; }
    setMoisIdx(m);
    setAnnee(a);
  }

  function dateKey(jour) {
    return `${annee}-${String(moisIdx + 1).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
  }

  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Calendrier</h1>

      <div className="flex flex-col lg:flex-row gap-6">

        {/* ── Calendrier ── */}
        <div className="flex-1 min-w-0 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">

          {/* Navigation mois */}
          <div className="flex items-center justify-between mb-5">
            <button onClick={() => naviguer(-1)}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors">
              ◀
            </button>
            <h2 className="text-base font-bold text-gray-900 dark:text-white capitalize">
              {MOIS[moisIdx]} {annee}
            </h2>
            <button onClick={() => naviguer(1)}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors">
              ▶
            </button>
          </div>

          {/* En-têtes jours */}
          <div className="grid grid-cols-7 mb-2">
            {JOURS.map(j => (
              <div key={j} className="text-center text-xs font-semibold text-gray-400 dark:text-gray-500 py-1">
                {j}
              </div>
            ))}
          </div>

          {/* Grille */}
          <div className="grid grid-cols-7 gap-1">
            {cellules.map((jour, i) => {
              if (!jour) return <div key={`e-${i}`} />;
              const key      = dateKey(jour);
              const seances  = seancesParDate[key] ?? [];
              const actives  = seances.filter(s => s.type !== "REPOS");
              const isToday  = key === todayKey;
              return (
                <div key={key}
                  className={clsx(
                    "rounded-xl p-1.5 min-h-[56px] flex flex-col items-center transition-colors",
                    actives.length > 0
                      ? "bg-brand/5 dark:bg-brand/10"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/50",
                    isToday && "ring-2 ring-brand ring-offset-1 dark:ring-offset-gray-900"
                  )}>
                  <span className={clsx(
                    "text-xs font-semibold mb-1",
                    isToday ? "text-brand" : "text-gray-500 dark:text-gray-400"
                  )}>
                    {jour}
                  </span>
                  <div className="flex flex-col items-center gap-0.5 w-full">
                    {actives.map((s, si) => (
                      <span key={si}
                        className={clsx(
                          "w-full text-center text-[10px] leading-tight font-medium rounded px-0.5 py-0.5 text-white truncate",
                          TYPE_COLORS[s.type] ?? "bg-gray-400"
                        )}
                        title={s.titre}>
                        {TYPE_ICONS[s.type]}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Légende — uniquement les types présents dans le programme */}
          <div className="mt-4 flex flex-wrap gap-3">
            {Object.entries(TYPE_ICONS)
              .filter(([t]) => t !== "REPOS" && semaines.some(sem => sem.seances?.some(s => s.type === t)))
              .map(([type, icon]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <span className={clsx("w-3 h-3 rounded-sm inline-block", TYPE_COLORS[type])} />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{icon} {type.charAt(0) + type.slice(1).toLowerCase()}</span>
                </div>
              ))}
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="lg:w-64 flex flex-col gap-4">

          {/* KPIs globaux — grille sur mobile */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
            <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">
              Depuis le début
            </h3>
            <div className="grid grid-cols-3 lg:grid-cols-1 gap-3 lg:gap-4">
              <StatBloc label="Séances" value={stats.totalSeances} unit="séances" icon="✅" />
              <StatBloc label="Distance" value={stats.totalKm}     unit="km"      icon="🏃" />
              <StatBloc label="Dénivelé" value={stats.totalDplus}  unit="m D+"    icon="⛰️" />
            </div>
          </div>

          {/* Séances du mois en cours */}
          <StatsMois seancesParDate={seancesParDate} annee={annee} moisIdx={moisIdx} moisLabel={MOIS[moisIdx]} />

          {/* Bouton revenir au mois courant */}
          {(annee !== today.getFullYear() || moisIdx !== today.getMonth()) && (
            <button
              onClick={() => { setAnnee(today.getFullYear()); setMoisIdx(today.getMonth()); }}
              className="text-xs text-brand font-semibold hover:underline text-center">
              ← Revenir au mois courant
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatBloc({ label, value, unit, icon }) {
  return (
    <div className="flex flex-col items-center lg:flex-row lg:items-center lg:gap-3 text-center lg:text-left">
      <span className="text-xl leading-none mb-1 lg:mb-0">{icon}</span>
      <div>
        <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
          {value}
        </p>
        <p className="text-[10px] text-gray-400 dark:text-gray-500">{label}</p>
      </div>
    </div>
  );
}

function StatsMois({ seancesParDate, annee, moisIdx, moisLabel }) {
  const stats = useMemo(() => {
    let seances = 0, km = 0, dplus = 0;
    const prefix = `${annee}-${String(moisIdx + 1).padStart(2, "0")}`;
    for (const [key, list] of Object.entries(seancesParDate)) {
      if (!key.startsWith(prefix)) continue;
      for (const s of list) {
        if (s.type === "REPOS") continue;
        seances++;
        km    += s.journal?.distance_reelle_km ?? 0;
        dplus += s.journal?.dplus_reel_m ?? 0;
      }
    }
    return { seances, km: Math.round(km * 10) / 10, dplus };
  }, [seancesParDate, annee, moisIdx]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
      <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">
        {moisLabel}
      </h3>
      <div className="grid grid-cols-3 lg:grid-cols-1 gap-3 lg:gap-4">
        <StatBloc label="Séances" value={stats.seances} unit="séances" icon="✅" />
        <StatBloc label="Distance" value={stats.km}     unit="km"      icon="🏃" />
        <StatBloc label="Dénivelé" value={stats.dplus}  unit="m D+"    icon="⛰️" />
      </div>
    </div>
  );
}
