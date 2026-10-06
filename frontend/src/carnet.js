// Constantes et formateurs partagés par les pages du carnet.

export const SPORTS = {
  course:    { label: "Course",          emoji: "🏃", couleur: "#FF9500", distance: true },
  trail:     { label: "Trail",           emoji: "⛰️", couleur: "#A2845E", distance: true },
  velo:      { label: "Vélo",            emoji: "🚴", couleur: "#32ADE6", distance: true },
  marche:    { label: "Marche",          emoji: "🚶", couleur: "#34C759", distance: true },
  randonnee: { label: "Randonnée",       emoji: "🥾", couleur: "#00C7BE", distance: true },
  natation:  { label: "Natation",        emoji: "🏊", couleur: "#007AFF", distance: true },
  muscu:     { label: "Renfo / Muscu",   emoji: "💪", couleur: "#AF52DE", distance: false },
  hiit:      { label: "HIIT / Cross",    emoji: "🔥", couleur: "#FF3B30", distance: false },
  yoga:      { label: "Yoga / Mobilité", emoji: "🧘", couleur: "#FF2D55", distance: false },
  autre:     { label: "Autre",           emoji: "⚡", couleur: "#8E8E93", distance: false },
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

// Classes de style partagées (composants définis dans index.css)
export const inputCls = "champ";
export const btnPrimaire = "btn-primaire";
export const btnSecondaire = "btn-gris";
