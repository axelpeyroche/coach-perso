import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBiometrieRecuperation, getTendancesPhysiologiques, getObjectifCourse, setObjectifCourse, getStatutProgramme, initialiserProgramme, supprimerProgramme } from "../api";
import Card from "../components/Card";
import StatTile from "../components/StatTile";
import clsx from "clsx";

const USER_ID = 1;

const ZONE_COLORS = {
  Z1: "bg-blue-400", Z2: "bg-green-400", Z3: "bg-yellow-400", Z4: "bg-orange-400", Z5: "bg-red-400",
};

// ─── Formulaire objectif course ────────────────────────────────────────────

function FormulaireObjectif({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ nom: "", date_course: "", distance_km: "", dplus_m: "", objectif_temps_min: "", notes: "" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Convertit "2h30" ou "150" en minutes
  const parseTemps = (s) => {
    if (!s) return null;
    const hm = s.match(/^(\d+)h(\d{0,2})$/i);
    if (hm) return parseInt(hm[1]) * 60 + (parseInt(hm[2] || "0") || 0);
    const mins = parseInt(s);
    return isNaN(mins) ? null : mins;
  };

  const mut = useMutation({
    mutationFn: () => {
      const temps = parseTemps(form.objectif_temps_min);
      if (!temps) throw new Error("Format temps invalide (ex: 2h30 ou 150)");
      return setObjectifCourse({
        nom: form.nom,
        date_course: form.date_course,
        distance_km: parseFloat(form.distance_km),
        dplus_m: form.dplus_m ? parseInt(form.dplus_m) : 0,
        objectif_temps_min: temps,
        notes: form.notes || undefined,
      }, USER_ID);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["objectif-course"] }); onClose(); },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nom de la course</label>
          <input value={form.nom} onChange={e => set("nom", e.target.value)} placeholder="Trail des Crêtes 2026"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Date (jj/mm/aaaa)</label>
          <input value={form.date_course} onChange={e => set("date_course", e.target.value)} placeholder="15/10/2026"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Distance (km)</label>
          <input type="number" step="0.1" value={form.distance_km} onChange={e => set("distance_km", e.target.value)} placeholder="21"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Dénivelé D+ (m)</label>
          <input type="number" value={form.dplus_m} onChange={e => set("dplus_m", e.target.value)} placeholder="500 (optionnel)"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Objectif (ex: 2h30 ou 150)</label>
          <input value={form.objectif_temps_min} onChange={e => set("objectif_temps_min", e.target.value)} placeholder="2h30"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Notes (optionnel)</label>
          <input value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Contexte, terrain..."
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
      </div>
      {mut.isError && <p className="text-xs text-red-500">{mut.error?.message ?? "Erreur"}</p>}
      <div className="flex gap-2">
        <button onClick={onClose}
          className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500">Annuler</button>
        <button onClick={() => mut.mutate()} disabled={mut.isPending || !form.nom || !form.date_course || !form.distance_km || !form.objectif_temps_min}
          className="flex-1 py-2 rounded-xl bg-brand text-white font-semibold text-sm disabled:opacity-50">
          {mut.isPending ? "..." : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

// ─── Bloc objectif course ───────────────────────────────────────────────────

function BlocObjectif() {
  const [edit, setEdit] = useState(false);
  const { data: obj, isLoading } = useQuery({ queryKey: ["objectif-course"], queryFn: () => getObjectifCourse(USER_ID) });

  if (isLoading) return null;

  if (edit || !obj) {
    return (
      <Card title={obj ? "Modifier l'objectif" : "Prochain objectif course 🎯"}>
        <FormulaireObjectif onClose={() => setEdit(false)} />
      </Card>
    );
  }

  const urgence = obj.jours_restants <= 14 ? "text-red-500" : obj.jours_restants <= 30 ? "text-orange-500" : "text-brand";

  return (
    <Card title="">
      <div className="space-y-4">
        {/* En-tête course */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Prochain objectif</p>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{obj.nom}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {obj.date_course} · {obj.distance_km} km{obj.dplus_m > 0 ? ` · D+ ${obj.dplus_m} m` : ""}
            </p>
          </div>
          <div className="text-center shrink-0">
            <p className={clsx("text-3xl font-black", urgence)}>{obj.jours_restants}</p>
            <p className="text-xs text-gray-400">jours</p>
          </div>
        </div>

        {/* Objectif temps */}
        <div className="rounded-xl bg-brand/5 dark:bg-brand/10 border border-brand/20 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Objectif</p>
            <p className="text-xl font-black text-brand">{obj.objectif_temps_str}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 dark:text-gray-400">Allure cible</p>
            <p className="text-xl font-black text-gray-900 dark:text-white">{obj.allures.course}</p>
          </div>
        </div>

        {/* Allures zones */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Allures d'entraînement</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "EF / Z2", val: obj.allures.z2, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
              { label: "Seuil / Z4", val: obj.allures.z4, color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
              { label: "Fraco / Z5", val: obj.allures.z5, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
            ].map(({ label, val, color }) => (
              <div key={label} className={clsx("rounded-xl px-3 py-2 text-center", color)}>
                <p className="text-xs font-medium opacity-80">{label}</p>
                <p className="text-sm font-bold font-mono">{val}</p>
              </div>
            ))}
          </div>
        </div>

        {obj.notes && <p className="text-xs text-gray-400 italic">{obj.notes}</p>}

        <button onClick={() => setEdit(true)}
          className="w-full text-xs text-gray-400 hover:text-brand dark:hover:text-brand transition-colors py-1">
          Modifier l'objectif →
        </button>
      </div>
    </Card>
  );
}

// ─── Bouton reconfigurer (supprime en DB) ───────────────────────────────────

function ReconfigurerBtn() {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => supprimerProgramme(USER_ID),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["statut-programme"] });
      qc.invalidateQueries({ queryKey: ["macrocycles"] });
    },
  });
  return (
    <button
      onClick={() => { if (window.confirm("Supprimer le programme actuel et tout recréer ?")) mut.mutate(); }}
      disabled={mut.isPending}
      className="text-xs text-gray-400 hover:text-red-500 transition-colors mt-1 disabled:opacity-50"
    >
      {mut.isPending ? "Suppression…" : "Reconfigurer →"}
    </button>
  );
}

// ─── Setup programme ────────────────────────────────────────────────────────

function prochainLundis(n = 16) {
  const lundis = [];
  const today = new Date();
  const diff = (1 - today.getDay() + 7) % 7 || 7; // jours jusqu'au prochain lundi
  let d = new Date(today);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    lundis.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return lundis;
}

function formatDate(d) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function toApiDate(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function SetupProgramme({ objectifCourse, onDone }) {
  const qc = useQueryClient();
  const lundis = useMemo(() => prochainLundis(16), []);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const dateSelectionnee = lundis[selectedIdx];

  // Calcul semaines avant la course depuis la date choisie
  const semainesAvantCourse = useMemo(() => {
    if (!objectifCourse?.date_course) return null;
    const [j, m, a] = objectifCourse.date_course.split("/");
    const dateCourse = new Date(a, m - 1, j);
    return Math.floor((dateCourse - dateSelectionnee) / (7 * 24 * 3600 * 1000));
  }, [objectifCourse, dateSelectionnee]);

  const tooClose = semainesAvantCourse !== null && semainesAvantCourse < 4;

  const nSurcharge = semainesAvantCourse !== null ? Math.max(0, semainesAvantCourse - 3) : null;

  const mut = useMutation({
    mutationFn: () => initialiserProgramme(toApiDate(dateSelectionnee), USER_ID),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["statut-programme"] });
      qc.invalidateQueries({ queryKey: ["macrocycles"] });
      onDone?.();
    },
  });

  return (
    <Card title="Démarrer le programme">
      <div className="space-y-5">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Choisis le lundi de début du programme. Les séances seront générées automatiquement.
        </p>

        {/* Sélecteur de lundi */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Date de début (lundi)</label>
          <select
            value={selectedIdx}
            onChange={e => setSelectedIdx(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {lundis.map((d, i) => (
              <option key={i} value={i}>{formatDate(d)}</option>
            ))}
          </select>
        </div>

        {/* Info course */}
        {objectifCourse ? (
          <div className={clsx(
            "rounded-xl px-4 py-3 border text-sm",
            tooClose
              ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"
              : "bg-brand/5 dark:bg-brand/10 border-brand/20"
          )}>
            <p className="font-semibold">{objectifCourse.nom}</p>
            <p className="text-xs mt-0.5 text-gray-500 dark:text-gray-400">
              {objectifCourse.date_course} · {objectifCourse.distance_km} km
            </p>
            {tooClose ? (
              <p className="text-xs mt-1 font-medium">
                Course dans {semainesAvantCourse} semaine(s) depuis cette date — trop proche (minimum 4 semaines).
              </p>
            ) : (
              <p className="text-xs mt-1 text-gray-600 dark:text-gray-300">
                Course dans <strong>{semainesAvantCourse} semaines</strong> — <strong>{nSurcharge} semaines de build</strong> + 2 de taper + semaine course
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl px-4 py-3 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-600 dark:text-gray-300">
            Aucune course planifiée — programme performance générale sur <strong>24 semaines (3 modules)</strong>.
            <p className="text-xs mt-1 text-gray-400">Tu peux ajouter une course dans "Prochain objectif" pour adapter la durée.</p>
          </div>
        )}

        {/* Résumé */}
        {!tooClose && (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Début", val: toApiDate(dateSelectionnee).replace(/\//g, " / ") },
              { label: "Build", val: semainesAvantCourse !== null ? `${nSurcharge} sem.` : "15 sem." },
              { label: "Total", val: semainesAvantCourse !== null ? `${semainesAvantCourse} sem.` : "24 sem." },
            ].map(({ label, val }) => (
              <div key={label} className="rounded-xl bg-gray-50 dark:bg-gray-800 py-2 px-3">
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white mt-0.5">{val}</p>
              </div>
            ))}
          </div>
        )}

        {mut.isError && (
          <p className="text-xs text-red-500">
            {mut.error?.response?.data?.detail
              || (mut.error?.code === "ECONNABORTED" ? "Timeout — le serveur met trop longtemps à répondre. Réessaie." : null)
              || mut.error?.message
              || "Erreur inconnue"}
          </p>
        )}
        {mut.isSuccess && (
          <p className="text-xs text-green-600 dark:text-green-400">{mut.data?.avertissement ?? "Programme généré !"}</p>
        )}

        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending || tooClose}
          className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm disabled:opacity-40"
        >
          {mut.isPending ? "Génération en cours…" : "Générer le programme"}
        </button>
      </div>
    </Card>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  const qc = useQueryClient();
  const { data: physio } = useQuery({
    queryKey: ["tendances", USER_ID],
    queryFn: () => getTendancesPhysiologiques(USER_ID),
  });
  const { data: recup } = useQuery({
    queryKey: ["recuperation", USER_ID],
    queryFn: () => getBiometrieRecuperation(USER_ID),
  });
  const { data: statut, isLoading: loadingStatut } = useQuery({
    queryKey: ["statut-programme", USER_ID],
    queryFn: () => getStatutProgramme(USER_ID),
  });
  const { data: objectifCourse } = useQuery({
    queryKey: ["objectif-course", USER_ID],
    queryFn: () => getObjectifCourse(USER_ID),
  });

  const derniereVMA  = physio?.vma?.at(-1);
  const derniereACWA = recup?.acwa?.at(-1);
  const alerteActive = recup?.alerte_active;
  const zones        = derniereVMA?.zones;
  const programmExiste = statut?.programme_existe;

  if (loadingStatut) return null;

  // Si aucun programme → afficher uniquement le setup
  if (!programmExiste) {
    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Bienvenue</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure ton programme d'entraînement EPC pour commencer.</p>
        </div>
        <BlocObjectif />
        <SetupProgramme objectifCourse={objectifCourse} onDone={() => qc.invalidateQueries({ queryKey: ["statut-programme"] })} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Vue d'ensemble de ta progression EPC</p>
        </div>
        <ReconfigurerBtn />
      </div>

      {alerteActive && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Risque de blessure détecté</p>
            <p className="text-sm text-red-600 dark:text-red-300 mt-0.5">{recup?.message_alerte}</p>
          </div>
        </div>
      )}

      {/* Objectif course */}
      <BlocObjectif />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="VMA actuelle"    value={derniereVMA ? `${derniereVMA.valeur} km/h` : "—"} sub="Demi-Cooper"   color="green" />
        <StatTile label="Ratio ACWA"      value={derniereACWA?.ratio ?? "—"} sub={derniereACWA?.alerte_risque ? "⚠️ Élevé" : "Normal"} color={derniereACWA?.alerte_risque ? "red" : "blue"} />
        <StatTile label="Km cette semaine" value={derniereACWA ? `${derniereACWA.charge_aigue_km} km` : "—"} sub="Charge aiguë"    color="orange" />
        <StatTile label="Moy. 4 semaines"  value={derniereACWA ? `${derniereACWA.charge_chronique_km} km` : "—"} sub="Charge chronique" color="purple" />
      </div>

      {/* Zones */}
      {zones && (
        <Card title="Zones de vitesse actuelles">
          <div className="space-y-1">
            {/* En-tête colonnes */}
            <div className="flex items-center gap-2 pb-1 border-b border-gray-100 dark:border-gray-800">
              <span className="w-2 shrink-0" />
              <span className="w-6 shrink-0" />
              <span className="text-xs text-gray-400 w-24 shrink-0">Zone</span>
              <span className="text-xs text-gray-400 flex-1 text-center font-mono">km/h</span>
              <span className="text-xs text-gray-400 flex-1 text-center font-mono">min/km</span>
              <span className="text-xs text-gray-400 flex-1 text-center font-mono">bpm</span>
            </div>
            {[
              { z: "Z1", label: "Récupération" },
              { z: "Z2", label: "Aérobie" },
              { z: "Z3", label: "Tempo" },
              { z: "Z4", label: "Seuil" },
              { z: "Z5", label: "VO2max" },
            ].map(({ z, label }) => {
              const pace = derniereVMA?.zones_pace?.[z];
              const fc   = derniereVMA?.zones_fc?.[z];
              return (
                <div key={z} className="flex items-center gap-2 py-1">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${ZONE_COLORS[z]}`} />
                  <span className="w-6 text-xs font-bold text-gray-700 dark:text-gray-300 shrink-0">{z}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 w-24 shrink-0">{label}</span>
                  <span className="text-xs font-mono text-gray-800 dark:text-gray-200 flex-1 text-center">
                    {zones[z][0]}–{zones[z][1]}
                  </span>
                  <span className="text-xs font-mono text-gray-700 dark:text-gray-300 flex-1 text-center">
                    {pace ? `${pace[0]}–${pace[1]}` : "—"}
                  </span>
                  <span className="text-xs font-mono text-gray-700 dark:text-gray-300 flex-1 text-center">
                    {fc?.[0] && fc?.[1] ? `${fc[0]}–${fc[1]}` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {!derniereVMA && !derniereACWA && !zones && (
        <Card title="Démarrer">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Aucune donnée encore. Va dans{" "}
            <strong className="text-brand">Évaluation</strong> pour calculer ta VMA et tes zones.
          </p>
        </Card>
      )}
    </div>
  );
}
