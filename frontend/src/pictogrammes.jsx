// Pictogrammes des exercices de muscu (catalogue servi par /api/pictogrammes,
// voir pictogrammes.py) : même rapprochement nom → clé que côté serveur.
import { useQuery } from "@tanstack/react-query";
import { getPictogrammes } from "./api";

const MOTS_VIDES = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "a", "au", "aux", "en", "sur", "sous", "et", "un", "une", "avec"]);
const CACHE = "pictogrammes";
// Haltère : exercice encore inconnu, ou catalogue injoignable hors ligne
const GENERIQUE = ["M6 8.5v7M18 8.5v7", "M3.5 10.5v3M20.5 10.5v3", "M6 12h12"];

export function mots(nom) {
  const t = String(nom ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\bemom\b/g, " ");
  return (t.match(/[a-z0-9]+/g) ?? []).filter((m) => !MOTS_VIDES.has(m));
}

// Tous les mots de la clé dans le nom ; la clé la plus précise l'emporte
export function tracesExercice(nom, catalogue) {
  const m = new Set(mots(nom));
  let meilleure = null;
  for (const k of Object.keys(catalogue?.pictogrammes ?? {})) {
    const km = k.split(" ");
    if (km.every((x) => m.has(x)) && (!meilleure || km.length > meilleure.split(" ").length)) meilleure = k;
  }
  return meilleure ? catalogue.pictogrammes[meilleure] : catalogue?.generique ?? GENERIQUE;
}

function enCache() {
  try { return JSON.parse(localStorage.getItem(CACHE)) ?? undefined; } catch { return undefined; }
}

// Catalogue gardé en local : la séance s'affiche aussi sans réseau
export function usePictogrammes() {
  const { data } = useQuery({
    queryKey: ["pictogrammes"],
    queryFn: async () => {
      const d = await getPictogrammes();
      try { localStorage.setItem(CACHE, JSON.stringify(d)); } catch { /* stockage indisponible */ }
      return d;
    },
    initialData: enCache,
    initialDataUpdatedAt: 0, // le cache local s'affiche, puis le serveur le met à jour
    staleTime: 60 * 60 * 1000,
  });
  return data;
}

export function Pictogramme({ traces, className, style }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {traces.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
