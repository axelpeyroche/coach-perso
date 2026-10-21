import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Page from "../components/Page";
import { Carte, km, nomSport, SPORTS, TACTILE, telecharger } from "../components/CarteItineraire";
import Profil, { profil, TERRAINS } from "../components/ProfilAltitude";
import { Interrupteur, Segmente } from "../components/ui";
import {
  creerFavoriItineraire, getAlluresItineraire, getSortiesItineraire, getTerrains, getTrace,
  ligneDroiteItineraire, tracerItineraire,
} from "../api";
import { useAuth } from "../AuthContext";
import { nombre } from "../carnet";
import * as T from "./itineraireTrace";

// Création d'un parcours de A à Z : chaque toucher de la carte ajoute un point, relié au précédent
// par les chemins (BRouter) ou en ligne droite (hors sentier). Récap, profil et segments en direct.

const A_PIED = ["course", "trail", "randonnee"];
const ORANGE = "#FF6B35";
const VIERGE = { boucle: false, wps: [], segs: [] };
const MODES = [["chemins", "Suivre les chemins"], ["droite", "Ligne droite"]];
const SURFACES = ["sentier", "chemin", "bitume", "hors"];
const LIBELLES = { sentier: "sentier", chemin: "chemin", bitume: "bitume", hors: "hors sentier" };

// ── Modèle : { boucle, wps: [[lat, lon]], segs: [{ pts, ty, mode }] } (voir itineraireTrace) ──
const nb = T.nbSegments;
const provisoire = (a, b, mode) => ({ pts: [a.slice(0, 2), b.slice(0, 2)], ty: [null, null], mode, provisoire: true });
const inverse = (s) => ({ ...s, pts: [...s.pts].reverse(), ty: [...s.ty.slice(0, -1).reverse(), s.ty[0]] });
// Tout point peut être retiré, sauf le départ d'une boucle
const retirable = (e, k) => (e.boucle ? k > 0 && e.wps.length > 2 : true);

// Nouvel état provisoire (segments à recalculer en tirets) : { e, ks: segments à calculer, cales: points à poser sur le chemin }
function preparer(e, op, mode) {
  const n = nb(e), wps = [...e.wps], segs = [...e.segs];
  const fin = (k) => wps[T.suivant({ ...e, wps }, k)];
  switch (op.type) {
    case "ajouter": {
      if (!wps.length) return { e: { ...e, wps: [op.pos], segs: [] } };
      if (e.boucle) {
        wps.push(op.pos);
        segs.splice(n - 1, 1, provisoire(e.wps.at(-1), op.pos, mode), provisoire(op.pos, e.wps[0], mode));
        return { e: { ...e, wps, segs }, ks: [n - 1, n], cales: [n] };
      }
      wps.push(op.pos);
      segs.push(provisoire(e.wps.at(-1), op.pos, mode));
      return { e: { ...e, wps, segs }, ks: [n], cales: n === 0 ? [0, 1] : [n + 1] };
    }
    case "deplacer": {
      wps[op.k] = op.pos;
      if (!segs.length) return { e: { ...e, wps } };
      const prec = op.k > 0 ? op.k - 1 : e.boucle ? n - 1 : null;
      const suiv = op.k < n ? op.k : null;
      const ks = [prec, suiv].filter((k) => k != null);
      const e2 = { ...e, wps, segs };
      for (const k of ks) segs[k] = provisoire(wps[k], fin(k), e.segs[k].mode);
      return { e: e2, ks, cales: [op.k] };
    }
    case "inserer": {
      const m = e.segs[op.k].mode;
      wps.splice(op.k + 1, 0, op.pos);
      segs.splice(op.k, 1, provisoire(e.wps[op.k], op.pos, m), provisoire(op.pos, fin(op.k + 1), m));
      return { e: { ...e, wps, segs }, ks: [op.k, op.k + 1], cales: [op.k + 1] };
    }
    case "retirer": {
      if (wps.length <= 1) return { e: VIERGE };
      if (!e.boucle && (op.k === 0 || op.k === wps.length - 1)) {
        const bout = op.k === 0 ? (l) => l.slice(1) : (l) => l.slice(0, -1);
        return { e: { ...e, wps: bout(wps), segs: bout(segs) } };
      }
      const m = e.segs[op.k - 1].mode;
      wps.splice(op.k, 1);
      const e2 = { ...e, wps, segs };
      segs.splice(op.k - 1, 2, provisoire(wps[op.k - 1], fin(op.k - 1), m));
      return { e: e2, ks: [op.k - 1] };
    }
    case "couper": {
      const r = T.couper(e, op.k, op.pos);
      if (!r) return null;
      const m = e.segs[op.k].mode;
      r.segs[op.k] = { ...r.segs[op.k], mode: m };
      r.segs[op.k + 1] = { ...r.segs[op.k + 1], mode: m };
      return { e: r };
    }
    case "mode": {
      segs[op.k] = provisoire(wps[op.k], fin(op.k), op.mode);
      return { e: { ...e, segs }, ks: [op.k] };
    }
    case "boucler": {
      if (e.boucle) return { e: { ...e, boucle: false, segs: segs.slice(0, -1) } };
      if (wps.length < 2) return null;
      return { e: { ...e, boucle: true, segs: [...segs, provisoire(wps.at(-1), wps[0], mode)] }, ks: [n] };
    }
    case "ar": {
      if (e.boucle || wps.length < 2) return null;
      return { e: { ...e, wps: [...wps, ...wps.slice(0, -1).reverse()], segs: [...segs, ...[...segs].reverse().map(inverse)] } };
    }
    case "inverser": {
      if (!segs.length) return null;
      const w = e.boucle ? [wps[0], ...wps.slice(1).reverse()] : [...wps].reverse();
      return { e: { ...e, wps: w, segs: [...segs].reverse().map(inverse) } };
    }
    case "remplacer": return { e: op.e };
    default: return null;
  }
}

// Calcul des segments provisoires : d'abord par les chemins (segments voisins en un seul appel,
// les points demandés sont posés sur le chemin), puis les lignes droites depuis ces points
async function recalculer(e, ks, cales = [], { sport }) {
  const segs = [...e.segs], wps = [...e.wps];
  const fin = (k) => T.suivant(e, k);
  const chemins = ks.filter((k) => segs[k].mode !== "droite").sort((a, b) => a - b);
  const groupes = [];
  for (const k of chemins) {
    const g = groupes.at(-1);
    if (g && g.at(-1) === k - 1) g.push(k); else groupes.push([k]);
  }
  for (const g of groupes) {
    const res = await tracerItineraire({ sport, points: [...g.map((k) => wps[k]), wps[fin(g.at(-1))]], sentiers: false });
    T.scinder(res).forEach((s, i) => { segs[g[i]] = { ...s, mode: "chemins" }; });
  }
  for (const w of cales) {
    const prec = w > 0 ? w - 1 : e.boucle ? nb(e) - 1 : null;
    if (prec != null && chemins.includes(prec)) wps[w] = segs[prec].pts.at(-1).slice(0, 2);
    else if (w < nb(e) && chemins.includes(w)) wps[w] = segs[w].pts[0].slice(0, 2);
  }
  for (const k of ks.filter((k) => segs[k].mode === "droite")) {
    const res = await ligneDroiteItineraire({ points: [wps[k], wps[fin(k)]] });
    segs[k] = { pts: res.points, ty: res.points.map(() => "hors"), mode: "droite" };
  }
  return { ...e, wps, segs };
}

function message(err) {
  if (err?.response?.status === 429) return "Beaucoup de calculs d'affilée : patiente quelques secondes.";
  if (err?.code === "ECONNABORTED") return "Le calcul prend trop de temps. Réessaie dans un instant.";
  const d = err?.response?.data?.detail;
  return typeof d === "string" ? d : "Pas de chemin trouvé jusque-là. Essaie un point un peu plus loin, ou passe en ligne droite.";
}

// Un tracé importé (GPX ou sortie du carnet) devient des points de passage modifiables
function depuisTrace(points, terrains, aPied) {
  let pts = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1], p[2] ?? null]);
  if (pts.length > 6000) { const pas = Math.ceil(pts.length / 6000); pts = pts.filter((_, i) => i % pas === 0 || i === pts.length - 1); }
  if (pts.length < 2) return null;
  const boucle = T.distM(pts[0], pts.at(-1)) < 150 && T.cumul(pts).at(-1) > 1000;
  const e = T.decouper({ points: pts, terrains }, boucle, aPied);
  return { ...e, segs: e.segs.map((s) => ({ ...s, mode: "chemins" })) };
}

function lireGpx(texte) {
  const doc = new DOMParser().parseFromString(texte, "application/xml");
  let noeuds = [...doc.getElementsByTagName("trkpt")];
  if (!noeuds.length) noeuds = [...doc.getElementsByTagName("rtept")];
  const points = noeuds.map((n) => {
    const ele = n.getElementsByTagName("ele")[0];
    return [Number(n.getAttribute("lat")), Number(n.getAttribute("lon")), ele ? Math.round(Number(ele.textContent) * 10) / 10 : null];
  });
  return { points, nom: doc.getElementsByTagName("name")[0]?.textContent?.trim() || null };
}

// ── Récap en direct ─────────────────────────────────────────────────────────
function Chiffre({ titre, valeur, unite }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.02em] text-label-2">{titre}</p>
      <p className="text-[19px] md:text-[21px] font-semibold leading-tight chiffres truncate">
        {valeur}<span className="text-[12px] font-medium text-label-2 ml-0.5">{unite}</span>
      </p>
    </div>
  );
}

function BarreSurfaces({ repartition }) {
  if (!repartition) return null;
  const parts = SURFACES.map((t) => [t, repartition[t] ?? 0]).filter(([, v]) => v > 0);
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 rounded-full overflow-hidden bg-remplissage" aria-hidden>
        {parts.map(([t, v]) => <span key={t} style={{ width: `${v}%`, background: TERRAINS[t][1] }} />)}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-label-2 chiffres">
        {parts.map(([t, v]) => (
          <span key={t} className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: TERRAINS[t][1] }} aria-hidden />{v} % {LIBELLES[t]}
          </span>
        ))}
      </p>
    </div>
  );
}

function Recap({ stats, dmoins, temps, dernier, vide }) {
  return (
    <div className="card p-3.5 space-y-2.5">
      <div className="grid grid-cols-[1fr_0.8fr_0.8fr_1.3fr] gap-2">
        <Chiffre titre="Distance" valeur={km(stats?.distance_km ?? 0)} unite="km" />
        <Chiffre titre="D+" valeur={stats?.dplus_m ?? 0} unite="m" />
        <Chiffre titre="D−" valeur={dmoins ?? 0} unite="m" />
        <Chiffre titre="Temps estimé" valeur={temps || "—"} unite="" />
      </div>
      {vide ? (
        <p className="text-[13px] text-label-2">
          {TACTILE ? "Touche" : "Clique sur"} la carte pour placer le départ, puis chaque point de passage.
        </p>
      ) : (
        <>
          <BarreSurfaces repartition={stats?.repartition} />
          {dernier && (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-remplissage px-2.5 py-1 text-[12px] font-semibold chiffres">
              Dernier tronçon : +{km(dernier.distance_km)} km · +{dernier.dplus_m} m
            </p>
          )}
        </>
      )}
    </div>
  );
}

const Outil = ({ onClick, disabled, children, actif, titre }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={titre}
    className={`btn-sm shrink-0 btn ${actif ? "bg-brand text-white" : "bg-remplissage text-label"} disabled:opacity-40`}>
    {children}
  </button>
);

// ── Page ───────────────────────────────────────────────────────────────────
export default function CreerParcours() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const centre = user?.adresse_lat != null && user?.adresse_lon != null ? [user.adresse_lat, user.adresse_lon] : null;
  const [sport, setSport] = useState("trail");
  const [mode, setMode] = useState("chemins");
  const [etat, setEtat] = useState({ e: VIERGE, pile: [], refaire: [], attente: null, erreur: null });
  const etatRef = useRef(etat);
  etatRef.current = etat;
  const [curseur, setCurseur] = useState(null);
  const [pentesIgn, setPentesIgn] = useState(false);
  const [cible, setCible] = useState({ type: "", valeur: "" });
  const [nom, setNom] = useState("");
  const [cadrage, setCadrage] = useState(0);
  const [sortiesOuvertes, setSortiesOuvertes] = useState(false);
  const [info, setInfo] = useState(null);
  const fichier = useRef(null);

  const { data: allures } = useQuery({ queryKey: ["itineraires-allures"], queryFn: getAlluresItineraire, staleTime: 600_000 });
  const { data: sorties } = useQuery({ queryKey: ["itineraires-sorties"], queryFn: getSortiesItineraire, enabled: sortiesOuvertes, staleTime: 300_000 });

  const { e, attente } = etat;
  const valider = (e2, avant) => setEtat((s) => ({ e: e2, pile: [...s.pile, avant].slice(-50), refaire: [], attente: null, erreur: null }));

  const executer = async (op) => {
    const cur = etatRef.current;
    if (cur.attente) return;
    const p = preparer(cur.e, op, mode);
    if (!p) return;
    setInfo(null);
    if (!p.ks?.length) { valider(p.e, cur.e); return; }
    setEtat({ ...cur, e: p.e, attente: { type: "calcul" }, erreur: null });
    try {
      const e2 = await recalculer(p.e, p.ks, p.cales, { sport });
      valider(e2, cur.e);
    } catch (err) {
      setEtat((s) => ({ ...s, e: cur.e, attente: null, erreur: message(err) }));
    }
  };
  const annuler = () => setEtat((s) => (s.pile.length && !s.attente
    ? { ...s, e: s.pile.at(-1), pile: s.pile.slice(0, -1), refaire: [s.e, ...s.refaire], erreur: null } : s));
  const retablir = () => setEtat((s) => (s.refaire.length && !s.attente
    ? { ...s, e: s.refaire[0], pile: [...s.pile, s.e], refaire: s.refaire.slice(1), erreur: null } : s));

  useEffect(() => {
    const f = (ev) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.target.closest?.("input, textarea")) return;
      const k = ev.key.toLowerCase();
      if (k === "z" && !ev.shiftKey) { ev.preventDefault(); annuler(); }
      else if ((k === "z" && ev.shiftKey) || k === "y") { ev.preventDefault(); retablir(); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  // ── Chiffres du tracé ──
  const calc = useMemo(() => {
    if (!e.segs.length) return null;
    const { points, types, etapes } = T.assembler(e);
    const stats = T.decrire(points, types);
    const prof = profil(points);
    const alts = points.map((p) => p[2]).filter((a) => a != null);
    const pentes = T.pentes(prof);
    const horsKm = stats.terrains.filter((t) => t[2] === "hors").reduce((a, t) => a + t[1] - t[0], 0);
    return {
      points, etapes, stats, horsKm,
      dmoins: T.denivele([...points].reverse()),
      altMax: alts.length ? Math.round(Math.max(...alts)) : null,
      penteMax: pentes.length ? Math.round(Math.max(...pentes.map(Math.abs))) : null,
      parSeg: e.segs.map((s) => T.decrire(s.pts, s.ty)),
    };
  }, [e]);
  const stats = calc?.stats;
  const temps = T.duree(T.tempsEstime(stats, allures?.[sport]));
  const dernier = calc?.parSeg.at(-1);

  const edition = useMemo(() => ({ e, attente, surface: true, retirable }), [e, attente]);
  const posCurseur = curseur != null && calc?.points[curseur] ? { pos: calc.points[curseur], c: ORANGE } : null;

  // ── Importer ──
  const remplacer = (e2, nomTrace) => {
    if (!e2) { setEtat((s) => ({ ...s, erreur: "Ce tracé ne contient pas assez de points." })); return; }
    executer({ type: "remplacer", e: e2 });
    if (nomTrace) setNom(nomTrace.slice(0, 120));
    setCadrage((c) => c + 1);
  };
  const importerGpx = async (f) => {
    if (!f) return;
    try {
      const { points, nom: n } = lireGpx(await f.text());
      remplacer(depuisTrace(points, [], A_PIED.includes(sport)), n);
    } catch {
      setEtat((s) => ({ ...s, erreur: "Fichier GPX illisible." }));
    }
  };
  const [chargement, setChargement] = useState(null);
  const partirDe = async (s) => {
    setChargement(s.id);
    try {
      const [t, ter] = await Promise.all([getTrace(s.id), getTerrains(s.id).catch(() => ({ terrains: [] }))]);
      remplacer(depuisTrace(t.points, ter.terrains, A_PIED.includes(sport)), s.titre);
      setSortiesOuvertes(false);
    } catch {
      setEtat((x) => ({ ...x, erreur: "Impossible de charger le tracé de cette sortie." }));
    } finally {
      setChargement(null);
    }
  };

  // ── Enregistrer / exporter ──
  const nomAuto = () => `${e.boucle ? "Boucle" : "Parcours"} ${nomSport(sport).toLowerCase()} ${km(stats?.distance_km ?? 0)} km`;
  const enregistrement = useMutation({
    mutationFn: () => {
      let pts = calc.points, etapes = calc.etapes;
      if (pts.length > 20000) {
        const pas = Math.ceil(pts.length / 20000);
        pts = pts.filter((_, i) => i % pas === 0 || i === pts.length - 1);
        etapes = [];
      }
      return creerFavoriItineraire({
        nom: nom.trim() || nomAuto(), sport, boucle: e.boucle,
        distance_km: stats.distance_km, dplus_m: stats.dplus_m, points: pts,
        terrains: stats.terrains.slice(0, 5000), repartition: stats.repartition,
        etapes: etapes.length <= 100 ? etapes : [], depart: pts[0].slice(0, 2),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["itineraires-favoris"] });
      setInfo("Parcours enregistré dans « Mes parcours ».");
    },
    onError: () => setEtat((s) => ({ ...s, erreur: "Enregistrement impossible. Réessaie dans un instant." })),
  });
  const exporter = () => telecharger({ ...stats, points: calc.points, nom: nom.trim() || undefined }, sport, e.boucle);

  const ok = !!calc && !attente;
  const n = e.wps.length;
  const valeurCible = Number(String(cible.valeur).replace(",", "."));
  const actuel = cible.type === "distance" ? stats?.distance_km ?? 0 : stats?.dplus_m ?? 0;
  const progres = cible.type && valeurCible > 0 ? Math.round((100 * actuel) / valeurCible) : null;

  const panneau = (
    <div className="space-y-5">
      <div>
        <h2 className="entete-liste">Enregistrer</h2>
        <div className="card p-3.5 space-y-3">
          <input className="champ" value={nom} onChange={(ev) => setNom(ev.target.value)} maxLength={120}
            placeholder={calc ? nomAuto() : "Nom du parcours"} aria-label="Nom du parcours" />
          <div className="flex gap-2">
            <button type="button" onClick={exporter} disabled={!ok} className="btn-gris btn-sm flex-1">Exporter GPX</button>
            <button type="button" onClick={() => enregistrement.mutate()} disabled={!ok || enregistrement.isPending}
              className="btn-primaire btn-sm flex-1">
              {enregistrement.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
          {info && (
            <p className="text-[13px] text-ios-green" role="status">
              {info} <Link to="/itineraires/parcours" className="font-semibold underline">Voir</Link>
            </p>
          )}
        </div>
      </div>

      <div>
        <h2 className="entete-liste">Sport</h2>
        <select className="champ" value={sport} onChange={(ev) => setSport(ev.target.value)} aria-label="Sport">
          {SPORTS.map(([k, l, em]) => <option key={k} value={k}>{em} {l}</option>)}
        </select>
        <p className="px-1 pt-1.5 text-[12px] text-label-2">Choix des chemins pour les prochains tronçons et temps estimé.</p>
      </div>

      {e.segs.length > 0 && calc && (
        <div>
          <h2 className="entete-liste">{e.segs.length} tronçon{e.segs.length > 1 ? "s" : ""}</h2>
          {calc.horsKm >= 0.05 && (
            <p className="mb-2 rounded-[12px] bg-ios-orange/15 px-3.5 py-2.5 text-[13px] text-label">
              {km(calc.horsKm)} km hors sentier : vérifie que le passage est praticable et autorisé.
            </p>
          )}
          <div className="card py-0.5 max-h-[320px] overflow-y-auto">
            {e.segs.map((s, k) => (
              <div key={k} className="ligne" style={{ "--inset": "2.75rem" }}>
                <span className="w-6 h-6 rounded-full bg-remplissage text-[12px] font-semibold flex items-center justify-center shrink-0 chiffres">{k + 1}</span>
                <span className="flex-1 min-w-0 text-[14px] chiffres">
                  {km(calc.parSeg[k].distance_km)} km · +{calc.parSeg[k].dplus_m} m
                </span>
                <button type="button" disabled={!!attente || s.provisoire}
                  onClick={() => executer({ type: "mode", k, mode: s.mode === "droite" ? "chemins" : "droite" })}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40 ${s.mode === "droite" ? "bg-[#AF52DE]/15 text-[#AF52DE]" : "bg-remplissage text-label-2"}`}
                  title="Changer le mode de ce tronçon">
                  {s.mode === "droite" ? "Ligne droite" : "Chemins"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="entete-liste">Objectif</h2>
        <div className="card p-3.5 space-y-3">
          <Segmente options={[["", "Aucun"], ["distance", "Distance"], ["dplus", "D+"]]} valeur={cible.type}
            onChange={(t) => setCible({ type: t, valeur: "" })} />
          {cible.type && (
            <>
              <label className="flex items-center gap-2">
                <input className="champ" inputMode="decimal" value={cible.valeur} aria-label="Objectif"
                  onChange={(ev) => setCible({ ...cible, valeur: ev.target.value })}
                  placeholder={cible.type === "distance" ? "15" : "600"} />
                <span className="text-[14px] text-label-2">{cible.type === "distance" ? "km" : "m D+"}</span>
              </label>
              {progres != null && (
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-remplissage overflow-hidden" aria-hidden>
                    <span className="block h-full rounded-full" style={{ width: `${Math.min(100, progres)}%`, background: progres > 105 ? "#FF9500" : ORANGE }} />
                  </div>
                  <p className="text-[12px] text-label-2 chiffres">
                    {cible.type === "distance" ? `${km(actuel)} / ${km(valeurCible)} km` : `${actuel} / ${Math.round(valeurCible)} m D+`} · {progres} %
                    {progres < 100 && ` · reste ${cible.type === "distance" ? `${km(valeurCible - actuel)} km` : `${Math.round(valeurCible - actuel)} m`}`}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <h2 className="entete-liste">Raccourcis</h2>
        <div className="card py-0.5">
          <button type="button" onClick={() => fichier.current?.click()} disabled={!!attente} className="ligne w-full text-left">
            <span className="flex-1 text-[15px]">Importer un GPX</span>
            <span className="text-[18px] text-label-3" aria-hidden>›</span>
          </button>
          <button type="button" onClick={() => setSortiesOuvertes((v) => !v)} disabled={!!attente} className="ligne w-full text-left">
            <span className="flex-1 text-[15px]">Partir d'une sortie</span>
            <span className="text-[18px] text-label-3" aria-hidden>{sortiesOuvertes ? "⌄" : "›"}</span>
          </button>
          {sortiesOuvertes && (
            <div className="max-h-[260px] overflow-y-auto">
              {!sorties && <p className="px-4 py-2 text-[13px] text-label-2">Chargement…</p>}
              {sorties?.length === 0 && <p className="px-4 py-2 text-[13px] text-label-2">Aucune sortie avec un tracé GPS.</p>}
              {sorties?.map((s) => (
                <button type="button" key={s.id} onClick={() => partirDe(s)} disabled={chargement != null}
                  className="ligne w-full text-left !pl-7">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] truncate">{s.titre || "Sortie"}</span>
                    <span className="block text-[12px] text-label-2 chiffres">
                      {new Date(s.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                      {s.distance_km != null && ` · ${km(s.distance_km)} km`}{s.dplus_m != null && ` · ${s.dplus_m} m D+`}
                    </span>
                  </span>
                  {chargement === s.id && <span className="w-4 h-4 rounded-full border-2 border-label-3 border-t-brand animate-spin" aria-hidden />}
                </button>
              ))}
            </div>
          )}
          <div className="ligne">
            <span className="flex-1 min-w-0">
              <span className="block text-[15px]">Pentes &gt; 30°</span>
              <span className="block text-[12px] text-label-2">Carte IGN des pentes raides (France)</span>
            </span>
            <Interrupteur actif={pentesIgn} onChange={setPentesIgn} label="Pentes de plus de 30°" />
          </div>
        </div>
        <input ref={fichier} type="file" accept=".gpx,application/gpx+xml" className="hidden"
          onChange={(ev) => { importerGpx(ev.target.files?.[0]); ev.target.value = ""; }} />
      </div>
    </div>
  );

  return (
    <Page titre="Créer un parcours" sousTitre="Itinéraires" large>
      <div className="grid md:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div className="space-y-3 min-w-0">
          <Recap stats={stats} dmoins={calc?.dmoins} temps={calc ? temps : null} dernier={e.segs.length > 1 ? dernier : null} vide={!n} />

          <div className="space-y-2">
            <Segmente options={MODES} valeur={mode} onChange={setMode} />
            <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-0.5">
              <Outil onClick={annuler} disabled={!etat.pile.length || !!attente} titre="Annuler (Ctrl+Z)">↶ Annuler</Outil>
              <Outil onClick={retablir} disabled={!etat.refaire.length || !!attente} titre="Rétablir (Ctrl+Maj+Z)">↷ Rétablir</Outil>
              <Outil onClick={() => executer({ type: "boucler" })} disabled={!!attente || n < 2} actif={e.boucle}
                titre="Relier le dernier point au départ">⟲ Boucler</Outil>
              <Outil onClick={() => executer({ type: "ar" })} disabled={!!attente || n < 2 || e.boucle} titre="Revenir par le même chemin">⇄ A/R</Outil>
              <Outil onClick={() => executer({ type: "inverser" })} disabled={!!attente || !e.segs.length} titre="Inverser le sens">⇅ Inverser</Outil>
              <Outil onClick={() => executer({ type: "remplacer", e: VIERGE })} disabled={!!attente || !n} titre="Tout effacer">Effacer</Outil>
            </div>
          </div>

          {etat.erreur && <p className="px-1 text-[13px] text-ios-red" role="alert">{etat.erreur}</p>}

          <Carte edition={edition} couleurEdition={ORANGE} onOp={executer} centre={centre}
            pentesIgn={pentesIgn} cadrageEdition={cadrage}
            traceSurvol={calc?.points} onSurvol={TACTILE ? null : setCurseur} curseur={posCurseur} />

          <p className="px-1 text-[12px] text-label-2">
            {TACTILE ? "Touche" : "Clique sur"} la carte pour ajouter un point · fais glisser un point ou le tracé pour le déplacer · {TACTILE ? "touche" : "clique sur"} un point pour le retirer.
          </p>

          {calc && (
            <div className="card px-4 pt-3 pb-3">
              <Profil points={calc.points} couleur={ORANGE} hauteur={100} detail axes terrains={stats.terrains}
                curseur={curseur} onCurseur={setCurseur} entete={(l) => (
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <h3 className="text-[13px] font-semibold uppercase tracking-[0.02em] text-label-2">Profil</h3>
                    <p className="text-[12px] text-label-2 chiffres shrink-0 truncate">
                      {l ? [`${nombre(l.km, 2)} km`, `${Math.round(l.alt)} m`, l.pente != null && `${l.pente > 0 ? "+" : l.pente < 0 ? "−" : ""}${Math.abs(l.pente)} %`, l.terrain]
                        .filter(Boolean).join(" · ")
                        : [calc.altMax != null && `alt. max ${calc.altMax} m`, calc.penteMax != null && `pente max ${calc.penteMax} %`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                )} />
            </div>
          )}
        </div>
        {panneau}
      </div>
    </Page>
  );
}
