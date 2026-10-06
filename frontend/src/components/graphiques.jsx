// Réglages communs des graphiques recharts, façon app Santé :
// pas de lignes d'axe, grille horizontale légère, info-bulle en verre.

export const GRIS = "#8E8E93";

export const axeX = {
  tick: { fontSize: 11, fill: GRIS },
  axisLine: false,
  tickLine: false,
  tickMargin: 8,
};

export const axeY = {
  tick: { fontSize: 11, fill: GRIS },
  axisLine: false,
  tickLine: false,
  width: 36,
  orientation: "right",
};

export const grille = { stroke: "#8E8E93", strokeOpacity: 0.2, vertical: false };

export const curseur = { fill: "rgba(142,142,147,0.12)", radius: 6 };

// Info-bulle : matériau verre, valeurs colorées selon la série
export function InfoBulle({ active, payload, label, format }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-xl px-3 py-2 text-[12px] min-w-[120px]">
      {label != null && <p className="text-label-2 mb-1">{label}</p>}
      {payload.filter((p) => p.value != null).map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-label">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill || p.stroke }} />
            {p.name}
          </span>
          <span className="font-semibold chiffres">{format ? format(p.value, p) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// Légende sobre (pastilles rondes)
export function Legende({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-label-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: i.couleur }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
