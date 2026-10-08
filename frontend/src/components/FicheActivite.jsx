import { memo, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { getFlux } from "../api";
import { sportInfo, fmtDateHeure, fmtDuree, nombre, SOURCES } from "../carnet";
import Feuille from "./Feuille";
import CarteTrace from "./CarteTrace";
import ModalActivite from "./ModalActivite";
import { Segmente } from "./ui";
import { axeX, axeY, grille } from "./graphiques";

const PIED = new Set(["course", "trail", "marche", "randonnee"]);

// Décimales affichées selon la grandeur
const DECIMALES = { fc: 0, cadence: 0, altitude: 0, puissance: 0, contact: 0, temperature: 0, vitesse: 1,
  oscillation: 1, foulee: 2, ratio_vertical: 1, pente: 1, respiration: 0 };

const mmss = (s) => {
  if (s == null || !isFinite(s)) return "—";
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return sec === 60 ? `${m + 1}:00` : `${m}:${String(sec).padStart(2, "0")}`;
};
const chrono = (s) => {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
// Pas de graduation « ronds » : 1-2-5 × 10ⁿ, ou des durées pour l'allure et le temps
function pasJoli(etendue, cible, choix) {
  const brut = etendue / cible || 1;
  if (choix) return choix.find((c) => c >= brut) ?? choix[choix.length - 1];
  const p = 10 ** Math.floor(Math.log10(brut)), n = brut / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
const graduations = (min, max, pas) => {
  const g = [];
  for (let v = Math.ceil(min / pas - 1e-9) * pas; v <= max + 1e-9; v += pas) g.push(+v.toFixed(6));
  return g;
};
const PAS_ALLURE = [5, 10, 15, 20, 30, 60, 120, 300];
const PAS_TEMPS = [60, 120, 300, 600, 900, 1200, 1800, 3600, 7200, 10800];

const quantile = (tri, q) => tri[Math.min(tri.length - 1, Math.max(0, Math.floor(q * (tri.length - 1))))];

// Prépare les courbes : une ligne par point (temps, distance, valeur de chaque flux).
// En course à pied, la vitesse devient une allure (min/km), axe inversé : plus haut = plus vite.
function preparer(flux, sport) {
  if (!flux?.series?.length) return null;
  const series = flux.series.map((s) => ({ ...s, dec: DECIMALES[s.cle] ?? 1 }));
  const iv = series.findIndex((s) => s.cle === "vitesse");
  if (PIED.has(sport) && iv >= 0) {
    const v = series[iv];
    series[iv] = {
      ...v, cle: "allure", nom: "Allure", unite: "/km", allure: true,
      data: v.data.map((x) => (x != null && x >= 3 ? 3600 / x : null)),
    };
  }
  const lignes = flux.temps.map((t, i) => {
    const l = { t, d: flux.distance?.[i] ?? null };
    for (const s of series) l[s.cle] = s.data[i];
    return l;
  });
  for (const s of series) {
    const vals = s.data.filter((x) => x != null);
    const tri = [...vals].sort((a, b) => a - b);
    s.moy = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    s.min = tri[0];
    s.max = tri[tri.length - 1];
    // Échelle resserrée (les arrêts et les pics isolés n'écrasent pas la courbe)
    let bas = quantile(tri, 0.02), haut = quantile(tri, 0.98);
    const marge = (haut - bas) * 0.1 || Math.abs(haut) * 0.05 || 1;
    bas -= marge; haut += marge;
    if (s.min >= 0) bas = Math.max(0, bas);
    const pas = pasJoli(haut - bas, 3, s.allure ? PAS_ALLURE : null);
    s.domaine = [Math.floor(bas / pas) * pas, Math.ceil(haut / pas) * pas];
    s.ticks = graduations(s.domaine[0], s.domaine[1], pas);
    s.decAxe = Math.max(0, -Math.floor(Math.log10(pas) + 1e-9));
  }
  return { series, lignes };
}

const fmtVal = (s, v) => (v == null ? "—" : s.allure ? mmss(v) : nombre(v, s.dec));

// Une courbe : mémorisée pour ne pas tout redessiner pendant le survol
const Graphe = memo(function Graphe({ s, lignes, axe, ticksX, onSurvol }) {
  const id = `deg-${s.cle}`;
  return (
    <div className="h-[132px] md:h-[150px] -mx-1" style={{ touchAction: "pan-y" }}
      onTouchEnd={() => onSurvol(null)} onTouchCancel={() => onSurvol(null)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={lignes} syncId="seance" margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
          onMouseMove={(e) => onSurvol(e?.activeTooltipIndex ?? null)}
          onMouseLeave={() => onSurvol(null)}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.couleur} stopOpacity={0.45} />
              <stop offset="100%" stopColor={s.couleur} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...grille} />
          <XAxis dataKey={axe} type="number" domain={["dataMin", "dataMax"]} {...axeX} ticks={ticksX} interval="preserveStartEnd"
            tickFormatter={(v) => (axe === "d" ? `${nombre(v, Number.isInteger(v) ? 0 : 1)} km` : chrono(v))} />
          <YAxis {...axeY} width={40} domain={s.domaine} ticks={s.ticks} reversed={!!s.allure} allowDataOverflow
            tickFormatter={(v) => (s.allure ? mmss(v) : nombre(v, Math.min(2, s.decAxe)))} />
          <Tooltip content={() => null} cursor={{ stroke: "currentColor", strokeOpacity: 0.35, strokeWidth: 1 }} />
          <Area type="monotone" dataKey={s.cle} stroke={s.couleur} strokeWidth={1.8} fill={`url(#${id})`}
            baseValue={s.allure ? "dataMax" : "dataMin"} connectNulls={false} isAnimationActive={false}
            dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "rgb(var(--surface))", fill: s.couleur }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

function Tuile({ label, valeur, unite, couleur }) {
  if (valeur == null || valeur === "—") return null;
  return (
    <div className="card px-3.5 py-3 min-w-0">
      <p className="text-[12px] text-label-2 truncate">{label}</p>
      <p className="text-[22px] leading-tight font-semibold chiffres truncate" style={couleur ? { color: couleur } : undefined}>
        {valeur}{unite && <span className="text-[13px] font-medium text-label-2 ml-0.5">{unite}</span>}
      </p>
    </div>
  );
}

const COULEURS_ZONES = ["#8E8E93", "#0A84FF", "#30D158", "#FF9F0A", "#FF375F"];

function ZonesFC({ zones }) {
  const total = zones.reduce((a, z) => a + (z.min_passees || 0), 0);
  if (!total) return null;
  return (
    <div className="card p-4 space-y-3">
      <h3 className="text-[15px] font-semibold">Zones cardiaques</h3>
      <div className="flex h-3 rounded-full overflow-hidden gap-[2px]">
        {zones.map((z, i) => z.min_passees > 0 && (
          <span key={i} style={{ width: `${(z.min_passees / total) * 100}%`, background: COULEURS_ZONES[i] }} />
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1 text-center">
        {zones.map((z, i) => (
          <div key={i} className="min-w-0">
            <p className="text-[11px] font-semibold" style={{ color: COULEURS_ZONES[i] }}>Z{i + 1}</p>
            <p className="text-[13px] font-semibold chiffres">{fmtDuree(Math.round(z.min_passees * 60))}</p>
            <p className="text-[10px] text-label-2 chiffres truncate">
              {z.min == null ? `< ${z.max}` : z.max == null ? `≥ ${z.min}` : `${z.min}–${z.max}`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Squelette() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2].map((i) => <div key={i} className="card h-[178px]" />)}
    </div>
  );
}

// Fiche détaillée d'une séance : chiffres clés, carte, zones et toutes les
// courbes synchronisées (FC, allure, cadence, altitude, oscillation, foulée…).
// Toucher ou survoler une courbe affiche la valeur au même instant sur toutes.
export default function FicheActivite({ activite: initiale, onClose }) {
  const [a, setA] = useState(initiale);
  const [edition, setEdition] = useState(false);
  const [axe, setAxe] = useState("d");
  const [index, setIndex] = useState(null);
  const s = sportInfo(a.sport);
  const det = a.details || {};

  const { data: flux, isLoading } = useQuery({
    queryKey: ["flux", a.id], queryFn: () => getFlux(a.id), staleTime: 30 * 60 * 1000,
  });
  const prepa = useMemo(() => preparer(flux, a.sport), [flux, a.sport]);
  const axeEff = prepa && !flux.distance ? "t" : axe;
  const onSurvol = useCallback((i) => setIndex(i), []);
  const ticksX = useMemo(() => {
    if (!prepa) return undefined;
    const vals = prepa.lignes.map((l) => l[axeEff]).filter((v) => v != null);
    if (vals.length < 2) return undefined;
    const min = vals[0], max = vals[vals.length - 1];
    return graduations(min, max, pasJoli(max - min, window.innerWidth < 768 ? 4 : 7, axeEff === "t" ? PAS_TEMPS : null))
      .filter((v) => v > min);
  }, [prepa, axeEff]);
  const point = index != null ? prepa?.lignes[index] : null;

  const pied = PIED.has(a.sport);
  const tuiles = [
    ["Durée", a.duree_sec ? fmtDuree(a.duree_sec) : null],
    ["Distance", a.distance_km != null ? nombre(a.distance_km, 2) : null, "km"],
    pied ? ["Allure moy.", a.allure_sec_km ? mmss(a.allure_sec_km) : null, "/km"]
      : ["Vitesse moy.", a.vitesse_kmh ? nombre(a.vitesse_kmh) : null, "km/h"],
    ["Dénivelé +", a.dplus_m || null, "m"],
    ["FC moyenne", a.fc_moyenne_bpm, "bpm", "#FF375F"],
    ["FC max", a.fc_max_bpm, "bpm", "#FF375F"],
    ["Calories", a.calories ? Math.round(a.calories) : null, "kcal"],
    ["Effort", a.rpe != null ? a.rpe : null, "/10"],
    ["Puissance moy.", det.puissance_moy_w ? Math.round(det.puissance_moy_w) : null, "W"],
    ["Foulée", det.foulee_m ? nombre(det.foulee_m, 2) : null, "m"],
    ["Oscillation", det.oscillation_cm ? nombre(det.oscillation_cm, 1) : null, "cm"],
    ["Contact au sol", det.contact_sol_ms ? Math.round(det.contact_sol_ms) : null, "ms"],
    ["Pas", det.pas ? Math.round(det.pas).toLocaleString("fr-FR") : null],
    ["Dérive cardiaque", det.derive_fc != null ? nombre(det.derive_fc, 1) : null, "%"],
  ].filter((t) => t[1] != null);

  return (
    <>
      <Feuille large onClose={onClose} titre={a.titre || a.sport_label || s.label}
        action={<button type="button" className="btn-texte" onClick={() => setEdition(true)}>Modifier</button>}>

        <div className="flex items-center gap-3 -mt-1">
          <span className="w-12 h-12 shrink-0 rounded-full flex items-center justify-center text-[24px]"
            style={{ backgroundColor: `${s.couleur}26` }}>{a.emoji ?? s.emoji}</span>
          <div className="min-w-0">
            <p className="text-[17px] font-semibold truncate">
              {a.sport_label || s.label}{a.est_competition && " 🏅"}
            </p>
            <p className="text-[13px] text-label-2 truncate">
              {fmtDateHeure(a.debut)} · {SOURCES[a.source] ?? a.source}
            </p>
          </div>
        </div>

        {tuiles.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {tuiles.map(([l, v, u, c]) => <Tuile key={l} label={l} valeur={v} unite={u} couleur={c} />)}
          </div>
        )}

        {det.trace && <CarteTrace activiteId={a.id} />}

        {Array.isArray(det.zones_fc) && <ZonesFC zones={det.zones_fc} />}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="text-[20px] font-bold tracking-tight">Courbes</h2>
            {prepa && flux.distance && (
              <Segmente className="w-[180px]" valeur={axe} onChange={setAxe}
                options={[["d", "Distance"], ["t", "Temps"]]} />
            )}
          </div>

          {/* Repère commun : position du doigt / de la souris sur les courbes */}
          {prepa && (
            <p className="px-1 -mt-1 text-[13px] text-label-2 chiffres h-4">
              {point
                ? `${point.d != null ? `${nombre(point.d, 2)} km · ` : ""}${chrono(point.t)}`
                : "Touche une courbe pour lire les valeurs"}
            </p>
          )}

          {isLoading ? <Squelette /> : prepa ? (
            <div className="grid gap-3">
              {prepa.series.map((serie) => {
                const v = point ? point[serie.cle] : null;
                return (
                  <div key={serie.cle} className="card px-4 pt-3 pb-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-[13px] font-semibold uppercase tracking-[0.02em] truncate" style={{ color: serie.couleur }}>
                        {serie.nom}
                      </h3>
                      <p className="text-[12px] text-label-2 chiffres shrink-0">
                        {point ? "" : serie.allure
                          ? `moy. ${mmss(serie.moy)} · meilleure ${mmss(serie.min)}`
                          : `moy. ${fmtVal(serie, serie.moy)} · max ${fmtVal(serie, serie.max)}`}
                      </p>
                    </div>
                    <p className="text-[24px] font-semibold leading-tight chiffres">
                      {fmtVal(serie, point ? v : serie.moy)}
                      <span className="text-[13px] font-medium text-label-2 ml-1">{serie.unite}</span>
                    </p>
                    <Graphe s={serie} lignes={prepa.lignes} axe={axeEff} ticksX={ticksX} onSurvol={onSurvol} />
                  </div>
                );
              })}
              {flux.source === "trace" && (
                <p className="text-[12px] text-label-2 px-1">
                  Courbes recalculées depuis le tracé GPS. Les séances reçues d'Intervals.icu affichent aussi la FC, la cadence, l'oscillation verticale, la foulée…
                </p>
              )}
            </div>
          ) : (
            <div className="card p-5 text-center space-y-1">
              <p className="text-[28px]">📈</p>
              <p className="text-[15px] font-semibold">Pas de courbes pour cette séance</p>
              <p className="text-[13px] text-label-2">
                Elles viennent d'Intervals.icu (séances de l'Apple Watch) ou d'un tracé GPS importé.
              </p>
            </div>
          )}
          {flux?.avertissement && <p className="text-[12px] text-ios-orange px-1">{flux.avertissement}</p>}
        </section>

        {a.notes && (
          <div className="card p-4">
            <h3 className="text-[13px] text-label-2 mb-1">Notes</h3>
            <p className="text-[15px] whitespace-pre-line">{a.notes}</p>
          </div>
        )}
      </Feuille>

      {edition && (
        <ModalActivite activite={a} onClose={() => setEdition(false)}
          onEnregistre={(maj) => maj?.id && setA(maj)}
          onSupprime={onClose} />
      )}
    </>
  );
}
