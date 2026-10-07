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
    for (let i = 0; i < t.lat.length; i++) {
      const cx = Math.floor(t.lon[i] * kx), cy = Math.floor(t.lat[i] * ky), c = cle(cx, cy);
      const s = somme.get(c);
      if (s) { s[0] += t.lat[i]; s[1] += t.lon[i]; s[2]++; } else somme.set(c, [t.lat[i], t.lon[i], 1]);
      if (cx === px && cy === py) continue;
      if (px !== null && Math.max(Math.abs(cx - px), Math.abs(cy - py)) > 3) { segments.push(seg); seg = []; }
      seg.push(c); px = cx; py = cy;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) voisinage.add(c + dx * L + dy);
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
