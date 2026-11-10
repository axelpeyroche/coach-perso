import { useQuery } from "@tanstack/react-query";
import Card from "./Card";
import Aide from "./Aide";
import { Section } from "./ui";
import { Faits, Ligne, court, teinte } from "./BilanBlocs";
import { getExploration } from "../api";
import { nombre, sportInfo } from "../carnet";

const INITIALES = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const useExploration = () => useQuery({ queryKey: ["exploration"], queryFn: getExploration, staleTime: 10 * 60_000 });

// Chemins parcourus pour la première fois, mois par mois, sur une année
export default function Exploration({ annee, ouvrir }) {
  const { data: e } = useExploration();
  if (!e || !e.nb_traces) return null;
  const mois = Array.from({ length: 12 }, (_, i) => e.mois.find((m) => m.mois === `${annee}-${String(i + 1).padStart(2, "0")}`) ?? { km: 0, nouveaux_km: 0 });
  const total = mois.reduce((s, m) => s + m.nouveaux_km, 0), parcouru = mois.reduce((s, m) => s + m.km, 0);
  if (!parcouru) return null;
  const max = Math.max(...mois.map((m) => m.nouveaux_km), 1);
  const sorties = e.sorties.filter((s) => s.date.startsWith(String(annee))).slice(0, 3);
  return (
    <Section titre={<span className="flex items-center gap-1.5">Exploration <Aide sujet="exploration" className="no-print" /></span>}>
      <Card pad={false}>
        <div className="px-4 pt-[18px] pb-3">
          <div className="grid grid-cols-12 gap-[5px] items-end h-[96px]">
            {mois.map((m, i) => (
              <div key={i} className="flex flex-col items-center justify-end gap-[5px] h-full min-w-0"
                title={`${nombre(m.nouveaux_km, 1)} km nouveaux sur ${nombre(m.km, 0)} km`}>
                <div className="w-full rounded-t-[5px] rounded-b-[2px]"
                  style={{ height: m.nouveaux_km ? `${Math.max(4, (m.nouveaux_km / max) * 100)}%` : "2px",
                    background: m.nouveaux_km ? "rgb(var(--green) / 0.75)" : "rgb(120 120 128 / 0.3)" }} />
                <span className="text-[11px] text-label-2">{INITIALES[i]}</span>
              </div>
            ))}
          </div>
        </div>
        <Faits items={[
          [`${nombre(total, total < 100 ? 1 : 0)} km`, `de chemins nouveaux en ${annee}`],
          [`${Math.round((100 * total) / parcouru)} %`, "des kilomètres tracés"],
        ]} />
        {sorties.length > 0 && (
          <div className="divide-y-[0.5px] divide-separateur border-t-[0.5px] border-separateur">
            {sorties.map((s) => (
              <Ligne key={s.activite_id} ico={sportInfo(s.sport).emoji} fond={teinte("rgb(var(--green))")}
                titre={s.titre || sportInfo(s.sport).label} sous={`${court(s.date)} · ${nombre(s.km, 1)} km au total`}
                valeur={`${nombre(s.nouveaux_km, 1)} km`} detail="nouveaux" onClick={() => ouvrir(s.activite_id)} />
            ))}
          </div>
        )}
      </Card>
      <p className="px-4 text-[13px] text-label-2">Un chemin compte comme nouveau la première fois qu'un tracé GPS y passe, à une centaine de mètres près.</p>
    </Section>
  );
}

// Ligne « chemins nouveaux » d'un mois, dans les faits marquants
export function ExplorationMois({ mois }) {
  const { data: e } = useExploration();
  const m = e?.mois.find((x) => x.mois === mois);
  if (!m || m.nouveaux_km < 0.5) return null;
  return (
    <Ligne ico="🧭" fond={teinte("rgb(var(--green))")} titre="Chemins nouveaux"
      sous={`sur ${nombre(m.km, 0)} km tracés au GPS`} valeur={`${nombre(m.nouveaux_km, 1)} km`} />
  );
}
