import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { getEquipementActivite, getMemeParcours, getSegmentsActivite } from "../api";
import { nombre, sportInfo, SOURCES } from "../carnet";
import { ciel, useMeteo } from "./FicheExtras";

// Fait défiler la feuille jusqu'à l'encart détaillé correspondant
export const ancre = (id, quoi) => `fiche-${id}-${quoi}`;
const aller = (id, quoi) => document.getElementById(ancre(id, quoi))?.scrollIntoView({ behavior: "smooth", block: "start" });

function Puce({ children, alerte, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={clsx("inline-flex items-center gap-1.5 rounded-full card px-2.5 py-[5px] text-[13px] font-medium whitespace-nowrap max-w-full active:opacity-70 transition",
        alerte ? "text-ios-orange" : "text-brand")}>
      <span className="truncate">{children}</span>
    </button>
  );
}

// En-tête : sport, date, titre et puces qui mènent aux encarts détaillés plus bas.
// Les chiffres, la carte, le profil et l'effort sont dans les encarts et dans l'image à partager.
export default function EnteteFiche({ a }) {
  const s = sportInfo(a.sport);
  const id = a.id;
  const avecTrace = !!a.details?.trace;

  // Mêmes requêtes que les encarts du dessous : pas d'appel en plus
  const { data: meteo } = useMeteo(a);
  const { data: equip } = useQuery({ queryKey: ["equipement", id], queryFn: () => getEquipementActivite(id), staleTime: 60_000 });
  const { data: meme } = useQuery({ queryKey: ["meme-parcours", id], queryFn: () => getMemeParcours(id), staleTime: 10 * 60_000, enabled: avecTrace });
  const { data: segs } = useQuery({ queryKey: ["segments-activite", id], queryFn: () => getSegmentsActivite(id), staleTime: 10 * 60_000, enabled: avecTrace });

  const e = equip?.equipement;
  const courante = meme?.find((l) => l.courante);
  const fois = meme?.length > 1 && courante ? meme.filter((l) => l.date <= courante.date).length : null;
  const seg = (segs ?? []).filter((x) => x.nb_passages > 0).sort((x, y) => x.rang - y.rang)[0];
  const date = new Date(a.debut);

  return (
    <div className="space-y-3 -mt-1">
      <div>
        <p className="flex items-center gap-1.5 text-[13px] text-label-2 min-w-0">
          <span className="w-[22px] h-[22px] rounded-[6px] grid place-items-center text-[13px] shrink-0"
            style={{ backgroundColor: `${s.couleur}33` }}>{a.emoji ?? s.emoji}</span>
          <span className="truncate">
            {a.sport_label || s.label}{a.est_competition && " 🏅"} · {date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
            {" · "}{date.toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" }).replace(":", " h ")}
            {" · "}{SOURCES[a.source] ?? a.source}
          </span>
        </p>
        <h2 className="text-[26px] font-bold leading-[1.15] mt-0.5 [text-wrap:balance]">{a.titre || a.sport_label || s.label}</h2>
      </div>

      {(meteo || e || fois || seg) && (
        <div className="flex flex-wrap gap-1.5">
          {meteo && (
            <Puce onClick={() => aller(id, "conditions")}>
              {ciel(meteo.code)[0]} {nombre(meteo.temperature, 0)}°{meteo.vent_kmh != null ? ` · vent ${meteo.vent_kmh} km/h` : ""}
            </Puce>
          )}
          {e && <Puce alerte={e.alerte} onClick={() => aller(id, "conditions")}>👟 {e.nom} · {nombre(e.km, 0)} km</Puce>}
          {fois && <Puce onClick={() => aller(id, "parcours")}>🔁 {fois}<sup>{fois === 1 ? "re" : "e"}</sup> fois sur ce parcours</Puce>}
          {seg && (
            <Puce onClick={() => aller(id, "segments")}>
              {seg.rang === 1 && seg.nb_passages > 1 ? "🥇" : seg.rang === 2 ? "🥈" : seg.rang === 3 ? "🥉" : "⛳"} {seg.nom}
            </Puce>
          )}
        </div>
      )}
    </div>
  );
}
