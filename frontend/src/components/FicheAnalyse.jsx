import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { creerSegment, getTerrains, getTrace, getZones } from "../api";
import { fmtDuree, nombre } from "../carnet";
import Aide from "./Aide";
import { cumulKm, mmss } from "./FicheExtras";
import { TERRAINS } from "./ProfilAltitude";
import { Segmente } from "./ui";

const COULEURS_ZONES = ["#8E8E93", "#0A84FF", "#30D158", "#FF9F0A", "#FF375F"];
const PENTES = [
  { cle: "d2", nom: "Descente raide", detail: "plus de −8 %", couleur: "#5E5CE6", max: -8 },
  { cle: "d1", nom: "Descente", detail: "−8 à −3 %", couleur: "#64D2FF", max: -3 },
  { cle: "plat", nom: "Plat", detail: "−3 à 3 %", couleur: "#8E8E93", max: 3 },
  { cle: "m1", nom: "Montée", detail: "3 à 8 %", couleur: "#FF9F0A", max: 8 },
  { cle: "m2", nom: "Montée raide", detail: "plus de 8 %", couleur: "#FF375F", max: Infinity },
];

// Pas entre deux points consécutifs : durée (pauses plafonnées à 3 fois le pas habituel) et distance
function pas(lignes) {
  const dts = [];
  for (let i = 1; i < lignes.length; i++) dts.push(lignes[i].t - lignes[i - 1].t);
  const med = [...dts].sort((a, b) => a - b)[dts.length >> 1] || 1;
  return lignes.map((l, i) => {
    if (!i) return { dt: 0, dd: 0 };
    const p = lignes[i - 1];
    return { dt: Math.max(0, Math.min(dts[i - 1], 3 * med)), dd: l.d != null && p.d != null ? Math.max(0, l.d - p.d) : 0 };
  });
}

// Pente de chaque point : celle du flux, sinon recalculée sur l'altitude (fenêtre de ±3 points)
function pentes(lignes) {
  if (lignes.some((l) => l.pente != null)) return lignes.map((l) => l.pente ?? null);
  if (!lignes.some((l) => l.altitude != null) || !lignes.some((l) => l.d != null)) return null;
  return lignes.map((_, i) => {
    const a = lignes[Math.max(0, i - 3)], b = lignes[Math.min(lignes.length - 1, i + 3)];
    if (a.altitude == null || b.altitude == null || a.d == null || b.d == null || b.d - a.d < 0.01) return null;
    return ((b.altitude - a.altitude) / ((b.d - a.d) * 1000)) * 100;
  });
}

// Cumule durée et distance par classe ; « classer » rend l'indice de la classe du point, ou −1
function repartir(lignes, classes, classer) {
  const p = pas(lignes);
  const tot = classes.map((c) => ({ ...c, sec: 0, km: 0 }));
  lignes.forEach((l, i) => {
    const k = classer(l, i);
    if (k == null || k < 0 || !tot[k]) return;
    tot[k].sec += p[i].dt; tot[k].km += p[i].dd;
  });
  const total = tot.reduce((s, c) => s + c.sec, 0);
  return total > 0 ? { classes: tot, total } : null;
}

function Barres({ rep, pied }) {
  const visibles = rep.classes.filter((c) => c.sec >= 1);
  return (
    <div className="space-y-3">
      <div className="flex h-3 rounded-full overflow-hidden gap-[2px]">
        {visibles.map((c) => <span key={c.cle} style={{ width: `${(c.sec / rep.total) * 100}%`, background: c.couleur }} />)}
      </div>
      <div>
        {rep.classes.map((c) => {
          const part = (c.sec / rep.total) * 100;
          const rythme = c.km > 0.05 && c.sec > 0 ? (pied ? `${mmss(c.sec / c.km)} /km` : `${nombre((c.km / c.sec) * 3600, 1)} km/h`) : null;
          return (
            <div key={c.cle} className={`flex items-center gap-2.5 py-1.5 border-b border-separateur last:border-0 ${c.sec < 1 ? "opacity-45" : ""}`}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.couleur }} />
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-medium leading-tight">{c.nom}</span>
                {c.detail && <span className="block text-[12px] text-label-2 chiffres">{c.detail}</span>}
              </span>
              <span className="hidden sm:block w-[86px] text-right text-[13px] text-label-2 chiffres">{rythme ?? ""}</span>
              <span className="w-[62px] text-right text-[13px] text-label-2 chiffres">{c.km >= 0.05 ? `${nombre(c.km, 1)} km` : ""}</span>
              <span className="w-[58px] text-right text-[14px] font-semibold chiffres">{c.sec >= 1 ? fmtDuree(Math.round(c.sec)) : "—"}</span>
              <span className="w-[40px] text-right text-[13px] text-label-2 chiffres">{c.sec >= 1 ? `${Math.round(part)} %` : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Où est passé le temps de la séance : par zone d'allure, par pente, par terrain
export function Repartition({ activite, lignes, pied }) {
  const [vue, setVue] = useState(null);
  const avecTrace = !!activite.details?.trace;
  const { data: zones } = useQuery({ queryKey: ["zones"], queryFn: getZones, staleTime: 5 * 60 * 1000, enabled: pied });
  const { data: terrains } = useQuery({
    queryKey: ["terrains", activite.id], queryFn: () => getTerrains(activite.id), staleTime: Infinity, enabled: avecTrace,
  });

  const parAllure = useMemo(() => {
    const z = zones?.zones;
    if (!pied || !z?.length || !z.some((x) => x.allure_lente || x.allure_rapide)) return null;
    const classes = z.map((x, i) => ({
      cle: `z${i + 1}`, nom: `Z${i + 1}${x.nom ? ` · ${x.nom}` : ""}`, couleur: COULEURS_ZONES[i] ?? "#8E8E93",
      detail: !x.allure_lente ? `plus lent que ${mmss(x.allure_rapide)}` : !x.allure_rapide ? `plus vite que ${mmss(x.allure_lente)}`
        : `${mmss(x.allure_lente)} à ${mmss(x.allure_rapide)}`,
    }));
    return repartir(lignes, classes, (l) => (l.allure == null ? -1
      : z.findIndex((x) => (x.allure_lente == null || l.allure <= x.allure_lente) && (x.allure_rapide == null || l.allure > x.allure_rapide))));
  }, [zones, lignes, pied]);

  const parPente = useMemo(() => {
    const p = pentes(lignes);
    if (!p) return null;
    const r = repartir(lignes, PENTES, (_, i) => (p[i] == null ? -1 : PENTES.findIndex((c) => p[i] < c.max)));
    // Une sortie toute plate n'apprend rien
    return r && r.classes[2].sec / r.total < 0.97 ? r : null;
  }, [lignes]);

  const parTerrain = useMemo(() => {
    const t = terrains?.terrains;
    const fin = lignes.findLast((l) => l.d != null)?.d;
    if (!t?.length || !fin) return null;
    const echelle = t.at(-1)[1] / fin;
    const cles = Object.keys(TERRAINS);
    const classes = cles.map((k) => ({ cle: k, nom: TERRAINS[k][0], couleur: TERRAINS[k][1] }));
    let j = 0;
    return repartir(lignes, classes, (l) => {
      if (l.d == null) return -1;
      const km = l.d * echelle;
      while (j < t.length - 1 && t[j][1] < km) j++;
      return cles.indexOf(t[j][2]);
    });
  }, [terrains, lignes]);

  const vues = [["allure", "Allure", parAllure], ["pente", "Pente", parPente], ["terrain", "Terrain", parTerrain]].filter((v) => v[2]);
  if (!vues.length) return null;
  const courante = vues.find((v) => v[0] === vue) ?? vues[0];
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-[15px] font-semibold flex items-center gap-1.5">Répartition du temps <Aide sujet="repartition_temps" /></h3>
        {vues.length > 1 && (
          <Segmente className="w-full sm:w-[260px]" valeur={courante[0]} onChange={setVue} options={vues.map((v) => [v[0], v[1]])} />
        )}
      </div>
      <Barres rep={courante[2]} pied={pied} />
    </div>
  );
}

// --- Portion choisie sur les courbes --------------------------------------------

const proche = (lignes, i, cle, sens) => {
  for (let k = i; k >= 0 && k < lignes.length; k += sens) if (lignes[k][cle] != null) return lignes[k][cle];
  return null;
};
const moyenne = (lignes, i0, i1, cle) => {
  let s = 0, n = 0;
  for (let i = i0; i <= i1; i++) if (lignes[i][cle] != null) { s += lignes[i][cle]; n++; }
  return n ? s / n : null;
};

export function statsPortion(lignes, i0, i1) {
  const d0 = proche(lignes, i0, "d", 1), d1 = proche(lignes, i1, "d", -1);
  const km = d0 != null && d1 != null && d1 > d0 ? d1 - d0 : null;
  const sec = lignes[i1].t - lignes[i0].t;
  // Dénivelé positif sur l'altitude lissée (3 points), pour ne pas compter le bruit
  let dplus = null, prec = null;
  for (let i = i0; i <= i1; i++) {
    const v = moyenne(lignes, Math.max(i0, i - 1), Math.min(i1, i + 1), "altitude");
    if (v == null) continue;
    if (prec != null && v > prec) dplus = (dplus ?? 0) + (v - prec);
    if (prec == null) dplus = 0;
    prec = v;
  }
  return { d0, d1, km, sec, dplus, fc: moyenne(lignes, i0, i1, "fc"), cadence: moyenne(lignes, i0, i1, "cadence") };
}

function Mesure({ label, valeur, unite }) {
  if (valeur == null) return null;
  return (
    <div className="tuile px-3 py-2.5 min-w-0">
      <p className="text-[12px] text-label-2">{label}</p>
      <p className="text-[19px] leading-tight font-semibold chiffres">
        {valeur}{unite && <span className="text-[12px] font-medium text-label-2 ml-0.5">{unite}</span>}
      </p>
    </div>
  );
}

function VersSegment({ activite, st, finFlux, onFin, onCree }) {
  const qc = useQueryClient();
  const [nom, setNom] = useState("");
  const { data: trace } = useQuery({ queryKey: ["trace", activite.id], queryFn: () => getTrace(activite.id), staleTime: Infinity });
  const total = useMemo(() => (trace?.points ? cumulKm(trace.points).at(-1) : null), [trace]);
  // Les kilomètres des courbes sont ramenés à ceux du tracé
  const echelle = total && finFlux ? total / finFlux : 1;
  const debut = Math.max(0, st.d0 * echelle), fin = Math.min(total ?? Infinity, st.d1 * echelle);
  const creer = useMutation({
    mutationFn: () => creerSegment({ activite_id: activite.id, debut_km: +debut.toFixed(3), fin_km: +fin.toFixed(3), nom: nom.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["segments-activite", activite.id] });
      qc.invalidateQueries({ queryKey: ["segments"] });
      onCree();
    },
  });
  const valide = fin - debut >= 0.1 && fin - debut <= 30;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input autoFocus className="champ !py-2 flex-1 min-w-0" placeholder="Nom du segment (ex. Montée du fort)" maxLength={120}
          value={nom} onChange={(e) => setNom(e.target.value)} />
        <button type="button" className="btn-primaire btn-sm" disabled={!nom.trim() || !valide || !total || creer.isPending}
          onClick={() => creer.mutate()}>Créer</button>
        <button type="button" className="btn-gris btn-sm" onClick={onFin}>Annuler</button>
      </div>
      {!valide && <p className="text-[12px] text-ios-orange">Un segment mesure entre 100 m et 30 km.</p>}
      {creer.isError && <p className="text-[12px] text-ios-red">{creer.error?.response?.data?.detail ?? "Création impossible"}</p>}
    </div>
  );
}

// Analyse d'une portion : deux curseurs (ou un glisser à la souris sur une courbe), moyennes, et segment
export function Portion({ activite, lignes, portion, onChange, pied }) {
  const [segment, setSegment] = useState(false);
  const [cree, setCree] = useState(false);
  const n = lignes.length - 1;
  const [i0, i1] = portion;
  const st = useMemo(() => statsPortion(lignes, i0, i1), [lignes, i0, i1]);
  const finFlux = lignes.findLast((l) => l.d != null)?.d;
  const regler = (k, v) => {
    const b = [i0, i1];
    b[k] = v;
    if (b[1] - b[0] < 2) return;
    setCree(false);
    onChange(b);
  };
  const repere = (i) => {
    const d = proche(lignes, i, "d", i === i0 ? 1 : -1);
    return d != null ? `${nombre(d, 2)} km` : fmtDuree(Math.round(lignes[i].t));
  };
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold flex items-center gap-1.5">Portion choisie <Aide sujet="portion" /></h3>
        <button type="button" className="btn-texte" onClick={() => onChange(null)}>Fermer</button>
      </div>
      <div className="space-y-1.5">
        {[["Départ", 0], ["Arrivée", 1]].map(([l, k]) => (
          <label key={l} className="flex items-center gap-3 text-[13px]">
            <span className="w-14 text-label-2">{l}</span>
            <input type="range" min={0} max={n} step={1} value={k ? i1 : i0} className="flex-1 min-w-0"
              onChange={(e) => regler(k, Number(e.target.value))} />
            <span className="w-[68px] text-right chiffres">{repere(k ? i1 : i0)}</span>
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Mesure label="Distance" valeur={st.km != null ? nombre(st.km, 2) : null} unite="km" />
        <Mesure label="Durée" valeur={fmtDuree(Math.round(st.sec))} />
        {pied
          ? <Mesure label="Allure" valeur={st.km ? mmss(st.sec / st.km) : null} unite="/km" />
          : <Mesure label="Vitesse" valeur={st.km && st.sec ? nombre((st.km / st.sec) * 3600, 1) : null} unite="km/h" />}
        <Mesure label="FC moyenne" valeur={st.fc != null ? Math.round(st.fc) : null} unite="bpm" />
        <Mesure label="Dénivelé +" valeur={st.dplus != null ? Math.round(st.dplus) : null} unite="m" />
        <Mesure label="Cadence" valeur={st.cadence != null ? Math.round(st.cadence) : null} />
      </div>
      <p className="hidden md:block text-[12px] text-label-2">Tu peux aussi glisser la souris sur une courbe pour choisir la portion.</p>
      {activite.details?.trace && st.km != null && (
        segment ? <VersSegment activite={activite} st={st} finFlux={finFlux} onFin={() => setSegment(false)}
          onCree={() => { setSegment(false); setCree(true); }} key={`${i0}-${i1}`} />
          : cree ? <p className="text-[13px] text-ios-green">Segment créé : il apparaît dans « Segments » plus haut.</p>
            : <button type="button" className="btn-teinte btn-sm" onClick={() => setSegment(true)}>En faire un segment</button>
      )}
    </div>
  );
}
