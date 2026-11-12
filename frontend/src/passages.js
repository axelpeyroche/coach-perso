// Carte des passages : superpose des tracés et compte combien de sorties passent au même endroit.
// Calculé dans le navigateur (bien plus rapide que le serveur gratuit) à partir des tracés allégés de l'API.

export const PALIERS_PASSAGES = [1, 2, 3, 5, 10, 20, 50]; // bornes basses des couleurs

// [lat0, lon0, dlat1, dlon1, …] au 1e-5 degré → { lat: Float64Array, lon: Float64Array }
export function decoderTraces(traces) {
  return traces.map((t) => {
    const n = t.length / 2, lat = new Float64Array(n), lon = new Float64Array(n);
    let la = 0, lo = 0;
    for (let i = 0; i < n; i++) {
      la += t[2 * i]; lo += t[2 * i + 1];
      lat[i] = la / 1e5; lon[i] = lo / 1e5;
    }
    return { lat, lon };
  });
}

const distM = (lat1, lon1, lat2, lon2) => {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180), y = lat2 - lat1;
  return 111_195 * Math.hypot(x, y);
};
const mediane = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
const palier = (n) => PALIERS_PASSAGES.reduce((p, b) => (b <= n ? b : p), 1);

/**
 * Le terrain est découpé en cases de `cellule` mètres ; une case compte les sorties distinctes passées
 * dans un rayon d'une case (tolérance au bruit GPS). Chaque portion de chemin est tracée une seule fois,
 * au centre moyen des points GPS de ses cases, avec le palier de passages le plus bas de ses extrémités.
 * Retourne { features (une MultiLineString par palier), vue, max }.
 */
export function calculerPassages(traces, cellule = 15) {
  traces = traces.filter((t) => t.lat.length >= 2);
  if (!traces.length) return { features: [], vue: null, max: 0 };
  const lat0 = mediane(traces.map((t) => t.lat[0])), lon0 = mediane(traces.map((t) => t.lon[0]));
  const kx = (111_320 * Math.cos(lat0 * Math.PI / 180)) / cellule, ky = 110_574 / cellule;
  const L = 4_000_000; // clé numérique d'une case : (cx + L/2) * L + (cy + L/2)
  const cle = (cx, cy) => (cx + L / 2) * L + (cy + L / 2);

  const somme = new Map(); // case → [Σlat, Σlon, n]
  const compte = new Map();
  const segments = [];
  for (const t of traces) {
    const voisinage = new Set();
    let seg = [], px = null, py = null;
    const ajouter = (la, lo) => {
      const cx = Math.floor(lo * kx), cy = Math.floor(la * ky), c = cle(cx, cy);
      const s = somme.get(c);
      if (s) { s[0] += la; s[1] += lo; s[2]++; } else somme.set(c, [la, lo, 1]);
      if (cx === px && cy === py) return;
      seg.push(c); px = cx; py = cy;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) voisinage.add(c + dx * L + dy);
    };
    for (let i = 0; i < t.lat.length; i++) {
      if (i) {
        // Perte du signal GPS (sous les arbres…) : le trou est comblé en ligne droite, case par case ;
        // au-delà de 2 km (trajet en voiture, montre en pause), le tracé est coupé
        const saut = Math.max(Math.abs(t.lon[i] * kx - t.lon[i - 1] * kx), Math.abs(t.lat[i] * ky - t.lat[i - 1] * ky));
        if (saut > 2000 / cellule) { segments.push(seg); seg = []; px = py = null; }
        else for (let k = 1; k < saut; k++) {
          const f = k / Math.ceil(saut);
          ajouter(t.lat[i - 1] + (t.lat[i] - t.lat[i - 1]) * f, t.lon[i - 1] + (t.lon[i] - t.lon[i - 1]) * f);
        }
      }
      ajouter(t.lat[i], t.lon[i]);
    }
    segments.push(seg);
    for (const c of voisinage) compte.set(c, (compte.get(c) ?? 0) + 1);
  }

  const chaines = new Map(); // palier → [[case, …], …]
  const vus = new Set();
  for (const seg of segments) {
    let chaine = null, niv = 0;
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1], b = seg[i];
      const e = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (vus.has(e)) { chaine = null; continue; }
      vus.add(e);
      const n = palier(Math.min(compte.get(a), compte.get(b)));
      if (chaine && n === niv && chaine.at(-1) === a) chaine.push(b);
      else {
        chaine = [a, b]; niv = n;
        if (!chaines.has(n)) chaines.set(n, []);
        chaines.get(n).push(chaine);
      }
    }
  }
  const centre = (c) => { const s = somme.get(c); return [s[1] / s[2], s[0] / s[2]]; };
  const features = [...chaines.keys()].sort((a, b) => a - b).map((n) => ({
    type: "Feature", properties: { n },
    geometry: { type: "MultiLineString", coordinates: chaines.get(n).map((ch) => ch.map(centre)) },
  }));

  // Vue initiale : les sorties qui partent à moins de 25 km du départ médian (pas les voyages)
  let proches = traces.filter((t) => distM(lat0, lon0, t.lat[0], t.lon[0]) < 25_000);
  if (!proches.length) proches = traces;
  let o = 180, s = 90, e = -180, n = -90;
  for (const t of proches) for (let i = 0; i < t.lat.length; i++) {
    o = Math.min(o, t.lon[i]); e = Math.max(e, t.lon[i]); s = Math.min(s, t.lat[i]); n = Math.max(n, t.lat[i]);
  }
  let max = 0;
  for (const c of somme.keys()) max = Math.max(max, compte.get(c));
  return { features, vue: [[o, s], [e, n]], max };
}

// ——— Clic sur un tracé : quelles sorties passent par ce tronçon ? ———

// Cadre de chaque tracé, pour écarter d'un coup ceux qui sont loin du clic
export function cadresTraces(traces) {
  return traces.map((t) => {
    let o = 180, s = 90, e = -180, n = -90;
    for (let i = 0; i < t.lat.length; i++) {
      o = Math.min(o, t.lon[i]); e = Math.max(e, t.lon[i]); s = Math.min(s, t.lat[i]); n = Math.max(n, t.lat[i]);
    }
    return [o, s, e, n];
  });
}

// Parcourt les portions de `t` proches de `p` (en mètres, repère local centré sur p) :
// rappel(distance, projeté [x, y], direction [dx, dy] normée, à côté (p se projette dans la portion, pas au-delà))
function portionsProches(t, cadre, p, rayon, rappel) {
  const kx = 111_320 * Math.cos(p[1] * Math.PI / 180), ky = 110_574;
  const mx = rayon / kx, my = rayon / ky;
  if (p[0] < cadre[0] - mx || p[0] > cadre[2] + mx || p[1] < cadre[1] - my || p[1] > cadre[3] + my) return;
  for (let i = 1; i < t.lat.length; i++) {
    const ax = (t.lon[i - 1] - p[0]) * kx, ay = (t.lat[i - 1] - p[1]) * ky;
    const bx = (t.lon[i] - p[0]) * kx, by = (t.lat[i] - p[1]) * ky;
    if ((ax > rayon && bx > rayon) || (ax < -rayon && bx < -rayon) || (ay > rayon && by > rayon) || (ay < -rayon && by < -rayon)) continue;
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
    if (!l2 || l2 > 2000 * 2000) continue;   // point répété, ou tracé coupé (voir calculerPassages)
    const brut = -(ax * vx + ay * vy) / l2, f = Math.max(0, Math.min(1, brut));
    const x = ax + vx * f, y = ay + vy * f, d = Math.hypot(x, y);
    if (d <= rayon) { const l = Math.sqrt(l2); rappel(d, [x, y], [vx / l, vy / l], brut >= -0.05 && brut <= 1.05); }
  }
}

/**
 * Tronçon le plus proche du clic `p` = [lon, lat], parmi les tracés `idx`, à moins de `tolerance` mètres.
 * Retourne { q: [lon, lat] (point sur le tracé), d: [dx, dy] (sens du tronçon) } ou null.
 */
export function tronconClique(traces, cadres, idx, p, tolerance) {
  let mieux = null;
  for (const i of idx) {
    portionsProches(traces[i], cadres[i], p, tolerance, (d, xy, dir) => {
      if (!mieux || d < mieux.dist) mieux = { dist: d, xy, dir };
    });
  }
  if (!mieux) return null;
  const kx = 111_320 * Math.cos(p[1] * Math.PI / 180), ky = 110_574;
  return { q: [p[0] + mieux.xy[0] / kx, p[1] + mieux.xy[1] / ky], d: mieux.dir };
}

// Tracés passés par ce tronçon : à moins de `rayon` mètres de q, dans le même axe
// (à un carrefour, seule la branche cliquée compte : |cos| ≥ 0,7, soit ±45°)
export function tracesPassantPar(traces, cadres, idx, troncon, rayon = 25) {
  const { q, d } = troncon;
  return idx.filter((i) => {
    let ok = false;
    // « À côté » : un tracé qui s'arrête ou tourne juste avant le point ne compte pas
    portionsProches(traces[i], cadres[i], q, rayon, (_, __, dir, aCote) => {
      if (aCote && Math.abs(dir[0] * d[0] + dir[1] * d[1]) >= 0.7) ok = true;
    });
    return ok;
  });
}

// Petit trait centré sur le tronçon cliqué (±`demi` mètres), pour le montrer sur la carte
export function traitTroncon({ q, d }, demi = 30) {
  const kx = 111_320 * Math.cos(q[1] * Math.PI / 180), ky = 110_574;
  return [[q[0] - d[0] * demi / kx, q[1] - d[1] * demi / ky], [q[0] + d[0] * demi / kx, q[1] + d[1] * demi / ky]];
}
