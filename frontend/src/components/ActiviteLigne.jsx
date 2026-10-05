import { sportInfo, fmtDateHeure, nombre, SOURCES } from "../carnet";

// Ligne compacte d'une activité (liste du carnet, dernières activités de l'accueil)
export default function ActiviteLigne({ a, onClick }) {
  const s = sportInfo(a.sport);
  const metriques = [
    a.duree_str,
    a.distance_km != null && `${nombre(a.distance_km, 2)} km`,
    a.dplus_m ? `${a.dplus_m} m D+` : null,
    a.allure_sec_km && !a.vitesse_kmh ? a.allure_str : null,
    a.vitesse_kmh ? `${nombre(a.vitesse_kmh)} km/h` : null,
    a.fc_moyenne_bpm ? `♥ ${a.fc_moyenne_bpm}` : null,
    a.rpe ? `RPE ${a.rpe}${a.rpe_estime ? " (estimé)" : ""}` : null,
  ].filter(Boolean);

  return (
    <button onClick={onClick}
      className="w-full text-left flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/50 dark:hover:bg-white/5 transition">
      <span className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-lg"
        style={{ backgroundColor: `${s.couleur}22` }}>
        {a.emoji ?? s.emoji}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {a.titre || a.sport_label || s.label}
          </span>
          {a.rpe == null && <span className="shrink-0 text-[10px] font-bold uppercase text-orange-600 dark:text-orange-400">RPE à remplir</span>}
          {a.est_competition &&<span className="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">🏅 course</span>}
        </span>
        <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
          {metriques.join(" · ") || "—"}
        </span>
      </span>
      <span className="text-right shrink-0">
        <span className="block text-xs text-gray-500 dark:text-gray-400">{fmtDateHeure(a.debut)}</span>
        <span className="block text-[10px] text-gray-400 dark:text-gray-500">{SOURCES[a.source] ?? a.source}</span>
      </span>
    </button>
  );
}
