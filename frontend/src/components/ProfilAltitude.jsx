import { useEffect, useMemo, useRef, useState } from "react";
import { nombre } from "../carnet";
import * as T from "../pages/itineraireTrace";

// Profil d'altitude partagé par les Itinéraires et les activités du carnet :
// remplissage coloré selon la pente, motif du terrain sur la courbe.

export function profil(points) {
  // Altitude manquante (début de sortie sans GPS barométrique…) : la plus proche connue
  let alt = points.find((p) => p[2] != null)?.[2] ?? 0, d = 0;
  return points.map((p, i) => {
    if (i) d += T.distM(points[i - 1], p);
    if (p[2] != null) alt = p[2];
    return [d / 1000, alt];
  });
}
const km = (v) => nombre(v, v < 10 ? 2 : 1);
// Graduations « rondes » (1-2-5 × 10ⁿ), comme les courbes de la fiche d'une séance
function pasJoli(etendue, cible) {
  const brut = etendue / cible || 1, p = 10 ** Math.floor(Math.log10(brut)), n = brut / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
const graduations = (min, max, pas) => {
  const g = [];
  for (let v = Math.ceil(min / pas - 1e-9) * pas; v <= max + 1e-9; v += pas) g.push(+v.toFixed(6));
  return g;
};
const AXE_Y = 40, AXE_X = 22, GRIS = "#8E8E93";

// ── Profil d'altitude ──────────────────────────────────────────────────────
// Terrain le long du tracé : route = deux traits pleins, chemin = trait plein sous des pointillés,
// sentier = pointillés seuls (la couleur double le motif)
const TERRAINS = { bitume: ["Route", "#8E8E93"], chemin: ["Chemin", "#A2845E"], sentier: ["Sentier", "#30A46C"] };

// Trait d'un tronçon : décalé de part et d'autre du tracé pour la route et le chemin
function Trait({ type, d }) {
  const c = TERRAINS[type]?.[1] ?? "#8E8E93";
  const p = { d, fill: "none", stroke: c, strokeLinejoin: "round" };
  if (type === "bitume") {
    return <><path {...p} strokeWidth={1.5} transform="translate(0,-1.9)" /><path {...p} strokeWidth={1.5} transform="translate(0,1.9)" /></>;
  }
  if (type === "chemin") {
    return <><path {...p} strokeWidth={1.5} strokeDasharray="4 3" transform="translate(0,-1.9)" /><path {...p} strokeWidth={1.6} transform="translate(0,1.9)" /></>;
  }
  return <path {...p} strokeWidth={3} strokeDasharray="0.1 4.5" strokeLinecap="round" />;
}

function LegendeTerrain({ terrains }) {
  const presents = Object.keys(TERRAINS).filter((t) => terrains.some((x) => x[2] === t));
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-label-2">
      {presents.map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <svg width={20} height={10} aria-hidden><Trait type={t} d="M1,5 L19,5" /></svg>
          {TERRAINS[t][0]}
        </span>
      ))}
    </p>
  );
}

function LegendePente() {
  return (
    <p className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-label-2 chiffres">
      {T.PENTES.map(([, l, c]) => (
        <span key={l} className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: c }} aria-hidden />{l}
        </span>
      ))}
    </p>
  );
}

// `axes` : graduations d'altitude à droite et de distance en bas (même allure que les courbes de la fiche) ;
// `entete(lecture)` dessine alors le titre, avec la lecture sous le doigt ({ km, alt, pente, terrain }) ou null.
export default function Profil({ points, couleur, hauteur = 26, detail = false, terrains, curseur = null, onCurseur, axes = false, entete }) {
  const prof = useMemo(() => profil(points), [points]);
  // Largeur réelle en pixels : les pointillés et traits doubles gardent leurs proportions
  const boite = useRef(null);
  const [L, setL] = useState(300);
  useEffect(() => {
    const el = boite.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setL(Math.max(60, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const total = prof.at(-1)?.[0] || 1;
  const alts = prof.map((p) => p[1]);
  const min = Math.min(...alts), max = Math.max(...alts), ecart = Math.max(max - min, 20);
  const H = hauteur, marge = detail ? 4 : 2;
  const W = axes ? Math.max(20, L - AXE_Y) : L; // largeur de la courbe
  // Avec les axes : domaine arrondi aux graduations, courbe posée sur la graduation basse
  const pasY = pasJoli(ecart, 3);
  const dom = [Math.floor(min / pasY) * pasY, Math.max(Math.ceil(max / pasY) * pasY, Math.floor(min / pasY) * pasY + pasY)];
  const yDe = axes
    ? (a) => H - ((a - dom[0]) / (dom[1] - dom[0])) * (H - 6)
    : (a) => H - marge - ((a - min) / ecart) * (H - 2 * marge);
  const ticksY = axes ? graduations(dom[0], dom[1], pasY) : [];
  const ticksX = axes ? graduations(0, total, pasJoli(total, L < 500 ? 4 : 7)).filter((v) => v > 0 && v < total * 0.98) : [];
  const pas = Math.max(1, Math.floor(prof.length / 400));
  // [km, x, y, indice du point]
  const pts = [];
  prof.forEach(([d, a], i) => { if (i % pas === 0 || i === prof.length - 1) pts.push([d, (d / total) * W, yDe(a), i]); });
  const chemin = (liste) => liste.map(([, x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  const ligne = chemin(pts);
  // Kilomètres BRouter recalés sur la distance du profil
  const k = terrains?.length ? total / (terrains.at(-1)[1] || total) : 1;
  const pente = useMemo(() => (detail ? T.pentes(prof) : null), [detail, prof]);

  // Découpe de la courbe par terrain (le trait)
  const troncons = useMemo(() => {
    if (!detail || !terrains?.length) return [];
    const res = [];
    let i = 0;
    for (const [a, b, t] of terrains) {
      const fin = b * k;
      const morceau = i > 0 ? [pts[i - 1]] : [];
      while (i < pts.length && pts[i][0] <= fin) morceau.push(pts[i++]);
      if (i < pts.length) morceau.push(pts[i]);
      if (morceau.length >= 2) res.push({ a, b, t, d: `M${chemin(morceau)}` });
    }
    return res;
  }, [detail, terrains, L, H, points, axes]);

  // Découpe par classe de pente (le remplissage sous la courbe)
  const zones = useMemo(() => {
    if (!detail) return [];
    const res = [];
    for (let j = 0; j < pts.length - 1; j++) {
      const c = T.classePente(pente[pts[j][3]]);
      if (res.length && res.at(-1).c === c) res.at(-1).pts.push(pts[j + 1]);
      else res.push({ c, pts: [pts[j], pts[j + 1]] });
    }
    return res;
  }, [detail, pente, L, H, points, axes]);

  // Curseur : le doigt (ou la souris) sur le profil donne le point le plus proche
  const indice = (clientX) => {
    const r = boite.current.getBoundingClientRect();
    const d = Math.min(1, Math.max(0, (clientX - r.left) / (r.width * W / L))) * total;
    let lo = 0, hi = prof.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (prof[mid][0] < d) lo = mid + 1; else hi = mid; }
    if (lo > 0 && d - prof[lo - 1][0] < prof[lo][0] - d) lo--;
    return lo;
  };
  const c = curseur != null && curseur < prof.length ? curseur : null;
  const cx = c != null ? (prof[c][0] / total) * W : 0;
  const terrainC = c != null ? terrains?.find(([, b]) => prof[c][0] <= b * k + 1e-6)?.[2] : null;
  const penteC = c != null && pente ? Math.round(pente[c]) : null;
  const gestes = onCurseur ? {
    onPointerDown: (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); onCurseur(indice(e.clientX)); },
    onPointerMove: (e) => onCurseur(indice(e.clientX)),
    onPointerLeave: (e) => { if (e.pointerType === "mouse") onCurseur(null); },
    style: { touchAction: "pan-y" },
  } : {};

  const lecture = c != null ? { km: prof[c][0], alt: prof[c][1], pente: penteC, terrain: terrainC && (TERRAINS[terrainC]?.[0] ?? terrainC) } : null;
  const Hs = H + (axes ? AXE_X : 0);

  return (
    <div ref={boite}>
      {entete?.(lecture)}
      <div {...gestes} className={onCurseur ? "cursor-crosshair select-none" : undefined}>
        <svg viewBox={`0 0 ${L} ${Hs}`} className="w-full block overflow-visible" style={{ height: Hs }}
          role={detail ? "img" : undefined} aria-hidden={detail ? undefined : true}
          aria-label={detail ? "Profil d'altitude le long du parcours : pentes en couleur, terrain sur la courbe" : undefined}>
          {axes && (
            <g fontSize={11} fill={GRIS} className="chiffres">
              {ticksY.map((v) => (
                <g key={v}>
                  <line x1={0} x2={W} y1={yDe(v)} y2={yDe(v)} stroke={GRIS} strokeOpacity={0.2} />
                  <text x={L} y={yDe(v)} dy="0.35em" textAnchor="end">{nombre(v, 0)}</text>
                </g>
              ))}
              {ticksX.map((v) => (
                <text key={v} x={(v / total) * W} y={H + 16} textAnchor="middle">{`${nombre(v, Number.isInteger(v) ? 0 : 1)} km`}</text>
              ))}
            </g>
          )}
          {/* Remplissage : couleur de la pente ; trait : motif du terrain */}
          {zones.length ? zones.map((z, j) => (
            <path key={j} d={`M${z.pts[0][1].toFixed(1)},${H} L${chemin(z.pts)} L${z.pts.at(-1)[1].toFixed(1)},${H} Z`}
              fill={T.PENTES[z.c][2]} fillOpacity={0.28} />
          )) : <path d={`M0,${H} L${ligne} L${W},${H} Z`} fill={couleur} fillOpacity={0.15} />}
          {troncons.length ? troncons.map(({ a, b, t, d }, j) => (
                <g key={j}>
                  <title>{`${TERRAINS[t]?.[0] ?? t} · ${km(a)} → ${km(b)} km`}</title>
                  <Trait type={t} d={d} />
                </g>
              )) : <path d={`M${ligne}`} fill="none" stroke={detail ? "currentColor" : couleur} strokeWidth={1.6} className={detail ? "text-label-2" : undefined} />}
          {c != null && (
            <g className="text-label" pointerEvents="none">
              <line x1={cx} x2={cx} y1={0} y2={H} stroke="currentColor" strokeOpacity={0.45} strokeWidth={1} />
              <circle cx={cx} cy={yDe(prof[c][1])} r={4.5} fill={couleur} stroke="#fff" strokeWidth={2} />
            </g>
          )}
        </svg>
      </div>
      {detail && !axes && (
        <p className="flex justify-between gap-2 text-[11px] text-label-2 chiffres mt-0.5 min-h-[16px]">
          {c != null ? (
            <span className="text-label font-semibold">
              {km(prof[c][0])} km · {Math.round(prof[c][1])} m
              {penteC != null && ` · ${penteC > 0 ? "+" : penteC < 0 ? "−" : ""}${Math.abs(penteC)} %`}
              {terrainC && ` · ${TERRAINS[terrainC]?.[0] ?? terrainC}`}
            </span>
          ) : (
            <><span>{Math.round(min)} m</span><span>alt. max {Math.round(max)} m</span><span>{km(total)} km</span></>
          )}
        </p>
      )}
      {detail && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5">
          {troncons.length > 0 && <LegendeTerrain terrains={terrains} />}
          <LegendePente />
        </div>
      )}
    </div>
  );
}
