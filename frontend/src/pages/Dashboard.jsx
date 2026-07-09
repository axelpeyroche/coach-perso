import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBiometrieRecuperation, getTendancesPhysiologiques, getObjectifCourse, setObjectifCourse } from "../api";
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

// ─── Dashboard ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: physio } = useQuery({
    queryKey: ["tendances", USER_ID],
    queryFn: () => getTendancesPhysiologiques(USER_ID),
  });
  const { data: recup } = useQuery({
    queryKey: ["recuperation", USER_ID],
    queryFn: () => getBiometrieRecuperation(USER_ID),
  });

  const derniereVMA  = physio?.vma?.at(-1);
  const derniereACWA = recup?.acwa?.at(-1);
  const alerteActive = recup?.alerte_active;
  const zones        = derniereVMA?.zones;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Vue d'ensemble de ta progression EPC</p>
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
          <div className="space-y-2">
            {[
              { z: "Z1", label: "Récupération" },
              { z: "Z2", label: "Base aérobie" },
              { z: "Z3", label: "Tempo" },
              { z: "Z4", label: "Seuil" },
              { z: "Z5", label: "VO2max" },
            ].map(({ z, label }) => (
              <div key={z} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${ZONE_COLORS[z]}`} />
                <span className="w-6 text-xs font-semibold text-gray-700 dark:text-gray-300">{z}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 w-28">{label}</span>
                <span className="text-xs font-mono text-gray-800 dark:text-gray-200">
                  {zones[z][0]} – {zones[z][1]} km/h
                </span>
              </div>
            ))}
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
