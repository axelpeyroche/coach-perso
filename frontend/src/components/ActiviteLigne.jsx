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
    <button onClick={onClick} className="ligne" style={{ "--inset": "4.25rem" }}>
      <span className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[19px]"
        style={{ backgroundColor: `${s.couleur}26` }}>
        {a.emoji ?? s.emoji}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-[15px] font-semibold text-label truncate">
            {a.titre || a.sport_label || s.label}
          </span>
          {a.est_competition && <span className="shrink-0 text-[13px]">🏅</span>}
        </span>
        <span className="block text-[13px] text-label-2 truncate chiffres">
          {metriques.join(" · ") || "—"}
        </span>
        {a.rpe == null && <span className="badge mt-1 bg-ios-orange/15 text-ios-orange">RPE à remplir</span>}
      </span>
      <span className="text-right shrink-0 self-start pt-0.5">
        <span className="block text-[12px] text-label-2">{fmtDateHeure(a.debut)}</span>
        <span className="block text-[11px] text-label-3">{SOURCES[a.source] ?? a.source}</span>
      </span>
    </button>
  );
}
