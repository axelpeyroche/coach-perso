export const RPE_LABELS = [
  "", "Très facile", "Facile", "Modéré", "Confortable",
  "Un peu difficile", "Difficile", "Très difficile", "Très dur",
  "Extrême", "Maximum absolu",
];

export const RPE_COLORS = [
  "", "text-ios-teal", "text-ios-blue", "text-ios-mint", "text-ios-green",
  "text-ios-yellow", "text-ios-yellow", "text-ios-orange", "text-ios-orange",
  "text-ios-red", "text-ios-red",
];

export function getRpeLabel(rpe) {
  return RPE_LABELS[Math.round(rpe)] ?? "";
}

export function getRpeColorClass(rpe) {
  return RPE_COLORS[Math.round(rpe)] ?? "";
}
