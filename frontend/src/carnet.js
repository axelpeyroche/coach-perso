// Constantes et formateurs partagés par les pages du carnet.

export const SPORTS = {
  course:    { label: "Course",          emoji: "🏃", couleur: "#8b5cf6", distance: true },
  trail:     { label: "Trail",           emoji: "⛰️", couleur: "#a16207", distance: true },
  velo:      { label: "Vélo",            emoji: "🚴", couleur: "#0ea5e9", distance: true },
  marche:    { label: "Marche",          emoji: "🚶", couleur: "#22c55e", distance: true },
  randonnee: { label: "Randonnée",       emoji: "🥾", couleur: "#15803d", distance: true },
  natation:  { label: "Natation",        emoji: "🏊", couleur: "#06b6d4", distance: true },
  muscu:     { label: "Renfo / Muscu",   emoji: "💪", couleur: "#f97316", distance: false },
  hiit:      { label: "HIIT / Cross",    emoji: "🔥", couleur: "#ef4444", distance: false },
  yoga:      { label: "Yoga / Mobilité", emoji: "🧘", couleur: "#ec4899", distance: false },
  autre:     { label: "Autre",           emoji: "⚡", couleur: "#9ca3af", distance: false },
};

export const sportInfo = (s) => SPORTS[s] ?? SPORTS.autre;

export const SOURCES = {
  manuel: "Saisie", strava: "Strava", apple_sante: "Apple Santé", fichier: "Fichier", programme: "Programme EPC",
};

export function fmtDuree(sec) {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h${String(m).padStart(2, "0")}`;
  const s = Math.round(sec % 60);
  return s ? `${m}min${String(s).padStart(2, "0")}` : `${m} min`;
}

export function fmtAllureSec(secKm) {
  if (!secKm) return "—";
  const m = Math.floor(secKm / 60);
  const s = Math.round(secKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

export function fmtDate(iso, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!iso) return "—";
  return new Date(iso.length === 10 ? `${iso}T12:00` : iso).toLocaleDateString("fr-FR", opts);
}

export function fmtDateHeure(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

// "1:23:45", "83:20", "45" (minutes) → secondes
export function parseDuree(txt) {
  if (txt == null || txt === "") return null;
  const t = String(txt).trim().replace(/h/i, ":").replace(/min|m/i, "").replace(/\s/g, "");
  const parts = t.split(":").filter(p => p !== "").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return t.includes(":") && String(txt).toLowerCase().includes("h")
    ? parts[0] * 3600 + parts[1] * 60
    : parts[0] * 60 + parts[1];
  return parts[0] * 60;
}

// secondes → "h:mm:ss" pour les champs de saisie
export function dureeVersTexte(sec) {
  if (sec == null) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function nombre(v, dec = 1) {
  if (v == null) return "—";
  return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: dec });
}

export const inputCls =
  "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-400";

export const btnPrimaire =
  "rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90 disabled:opacity-50 transition";

export const btnSecondaire =
  "rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-white/50 dark:hover:bg-white/5 disabled:opacity-50 transition";
