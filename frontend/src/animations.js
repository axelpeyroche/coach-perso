// Animations 3D des exercices de muscu (catalogue servi par /api/animations, voir
// animations.py) : même rapprochement nom → clé que les pictogrammes.
import { useQuery } from "@tanstack/react-query";
import { getAnimations } from "./api";
import { mots } from "./pictogrammes";

const CACHE = "animations";

// Tous les mots de la clé dans le nom ; la clé la plus précise l'emporte
export function animationExercice(nom, catalogue) {
  const m = new Set(mots(nom));
  let meilleure = null;
  for (const k of Object.keys(catalogue ?? {})) {
    const km = k.split(" ");
    if (km.every((x) => m.has(x)) && (!meilleure || km.length > meilleure.split(" ").length)) meilleure = k;
  }
  return meilleure ? catalogue[meilleure] : null;
}

function enCache() {
  try { return JSON.parse(localStorage.getItem(CACHE)) ?? undefined; } catch { return undefined; }
}

// Catalogue gardé en local : le mouvement se montre aussi sans réseau
export function useAnimations() {
  const { data } = useQuery({
    queryKey: ["animations"],
    queryFn: async () => {
      const d = await getAnimations();
      try { localStorage.setItem(CACHE, JSON.stringify(d)); } catch { /* stockage indisponible */ }
      return d;
    },
    initialData: enCache,
    initialDataUpdatedAt: 0,
    staleTime: 60 * 60 * 1000,
  });
  return data;
}
