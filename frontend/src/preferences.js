// Préférences d'affichage, gardées sur l'appareil (localStorage) : couleur d'accent, densité,
// unités, premier jour de la semaine, palette, organisation du Résumé.
import { useSyncExternalStore } from "react";

const CLE = "preferences";

export const ACCENTS = [
  ["bleu", "Bleu", "blue"], ["orange", "Orange", "orange"], ["vert", "Vert", "green"],
  ["violet", "Violet", "purple"], ["rose", "Rose", "pink"], ["indigo", "Indigo", "indigo"],
  ["turquoise", "Turquoise", "teal"],
];

const DEFAUT = {
  accent: "bleu",
  densite: "aere",        // aere | compact
  unites: "km",           // km | mi
  premierJour: 1,         // 1 = lundi, 0 = dimanche
  palette: "standard",    // standard | daltonien
  reperes: false,         // repères sans couleur (marques sur les interrupteurs, liens soulignés)
  resume: { ordre: [], masques: [] },
  favoris: ["semaine", "28j", "acwr", "regularite"],
};

function charger() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) || "{}");
    return { ...DEFAUT, ...brut, resume: { ...DEFAUT.resume, ...(brut.resume || {}) } };
  } catch {
    return DEFAUT;
  }
}

let courant = charger();
const abonnes = new Set();

export function lirePreferences() {
  return courant;
}

// Pose les réglages sur <html> : les feuilles de style font le reste
export function appliquerPreferences() {
  const h = document.documentElement;
  h.dataset.accent = courant.accent;
  h.dataset.palette = courant.palette;
  h.classList.toggle("dense", courant.densite === "compact");
  h.classList.toggle("reperes", !!courant.reperes);
}

export function modifierPreferences(patch) {
  courant = { ...courant, ...patch };
  try { localStorage.setItem(CLE, JSON.stringify(courant)); } catch { /* stockage plein ou refusé */ }
  appliquerPreferences();
  abonnes.forEach((f) => f());
}

function abonner(f) {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

export function usePreferences() {
  return useSyncExternalStore(abonner, lirePreferences);
}

// ── Semaine ────────────────────────────────────────────────────────────────
const isoJour = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Premier jour de la semaine qui contient `d` (Date ou « AAAA-MM-JJ »), au format AAAA-MM-JJ
export function debutSemaine(d = new Date(), premierJour = courant.premierJour) {
  const j = typeof d === "string" ? new Date(`${d}T12:00`) : new Date(d);
  j.setDate(j.getDate() - ((j.getDay() - premierJour + 7) % 7));
  return isoJour(j);
}

export const aujourdhuiIso = () => isoJour(new Date());

const NOMS_JOURS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
// Noms courts des jours dans l'ordre de la semaine choisie
export function joursSemaine(premierJour = courant.premierJour) {
  return Array.from({ length: 7 }, (_, i) => NOMS_JOURS[(premierJour + i) % 7]);
}

// ── Unités ─────────────────────────────────────────────────────────────────
export const KM_PAR_MILE = 1.609344;
export const enMiles = () => courant.unites === "mi";
