// Réglages communs des graphiques recharts, façon app Santé :
// pas de lignes d'axe, grille horizontale légère, info-bulle en verre.

import { Brush } from "recharts";

export const GRIS = "rgb(var(--gray))";

// Une couleur par notion, la même sur toutes les pages. Ce sont des variables : elles suivent
// le thème sombre et la palette adaptée au daltonisme.
const v = (nom) => `rgb(var(--${nom}))`;
export const NOTION = {
  fc: v("pink"), vfc: v("purple"), allure: v("blue"), charge: v("orange"), sommeil: v("indigo"),
  denivele: v("green"), poids: v("indigo"), vo2max: v("green"), alerte: v("red"),
};
export const ZONES_COULEURS = [GRIS, v("blue"), v("green"), v("orange"), v("red")];

// Zoom : réglette sous le graphique pour resserrer la plage affichée (à partir de 30 points).
// S'utilise dans un graphique recharts : {zoom(data)}
export function zoom(data, cle = "label") {
  if (!data || data.length < 30) return null;
  return <Brush dataKey={cle} height={18} travellerWidth={14} stroke={GRIS} fill="transparent" tickFormatter={() => ""} />;
}

// Plage habituelle d'une série (moyenne ± 1 écart-type) : [bas, haut], ou null s'il y a moins de 10 valeurs
export function plageHabituelle(valeurs) {
  const x = (valeurs ?? []).filter((n) => n != null && Number.isFinite(n));
  if (x.length < 10) return null;
  const m = x.reduce((t, n) => t + n, 0) / x.length;
  const e = Math.sqrt(x.reduce((t, n) => t + (n - m) ** 2, 0) / x.length);
  return e > 0 ? [m - e, m + e] : null;
}

// Enveloppe d'un graphique pour les lecteurs d'écran : le dessin est annoncé comme une image
// avec son titre et, si on le donne, un résumé en une phrase de ce qu'il montre.
export function Graphique({ label, resume, children, className }) {
  return (
    <div role="img" aria-label={resume ? `${label}. ${resume}` : label} className={className}>
      {children}
    </div>
  );
}

// Courbe miniature (tuiles) : la forme de la série, sans axes. `valeurs` : nombres, null ignorés.
export function Miniature({ valeurs, className = "w-full h-6" }) {
  const v = (valeurs ?? []).filter((x) => x != null);
  if (v.length < 3) return null;
  const min = Math.min(...v), max = Math.max(...v), e = max - min || 1;
  const pts = v.map((x, i) => [(i / (v.length - 1)) * 100, 22 - ((x - min) / e) * 20]);
  const [dx, dy] = pts[pts.length - 1];
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden className={className}>
      <polyline points={pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")} fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity="0.85" />
      <path d={`M${dx.toFixed(1)} ${dy.toFixed(1)}h0`} stroke="currentColor" strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

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

export const grille = { stroke: "rgb(var(--gray))", strokeOpacity: 0.2, vertical: false };

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
