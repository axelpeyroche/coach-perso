export const RPE_LABELS = [
  "", "Très facile", "Facile", "Modéré", "Confortable",
  "Un peu difficile", "Difficile", "Très difficile", "Très dur",
  "Extrême", "Maximum absolu",
];

export const RPE_COLORS = [
  "", "text-blue-400", "text-blue-500", "text-green-400", "text-green-500",
  "text-yellow-400", "text-yellow-500", "text-orange-400", "text-orange-500",
  "text-red-400", "text-red-500",
];

export function getRpeLabel(rpe) {
  return RPE_LABELS[Math.round(rpe)] ?? "";
}

export function getRpeColorClass(rpe) {
  return RPE_COLORS[Math.round(rpe)] ?? "";
}
