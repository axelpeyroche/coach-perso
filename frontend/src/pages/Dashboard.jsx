import { useState, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getBiometrieRecuperation, getTendancesPhysiologiques, getObjectifCourse, setObjectifCourse, extraireInfosCourse, getStatutProgramme, initialiserProgramme, supprimerProgramme, resetOnboarding, getProfilFC, patchProfilFC, getAnalyseObjectif, recalibrerProgramme, getPreferences, patchPreferences, getAlerteFatigue, signalerBlessure, getSemaineEnCours, getResumeHebdo } from "../api";
import { useAuth } from "../AuthContext";
import Card from "../components/Card";
import StatTile from "../components/StatTile";
import clsx from "clsx";


const ZONE_COLORS = {
  Z1: "bg-blue-400", Z2: "bg-green-400", Z3: "bg-yellow-400", Z4: "bg-orange-400", Z5: "bg-red-400",
};

// ─── Formulaire objectif course ────────────────────────────────────────────

function FormulaireObjectif({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ nom: "", url: "", date_course: "", distance_km: "", dplus_m: "", objectif_h: "", objectif_min: "", notes: "" });
  const [distancesOptions, setDistancesOptions] = useState([]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const tempsMin = (parseInt(form.objectif_h) || 0) * 60 + (parseInt(form.objectif_min) || 0);

  // Récupération auto des infos depuis l'URL officielle de la course
  const mutExtraire = useMutation({
    mutationFn: () => extraireInfosCourse(form.url.trim()),
    onSuccess: (infos) => {
      setDistancesOptions(infos.distances ?? []);
      setForm(f => ({
        ...f,
        nom: infos.nom || f.nom,
        date_course: infos.date_course || f.date_course,
        distance_km: infos.distance_km != null ? String(infos.distance_km) : f.distance_km,
        dplus_m: infos.dplus_m != null ? String(infos.dplus_m) : f.dplus_m,
      }));
    },
  });

  const mut = useMutation({
    mutationFn: () => {
      if (!tempsMin) throw new Error("Sélectionne un temps objectif");
      return setObjectifCourse({
        nom: form.nom,
        date_course: form.date_course,
        distance_km: parseFloat(form.distance_km),
        dplus_m: form.dplus_m ? parseInt(form.dplus_m) : 0,
        objectif_temps_min: tempsMin,
        notes: form.notes || undefined,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["objectif-course"] }); onClose(); },
  });

  const selectCls = "w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nom de la course</label>
          <input value={form.nom} onChange={e => set("nom", e.target.value)} placeholder="Trail des Crêtes 2026"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Lien officiel de la course <span className="text-gray-400">(optionnel)</span></label>
          <div className="flex gap-2">
            <input value={form.url} onChange={e => set("url", e.target.value)} placeholder="https://…"
              className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            <button type="button"
              onClick={() => mutExtraire.mutate()}
              disabled={mutExtraire.isPending || !form.url.trim()}
              className="shrink-0 px-3 py-2 rounded-xl bg-brand/10 text-brand text-sm font-semibold hover:bg-brand/20 transition-colors disabled:opacity-40">
              {mutExtraire.isPending ? "…" : "Récupérer"}
            </button>
          </div>
          {mutExtraire.isSuccess && (
            <p className={clsx("text-xs mt-1", mutExtraire.data?.trouve ? "text-green-600 dark:text-green-400" : "text-orange-500")}>
              {mutExtraire.data?.trouve
                ? `Infos récupérées : ${[
                    mutExtraire.data.date_course,
                    (mutExtraire.data.distances?.length > 1) ? `${mutExtraire.data.distances.length} distances` : (mutExtraire.data.distance_km ? `${mutExtraire.data.distance_km} km` : null),
                    mutExtraire.data.dplus_m ? `D+ ${mutExtraire.data.dplus_m} m` : null,
                  ].filter(Boolean).join(" · ")}. Vérifie et corrige si besoin.`
                : "Aucune info détectée automatiquement — remplis les champs à la main."}
            </p>
          )}
          {mutExtraire.isError && (
            <p className="text-xs mt-1 text-red-500">{mutExtraire.error?.response?.data?.detail ?? "Impossible de récupérer les infos"}</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Date (jj/mm/aaaa)</label>
          <input value={form.date_course} onChange={e => set("date_course", e.target.value)} placeholder="15/10/2026"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Distance (km){distancesOptions.length > 1 && " — choisis"}</label>
          {distancesOptions.length > 1 ? (
            <select value={form.distance_km} onChange={e => set("distance_km", e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="">— Choisir</option>
              {distancesOptions.map(d => <option key={d} value={d}>{d} km</option>)}
            </select>
          ) : (
            <input type="number" step="0.1" value={form.distance_km} onChange={e => set("distance_km", e.target.value)} placeholder="21"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Dénivelé D+ (m)</label>
          <input type="number" value={form.dplus_m} onChange={e => set("dplus_m", e.target.value)} placeholder="500 (optionnel)"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Objectif de temps</label>
          <div className="flex items-center gap-2">
            <select value={form.objectif_h} onChange={e => set("objectif_h", e.target.value)} className={selectCls}>
              <option value="">— h</option>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>{i} h</option>
              ))}
            </select>
            <select value={form.objectif_min} onChange={e => set("objectif_min", e.target.value)} className={selectCls}>
              <option value="">— min</option>
              {Array.from({ length: 60 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, "0")} min</option>
              ))}
            </select>
          </div>
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
        <button onClick={() => mut.mutate()} disabled={mut.isPending || !form.nom || !form.date_course || !form.distance_km || !tempsMin}
          className="flex-1 py-2 rounded-xl bg-brand text-white font-semibold text-sm disabled:opacity-50">
          {mut.isPending ? "..." : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

// ─── Helpers allures ────────────────────────────────────────────────────────

function kmhToPace(kmh) {
  if (!kmh || kmh <= 0) return "—";
  const totalSec = 3600 / kmh;
  const min = Math.floor(totalSec / 60);
  const sec = Math.round(totalSec % 60);
  return `${min}:${String(sec).padStart(2, "0")}/km`;
}

// Milieu de zone → allure représentative
const ALLURES_VMA = {
  z2: 0.70,   // milieu Z2 (65–75%)
  z4: 0.90,   // milieu Z4 (85–95%)
  z5: 1.025,  // fractionné Z5 (VO2max, ~102% VMA) — aligné avec le backend analyse-objectif
};

// ─── Bloc objectif course ───────────────────────────────────────────────────

function BlocObjectif({ vma }) {
  const [edit, setEdit] = useState(false);
  const { data: obj, isLoading } = useQuery({ queryKey: ["objectif-course"], queryFn: () => getObjectifCourse() });

  const alluresVMA = vma ? {
    z2: kmhToPace(vma * ALLURES_VMA.z2),
    z4: kmhToPace(vma * ALLURES_VMA.z4),
    z5: kmhToPace(vma * ALLURES_VMA.z5),
  } : null;

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
              { label: "EF / Z2", val: alluresVMA?.z2 ?? obj.allures.z2, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
              { label: "Seuil / Z4", val: alluresVMA?.z4 ?? obj.allures.z4, color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
              { label: "Fraco / Z5", val: alluresVMA?.z5 ?? obj.allures.z5, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
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

// ─── Analyse objectif : VMA cible vs actuelle ──────────────────────────────

const FAISABILITE_STYLE = {
  "atteignable":   { badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",  icon: "✅" },
  "ambitieux":     { badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", icon: "🎯" },
  "challenge":     { badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", icon: "🔥" },
  "très ambitieux":{ badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",          icon: "⚡" },
};

function BlocAnalyseObjectif() {
  const qc = useQueryClient();
  const { data: analyse, isLoading } = useQuery({
    queryKey: ["analyse-objectif"],
    queryFn: getAnalyseObjectif,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  const mut = useMutation({
    mutationFn: recalibrerProgramme,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["analyse-objectif"] });
      alert(`Recalibration OK — VMA ${data.vma} km/h\nZ2 : ${data.allures.Z2} · Z4 : ${data.allures.Z4} · Z5 : ${data.allures.Z5}\n${data.seances_mises_a_jour} séance(s) mises à jour.`);
    },
    onError: (e) => alert(e?.response?.data?.detail ?? "Erreur recalibration"),
  });

  if (isLoading || !analyse?.objectif) return null;

  const { vma_actuelle, vma_requise, delta_vma, faisabilite, allures_entrainement, volume_pic_cible, temps_predit_min } = analyse;

  function fmtMin(min) {
    if (!min) return null;
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${min} min`;
  }
  const fs = FAISABILITE_STYLE[faisabilite] ?? FAISABILITE_STYLE["challenge"];

  return (
    <Card title="">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Analyse coach</p>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Objectif atteignable ?</h3>
          </div>
          <span className={clsx("text-xs font-semibold px-2.5 py-1 rounded-full shrink-0", fs.badge)}>
            {fs.icon} {faisabilite}
          </span>
        </div>

        {/* VMA gap */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
            <p className="text-xs text-gray-400 mb-1">VMA actuelle</p>
            <p className="text-lg font-black text-gray-900 dark:text-white">
              {vma_actuelle ? `${vma_actuelle.toFixed(1)}` : "—"}
            </p>
            <p className="text-xs text-gray-400">km/h</p>
          </div>
          <div className="rounded-xl bg-brand/5 dark:bg-brand/10 border border-brand/20 p-3">
            <p className="text-xs text-gray-400 mb-1">Delta</p>
            <p className={clsx("text-lg font-black", delta_vma === null ? "text-gray-400" : delta_vma <= 0 ? "text-green-600 dark:text-green-400" : "text-orange-500")}>
              {delta_vma === null ? "—" : delta_vma > 0 ? `+${delta_vma.toFixed(1)}` : delta_vma.toFixed(1)}
            </p>
            <p className="text-xs text-gray-400">km/h</p>
          </div>
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
            <p className="text-xs text-gray-400 mb-1">VMA cible</p>
            <p className="text-lg font-black text-brand">{vma_requise ? vma_requise.toFixed(1) : "—"}</p>
            <p className="text-xs text-gray-400">km/h</p>
          </div>
        </div>

        {/* Allures actuelles */}
        {allures_entrainement && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Tes allures d'entraînement</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { z: "Z2", label: "EF / Z2",    color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
                { z: "Z4", label: "Seuil / Z4", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
                { z: "Z5", label: "Frac. / Z5", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
              ].map(({ z, label, color }) => (
                <div key={z} className={clsx("rounded-xl px-3 py-2 text-center", color)}>
                  <p className="text-xs font-medium opacity-80">{label}</p>
                  <p className="text-sm font-bold font-mono">{allures_entrainement[z]}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prédiction chrono */}
        {temps_predit_min && (
          <div className="rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 px-3 py-2.5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-indigo-500 dark:text-indigo-400 font-medium">Temps prédit (VMA actuelle)</p>
              <p className="text-base font-black text-indigo-800 dark:text-indigo-200">{fmtMin(temps_predit_min)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Objectif visé</p>
              <p className="text-base font-black text-gray-700 dark:text-gray-200">{analyse.objectif.objectif_temps_str}</p>
            </div>
          </div>
        )}

        {/* Volume & recalibration */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-gray-400">
            Volume pic cible : <span className="font-semibold text-gray-700 dark:text-gray-300">{volume_pic_cible} km/sem</span>
          </p>
          <button
            onClick={() => { if (window.confirm("Recalibrer les allures des séances de course avec ta VMA actuelle ?")) mut.mutate(); }}
            disabled={mut.isPending || !vma_actuelle}
            className="text-xs text-brand border border-brand/30 hover:bg-brand/10 px-3 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-40"
          >
            {mut.isPending ? "Recalibration…" : "Recalibrer allures"}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ─── Bloc fusionné : Objectif + Analyse (allures affichées une seule fois) ───

function BlocObjectifComplet({ vma }) {
  const [edit, setEdit] = useState(false);
  const qc = useQueryClient();
  const { data: obj, isLoading } = useQuery({ queryKey: ["objectif-course"], queryFn: () => getObjectifCourse() });
  const { data: analyse } = useQuery({ queryKey: ["analyse-objectif"], queryFn: getAnalyseObjectif, staleTime: 5 * 60 * 1000, retry: 0 });

  const mut = useMutation({
    mutationFn: recalibrerProgramme,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["analyse-objectif"] });
      alert(`Recalibration OK — VMA ${data.vma} km/h\nZ2 : ${data.allures.Z2} · Z4 : ${data.allures.Z4} · Z5 : ${data.allures.Z5}\n${data.seances_mises_a_jour} séance(s) mises à jour.`);
    },
    onError: (e) => alert(e?.response?.data?.detail ?? "Erreur recalibration"),
  });

  if (isLoading) return null;

  if (edit || !obj) {
    return (
      <Card title={obj ? "Modifier l'objectif" : "Prochain objectif course 🎯"}>
        <FormulaireObjectif onClose={() => setEdit(false)} />
      </Card>
    );
  }

  const urgence = obj.jours_restants <= 14 ? "text-red-500" : obj.jours_restants <= 30 ? "text-orange-500" : "text-brand";
  const a = analyse?.objectif ? analyse : null;
  // Allures d'entraînement : source unique = backend (évite l'incohérence d'arrondi)
  const allures = a?.allures_entrainement;
  const fs = a?.faisabilite ? (FAISABILITE_STYLE[a.faisabilite] ?? FAISABILITE_STYLE["challenge"]) : null;

  function fmtMin(min) {
    if (!min) return null;
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${min} min`;
  }

  return (
    <Card title="">
      <div className="space-y-4">
        {/* En-tête objectif */}
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

        {/* Objectif temps + allure cible */}
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

        {/* Objectif atteignable ? */}
        {a && (
          <>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Objectif atteignable ?</p>
              {fs && (
                <span className={clsx("text-xs font-semibold px-2.5 py-1 rounded-full shrink-0", fs.badge)}>
                  {fs.icon} {a.faisabilite}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
                <p className="text-xs text-gray-400 mb-1">VMA actuelle</p>
                <p className="text-lg font-black text-gray-900 dark:text-white">{a.vma_actuelle ? a.vma_actuelle.toFixed(1) : "—"}</p>
                <p className="text-xs text-gray-400">km/h</p>
              </div>
              <div className="rounded-xl bg-brand/5 dark:bg-brand/10 border border-brand/20 p-3">
                <p className="text-xs text-gray-400 mb-1">Delta</p>
                <p className={clsx("text-lg font-black", a.delta_vma === null ? "text-gray-400" : a.delta_vma <= 0 ? "text-green-600 dark:text-green-400" : "text-orange-500")}>
                  {a.delta_vma === null ? "—" : a.delta_vma > 0 ? `+${a.delta_vma.toFixed(1)}` : a.delta_vma.toFixed(1)}
                </p>
                <p className="text-xs text-gray-400">km/h</p>
              </div>
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
                <p className="text-xs text-gray-400 mb-1">VMA cible</p>
                <p className="text-lg font-black text-brand">{a.vma_requise ? a.vma_requise.toFixed(1) : "—"}</p>
                <p className="text-xs text-gray-400">km/h</p>
              </div>
            </div>
          </>
        )}

        {/* Allures d'entraînement — affichées UNE seule fois */}
        {(allures || obj.allures) && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Allures d'entraînement</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { z: "Z2", val: allures?.Z2 ?? obj.allures.z2, label: "EF / Z2",    color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
                { z: "Z4", val: allures?.Z4 ?? obj.allures.z4, label: "Seuil / Z4", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
                { z: "Z5", val: allures?.Z5 ?? obj.allures.z5, label: "Frac. / Z5", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
              ].map(({ z, val, label, color }) => (
                <div key={z} className={clsx("rounded-xl px-3 py-2 text-center", color)}>
                  <p className="text-xs font-medium opacity-80">{label}</p>
                  <p className="text-sm font-bold font-mono">{val}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prédiction chrono */}
        {a?.temps_predit_min && (
          <div className="rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 px-3 py-2.5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-indigo-500 dark:text-indigo-400 font-medium">Temps prédit (VMA actuelle)</p>
              <p className="text-base font-black text-indigo-800 dark:text-indigo-200">{fmtMin(a.temps_predit_min)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Objectif visé</p>
              <p className="text-base font-black text-gray-700 dark:text-gray-200">{a.objectif.objectif_temps_str}</p>
            </div>
          </div>
        )}

        {/* Volume + recalibrer */}
        {a && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-gray-400">
              Volume pic cible : <span className="font-semibold text-gray-700 dark:text-gray-300">{a.volume_pic_cible} km/sem</span>
            </p>
            <button
              onClick={() => { if (window.confirm("Recalibrer les allures des séances de course avec ta VMA actuelle ?")) mut.mutate(); }}
              disabled={mut.isPending || !a.vma_actuelle}
              className="text-xs text-brand border border-brand/30 hover:bg-brand/10 px-3 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-40"
            >
              {mut.isPending ? "Recalibration…" : "Recalibrer allures"}
            </button>
          </div>
        )}

        {obj.notes && <p className="text-xs text-gray-400 italic">{obj.notes}</p>}

        <button onClick={() => setEdit(true)}
          className="w-full text-xs text-gray-400 hover:text-brand dark:hover:text-brand transition-colors py-1">
          Modifier l'objectif →
        </button>
      </div>
    </Card>
  );
}

// ─── Score de forme ─────────────────────────────────────────────────────────

function ScoreForme({ forme }) {
  if (!forme) return null;
  const { score, message } = forme;
  const couleur = score >= 75 ? "#22c55e" : score >= 50 ? "#eab308" : score >= 30 ? "#f97316" : "#ef4444";
  // Jauge circulaire SVG
  const r = 34, c = 2 * Math.PI * r;
  return (
    <Card title="">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: 84, height: 84 }}>
          <svg width="84" height="84" viewBox="0 0 84 84">
            <circle cx="42" cy="42" r={r} fill="none" stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeWidth="8" />
            <circle cx="42" cy="42" r={r} fill="none" stroke={couleur} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
              transform="rotate(-90 42 42)" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-black text-gray-900 dark:text-white">{score}</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Forme du jour</p>
          <p className="text-sm font-bold text-gray-900 dark:text-white mt-0.5">{message}</p>
          <p className="text-xs text-gray-400 mt-1">Calculé depuis ta charge d'entraînement (ACWA) et tes RPE récents.</p>
        </div>
      </div>
    </Card>
  );
}

// ─── Jauge semaine en cours ─────────────────────────────────────────────────

function JaugeSemaine() {
  const { data } = useQuery({ queryKey: ["semaine-en-cours"], queryFn: getSemaineEnCours, staleTime: 5 * 60 * 1000 });
  const s = data?.semaine;
  if (!s) return null;
  const pctKm = s.km_prevu > 0 ? Math.min(100, (s.km_fait / s.km_prevu) * 100) : 0;
  const pctSeances = s.seances_prevues > 0 ? Math.min(100, (s.seances_faites / s.seances_prevues) * 100) : 0;
  return (
    <Card title={`📅 Semaine ${s.numero_semaine} en cours`}>
      <div className="space-y-3">
        {s.km_prevu > 0 && (
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">Kilomètres course</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">{s.km_fait} <span className="text-gray-400 font-normal">/ {s.km_prevu} km</span></span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pctKm}%` }} />
            </div>
          </div>
        )}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Séances validées</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">{s.seances_faites} <span className="text-gray-400 font-normal">/ {s.seances_prevues}</span></span>
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pctSeances}%` }} />
          </div>
        </div>

        {/* Détail par type : ce qu'il reste à créer / planifier / valider */}
        {s.objectifs?.length > 0 && (
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 space-y-1.5">
            {s.objectifs.map(o => {
              const icon = o.type === "course" ? "🏃" : o.type === "velo" ? "🚴" : "💪";
              const enPlus = o.en_plus ?? 0;
              // Type non prévu dans le profil (cible=0) : ligne "supplémentaire" uniquement
              if (o.cible === 0) {
                return (
                  <div key={o.type} className="flex items-center justify-between text-xs gap-2">
                    <span className="text-gray-600 dark:text-gray-300 shrink-0">{icon} <span className="capitalize">{o.label}</span> <span className="text-gray-400">{o.validees}/{o.creees}</span></span>
                    <span className="text-purple-500 dark:text-purple-400 font-medium">+{enPlus} hors programme</span>
                  </div>
                );
              }
              const manques = [];
              if (o.a_creer > 0)     manques.push(`${o.a_creer} à créer`);
              if (o.a_planifier > 0) manques.push(`${o.a_planifier} à planifier`);
              if (o.a_valider > 0)   manques.push(`${o.a_valider} à valider`);
              return (
                <div key={o.type} className="flex items-center justify-between text-xs gap-2">
                  <span className="text-gray-600 dark:text-gray-300 shrink-0">{icon} <span className="capitalize">{o.label}</span> <span className="text-gray-400">{o.validees}/{o.cible}</span></span>
                  <span className="text-right flex items-center gap-1.5">
                    {enPlus > 0 && (
                      <span className="text-purple-500 dark:text-purple-400 font-medium">+{enPlus} en plus</span>
                    )}
                    {manques.length > 0
                      ? <span className="text-orange-500 dark:text-orange-400 font-medium">{manques.join(" · ")}</span>
                      : enPlus === 0 && <span className="text-green-600 dark:text-green-400 font-medium">✓ complet</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-gray-400">
          {s.jours_restants} jour{s.jours_restants > 1 ? "s" : ""} restant{s.jours_restants > 1 ? "s" : ""} · phase {s.macrophase}
        </p>
      </div>
    </Card>
  );
}

// ─── Résumé hebdo ───────────────────────────────────────────────────────────

function ResumeHebdo() {
  const { data } = useQuery({ queryKey: ["resume-hebdo"], queryFn: getResumeHebdo, staleTime: 30 * 60 * 1000 });
  const r = data?.resume;
  if (!r || r.seances_faites === 0) return null;
  return (
    <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 px-4 py-3">
      <p className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 uppercase tracking-wide">Bilan semaine {r.numero_semaine}</p>
      <p className="text-sm text-indigo-900 dark:text-indigo-200 mt-1">
        <strong>{r.km} km</strong> · {r.seances_faites}/{r.seances_prevues} séances
        {r.rpe_moyen != null ? <> · RPE moyen <strong>{r.rpe_moyen}</strong></> : null}
        {r.delta_km != null ? <> · {r.delta_km >= 0 ? "+" : ""}{r.delta_km} km vs sem. précédente</> : null}
      </p>
      <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{r.message}</p>
    </div>
  );
}

// ─── Alerte Fatigue RPE ────────────────────────────────────────────────────

function AlerteFatigueRPE() {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery({
    queryKey: ["alerte-fatigue"],
    queryFn: getAlerteFatigue,
    staleTime: 10 * 60 * 1000,
    retry: 0,
  });
  if (!data?.alerte || dismissed) return null;
  return (
    <div className="rounded-2xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 px-4 py-3 flex items-start gap-3">
      <span className="text-xl shrink-0">🔥</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-orange-800 dark:text-orange-300">Fatigue accumulée détectée</p>
        <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">{data.message}</p>
        <p className="text-xs text-orange-500 dark:text-orange-500 mt-1 font-medium">Envisage une semaine de décharge ou quelques jours de repos actif.</p>
      </div>
      <button onClick={() => setDismissed(true)} className="text-orange-400 hover:text-orange-600 text-xl leading-none shrink-0">×</button>
    </div>
  );
}

// ─── Modal Blessure ─────────────────────────────────────────────────────────

function BlessureModal({ onClose }) {
  const qc = useQueryClient();
  const [duree, setDuree] = useState(7);
  const [desc, setDesc] = useState("");
  const mut = useMutation({
    mutationFn: () => signalerBlessure(duree, desc || undefined),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["toutes-semaines"] });
      qc.invalidateQueries({ queryKey: ["semaine-courante"] });
      onClose();
      const fin = new Date(data.fin_blessure);
      const finStr = fin.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
      alert(`Blessure enregistrée — repos affiché dans le calendrier jusqu'au ${finStr}.`);
    },
    onError: (e) => alert(e?.response?.data?.detail ?? "Erreur lors de la mise à jour"),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">🩹 Signaler une blessure</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Combien de temps de repos est nécessaire ? Les séances sur cette période seront adaptées.</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { val: 3, label: "3 jours" },
            { val: 7, label: "1 semaine" },
            { val: 14, label: "2 semaines" },
            { val: 28, label: "4 semaines" },
          ].map(({ val, label }) => (
            <button key={val} onClick={() => setDuree(val)}
              className={clsx("py-2.5 rounded-xl text-sm font-medium border transition-colors",
                duree === val
                  ? "bg-brand text-white border-brand"
                  : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-brand/50")}>
              {label}
            </button>
          ))}
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Zone touchée (optionnel)</label>
          <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Cheville, genou, dos..."
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Annuler
          </button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors">
            {mut.isPending ? "Mise à jour…" : "Confirmer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Reconfigurer ─────────────────────────────────────────────────────

function ModalReconfigurer({ onClose }) {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lundis = useMemo(() => prochainLundis(16), []);
  const [view, setView] = useState("choice"); // "choice" | "modifier" | "reset-confirm"
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [seancesMuscu, setSeancesMuscu] = useState(2);
  const [freqTests, setFreqTests] = useState(8);

  const { data: prefs } = useQuery({
    queryKey: ["preferences"],
    queryFn: getPreferences,
    onSuccess: (d) => {
      setSeancesMuscu(d.seances_muscu_semaine ?? 2);
      setFreqTests(d.frequence_tests_semaines ?? 8);
    },
  });

  // Pré-remplir avec les préférences actuelles dès que disponibles
  const prefsLoaded = useRef(false);
  if (prefs && !prefsLoaded.current) {
    prefsLoaded.current = true;
    setSeancesMuscu(prefs.seances_muscu_semaine ?? 2);
    setFreqTests(prefs.frequence_tests_semaines ?? 8);
  }

  const mutModifier = useMutation({
    mutationFn: async () => {
      await patchPreferences({ seances_muscu_semaine: seancesMuscu, frequence_tests_semaines: freqTests });
      return initialiserProgramme(toApiDate(lundis[selectedIdx]));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["statut-programme"] });
      qc.invalidateQueries({ queryKey: ["macrocycles"] });
      qc.invalidateQueries({ queryKey: ["preferences"] });
      onClose();
    },
  });

  const mutReset = useMutation({
    mutationFn: () => resetOnboarding(),
    onSuccess: (userData) => {
      setUser(userData);
      navigate("/onboarding");
    },
    onError: (e) => alert(e?.response?.data?.detail ?? "Erreur lors de la suppression du programme"),
  });

  const inputCls = "w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>

        {view === "choice" && (
          <>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Reconfigurer le programme</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Comment veux-tu modifier ton programme ?</p>
            </div>
            <button
              onClick={() => setView("modifier")}
              className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 hover:border-brand hover:bg-brand/5 transition-colors group"
            >
              <p className="font-semibold text-gray-900 dark:text-white group-hover:text-brand">Modifier les réglages</p>
              <p className="text-xs text-gray-400 mt-0.5">Changer la date, les séances muscu ou la fréquence des tests</p>
            </button>
            <button
              onClick={() => setView("reset-confirm")}
              className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors group"
            >
              <p className="font-semibold text-gray-900 dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400">Recommencer de zéro</p>
              <p className="text-xs text-gray-400 mt-0.5">Reprendre l'onboarding complet — toutes les données seront supprimées</p>
            </button>
            <button onClick={onClose} className="w-full text-xs text-gray-400 hover:text-gray-600 py-1">Annuler</button>
          </>
        )}

        {view === "modifier" && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={() => setView("choice")} className="text-gray-400 hover:text-gray-600 text-lg leading-none">←</button>
              <h3 className="text-base font-bold text-gray-900 dark:text-white">Modifier les réglages</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Date de début (lundi)</label>
                <select value={selectedIdx} onChange={e => setSelectedIdx(Number(e.target.value))} className={inputCls}>
                  {lundis.map((d, i) => <option key={i} value={i}>{formatDate(d)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Séances muscu / semaine</label>
                <div className="flex gap-2">
                  {[1, 2, 3].map(n => (
                    <button key={n} onClick={() => setSeancesMuscu(n)}
                      className={clsx("flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors",
                        seancesMuscu === n
                          ? "border-brand bg-brand text-white"
                          : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-brand"
                      )}>{n}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tests d'évaluation toutes les…</label>
                <div className="flex gap-2 flex-wrap">
                  {[4, 6, 8, 12].map(n => (
                    <button key={n} onClick={() => setFreqTests(n)}
                      className={clsx("flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors",
                        freqTests === n
                          ? "border-brand bg-brand text-white"
                          : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-brand"
                      )}>{n} sem.</button>
                  ))}
                </div>
              </div>
            </div>

            {mutModifier.isError && (
              <p className="text-xs text-red-500">{mutModifier.error?.response?.data?.detail ?? "Erreur de génération"}</p>
            )}

            <button
              onClick={() => mutModifier.mutate()}
              disabled={mutModifier.isPending}
              className="w-full py-3 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand/90 transition-colors disabled:opacity-50"
            >
              {mutModifier.isPending ? "Génération en cours…" : "Régénérer le programme"}
            </button>
            <button onClick={onClose} className="w-full text-xs text-gray-400 hover:text-gray-600 py-1">Annuler</button>
          </>
        )}

        {view === "reset-confirm" && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={() => setView("choice")} className="text-gray-400 hover:text-gray-600 text-lg leading-none">←</button>
              <h3 className="text-base font-bold text-gray-900 dark:text-white">Recommencer de zéro</h3>
            </div>
            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
              <p className="text-sm text-red-700 dark:text-red-400">
                Cette action supprime ton programme et toutes tes séances générées. Ton historique d'évaluations est conservé.
              </p>
            </div>
            <button
              onClick={() => mutReset.mutate()}
              disabled={mutReset.isPending}
              className="w-full py-3 rounded-xl bg-red-500 text-white font-semibold text-sm hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {mutReset.isPending ? "Suppression…" : "Confirmer — tout supprimer"}
            </button>
            <button onClick={onClose} className="w-full text-xs text-gray-400 hover:text-gray-600 py-1">Annuler</button>
          </>
        )}
      </div>
    </div>
  );
}

function ReconfigurerBtn() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-brand transition-colors mt-1">
        Reconfigurer →
      </button>
      {open && <ModalReconfigurer onClose={() => setOpen(false)} />}
    </>
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
    mutationFn: () => initialiserProgramme(toApiDate(dateSelectionnee)),
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

// ─── Bornes zones (% VMA) ───────────────────────────────────────────────────
const BORNES_VMA = {
  Z1: [0.60, 0.65], Z2: [0.65, 0.75], Z3: [0.75, 0.85],
  Z4: [0.85, 0.95], Z5: [0.95, 1.00],
};

function karvonen(fcMax, fcRepos, pct) {
  return Math.round((fcMax - fcRepos) * pct + fcRepos);
}

// Formule Excel : TEMPS(0; 60/(VMA*pct); (60/(VMA*pct) - ENT(60/(VMA*pct)))*60)
function vmaToAllure(vma, pct) {
  if (!vma || !pct) return "—";
  const minKm = 60 / (vma * pct);
  const min = Math.floor(minKm);
  const sec = Math.round((minKm - min) * 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

// ─── Modal config FC ────────────────────────────────────────────────────────

function ModalFC({ profil, onClose }) {
  const qc = useQueryClient();
  const [fcMax, setFcMax]     = useState(profil?.fc_max ?? "");
  const [fcRepos, setFcRepos] = useState(profil?.fc_repos ?? "");

  const mut = useMutation({
    mutationFn: () => patchProfilFC({
      fc_max:   fcMax   ? parseInt(fcMax)   : undefined,
      fc_repos: fcRepos ? parseInt(fcRepos) : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["profil-fc"] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900 dark:text-white">Profil cardio</h3>

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Cardio</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "FC max (bpm)", val: fcMax, set: setFcMax, ph: "192" },
              { label: "FC repos (bpm)", val: fcRepos, set: setFcRepos, ph: "55" },
            ].map(({ label, val, set, ph }) => (
              <div key={label}>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                <input type="number" placeholder={ph} value={val} onChange={e => set(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
              </div>
            ))}
          </div>
          {fcMax && fcRepos && (
            <p className="text-xs text-gray-400 mt-2">
              Réserve cardiaque : <strong className="text-gray-700 dark:text-gray-200">{parseInt(fcMax) - parseInt(fcRepos)} bpm</strong>
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">Annuler</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className="px-5 py-2 rounded-xl bg-brand text-white font-semibold text-sm disabled:opacity-50">
            {mut.isPending ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal poids seul (même fenêtre que le "+" du graphique dans Stats) ──────
function ModalPoids({ profil, onClose }) {
  const qc = useQueryClient();
  const { setUser } = useAuth();
  const [poids, setPoids] = useState(profil?.poids_kg ? String(profil.poids_kg) : "");
  const mut = useMutation({
    mutationFn: () => patchProfilFC({ poids_kg: parseFloat(poids) }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["profil-fc"] });
      qc.invalidateQueries({ queryKey: ["historique-poids"] });
      // Met à jour le poids dans les infos personnelles (AuthContext)
      setUser(u => u ? { ...u, poids_kg: data.poids_kg } : u);
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-xs p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900 dark:text-white">Nouveau poids</h3>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Poids (kg)</label>
          <input type="number" step="0.1" autoFocus placeholder="72.5" value={poids} onChange={e => setPoids(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500">Annuler</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending || !parseFloat(poids)}
            className="flex-1 py-2 rounded-xl bg-brand text-white font-semibold text-sm disabled:opacity-50">
            {mut.isPending ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  const qc = useQueryClient();
  const [showModalFC, setShowModalFC] = useState(false);
  const [showModalPoids, setShowModalPoids] = useState(false);

  const { data: physio } = useQuery({
    queryKey: ["tendances", undefined],
    queryFn: () => getTendancesPhysiologiques(),
  });
  const { data: recup } = useQuery({
    queryKey: ["recuperation", undefined],
    queryFn: () => getBiometrieRecuperation(),
  });
  const { data: statut, isLoading: loadingStatut } = useQuery({
    queryKey: ["statut-programme", undefined],
    queryFn: () => getStatutProgramme(),
  });
  const { data: objectifCourse } = useQuery({
    queryKey: ["objectif-course", undefined],
    queryFn: () => getObjectifCourse(),
  });
  const { data: profilFC } = useQuery({
    queryKey: ["profil-fc", undefined],
    queryFn: () => getProfilFC(),
  });

  const derniereVMA  = physio?.vma?.at(-1);
  const derniereACWA = recup?.acwa?.at(-1);
  const alerteActive = recup?.alerte_active;
  const [showBlessureModal, setShowBlessureModal] = useState(false);
  const zones        = derniereVMA?.zones;
  const programmExiste = statut?.programme_existe;

  // Recalcule les zones FC avec Karvonen si fc_max + fc_repos disponibles
  const zonesFCKarvonen = useMemo(() => {
    const vma = derniereVMA?.valeur;
    const fcMax = profilFC?.fc_max;
    const fcRepos = profilFC?.fc_repos;
    if (!vma || !fcMax || !fcRepos) return null;
    return Object.fromEntries(
      Object.entries(BORNES_VMA).map(([z, [pMin, pMax]]) => [
        z, [karvonen(fcMax, fcRepos, pMin), karvonen(fcMax, fcRepos, pMax)],
      ])
    );
  }, [derniereVMA, profilFC]);

  if (loadingStatut) return null;

  // Si aucun programme → afficher uniquement le setup
  if (!programmExiste) {
    return (
      <div className="p-4 md:p-8 w-full space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Bienvenue</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure ton programme d'entraînement pour commencer.</p>
        </div>
        <BlocObjectif vma={null} />
        <SetupProgramme objectifCourse={objectifCourse} onDone={() => qc.invalidateQueries({ queryKey: ["statut-programme"] })} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 w-full space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Vue d'ensemble de ta progression</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowBlessureModal(true)}
            className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5 rounded-xl transition-colors font-medium">
            🩹 Signaler une blessure
          </button>
          <ReconfigurerBtn />
        </div>
      </div>

      {/* Alertes fatigue RPE */}
      <AlerteFatigueRPE />

      {/* Bilan de la semaine passée */}
      <ResumeHebdo />

      {/* Forme du jour + progression de la semaine */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ScoreForme forme={recup?.forme} />
        <JaugeSemaine />
      </div>

      {showBlessureModal && <BlessureModal onClose={() => setShowBlessureModal(false)} />}

      {alerteActive && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Risque de blessure détecté</p>
            <p className="text-sm text-red-600 dark:text-red-300 mt-0.5">{recup?.message_alerte}</p>
          </div>
        </div>
      )}

      {/* Objectif + analyse coach fusionnés (allures affichées une seule fois) */}
      <BlocObjectifComplet vma={derniereVMA?.valeur ?? null} />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="VMA actuelle"    value={derniereVMA ? `${derniereVMA.valeur} km/h` : "—"} sub="Demi-Cooper"   color="green" />
        <StatTile label="Poids"           value={profilFC?.poids_kg ? `${profilFC.poids_kg} kg` : "—"} sub={<button onClick={() => setShowModalPoids(true)} className="text-brand hover:underline">Mettre à jour</button>} color="blue" />
        <div className="rounded-2xl p-4 backdrop-blur-xl bg-orange-400/20 dark:bg-orange-500/12 text-orange-800 dark:text-orange-300 border border-orange-300/50 dark:border-orange-400/15">
          <p className="text-xs font-medium opacity-70 mb-1">Km cette semaine</p>
          <div className="grid grid-cols-2 divide-x divide-orange-300/40 dark:divide-orange-400/20">
            <div className="flex flex-col items-center text-center pr-2">
              <p className="text-[11px] opacity-60">🏃 course</p>
              <p className="text-xl font-bold leading-tight">{derniereACWA ? (derniereACWA.km_course ?? 0) : "—"}</p>
            </div>
            <div className="flex flex-col items-center text-center pl-2">
              <p className="text-[11px] opacity-60">🚴 vélo</p>
              <p className="text-xl font-bold leading-tight">{derniereACWA ? (derniereACWA.km_velo ?? 0) : "—"}</p>
            </div>
          </div>
        </div>
        <StatTile label="Ratio ACWA"      value={derniereACWA?.ratio ?? "—"} sub={derniereACWA?.alerte_risque ? "⚠️ Élevé" : "Normal"} color={derniereACWA?.alerte_risque ? "red" : "purple"} />
      </div>

      {/* Zones */}
      {zones && (
        <Card
          title="Zones de vitesse actuelles"
          action={
            <button onClick={() => setShowModalFC(true)}
              className="shrink-0 text-xs text-brand border border-brand/30 hover:bg-brand/10 px-2.5 py-1 rounded-lg transition-colors font-medium">
              ⚙ Profil {profilFC?.fc_max ? `${profilFC.fc_max}/${profilFC.fc_repos ?? "?"}` : "configurer"}
            </button>
          }
        >
          <div className="space-y-0">
            {[
              { z: "Z1", label: "Récup." },
              { z: "Z2", label: "Aérobie" },
              { z: "Z3", label: "Tempo" },
              { z: "Z4", label: "Seuil" },
              { z: "Z5", label: "VO2max" },
            ].map(({ z, label }) => {
              const [pMin, pMax] = BORNES_VMA[z];
              const vma = derniereVMA?.valeur;
              const allureMax = vmaToAllure(vma, pMin);
              const allureMin = vmaToAllure(vma, pMax);
              const fc = zonesFCKarvonen?.[z] ?? derniereVMA?.zones_fc?.[z];
              return (
                <div key={z} className="flex items-center gap-2 py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${ZONE_COLORS[z]}`} />
                  <span className="w-7 text-xs font-bold text-gray-700 dark:text-gray-300 shrink-0">{z}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 w-14 shrink-0">{label}</span>
                  <span className="text-xs font-mono text-gray-700 dark:text-gray-300 flex-1">
                    {allureMax}–{allureMin}<span className="text-gray-400 dark:text-gray-500">/km</span>
                  </span>
                  <span className="text-xs font-mono text-gray-500 dark:text-gray-400 text-right shrink-0">
                    {fc?.[0] && fc?.[1] ? `${fc[0]}–${fc[1]}` : "—"}
                  </span>
                </div>
              );
            })}
            {zonesFCKarvonen && (
              <p className="text-xs text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800">
                Karvonen — réserve {profilFC.fc_max - profilFC.fc_repos} bpm
              </p>
            )}
          </div>
        </Card>
      )}
      {showModalFC && <ModalFC profil={profilFC} onClose={() => setShowModalFC(false)} />}
      {showModalPoids && <ModalPoids profil={profilFC} onClose={() => setShowModalPoids(false)} />}

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
