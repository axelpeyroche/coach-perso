import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { getActivites, getComparables, getFlux } from "../api";
import { fmtDate, fmtDuree, nombre, sportInfo, fmtDistance } from "../carnet";
import Feuille from "./Feuille";
import Aide from "./Aide";
import { mmss } from "./FicheExtras";
import { axeX, axeY, grille } from "./graphiques";
import { Segmente } from "./ui";

const PIED = new Set(["course", "trail", "marche", "randonnee"]);
// Cette séance en bleu, l'autre en orange : lisibles en clair comme en sombre
const COULEUR_A = "#0A84FF", COULEUR_B = "#FF9F0A";
const POINTS = 240;

const chrono = (s) => {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

// Moyenne glissante qui laisse les trous en place
function lisser(v, k = 2) {
  return v.map((x, i) => {
    if (x == null) return null;
    let s = 0, n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(v.length - 1, i + k); j++) if (v[j] != null) { s += v[j]; n++; }
    return s / n;
  });
}

// Valeurs d'une série replacées sur une grille commune (interpolation linéaire, vide au-delà de la fin)
function surGrille(xs, ys, grilleX) {
  const pts = [];
  for (let i = 0; i < xs.length; i++) if (xs[i] != null && ys[i] != null && (!pts.length || xs[i] > pts.at(-1)[0])) pts.push([xs[i], ys[i]]);
  if (pts.length < 2) return null;
  let j = 0;
  return grilleX.map((x) => {
    if (x < pts[0][0] || x > pts.at(-1)[0]) return null;
    while (j < pts.length - 2 && pts[j + 1][0] < x) j++;
    const [x0, y0] = pts[j], [x1, y1] = pts[j + 1];
    return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  });
}

const GRANDEURS = [
  { cle: "allure", source: "vitesse", nom: "Allure", unite: "/km", pied: true, fmt: mmss, inverse: true },
  { cle: "vitesse", source: "vitesse", nom: "Vitesse", unite: "km/h", pied: false, fmt: (v) => nombre(v, 1) },
  { cle: "fc", source: "fc", nom: "Fréquence cardiaque", unite: "bpm", fmt: (v) => nombre(v, 0) },
  { cle: "altitude", source: "altitude", nom: "Altitude", unite: "m", fmt: (v) => nombre(v, 0) },
  { cle: "cadence", source: "cadence", nom: "Cadence", unite: "", fmt: (v) => nombre(v, 0) },
];

function serie(flux, g) {
  const s = flux?.series?.find((x) => x.cle === g.source && !x.superpose);
  if (!s) return null;
  if (g.cle === "allure") return lisser(s.data, 3).map((v) => (v != null && v >= 3 ? 3600 / v : null));
  return g.cle === "vitesse" ? lisser(s.data, 3) : s.data;
}

// Les deux séances sur une même grille (distance ou temps) : une ligne par point, colonnes a_… et b_…
function superposer(fa, fb, pied, axe) {
  if (!fa?.temps || !fb?.temps) return null;
  const xa = axe === "d" ? fa.distance : fa.temps, xb = axe === "d" ? fb.distance : fb.temps;
  if (!xa || !xb) return null;
  const fin = Math.max(xa.findLast((v) => v != null) ?? 0, xb.findLast((v) => v != null) ?? 0);
  if (!fin) return null;
  const gx = Array.from({ length: POINTS + 1 }, (_, i) => (fin * i) / POINTS);
  const lignes = gx.map((x) => ({ x }));
  const grandeurs = [];
  for (const g of GRANDEURS) {
    if (g.pied != null && g.pied !== pied) continue;
    const a = surGrille(xa, serie(fa, g) ?? [], gx), b = surGrille(xb, serie(fb, g) ?? [], gx);
    if (!a || !b) continue;
    a.forEach((v, i) => { lignes[i][`a_${g.cle}`] = v; lignes[i][`b_${g.cle}`] = b[i]; });
    const tri = [...a, ...b].filter((v) => v != null).sort((p, q) => p - q);
    const q = (p) => tri[Math.round(p * (tri.length - 1))];
    // En allure (axe inversé), le bas du graphe laisse de côté les arrêts ; le haut va jusqu'au plus rapide
    let bas = q(g.inverse ? 0 : 0.02), haut = q(g.inverse ? 0.96 : 1);
    const marge = (haut - bas) * 0.06 || 1;
    bas = Math.max(0, bas - marge); haut += marge;
    const brut = (haut - bas) / 3;
    const p10 = 10 ** Math.floor(Math.log10(brut)), n = brut / p10;
    const pas = g.inverse ? [5, 10, 15, 20, 30, 60, 120, 300].find((c) => c >= brut) ?? 300 : (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p10;
    const domaine = [Math.floor(bas / pas) * pas, Math.ceil(haut / pas) * pas];
    const ticksY = [];
    for (let v = domaine[0]; v <= domaine[1] + 1e-9; v += pas) ticksY.push(+v.toFixed(6));
    grandeurs.push({ ...g, domaine, ticksY });
  }
  return grandeurs.length ? { lignes, grandeurs, fin } : null;
}

const allureMoy = (a) => {
  const t = a.details?.duree_mouvement_sec || a.duree_sec;
  return t && a.distance_km ? t / a.distance_km : null;
};

// Chiffres des deux séances côte à côte, avec l'écart (cette séance par rapport à l'autre)
function chiffres(a, b, pied) {
  const ecart = (x, y, fmt, mieuxSi) => {
    if (x == null || y == null) return null;
    const d = x - y;
    if (Math.abs(d) < 1e-9) return { texte: "=", ton: "" };
    return { texte: `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`, ton: mieuxSi == null ? "" : (d < 0) === (mieuxSi === "moins") ? "text-ios-green" : "text-ios-orange" };
  };
  const ta = a.details?.duree_mouvement_sec || a.duree_sec, tb = b.details?.duree_mouvement_sec || b.duree_sec;
  const va = a.distance_km && ta ? (a.distance_km / ta) * 3600 : null, vb = b.distance_km && tb ? (b.distance_km / tb) * 3600 : null;
  return [
    ["Distance", a.distance_km != null ? `${fmtDistance(a.distance_km, 2)}` : null, b.distance_km != null ? `${fmtDistance(b.distance_km, 2)}` : null,
      ecart(a.distance_km, b.distance_km, (d) => `${nombre(d, 2)} km`)],
    ["Durée", ta ? fmtDuree(ta) : null, tb ? fmtDuree(tb) : null, ecart(ta, tb, (d) => fmtDuree(Math.round(d)))],
    pied
      ? ["Allure", allureMoy(a) ? `${mmss(allureMoy(a))} /km` : null, allureMoy(b) ? `${mmss(allureMoy(b))} /km` : null,
        ecart(allureMoy(a), allureMoy(b), (d) => `${Math.round(d)} s`, "moins")]
      : ["Vitesse", va ? `${nombre(va, 1)} km/h` : null, vb ? `${nombre(vb, 1)} km/h` : null, ecart(va, vb, (d) => nombre(d, 1), "plus")],
    ["FC moyenne", a.fc_moyenne_bpm && `${a.fc_moyenne_bpm} bpm`, b.fc_moyenne_bpm && `${b.fc_moyenne_bpm} bpm`,
      ecart(a.fc_moyenne_bpm, b.fc_moyenne_bpm, (d) => `${Math.round(d)}`, "moins")],
    ["Dénivelé +", a.dplus_m != null ? `${a.dplus_m} m` : null, b.dplus_m != null ? `${b.dplus_m} m` : null, ecart(a.dplus_m, b.dplus_m, (d) => `${Math.round(d)} m`)],
    ["Effort", a.rpe != null ? `${a.rpe}/10` : null, b.rpe != null ? `${b.rpe}/10` : null, ecart(a.rpe, b.rpe, (d) => nombre(d, 1))],
  ].filter((l) => l[1] || l[2]);
}

// Une phrase : à quelle vitesse et à quel coût cardiaque, d'une séance à l'autre
function verdict(a, b, pied) {
  if (!pied) return null;
  const pa = allureMoy(a), pb = allureMoy(b);
  if (!pa || !pb) return null;
  const d = Math.round(pa - pb), fc = a.fc_moyenne_bpm && b.fc_moyenne_bpm ? a.fc_moyenne_bpm - b.fc_moyenne_bpm : null;
  const allure = Math.abs(d) < 3 ? "à la même allure" : `${Math.abs(d)} s/km ${d < 0 ? "plus vite" : "moins vite"}`;
  if (fc == null) return `Cette séance : ${allure} que l'autre.`;
  const coeur = Math.abs(fc) < 2 ? "pour la même fréquence cardiaque" : `pour ${Math.abs(fc)} bpm de ${fc < 0 ? "moins" : "plus"}`;
  // Deux profils très différents (plus de 10 m de dénivelé par km d'écart) ne se comparent pas à l'allure
  const pente = (x) => (x.dplus_m != null && x.distance_km ? x.dplus_m / x.distance_km : null);
  const relief = pente(a) != null && pente(b) != null && Math.abs(pente(a) - pente(b)) > 10;
  const signe = relief ? ` Les profils diffèrent (${a.dplus_m} m de dénivelé contre ${b.dplus_m} m) : l'écart d'allure vient d'abord du terrain.`
    : d <= -3 && fc <= 1 ? " C'est un progrès net si le terrain et la météo se valent."
      : d >= 3 && fc >= -1 ? " Plus coûteuse : fatigue, chaleur ou terrain ?" : "";
  return `Cette séance : ${allure} que l'autre, ${coeur}.${signe}`;
}

function Ligne({ a, onClick, meme }) {
  const s = sportInfo(a.sport);
  return (
    <button type="button" onClick={onClick} className="ligne" style={{ "--inset": "1rem" }}>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-[15px] font-semibold text-label truncate">{a.titre || a.sport_label || s.label}</span>
          {meme && a.type_seance && <span className="badge shrink-0 bg-brand/15 text-brand">{a.type_seance.label}</span>}
        </span>
        <span className="block text-[13px] text-label-2 chiffres truncate">
          {[a.distance_km != null && `${fmtDistance(a.distance_km, 1)}`, a.duree_str, a.allure_str, a.fc_moyenne_bpm && `♥ ${a.fc_moyenne_bpm}`].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="text-[12px] text-label-2 shrink-0 chiffres">{fmtDate(a.debut)}</span>
    </button>
  );
}

function Choix({ activite, onChoisir }) {
  const [q, setQ] = useState("");
  const { data: proches, isLoading } = useQuery({
    queryKey: ["comparables", activite.id], queryFn: () => getComparables(activite.id), staleTime: 5 * 60 * 1000,
  });
  const { data: trouves, isFetching } = useQuery({
    queryKey: ["activites", { sport: activite.sport, q, limite: 20 }],
    queryFn: () => getActivites({ sport: activite.sport, q, limit: 20 }),
    enabled: q.trim().length >= 2,
  });
  const liste = q.trim().length >= 2 ? (trouves?.activites ?? []).filter((x) => x.id !== activite.id) : proches ?? [];
  return (
    <div className="space-y-3">
      <p className="text-[15px] text-label-2 px-1">
        Choisis la séance à superposer : les plus ressemblantes d'abord (même type, distance proche), ou cherche par titre.
      </p>
      <input type="search" className="champ !py-2" placeholder="Chercher une séance par son titre" value={q}
        onChange={(e) => setQ(e.target.value)} />
      {isLoading || (isFetching && !liste.length) ? <p className="text-[15px] text-label-2 px-1">Chargement…</p>
        : liste.length === 0 ? <p className="text-[15px] text-label-2 px-1">Aucune autre séance de ce sport{q ? " à ce nom" : ""}.</p>
          : (
            <div className="card py-1">
              {liste.map((b) => <Ligne key={b.id} a={b} meme={b.meme_type} onClick={() => onChoisir(b)} />)}
            </div>
          )}
    </div>
  );
}

function Courbe({ g, lignes, axe, index, onSurvol, ticks }) {
  const p = index != null ? lignes[index] : null;
  const va = p?.[`a_${g.cle}`], vb = p?.[`b_${g.cle}`];
  return (
    <div className="card px-4 pt-3 pb-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.02em] text-label-2">{g.nom}</h3>
        <p className="text-[13px] chiffres font-semibold shrink-0 h-5">
          {p && (
            <>
              <span style={{ color: COULEUR_A }}>{va != null ? g.fmt(va) : "—"}</span>
              <span className="text-label-3 mx-1.5">·</span>
              <span style={{ color: COULEUR_B }}>{vb != null ? g.fmt(vb) : "—"}</span>
              <span className="text-label-2 font-medium ml-1">{g.unite}</span>
            </>
          )}
        </p>
      </div>
      <div className="h-[150px] md:h-[180px] -mx-1" style={{ touchAction: "pan-y" }}
        onTouchEnd={() => onSurvol(null)} onTouchCancel={() => onSurvol(null)}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={lignes} syncId="comparaison" margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
            onMouseMove={(e) => onSurvol(e?.activeTooltipIndex ?? null)} onMouseLeave={() => onSurvol(null)}>
            <CartesianGrid {...grille} />
            <XAxis dataKey="x" type="number" domain={[0, "dataMax"]} {...axeX} ticks={ticks} interval="preserveStartEnd"
              tickFormatter={(v) => (axe === "d" ? `${nombre(v, Number.isInteger(v) ? 0 : 1)} km` : chrono(v))} />
            <YAxis {...axeY} width={40} domain={g.domaine} reversed={!!g.inverse} allowDataOverflow ticks={g.ticksY}
              tickFormatter={(v) => g.fmt(v)} />
            <Tooltip content={() => null} cursor={{ stroke: "currentColor", strokeOpacity: 0.35, strokeWidth: 1 }} />
            <Line type="monotone" dataKey={`b_${g.cle}`} stroke={COULEUR_B} strokeWidth={1.8} dot={false} isAnimationActive={false}
              connectNulls={false} activeDot={{ r: 3.5, strokeWidth: 0, fill: COULEUR_B }} />
            <Line type="monotone" dataKey={`a_${g.cle}`} stroke={COULEUR_A} strokeWidth={2} dot={false} isAnimationActive={false}
              connectNulls={false} activeDot={{ r: 3.5, strokeWidth: 0, fill: COULEUR_A }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Legende({ a, couleur, role }) {
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <span className="mt-1.5 w-3 h-3 rounded-full shrink-0" style={{ background: couleur }} />
      <div className="min-w-0">
        <p className="text-[12px] text-label-2">{role} · {fmtDate(a.debut)}</p>
        <p className="text-[15px] font-semibold leading-snug">{a.titre || a.sport_label || sportInfo(a.sport).label}</p>
      </div>
    </div>
  );
}

function Vue({ a, b, fluxA, onChanger }) {
  const pied = PIED.has(a.sport);
  const [axe, setAxe] = useState("d");
  const [index, setIndex] = useState(null);
  const { data: fluxB, isLoading } = useQuery({ queryKey: ["flux", b.id], queryFn: () => getFlux(b.id), staleTime: 30 * 60 * 1000 });
  const parDistance = !!(fluxA?.distance && fluxB?.distance);
  const axeEff = parDistance ? axe : "t";
  const sup = useMemo(() => superposer(fluxA, fluxB, pied, axeEff), [fluxA, fluxB, pied, axeEff]);
  const ticks = useMemo(() => {
    if (!sup) return undefined;
    const choix = axeEff === "d" ? [0.5, 1, 2, 5, 10, 20, 50] : [300, 600, 900, 1200, 1800, 3600, 7200];
    const pas = choix.find((c) => sup.fin / c <= (window.innerWidth < 768 ? 4 : 8)) ?? choix.at(-1);
    return Array.from({ length: Math.floor(sup.fin / pas) }, (_, i) => (i + 1) * pas);
  }, [sup, axeEff]);
  const lignes = chiffres(a, b, pied);
  const phrase = verdict(a, b, pied);
  const p = index != null && sup ? sup.lignes[index] : null;

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Legende a={a} couleur={COULEUR_A} role="Cette séance" />
          <Legende a={b} couleur={COULEUR_B} role="Comparée à" />
        </div>
        {phrase && <p className="text-[15px] leading-snug">{phrase}</p>}
        <button type="button" className="btn-gris btn-sm" onClick={onChanger}>Choisir une autre séance</button>
      </div>

      <div className="card px-4 py-2">
        <div className="grid grid-cols-[1.1fr_1fr_1fr_0.8fr] gap-x-2 text-[12px] text-label-2 py-1.5 border-b border-separateur">
          <span />
          <span className="text-right font-semibold" style={{ color: COULEUR_A }}>Cette séance</span>
          <span className="text-right font-semibold" style={{ color: COULEUR_B }}>L'autre</span>
          <span className="text-right">Écart</span>
        </div>
        {lignes.map(([l, va, vb, e]) => (
          <div key={l} className="grid grid-cols-[1.1fr_1fr_1fr_0.8fr] gap-x-2 items-baseline py-2 border-b border-separateur last:border-0">
            <span className="text-[13px] text-label-2">{l}</span>
            <span className="text-right text-[14px] font-semibold chiffres">{va || "—"}</span>
            <span className="text-right text-[14px] font-semibold chiffres">{vb || "—"}</span>
            <span className={`text-right text-[13px] chiffres ${e?.ton ?? "text-label-2"}`}>{e?.texte ?? ""}</span>
          </div>
        ))}
        <p className="text-[12px] text-label-2 py-2">Écart : cette séance par rapport à l'autre. Vert : mieux cette fois.</p>
      </div>

      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-[20px] font-bold tracking-tight flex items-center gap-1.5">Courbes <Aide sujet="comparer_seances" /></h2>
        {parDistance && (
          <Segmente className="w-[180px]" valeur={axe} onChange={setAxe} options={[["d", "Distance"], ["t", "Temps"]]} />
        )}
      </div>
      {sup && (
        <p className="px-1 -mt-2 text-[13px] text-label-2 chiffres h-4">
          {p ? (axeEff === "d" ? `${nombre(p.x, 2)} km` : chrono(p.x)) : "Touche une courbe pour lire les deux valeurs"}
        </p>
      )}
      {isLoading ? <div className="card h-[190px] animate-pulse" />
        : sup ? (
          <div className="grid gap-3">
            {sup.grandeurs.map((g) => <Courbe key={g.cle} g={g} lignes={sup.lignes} axe={axeEff} index={index} onSurvol={setIndex} ticks={ticks} />)}
          </div>
        ) : (
          <div className="card p-5 text-center space-y-1">
            <p className="text-[15px] font-semibold">Pas de courbes à superposer</p>
            <p className="text-[13px] text-label-2">L'autre séance n'a ni tracé GPS ni courbes venues d'Intervals.icu. Les chiffres ci-dessus restent comparables.</p>
          </div>
        )}
    </div>
  );
}

// Encart de la fiche : ouvre la comparaison de cette séance avec une autre du même sport
export default function Comparer({ activite, flux }) {
  const [ouvert, setOuvert] = useState(false);
  const [autre, setAutre] = useState(null);
  return (
    <>
      <div className="card p-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex-1 min-w-[200px]">
          <h3 className="text-[15px] font-semibold flex items-center gap-1.5">Comparer à une autre séance <Aide sujet="comparer_seances" /></h3>
          <p className="text-[13px] text-label-2">Superpose l'allure, le cœur et le profil de deux sorties, même à des mois d'écart.</p>
        </div>
        <button type="button" className="btn-teinte btn-sm" onClick={() => setOuvert(true)}>Comparer</button>
      </div>
      {ouvert && (
        <Feuille large titre="Comparer" onClose={() => { setOuvert(false); setAutre(null); }}>
          {autre ? <Vue a={activite} b={autre} fluxA={flux} onChanger={() => setAutre(null)} />
            : <Choix activite={activite} onChoisir={setAutre} />}
        </Feuille>
      )}
    </>
  );
}
