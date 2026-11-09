import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Card from "./Card";
import { Chevron } from "./ui";
import { getZones } from "../api";

export const ZONES_COULEURS = ["#8E8E93", "#007AFF", "#34C759", "#FF9500", "#FF3B30"];

export const mmss = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : null);

export function plageFc(z) {
  if (z.fc_min == null) return `< ${z.fc_max + 1}`;
  if (z.fc_max == null) return `≥ ${z.fc_min}`;
  return `${z.fc_min}–${z.fc_max}`;
}

export function plageAllure(z) {
  const lente = mmss(z.allure_lente), rapide = mmss(z.allure_rapide);
  if (!lente && !rapide) return null;
  if (!lente) return `> ${rapide}`;
  if (!rapide) return `< ${lente}`;
  return `${lente}–${rapide}`;
}

const NOMS_COURTS = { "Endurance fondamentale": "Endurance (EF)" };

/** Carte du Résumé : les 5 zones cardiaques du jour, avec l'allure correspondante. */
export default function ZonesCardiaques() {
  const { data, isLoading } = useQuery({ queryKey: ["zones"], queryFn: getZones, staleTime: 5 * 60 * 1000 });
  const zones = data?.zones ?? [];
  return (
    <Card pad={false}>
      {isLoading ? (
        <p className="p-4 text-[15px] text-label-2">Calcul des zones…</p>
      ) : !zones.length ? (
        <p className="p-4 text-[15px] text-label-2">
          Pas encore assez de séances avec la fréquence cardiaque pour calculer tes zones.
        </p>
      ) : (
        <>
          <ul>
            {zones.slice().reverse().map((z) => (
              <li key={z.zone} className="flex items-center gap-3 px-4 py-2.5 border-b border-separateur last:border-0">
                <span className="w-1.5 self-stretch rounded-full shrink-0" style={{ background: ZONES_COULEURS[z.zone - 1] }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold leading-tight">
                    Z{z.zone} <span className="font-normal text-label-2">· {NOMS_COURTS[z.nom] ?? z.nom}</span>
                  </span>
                  {plageAllure(z) && <span className="block text-[12px] text-label-3 chiffres">{plageAllure(z)} /km</span>}
                </span>
                <span className="text-[17px] font-semibold chiffres whitespace-nowrap" style={{ color: ZONES_COULEURS[z.zone - 1] }}>
                  {plageFc(z)} <span className="text-[12px] font-normal text-label-3">bpm</span>
                </span>
              </li>
            ))}
          </ul>
          <Link to="/analyses#zones" className="flex items-center gap-2 px-4 py-3 bg-fond/60 active:opacity-70 transition">
            <span className="flex-1 min-w-0 text-[12px] text-label-2 chiffres">
              {data.methode === "seuil"
                ? <>Seuil <b className="text-label">{data.fc_seuil}</b> · FC max <b className="text-label">{data.fc_max}</b> · repos {data.fc_repos ?? "—"}</>
                : <>FC max <b className="text-label">{data.fc_max}</b> · repos {data.fc_repos}</>}
              <span className="block text-label-3">Recalculées automatiquement à chaque séance</span>
            </span>
            <Chevron />
          </Link>
        </>
      )}
    </Card>
  );
}
