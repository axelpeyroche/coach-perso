// Calculs sur un itinéraire : points de passage pour la retouche, terrain, D+, pentes, temps estimé.
// Un tracé = liste de points [lat, lon, alt] ; un type de terrain par point (celui du pas suivant).

const RAD = Math.PI / 180;
export function distM(a, b) {
  const x = (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD), y = (b[0] - a[0]) * RAD;
  return 6371000 * Math.hypot(x, y);
}

export function cumul(points) {
  const c = [0];
  for (let i = 1; i < points.length; i++) c.push(c[i - 1] + distM(points[i - 1], points[i]));
  return c;
}

// Indice du point le plus proche de `pos` ([lat, lon])
export function plusProche(points, pos) {
  let best = 0, dMin = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = distM(points[i], pos);
    if (d < dMin) { dMin = d; best = i; }
  }
  return { i: best, d: dMin };
}

// ── Terrain ──
// Tronçons BRouter [début km, fin km, type] → un type par point (kilomètres recalés sur le tracé)
export function typesParPoint(points, terrains) {
  if (!terrains?.length) return points.map(() => null);
  const c = cumul(points);
  const k = (c.at(-1) / 1000) / (terrains.at(-1)[1] || 1);
  let j = 0;
  return points.map((_, i) => {
    const milieu = ((c[i] + (c[i + 1] ?? c[i])) / 2000) / k;
    while (j < terrains.length - 1 && terrains[j][1] < milieu) j++;
    return terrains[j][2];
  });
}

export function terrainsDepuis(points, types) {
  if (!types.some(Boolean)) return [];
  const c = cumul(points);
  const res = [];
  for (let i = 0; i < points.length - 1; i++) {
    const t = types[i] ?? "chemin", a = c[i] / 1000, b = c[i + 1] / 1000;
    if (res.length && res.at(-1)[2] === t) res.at(-1)[1] = b;
    else res.push([a, b, t]);
  }
  return res.map(([a, b, t]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000, t]);
}

export function repartitionDepuis(terrains) {
  const parts = { bitume: 0, chemin: 0, sentier: 0 };
  for (const [a, b, t] of terrains) parts[t] = (parts[t] ?? 0) + b - a;
  const total = parts.bitume + parts.chemin + parts.sentier;
  if (!total) return null;
  return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round((100 * v) / total)]));
}

// D+ avec hystérésis de 3 m : même calcul que le serveur (carnet_service.denivele_positif)
export function denivele(points) {
  const alts = points.map((p) => p[2]).filter((a) => a != null);
  if (alts.length < 2) return 0;
  let total = 0, ref = alts[0];
  for (const a of alts.slice(1)) {
    if (a > ref + 3) { total += a - ref; ref = a; }
    else if (a < ref) ref = a;
  }
  return Math.round(total);
}

export function decrire(points, types) {
  const terrains = terrainsDepuis(points, types);
  return {
    distance_km: Math.round(cumul(points).at(-1) / 10) / 100,
    dplus_m: denivele(points),
    terrains,
    repartition: repartitionDepuis(terrains),
  };
}

// ── Points de passage ──
// L'itinéraire en retouche : des points de passage `wps` ([lat, lon]) reliés par des segments
// `segs` ({ pts, ty }). Le segment k va de wps[k] à wps[k + 1] ; pour une boucle, le dernier
// segment revient au départ wps[0].

export const nbSegments = (e) => (e.boucle ? e.wps.length : e.wps.length - 1);
export const suivant = (e, k) => (k + 1) % e.wps.length;

// Points de passage de départ : tous les 2 km à pied, 6 km à vélo (3 à 10 points intermédiaires)
function etapesInitiales(points, aPied) {
  const c = cumul(points), total = c.at(-1);
  const n = Math.min(10, Math.max(3, Math.round(total / (aPied ? 2000 : 6000)) - 1));
  const res = [0];
  let i = 0;
  for (let j = 1; j <= n; j++) {
    const cible = (total * j) / (n + 1);
    while (i < c.length - 1 && c[i] < cible) i++;
    if (i > res.at(-1) && i < points.length - 1) res.push(i);
  }
  res.push(points.length - 1);
  return res;
}

function etapesValides(etapes, n) {
  return Array.isArray(etapes) && etapes.length >= 2 && etapes[0] === 0 && etapes.at(-1) === n - 1
    && etapes.every((v, i) => Number.isInteger(v) && (i === 0 || v > etapes[i - 1]));
}

const morceau = (pts, ty, a, b) => {
  const p = pts.slice(a, b + 1), t = ty.slice(a, b + 1);
  return p.length >= 2 ? { pts: p, ty: t } : { pts: [p[0], p[0]], ty: [t[0], t[0]] };
};

export function decouper(r, boucle, aPied) {
  const pts = r.points, ty = typesParPoint(pts, r.terrains);
  const etapes = etapesValides(r.etapes, pts.length) ? r.etapes : etapesInitiales(pts, aPied);
  const segs = etapes.slice(0, -1).map((a, j) => morceau(pts, ty, a, etapes[j + 1]));
  // Boucle : le dernier point de passage est le départ lui-même
  const wps = (boucle ? etapes.slice(0, -1) : etapes).map((i) => pts[i].slice(0, 2));
  return { boucle, wps, segs };
}

export function assembler(e) {
  const points = [], types = [], etapes = [];
  e.segs.forEach((s, k) => {
    etapes.push(points.length ? points.length - 1 : 0);
    const debut = k ? 1 : 0;
    points.push(...s.pts.slice(debut));
    // Type du pas sortant de chaque point ; celui du dernier point d'un segment est remplacé
    // par le premier type du segment suivant
    if (k) types.pop();
    types.push(...s.ty.slice(0, -1), s.ty.at(-1));
  });
  etapes.push(points.length - 1);
  return { points, types, etapes };
}

// Segments d'un tracé BRouter coupé à ses étapes
export function scinder(res) {
  const ty = typesParPoint(res.points, res.terrains);
  return res.etapes.slice(0, -1).map((a, j) => morceau(res.points, ty, a, res.etapes[j + 1]));
}

// Segment le plus proche d'un point touché sur la carte
export function segmentPlusProche(e, pos) {
  let best = 0, dMin = Infinity;
  e.segs.forEach((s, k) => {
    const { d } = plusProche(s.pts, pos);
    if (d < dMin) { dMin = d; best = k; }
  });
  return best;
}

// Points à envoyer au serveur pour une retouche, et application du tracé reçu
export function demandeRetouche(e, op) {
  const m = e.wps.length, n = nbSegments(e);
  if (op.type === "deplacer") {
    const prec = op.k > 0 ? op.k - 1 : (e.boucle ? n - 1 : null);
    const suiv = op.k < n ? op.k : null;
    return [prec != null && e.wps[prec], op.pos, suiv != null && e.wps[suivant(e, op.k)]].filter(Boolean);
  }
  if (op.type === "inserer") return [e.wps[op.k], op.pos, e.wps[suivant(e, op.k)]];
  if (op.type === "retirer") return [e.wps[op.k - 1], e.wps[(op.k + 1) % m]];
  return null;
}

export function appliquerRetouche(e, op, res) {
  const parts = scinder(res);
  const wps = [...e.wps], segs = [...e.segs], n = nbSegments(e);
  const cale = (j) => res.points[res.etapes[j]].slice(0, 2);
  if (op.type === "deplacer") {
    const prec = op.k > 0 ? op.k - 1 : (e.boucle ? n - 1 : null);
    const suiv = op.k < n ? op.k : null;
    if (prec != null) segs[prec] = parts[0];
    if (suiv != null) segs[suiv] = parts.at(-1);
    wps[op.k] = cale(prec != null ? 1 : 0);
  } else if (op.type === "inserer") {
    segs.splice(op.k, 1, parts[0], parts[1]);
    wps.splice(op.k + 1, 0, cale(1));
  } else if (op.type === "retirer") {
    segs.splice(op.k - 1, 2, parts[0]);
    wps.splice(op.k, 1);
  }
  return { ...e, wps, segs };
}

// Ajout d'un point de passage sur le tracé lui-même : coupe locale, sans recalcul
export function couper(e, k, pos) {
  const s = e.segs[k];
  const { i } = plusProche(s.pts, pos);
  if (i <= 0 || i >= s.pts.length - 1) return null;
  const segs = [...e.segs], wps = [...e.wps];
  segs.splice(k, 1, morceau(s.pts, s.ty, 0, i), morceau(s.pts, s.ty, i, s.pts.length - 1));
  wps.splice(k + 1, 0, s.pts[i].slice(0, 2));
  return { ...e, wps, segs };
}

export const retirable = (e, k) => (e.boucle ? k > 0 && e.wps.length > 2 : k > 0 && k < e.wps.length - 1);

// Lignes droites provisoires (pendant un glissé ou un calcul) et segments estompés
export function apercu(e, op) {
  if (!op) return { lignes: [], masques: [], wps: e.wps };
  const m = e.wps.length, n = nbSegments(e);
  if (op.type === "deplacer") {
    const prec = op.k > 0 ? op.k - 1 : (e.boucle ? n - 1 : null);
    const suiv = op.k < n ? op.k : null;
    const lignes = [];
    if (prec != null) lignes.push([e.wps[prec], op.pos]);
    if (suiv != null) lignes.push([op.pos, e.wps[suivant(e, op.k)]]);
    return { lignes, masques: [prec, suiv].filter((v) => v != null), wps: e.wps.map((w, j) => (j === op.k ? op.pos : w)) };
  }
  if (op.type === "inserer") {
    const wps = [...e.wps];
    wps.splice(op.k + 1, 0, op.pos);
    return { lignes: [[e.wps[op.k], op.pos], [op.pos, e.wps[suivant(e, op.k)]]], masques: [op.k], wps };
  }
  if (op.type === "retirer") {
    return { lignes: [[e.wps[op.k - 1], e.wps[(op.k + 1) % m]]], masques: [op.k - 1, op.k], wps: e.wps.filter((_, j) => j !== op.k) };
  }
  return { lignes: [], masques: [], wps: e.wps };
}

// ── Pentes ──
export const PENTES = [
  [5, "< 5 %", "#34C759"], [10, "5–10 %", "#FFCC00"], [20, "10–20 %", "#FF9500"], [Infinity, "> 20 %", "#FF3B30"],
];
export const classePente = (p) => PENTES.findIndex(([max]) => Math.abs(p) < max);

// Pente (en %) autour de chaque point du profil [[km, alt], …], lissée sur ±50 m
export function pentes(prof) {
  const res = [];
  let a = 0, b = 0;
  for (let i = 0; i < prof.length; i++) {
    const d = prof[i][0];
    while (prof[a][0] < d - 0.05) a++;
    while (b < prof.length - 1 && prof[b + 1][0] <= d + 0.05) b++;
    const dx = (prof[b][0] - prof[a][0]) * 1000;
    res.push(dx > 5 ? (100 * (prof[b][1] - prof[a][1])) / dx : 0);
  }
  return res;
}

// ── Temps estimé ──
// Distance-effort (1 km + 100 m de D+, ×1,5 à vélo) × allure habituelle du sport
export function tempsEstime(r, allure) {
  if (!allure || !r) return null;
  return (r.distance_km + (r.dplus_m / 100) * allure.effort_dplus) * allure.s_par_km_effort;
}

export function duree(s) {
  if (s == null) return null;
  const min = Math.max(1, Math.round(s / 300) * 5); // arrondi à 5 min : c'est une estimation
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}
