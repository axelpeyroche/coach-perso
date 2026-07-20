import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { getToutesSemaines, journaliserSeance, validerRPE, getProfilFC, supprimerJournal, modifierJournal, planifierSeance, creerEvaluation, enregistrerDemiCooper, enregistrerMax1Min, enregistrerAmrapBenchmark, getExercicesEvaluation, getHistoriqueEvaluations, modifierEvaluation, supprimerEvaluation } from "../api";
import clsx from "clsx";


// ─── Constantes ────────────────────────────────────────────────────────────

const TYPE_ICONS   = { COURSE: "🏃", AMRAP: "🔥", EMOM: "⏱️", EVALUATION: "🎯", DECHARGE: "🧘", REPOS: "😴", GYM_UPPER: "💪", GYM_LOWER: "🦵", GYM_FULL: "🏋️", BLESSURE: "🩹" };
const GYM_TYPES    = ["GYM_UPPER", "GYM_LOWER", "GYM_FULL"];
const GYM_LABEL    = { GYM_UPPER: "Upper Body", GYM_LOWER: "Lower Body", GYM_FULL: "Full Body" };
const GYM_COLOR    = { GYM_UPPER: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400", GYM_LOWER: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", GYM_FULL: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400" };
const PHASE_LABEL  = { surcharge: "Surcharge ↑", decharge: "Décharge ↓", evaluation: "Évaluation ★" };
const PHASE_COLORS = {
  surcharge:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  decharge:   "bg-blue-100  text-blue-700  dark:bg-blue-900/30  dark:text-blue-400",
  evaluation: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};
const ZONE_PILL = {
  Z1: "bg-gray-100   text-gray-500  dark:bg-gray-800  dark:text-gray-400",
  Z2: "bg-green-100  text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Z3: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  Z4: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  Z5: "bg-red-100    text-red-700   dark:bg-red-900/30  dark:text-red-400",
};
const RPE_COLOR = ["","text-green-400","text-green-500","text-green-600","text-yellow-400",
  "text-yellow-500","text-yellow-600","text-orange-400","text-orange-500","text-red-400","text-red-500"];
const RPE_LABEL = ["","Facile","Facile","Facile","Modéré",
  "Modéré","Modéré","Difficile","Difficile","Maximum","Maximum"];

function fmt(min) {
  if (!min) return null;
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h${m ? String(m).padStart(2,"0") : ""}` : `${min} min`;
}

// ─── Zones FC (Karvonen) ───────────────────────────────────────────────────
const BORNES_PCT = {
  Z1: [0.60, 0.65], Z2: [0.65, 0.75], Z3: [0.75, 0.85],
  Z4: [0.85, 0.95], Z5: [0.95, 1.00],
};

function calcZonesFC(fcMax, fcRepos) {
  if (!fcMax || !fcRepos) return null;
  return Object.fromEntries(
    Object.entries(BORNES_PCT).map(([z, [lo, hi]]) => [
      z,
      [Math.round((fcMax - fcRepos) * lo + fcRepos), Math.round((fcMax - fcRepos) * hi + fcRepos)],
    ])
  );
}

function signalCorrelationRPEFC(rpe, fcMoy, zone, zonesFC) {
  if (!rpe || !fcMoy || !zone || !zonesFC?.[zone]) return null;
  const [fcMin, fcMax] = zonesFC[zone];
  const ratio = fcMoy / ((fcMin + fcMax) / 2); // rapport FC réelle / FC cible milieu zone
  if (rpe <= 4 && ratio > 1.08) return { label: "FC élevée pour RPE bas", color: "text-orange-500" };
  if (rpe >= 7 && ratio < 0.92) return { label: "FC basse pour RPE élevé", color: "text-blue-500" };
  if (fcMoy > fcMax + 5)        return { label: "FC au-dessus de la zone", color: "text-red-500" };
  return null;
}

// ─── Formulaire évaluation ─────────────────────────────────────────────────

// ─── Formulaire édition évaluation ─────────────────────────────────────────

function FormulaireEditEvaluation({ seance, onClose }) {
  const qc = useQueryClient();
  const evalType = detectEvalType(seance.titre);

  const { data: historiqueData } = useQuery({
    queryKey: ["evaluations-historique"],
    queryFn: getHistoriqueEvaluations,
  });
  const { data: mouvements = [] } = useQuery({
    queryKey: ["exercices-evaluation"],
    queryFn: getExercicesEvaluation,
    enabled: evalType === "max1min",
  });

  // Trouver l'évaluation correspondant à la date de la séance
  const datePlanifiee = seance.date_planifiee; // "YYYY-MM-DD"
  const historique = historiqueData?.evaluations ?? [];
  const ev = historique.find(e => e.date === datePlanifiee) ?? historique[0] ?? null;

  const [distance, setDistance] = useState("");
  const [fcMax, setFcMax]       = useState("");
  const [amrap, setAmrap]       = useState("");
  const [reps, setReps]         = useState({});

  // Initialiser les champs quand l'évaluation est trouvée
  const [initialized, setInitialized] = useState(false);
  if (ev && !initialized) {
    if (evalType === "cooper" && ev.distance_m != null) setDistance(String(ev.distance_m));
    if (evalType === "amrap" && ev.amrap_tours != null) setAmrap(String(ev.amrap_tours));
    if (evalType === "max1min" && ev.max_1min.length > 0)
      setReps(Object.fromEntries(ev.max_1min.map(m => [m.nom, String(m.reps)])));
    setInitialized(true);
  }

  const saveMut = useMutation({
    mutationFn: () => {
      if (!ev) return Promise.resolve();
      const payload = {};
      if (evalType === "cooper" && distance) payload.distance_metres = parseFloat(distance);
      if (evalType === "amrap" && amrap)     payload.amrap_tours = parseFloat(amrap);
      if (evalType === "max1min" && ev.max_1min.length > 0)
        payload.max_1min = ev.max_1min.map(m => ({
          exercice_id: m.exercice_id,
          repetitions: parseInt(reps[m.nom] ?? m.reps),
        }));
      return modifierEvaluation(ev.id, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["evaluations-historique"] });
      qc.invalidateQueries({ queryKey: ["tendances"] });
      onClose();
    },
  });

  if (!ev) return (
    <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 px-4 py-4 text-center text-sm text-gray-400">
      Évaluation introuvable pour cette date.
      <button onClick={onClose} className="ml-3 text-xs text-brand underline">Fermer</button>
    </div>
  );

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 px-4 py-4 space-y-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Modifier les résultats — {ev.date.split("-").reverse().join("/")}</p>

      {evalType === "cooper" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Distance (m)</label>
            <input type="number" value={distance} onChange={e => setDistance(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            {distance && <p className="text-xs text-brand mt-1">VMA → {(parseFloat(distance)/100).toFixed(1)} km/h</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">FC max (optionnel)</label>
            <input type="number" placeholder="192" value={fcMax} onChange={e => setFcMax(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
        </div>
      )}

      {evalType === "amrap" && (
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">AMRAP 10' (tours)</label>
          <input type="number" step="0.1" value={amrap} onChange={e => setAmrap(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
      )}

      {evalType === "max1min" && ev.max_1min.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {ev.max_1min.map(m => (
            <div key={m.nom}>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 truncate">{m.nom}</label>
              <input type="number" value={reps[m.nom] ?? ""} onChange={e => setReps(r => ({ ...r, [m.nom]: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          ))}
        </div>
      )}

      {evalType === "max1min" && ev.max_1min.length === 0 && mouvements.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {mouvements.map(m => (
            <div key={m.slug}>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 truncate">{m.nom}</label>
              <input type="number" value={reps[m.nom] ?? ""} onChange={e => setReps(r => ({ ...r, [m.nom]: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center gap-2">
        <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          Annuler
        </button>
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          className="px-6 py-2.5 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50">
          {saveMut.isPending ? "..." : "Enregistrer ✓"}
        </button>
      </div>
      {saveMut.isError && <p className="text-xs text-red-500 text-center">Erreur — réessaie.</p>}
    </div>
  );
}


function detectEvalType(titre) {
  const t = (titre || "").toLowerCase();
  if (t.includes("cooper") || t.includes("vma")) return "cooper";
  if (t.includes("max") && t.includes("min") || t.includes("1 min") || t.includes("1min")) return "max1min";
  if (t.includes("amrap") || t.includes("benchmark") || t.includes("circuit")) return "amrap";
  return "cooper"; // fallback
}

function FormulaireEvaluation({ seance, onClose, onDone }) {
  const qc = useQueryClient();
  const evalType = detectEvalType(seance.titre);

  const { data: mouvements = [] } = useQuery({
    queryKey: ["exercices-evaluation"],
    queryFn: getExercicesEvaluation,
    enabled: evalType === "max1min",
  });

  const [distance, setDistance] = useState("");
  const [fcMax, setFcMax]       = useState("");
  const [reps, setReps]         = useState({});
  const [tours, setTours]       = useState("");
  const [rpe, setRpe]           = useState(7);
  const [notes, setNotes]       = useState("");

  const RPE_LABEL = { 1:"Très facile",2:"Facile",3:"Modéré",4:"Assez facile",5:"Moyen",6:"Un peu difficile",7:"Difficile",8:"Très difficile",9:"Extrêmement difficile",10:"Maximum" };
  const RPE_COLOR = { 1:"text-green-500",2:"text-green-500",3:"text-green-500",4:"text-lime-500",5:"text-yellow-500",6:"text-orange-400",7:"text-orange-500",8:"text-red-500",9:"text-red-600",10:"text-red-700" };

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const { id: evalId } = await creerEvaluation({ est_induction: false });

      if (evalType === "cooper" && distance) {
        await enregistrerDemiCooper(evalId, {
          distance_metres: parseFloat(distance),
          fc_max: fcMax ? parseInt(fcMax) : undefined,
        });
      }

      if (evalType === "max1min") {
        const repsPayload = mouvements
          .filter(m => reps[m.slug])
          .map(m => ({ exercice_id: m.id, repetitions_realisees: parseInt(reps[m.slug]) }));
        if (repsPayload.length > 0) await enregistrerMax1Min(evalId, repsPayload);
      }

      if (evalType === "amrap" && tours) {
        await enregistrerAmrapBenchmark(evalId, { tours_completes: parseFloat(tours) });
      }

      await journaliserSeance(seance.id, { rpe, notes: notes || undefined });

      qc.invalidateQueries({ queryKey: ["toutes-semaines"] });
      qc.invalidateQueries({ queryKey: ["evaluations-historique"] });
      onDone();
    } catch (e) {
      setError("Erreur — réessaie.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 px-4 py-4 space-y-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Résultats de l'évaluation</p>

      {/* Demi-Cooper */}
      {evalType === "cooper" && (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">🏃 Demi-Cooper</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Distance (m)</label>
            <input type="number" placeholder="1450" value={distance} onChange={e => setDistance(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            {distance && <p className="text-xs text-brand mt-1">VMA → {(parseFloat(distance)/100).toFixed(1)} km/h</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">FC max (optionnel)</label>
            <input type="number" placeholder="192" value={fcMax} onChange={e => setFcMax(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
        </div>
      </div>
      )}

      {/* Max 1 min */}
      {evalType === "max1min" && mouvements.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">💪 Max 1 min</p>
          <div className="grid grid-cols-2 gap-2">
            {mouvements.map(m => (
              <div key={m.slug}>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 truncate">{m.nom}</label>
                <input type="number" min={0} placeholder="reps" value={reps[m.slug] ?? ""}
                  onChange={e => setReps(r => ({ ...r, [m.slug]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white text-center focus:outline-none focus:ring-2 focus:ring-brand" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AMRAP */}
      {evalType === "amrap" && (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">🔥 AMRAP 10 min</p>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tours (ex. 2.9)</label>
          <input type="number" step="0.1" placeholder="2.9" value={tours} onChange={e => setTours(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
      </div>
      )}

      {/* RPE */}
      <div>
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Effort perçu (RPE)</span>
          <span className={clsx("text-sm font-bold", RPE_COLOR[Math.round(rpe)])}>{rpe}/10 — {RPE_LABEL[Math.round(rpe)]}</span>
        </div>
        <input type="range" min={1} max={10} step={0.5} value={rpe} onChange={e => setRpe(parseFloat(e.target.value))} className="w-full accent-brand" />
        <div className="flex justify-between text-xs text-gray-400 mt-0.5"><span>1 facile</span><span>10 max</span></div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="Sensations, conditions, observations..."
          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-brand" />
      </div>

      <div className="flex justify-between items-center gap-2">
        <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          Annuler
        </button>
        <button onClick={handleSubmit} disabled={saving}
          className="px-6 py-2.5 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50">
          {saving ? "Enregistrement..." : "Valider ✓"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 text-center">{error}</p>}
    </div>
  );
}


// ─── Formulaire de journalisation ──────────────────────────────────────────

function FormulaireLog({ seance, onClose, onDone, modeEdit = false }) {
  const qc = useQueryClient();
  const prefill = !modeEdit && seance.journal && !seance.journal.completee;
  const j = seance.journal;
  const [rpe, setRpe]     = useState(modeEdit && j?.rpe ? j.rpe : 7);
  const [notes, setNotes] = useState(modeEdit && j?.notes ? j.notes : "");
  const [champs, set_]    = useState(() => modeEdit && j ? {
    duree_reelle_min:   j.duree_reelle_min   ?? "",
    distance_reelle_km: j.distance_reelle_km ?? "",
    dplus_reel_m:       j.dplus_reel_m       ?? "",
    fc_moyenne_bpm:     j.fc_moyenne_bpm     ?? "",
    fc_max_bpm:         j.fc_max_bpm         ?? "",
  } : {});
  const setC = (k, v) => set_(c => ({ ...c, [k]: v }));

  const isCourse = seance.type === "COURSE";
  const isMuscu  = seance.type === "AMRAP" || seance.type === "EMOM";
  const isGym    = GYM_TYPES.includes(seance.type);

  // Détection séance seuil/fractionné : COURSE en Z4 ou Z5 avec pattern N×D min
  const mIntervalles = seance.titre?.match(/(\d+)\s*[×x\*]\s*(\d+)\s*min/i);
  const isIntervalles = isCourse && (seance.zone_cible === "Z4" || seance.zone_cible === "Z5") && !!mIntervalles;
  const nbBlocs = isIntervalles ? parseInt(mIntervalles[1]) : 0;
  const dureeBloc = isIntervalles ? parseInt(mIntervalles[2]) : 0;

  // Blocs intervalles : [{distance_km, fc_moyenne_bpm}]
  const [blocs, setBlocs] = useState(() => {
    if (modeEdit && j?.details_intervalles) {
      try {
        const parsed = JSON.parse(j.details_intervalles);
        return parsed.map(b => ({ distance_km: b.distance_km ?? "", fc_moyenne_bpm: b.fc_moyenne_bpm ?? "" }));
      } catch {}
    }
    return Array.from({ length: nbBlocs }, () => ({ distance_km: "", fc_moyenne_bpm: "" }));
  });
  const [distRepos, setDistRepos] = useState(() => {
    if (!modeEdit || j?.distance_repos_km == null) return "";
    const v = Math.round(j.distance_repos_km * 100) / 100;
    return String(v);
  });
  const [typeCourse, setTypeCourse] = useState(() => (modeEdit && j?.type_course) ? j.type_course : "route");
  const setBloc = (i, k, v) => setBlocs(b => b.map((bloc, idx) => idx === i ? { ...bloc, [k]: v } : bloc));

  const mut = useMutation({
    mutationFn: () => {
      if (prefill) return validerRPE(seance.id, rpe, notes || undefined);
      const nums = Object.fromEntries(
        Object.entries(champs).filter(([,v]) => v !== "").map(([k,v]) => [k, Number(v)])
      );
      let detailsIntervalles = undefined;
      if (isIntervalles) {
        detailsIntervalles = JSON.stringify(blocs.map(b => {
          const distKm = parseFloat(b.distance_km) || 0;
          const vitesse = dureeBloc > 0 && distKm > 0 ? distKm / (dureeBloc / 60) : null;
          return {
            distance_km: distKm || null,
            fc_moyenne_bpm: parseInt(b.fc_moyenne_bpm) || null,
            vitesse_kmh: vitesse ? Math.round(vitesse * 10) / 10 : null,
          };
        }));
        if (distRepos) nums.distance_repos_km = parseFloat(distRepos);
      }
      const payload = { rpe, notes: notes || undefined, ...nums, details_intervalles: detailsIntervalles, ...(isCourse ? { type_course: typeCourse } : {}) };
      if (modeEdit) return modifierJournal(seance.id, payload);
      return journaliserSeance(seance.id, payload);
    },
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ["toutes-semaines"] }); if (!modeEdit) onDone(data?.conseil_recuperation); else onDone(); },
  });

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 px-4 py-4 space-y-4">

      {/* COURSE SEUIL / FRACTIONNÉ : blocs par répétition */}
      {isIntervalles && (
        <div className="space-y-3">
          {blocs.map((bloc, i) => {
            const distKm = parseFloat(bloc.distance_km);
            const vitesse = dureeBloc > 0 && distKm > 0 ? Math.round((distKm / (dureeBloc / 60)) * 10) / 10 : null;
            return (
              <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Répétition {i + 1} / {nbBlocs}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Distance (km)</label>
                    <input type="number" step="0.01" placeholder="2.1"
                      value={bloc.distance_km}
                      onChange={e => setBloc(i, "distance_km", e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
                    {vitesse && <p className="text-xs text-brand mt-1">→ {vitesse} km/h</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">FC moy (bpm)</label>
                    <input type="number" placeholder="160"
                      value={bloc.fc_moyenne_bpm}
                      onChange={e => setBloc(i, "fc_moyenne_bpm", e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
                  </div>
                </div>
              </div>
            );
          })}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Distance récupération totale (km)</label>
            <input type="number" step="0.01" placeholder="0.8"
              value={distRepos}
              onChange={e => setDistRepos(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
        </div>
      )}

      {/* Sélecteur Route / Trail pour toutes les séances COURSE */}
      {isCourse && (
        <div className="flex gap-2">
          {["route", "trail"].map(t => (
            <button key={t} type="button" onClick={() => setTypeCourse(t)}
              className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${typeCourse === t ? "bg-brand text-white border-brand" : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-brand hover:text-brand"}`}>
              {t === "route" ? "🛣️ Route" : "🏔️ Trail"}
            </button>
          ))}
        </div>
      )}

      {/* COURSE CLASSIQUE : métriques manuelles */}
      {isCourse && !isIntervalles && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: "duree_reelle_min",   label: "Durée (min)",   ph: "40" },
            { key: "distance_reelle_km", label: "Distance (km)", ph: "6.2" },
            { key: "dplus_reel_m",       label: "D+ (m)",        ph: "50" },
            { key: "fc_moyenne_bpm",     label: "FC moy (bpm)",  ph: "153" },
            { key: "fc_max_bpm",         label: "FC max (bpm)",  ph: "165" },
          ].map(({ key, label, ph }) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
              <input type="number" placeholder={ph}
                value={prefill && seance.journal?.[key] != null ? seance.journal[key] : (champs[key] ?? "")}
                onChange={e => setC(key, e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          ))}
        </div>
      )}

      {/* MUSCULATION : durée + FC moyenne manuelles */}
      {isMuscu && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Durée (min)</label>
            <input type="number" placeholder="45" value={champs.duree_reelle_min ?? ""}
              onChange={e => setC("duree_reelle_min", e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">FC moyenne (bpm)</label>
            <input type="number" placeholder="140" value={champs.fc_moyenne_bpm ?? ""}
              onChange={e => setC("fc_moyenne_bpm", e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
        </div>
      )}

      {/* Slider RPE */}
      <div>
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Effort perçu (RPE)</span>
          <span className={clsx("text-sm font-bold", RPE_COLOR[Math.round(rpe)])}>
            {rpe}/10 — {RPE_LABEL[Math.round(rpe)]}
          </span>
        </div>
        <input type="range" min={1} max={10} step={0.5} value={rpe}
          onChange={e => setRpe(parseFloat(e.target.value))} className="w-full accent-brand" />
        <div className="flex justify-between text-xs text-gray-400 mt-0.5">
          <span>1 facile</span><span>10 max</span>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="Sensations, douleurs, observations..."
          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-brand" />
      </div>

      {/* Boutons */}
      <div className="flex justify-between items-center gap-2">
        <button onClick={onClose}
          className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          Annuler
        </button>
        <button onClick={() => mut.mutate()} disabled={mut.isPending}
          className="px-6 py-2.5 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50">
          {mut.isPending ? "..." : modeEdit ? "Enregistrer ✓" : "Valider ✓"}
        </button>
      </div>
      {mut.isError && <p className="text-xs text-red-500 text-center">Erreur — réessaie.</p>}
    </div>
  );
}

// ─── Carte séance ───────────────────────────────────────────────────────────

// ─── Modal planification ────────────────────────────────────────────────────

const JOURS_COURT = ["L","M","M","J","V","S","D"];
const MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

function PlanificationModal({ seance, onConfirm, onClose }) {
  // Semaine de la séance (lundi → dimanche)
  const seanceDate = new Date((seance.date || seance.date_seance) + "T00:00:00");
  const dow = seanceDate.getDay(); // 0=dim
  const lundiSem = new Date(seanceDate);
  lundiSem.setDate(seanceDate.getDate() - ((dow + 6) % 7));
  const dimancheSem = new Date(lundiSem);
  dimancheSem.setDate(lundiSem.getDate() + 6);

  const [annee, setAnnee]   = useState(lundiSem.getFullYear());
  const [moisIdx, setMois]  = useState(lundiSem.getMonth());
  const [jourSel, setJour]  = useState(null); // "YYYY-MM-DD"
  const [heure, setHeure]   = useState("08");
  const [minute, setMinute] = useState("00");

  const today = new Date(); today.setHours(0,0,0,0);

  function navMois(delta) {
    let m = moisIdx + delta, a = annee;
    if (m < 0)  { m = 11; a--; }
    if (m > 11) { m = 0;  a++; }
    setMois(m); setAnnee(a);
  }

  function dateKey(jour) {
    return `${annee}-${String(moisIdx+1).padStart(2,"0")}-${String(jour).padStart(2,"0")}`;
  }

  function isInSemaine(jour) {
    const d = new Date(annee, moisIdx, jour);
    return d >= lundiSem && d <= dimancheSem;
  }

  function isPasse(jour) {
    return new Date(annee, moisIdx, jour) < today;
  }

  const premierJour = new Date(annee, moisIdx, 1);
  let offset = premierJour.getDay() - 1;
  if (offset < 0) offset = 6;
  const nbJours = new Date(annee, moisIdx + 1, 0).getDate();
  const cellules = [...Array(offset).fill(null), ...Array.from({length: nbJours}, (_,i) => i+1)];

  const jourSelObj = jourSel ? new Date(jourSel + "T00:00:00") : null;
  const jourSelLabel = jourSelObj
    ? jourSelObj.toLocaleDateString("fr-FR", { weekday:"short", day:"numeric", month:"short" })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 max-w-xs w-full shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Planifier</p>
            <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{seance.titre}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">×</button>
        </div>

        {/* Navigation mois */}
        <div className="flex items-center justify-between">
          <button onClick={() => navMois(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">◀</button>
          <p className="text-sm font-semibold text-gray-900 dark:text-white capitalize">{MOIS_FR[moisIdx]} {annee}</p>
          <button onClick={() => navMois(1)}  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">▶</button>
        </div>

        {/* En-têtes jours */}
        <div className="grid grid-cols-7">
          {JOURS_COURT.map((j,i) => <div key={i} className="text-center text-xs font-semibold text-gray-400 py-0.5">{j}</div>)}
        </div>

        {/* Grille */}
        <div className="grid grid-cols-7 gap-0.5">
          {cellules.map((jour, i) => {
            if (!jour) return <div key={`e-${i}`} />;
            const key = dateKey(jour);
            const inSem  = isInSemaine(jour);
            const passe  = isPasse(jour);
            const sel    = jourSel === key;
            return (
              <button key={key} onClick={() => !passe && setJour(sel ? null : key)} disabled={passe}
                className={clsx(
                  "aspect-square flex items-center justify-center rounded-lg text-xs font-medium transition-colors",
                  passe  ? "text-gray-300 dark:text-gray-600 cursor-not-allowed" :
                  sel    ? "bg-brand text-white shadow-sm" :
                  inSem  ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800/50" :
                           "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                )}>
                {jour}
              </button>
            );
          })}
        </div>

        {/* Sélecteur heure */}
        {jourSel && (
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2.5 flex items-center gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">🕐 {jourSelLabel}</span>
            <div className="flex items-center gap-1 ml-auto">
              <select value={heure} onChange={e => setHeure(e.target.value)}
                className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand">
                {Array.from({length:17},(_,i) => String(i+6).padStart(2,"0")).map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="text-gray-400 font-bold">:</span>
              <select value={minute} onChange={e => setMinute(e.target.value)}
                className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand">
                {["00","15","30","45"].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Boutons */}
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Annuler
          </button>
          <button onClick={() => onConfirm(jourSel, `${heure}:${minute}`)} disabled={!jourSel}
            className="flex-1 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-dark disabled:opacity-40 transition-colors">
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}

const CONSEIL_COLORS = {
  facile:      { bg: "bg-green-50 dark:bg-green-900/15", border: "border-green-200 dark:border-green-800", text: "text-green-800 dark:text-green-300", sub: "text-green-600 dark:text-green-400" },
  modere:      { bg: "bg-blue-50 dark:bg-blue-900/15",  border: "border-blue-200 dark:border-blue-800",  text: "text-blue-800 dark:text-blue-300",  sub: "text-blue-600 dark:text-blue-400" },
  intense:     { bg: "bg-orange-50 dark:bg-orange-900/15", border: "border-orange-200 dark:border-orange-800", text: "text-orange-800 dark:text-orange-300", sub: "text-orange-600 dark:text-orange-400" },
  tres_intense:{ bg: "bg-red-50 dark:bg-red-900/15",    border: "border-red-200 dark:border-red-800",    text: "text-red-800 dark:text-red-300",    sub: "text-red-600 dark:text-red-400" },
  depassement: { bg: "bg-red-100 dark:bg-red-900/25",   border: "border-red-300 dark:border-red-700",    text: "text-red-900 dark:text-red-200",    sub: "text-red-700 dark:text-red-400" },
};

function CarteSeance({ seance, zonesFC }) {
  const qc = useQueryClient();
  const [ouvert, setOuvert]         = useState(false);
  const [logOpen, setLogOpen]       = useState(false);
  const [valide, setValide]         = useState(false);
  const [editOpen, setEditOpen]     = useState(false);
  const [conseil, setConseil]       = useState(null);
  const [planifOpen, setPlanifOpen] = useState(false);

  const mutPlanifier = useMutation({
    mutationFn: ({ date_planifiee, heure_planifiee }) => planifierSeance(seance.id, date_planifiee, heure_planifiee),
    onSuccess: () => { setPlanifOpen(false); qc.invalidateQueries({ queryKey: ["toutes-semaines"] }); },
  });

  const isGym = GYM_TYPES.includes(seance.type);
  const fait = valide || seance.journal?.completee;
  const prefillEnAttente = !fait && seance.journal && !seance.journal.completee;

  const mutAnnuler = useMutation({
    mutationFn: async () => {
      await supprimerJournal(seance.id);
      if (seance.type === "EVALUATION") {
        try {
          const data = await getHistoriqueEvaluations();
          const ev = (data?.evaluations ?? []).find(e => e.date === seance.date_planifiee);
          if (ev) await supprimerEvaluation(ev.id);
        } catch {}
      }
    },
    onSuccess: () => {
      setValide(false);
      qc.invalidateQueries({ queryKey: ["toutes-semaines"] });
      qc.invalidateQueries({ queryKey: ["evaluations-historique"] });
    },
  });

  return (
    <div className={clsx(
      "rounded-2xl border-2 overflow-hidden transition-all w-full min-w-0",
      fait
        ? "border-green-400 dark:border-green-600 shadow-[0_0_0_3px_rgba(34,197,94,0.15)]"
        : "border-gray-200 dark:border-gray-700"
    )}>
      {/* ── Ligne principale ── */}
      <div className={clsx(
        "flex items-center gap-3 px-4 py-3",
        fait ? "bg-green-50 dark:bg-green-900/15" : "bg-white dark:bg-gray-900"
      )}>
        <span className="text-xl shrink-0">{TYPE_ICONS[seance.type] ?? "📌"}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug truncate">{seance.titre}</p>
            {fait && <span className="text-green-500 dark:text-green-400 font-bold text-base leading-none shrink-0">✓</span>}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {seance.zone_cible && (
              <span className={clsx("px-1.5 py-0.5 rounded text-xs font-mono font-semibold", ZONE_PILL[seance.zone_cible])}>
                {seance.zone_cible}
              </span>
            )}
            {seance.duree_cible_min && (
              <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                ⏱ {fmt(seance.duree_cible_min)}
              </span>
            )}
            {seance.dplus_cible_m > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                ↑ {seance.dplus_cible_m} m
              </span>
            )}
            {isGym && (
              <span className={clsx("px-1.5 py-0.5 rounded text-xs font-bold", GYM_COLOR[seance.type])}>
                {GYM_LABEL[seance.type]}
              </span>
            )}
            {seance.temps_limite_min && (
              <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand text-xs font-bold">
                {seance.temps_limite_min} min
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {fait ? (
            <>
              <button onClick={() => { setEditOpen(v => !v); setOuvert(false); }}
                className="p-1.5 rounded-lg text-sm text-gray-400 hover:text-brand hover:bg-brand/10 transition-colors" title="Modifier">
                ✏️
              </button>
              <button onClick={() => { if (window.confirm("Annuler cette séance ?")) mutAnnuler.mutate(); }}
                disabled={mutAnnuler.isPending}
                className="p-1.5 rounded-lg text-sm text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40" title="Annuler la validation">
                🗑
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1">
              {/* Planification */}
              {seance.date_planifiee ? (
                <button onClick={() => setPlanifOpen(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors group">
                  <span>📅</span>
                  <span className="hidden sm:inline">
                    {new Date(seance.date_planifiee + "T00:00:00").toLocaleDateString("fr-FR", { weekday:"short", day:"numeric", month:"short" })}
                    {seance.heure_planifiee ? ` ${seance.heure_planifiee}` : ""}
                  </span>
                  <span
                    onClick={e => { e.stopPropagation(); mutPlanifier.mutate({ date_planifiee: null, heure_planifiee: null }); }}
                    className="ml-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all cursor-pointer">
                    ×
                  </span>
                </button>
              ) : (
                <button onClick={() => setPlanifOpen(true)} title="Planifier"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors text-base leading-none">
                  📅
                </button>
              )}
              <button onClick={() => { setLogOpen(v => !v); setOuvert(false); }}
                disabled={!seance.date_planifiee}
                title={!seance.date_planifiee ? "Planifie la séance avant de la valider" : undefined}
                className={clsx(
                  "px-3 py-1.5 rounded-xl text-white text-xs font-semibold transition-colors",
                  !seance.date_planifiee
                    ? "bg-gray-300 dark:bg-gray-600 cursor-not-allowed"
                    : prefillEnAttente
                      ? "bg-orange-500 hover:bg-orange-600"
                      : "bg-brand hover:bg-brand-dark"
                )}>
                Valider
              </button>
            </div>
          )}
          <button onClick={() => { setOuvert(v => !v); setLogOpen(false); setEditOpen(false); }}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <span className={clsx("inline-block transition-transform text-xs", ouvert ? "rotate-180" : "")}>▼</span>
          </button>
        </div>
      </div>

      {/* ── Résumé si loggé ── */}
      {fait && seance.journal && (
        <div className="px-4 py-2 border-t border-green-100 dark:border-green-900/20 bg-green-50/50 dark:bg-green-900/5 space-y-1.5">
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            {seance.journal.rpe && <span>RPE {seance.journal.rpe}/10</span>}
            {seance.journal.fc_moyenne_bpm && <span>FC {seance.journal.fc_moyenne_bpm} bpm</span>}
            {(() => {
              const sig = signalCorrelationRPEFC(
                seance.journal.rpe, seance.journal.fc_moyenne_bpm,
                seance.zone_cible, zonesFC
              );
              return sig ? <span className={clsx("font-semibold", sig.color)}>⚡ {sig.label}</span> : null;
            })()}
            {seance.journal.notes && <span className="truncate italic w-full">{seance.journal.notes}</span>}
          </div>
          {/* Charge réelle vs planifiée */}
          {(seance.journal.duree_reelle_min || seance.journal.distance_reelle_km || seance.journal.dplus_reel_m) && (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
              {seance.duree_cible_min && seance.journal.duree_reelle_min && (
                <span className={clsx("font-medium", seance.journal.duree_reelle_min >= seance.duree_cible_min * 0.9 ? "text-green-600 dark:text-green-400" : "text-orange-500")}>
                  ⏱ {seance.journal.duree_reelle_min} / {seance.duree_cible_min} min
                </span>
              )}
              {seance.journal.distance_reelle_km > 0 && (
                <span className="text-gray-500">📍 {seance.journal.distance_reelle_km} km</span>
              )}
              {seance.dplus_cible_m > 0 && seance.journal.dplus_reel_m > 0 && (
                <span className={clsx("font-medium", seance.journal.dplus_reel_m >= seance.dplus_cible_m * 0.9 ? "text-green-600 dark:text-green-400" : "text-orange-500")}>
                  ↑ {seance.journal.dplus_reel_m} / {seance.dplus_cible_m} m D+
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Conseil récupération ── */}
      {conseil && (() => {
        const c = CONSEIL_COLORS[conseil.niveau] ?? CONSEIL_COLORS.modere;
        return (
          <div className={clsx("px-4 py-3 border-t flex items-start gap-2.5", c.bg, c.border)}>
            <span className="text-base shrink-0">💡</span>
            <div className="flex-1 min-w-0">
              <p className={clsx("text-xs font-semibold", c.text)}>{conseil.titre}</p>
              <p className={clsx("text-xs mt-0.5", c.sub)}>{conseil.conseil}</p>
            </div>
            <button onClick={() => setConseil(null)} className={clsx("text-base leading-none shrink-0", c.sub)}>×</button>
          </div>
        );
      })()}

      {/* ── Formulaire modification ── */}
      {editOpen && fait && seance.type === "EVALUATION" && (
        <FormulaireEditEvaluation seance={seance} onClose={() => setEditOpen(false)} />
      )}
      {editOpen && fait && seance.type !== "EVALUATION" && (
        <FormulaireLog
          seance={seance}
          onClose={() => setEditOpen(false)}
          onDone={() => setEditOpen(false)}
          modeEdit
        />
      )}

      {/* ── Détail séance ── */}
      {ouvert && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-4 space-y-3 bg-white dark:bg-gray-900">

          {/* Exercices */}
          {seance.exercices?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {seance.type === "AMRAP"     ? `Circuit AMRAP ${seance.temps_limite_min} min` :
                 seance.type === "EMOM"      ? `EMOM ${seance.temps_limite_min} min` :
                 isGym                       ? `${GYM_LABEL[seance.type]} — ${seance.temps_limite_min} min` :
                 "Exercices"}
              </p>
              <div className="divide-y divide-gray-50 dark:divide-gray-800 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                {seance.exercices.map((ex, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-900 text-sm gap-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-xs text-gray-400 w-4 shrink-0">{i + 1}.</span>
                      <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{ex.nom}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {ex.duree_bloc_min && seance.type === "EMOM" && (
                        <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold">
                          {ex.duree_bloc_min} min
                        </span>
                      )}
                      {ex.series && ex.repetitions && (
                        <span className="px-2 py-0.5 rounded bg-brand/10 text-brand text-xs font-bold">
                          {ex.series}×{ex.repetitions}
                        </span>
                      )}
                      {!ex.series && ex.repetitions && (
                        <span className="px-2 py-0.5 rounded bg-brand/10 text-brand text-xs font-bold">
                          {ex.repetitions} reps
                        </span>
                      )}
                      {ex.duree_sec && !ex.repetitions && (
                        <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold">
                          {ex.duree_sec}s
                        </span>
                      )}
                      {ex.tempo && <span className="text-xs font-mono text-gray-400">{ex.tempo}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Instructions */}
          {seance.description && (
            <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words font-sans leading-relaxed overflow-hidden">
              {seance.description}
            </p>
          )}
        </div>
      )}

      {/* ── Formulaire log ── */}
      {logOpen && !fait && seance.type === "EVALUATION" && (
        <FormulaireEvaluation seance={seance}
          onClose={() => setLogOpen(false)}
          onDone={() => { setLogOpen(false); setValide(true); }} />
      )}
      {logOpen && !fait && seance.type !== "EVALUATION" && (
        <FormulaireLog seance={seance}
          onClose={() => setLogOpen(false)}
          onDone={(c) => { setLogOpen(false); setValide(true); if (c) setConseil(c); }} />
      )}

      {/* ── Modal planification ── */}
      {planifOpen && (
        <PlanificationModal
          seance={seance}
          onClose={() => setPlanifOpen(false)}
          onConfirm={(date_planifiee, heure_planifiee) => mutPlanifier.mutate({ date_planifiee, heure_planifiee })}
        />
      )}
    </div>
  );
}

// ─── Page principale ────────────────────────────────────────────────────────

function idxSemaineCourante(semaines) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < semaines.length; i++) {
    if (!semaines[i].date_debut) continue;
    const debut = new Date(semaines[i].date_debut);
    const fin   = new Date(debut);
    fin.setDate(fin.getDate() + 7);
    if (today >= debut && today < fin) return i;
  }
  // Pas encore commencé → première semaine ; terminé → dernière
  const premiere = semaines[0]?.date_debut ? new Date(semaines[0].date_debut) : null;
  if (premiere && today < premiere) return 0;
  return semaines.length - 1;
}

export default function Programme() {
  const [semIdx, setSemIdx] = useState(null);

  // Drag-to-scroll — déclaré avant tout early return (règles des hooks)
  const navRef = useRef(null);
  const drag = useRef({ active: false, moved: false, startX: 0, scrollLeft: 0 });
  const onMouseDown = useCallback((e) => {
    const el = navRef.current;
    drag.current = { active: true, moved: false, startX: e.pageX, scrollLeft: el.scrollLeft };
    el.style.cursor = "grabbing";
    el.style.userSelect = "none";
  }, []);
  const stopDrag = useCallback(() => {
    drag.current.active = false;
    if (navRef.current) { navRef.current.style.cursor = "grab"; navRef.current.style.userSelect = ""; }
  }, []);
  const onMouseMove = useCallback((e) => {
    if (!drag.current.active) return;
    const dx = e.pageX - drag.current.startX;
    if (Math.abs(dx) > 3) drag.current.moved = true;
    navRef.current.scrollLeft = drag.current.scrollLeft - dx;
  }, []);

  const qc = useQueryClient();


  const { data, isLoading, error } = useQuery({
    queryKey: ["toutes-semaines"],
    queryFn: () => getToutesSemaines(),
  });
  const { data: profilFC } = useQuery({
    queryKey: ["profil-fc"],
    queryFn: () => getProfilFC(),
  });
  const zonesFC = calcZonesFC(profilFC?.fc_max, profilFC?.fc_repos);

  const semaines = data?.semaines ?? [];
  const idxCourant = idxSemaineCourante(semaines);
  const idx = semIdx !== null ? semIdx : idxCourant;

  // Auto-scroll vers la semaine courante — avant tout early return (règle des hooks)
  useEffect(() => {
    if (!navRef.current || semaines.length === 0) return;
    const btn = navRef.current.querySelectorAll("button")[idxCourant];
    if (btn) btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [idxCourant, semaines.length]);

  if (isLoading) return <Loader />;
  if (error) return <Erreur msg={`Erreur : ${error.message}`} />;
  if (semaines.length === 0)
    return <Erreur msg="Aucun programme. Génère-en un depuis le tableau de bord." />;
  const semaine = semaines[idx];

  const seancesVisibles = semaine?.seances?.filter(s => s.type !== "REPOS") ?? [];
  const nbFaites = seancesVisibles.filter(s => s.journal?.completee).length;

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-5 w-full min-w-0">

      {/* En-tête */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Programme</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {semaines.length} semaines au total
        </p>
      </div>

      {/* Sélecteur semaine — scroll horizontal, drag souris desktop */}
      <div
        ref={navRef}
        className="overflow-x-auto scrollbar-hide -mx-4 px-4 cursor-grab select-none"
        onMouseDown={onMouseDown}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        onMouseMove={onMouseMove}
      >
        <div className="flex gap-2 pb-0.5">
        {semaines.map((s, i) => {
          const nbFait = (s.seances ?? []).filter(x => x.journal?.completee).length;
          const nbTotal = (s.seances ?? []).filter(x => x.type !== "REPOS").length;
          const complet = nbFait === nbTotal && nbTotal > 0;
          const estCourante = i === idxCourant;
          const selectionne = i === idx;
          return (
            <button key={s.semaine_globale} onClick={() => { if (!drag.current.moved) setSemIdx(i); }}
              className={clsx(
                "shrink-0 flex flex-col items-center px-3 py-2 rounded-xl border text-xs font-medium transition-colors",
                selectionne
                  ? "border-brand bg-brand/10 text-brand dark:bg-brand/20"
                  : complet
                  ? "border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400"
                  : estCourante
                  ? "border-brand/40 text-brand dark:text-brand ring-1 ring-brand/30"
                  : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300"
              )}>
              <span className="font-bold">S{s.semaine_globale}</span>
              <span className="opacity-70 mt-0.5">
                {complet ? "✓" : estCourante && !selectionne ? "●" : s.macrophase === "surcharge" ? "↑" : s.macrophase === "decharge" ? "↓" : "★"}
              </span>
            </button>
          );
        })}
        </div>
      </div>

      {semaine && (
        <>
          {/* Titre semaine */}
          <div className="flex items-center gap-3">
            <span className={clsx("px-2.5 py-1 rounded-full text-xs font-semibold", PHASE_COLORS[semaine.macrophase])}>
              {PHASE_LABEL[semaine.macrophase]}
            </span>
            <span className="text-xs text-gray-400">{semaine.date_debut ? semaine.date_debut.split("-").reverse().join("/") : ""}</span>
            {seancesVisibles.length > 0 && (
              <span className="text-xs text-gray-400 ml-auto">{nbFaites}/{seancesVisibles.length} faites</span>
            )}
          </div>

          {/* Séances */}
          <div className="space-y-3">
            {seancesVisibles.length > 0
              ? seancesVisibles.map(s => <CarteSeance key={s.id} seance={s} zonesFC={zonesFC} />)
              : <p className="text-sm text-gray-400 text-center py-8">Aucune séance cette semaine.</p>
            }
          </div>
        </>
      )}
    </div>
  );
}

function Loader() {
  return (
    <div className="p-8 flex items-center justify-center">
      <span className="animate-pulse text-sm text-gray-400">Chargement...</span>
    </div>
  );
}
function Erreur({ msg }) {
  return (
    <div className="p-8 space-y-1">
      <p className="text-sm font-semibold text-red-500">Erreur</p>
      <p className="text-xs text-gray-400">{msg}</p>
    </div>
  );
}
