import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { creerActivite, modifierActivite, supprimerActivite } from "../api";
import { SPORTS, sportInfo, parseDuree, dureeVersTexte, inputCls, btnPrimaire, btnSecondaire, SOURCES } from "../carnet";

function maintenantLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function Champ({ label, children, className = "" }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      {children}
    </label>
  );
}

const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));

// Ajout / édition d'une activité du carnet. `activite` = null pour une création.
export default function ModalActivite({ activite, onClose }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => ({
    sport: activite?.sport ?? "course",
    titre: activite?.titre ?? "",
    debut: activite?.debut?.slice(0, 16) ?? maintenantLocal(),
    duree: dureeVersTexte(activite?.duree_sec),
    distance_km: activite?.distance_km ?? "",
    dplus_m: activite?.dplus_m ?? "",
    fc_moyenne_bpm: activite?.fc_moyenne_bpm ?? "",
    fc_max_bpm: activite?.fc_max_bpm ?? "",
    calories: activite?.calories ?? "",
    rpe: activite?.rpe ?? "",
    ressenti: activite?.ressenti ?? "",
    notes: activite?.notes ?? "",
    est_competition: activite?.est_competition ?? false,
  }));
  const [erreur, setErreur] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const invalider = () => {
    ["activites", "stats-carnet", "objectifs"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const enregistrer = useMutation({
    mutationFn: (payload) => (activite ? modifierActivite(activite.id, payload) : creerActivite(payload)),
    onSuccess: () => { invalider(); onClose(); },
    onError: (e) => setErreur(e?.response?.data?.detail?.toString?.() ?? "Erreur lors de l'enregistrement"),
  });

  const supprimer = useMutation({
    mutationFn: () => supprimerActivite(activite.id),
    onSuccess: () => { invalider(); onClose(); },
  });

  function soumettre(e) {
    e.preventDefault();
    const duree_sec = parseDuree(f.duree);
    if (f.duree && duree_sec == null) { setErreur("Durée illisible (ex. 45, 1:05:30 ou 52:10)"); return; }
    if (f.rpe === "") { setErreur("Note ton ressenti d'effort (RPE sur 10) avant d'enregistrer."); return; }
    enregistrer.mutate({
      sport: f.sport,
      titre: f.titre || null,
      debut: f.debut,
      duree_sec,
      distance_km: num(f.distance_km),
      dplus_m: num(f.dplus_m),
      fc_moyenne_bpm: num(f.fc_moyenne_bpm),
      fc_max_bpm: num(f.fc_max_bpm),
      calories: num(f.calories),
      rpe: num(f.rpe),
      ressenti: num(f.ressenti),
      notes: f.notes || null,
      est_competition: f.est_competition,
      objectif_id: activite?.objectif_id ?? null,
      details: activite?.details ?? null,
    });
  }

  const avecDistance = sportInfo(f.sport).distance;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <form onSubmit={soumettre} onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-lg max-h-[92vh] overflow-y-auto space-y-4"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            {activite ? "Modifier l'activité" : "Nouvelle activité"}
          </h3>
          {activite && (
            <span className="text-xs text-gray-400">Source : {SOURCES[activite.source] ?? activite.source}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(SPORTS).map(([k, s]) => (
            <button type="button" key={k} onClick={() => setF((p) => ({ ...p, sport: k }))}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                f.sport === k ? "bg-brand text-white shadow-sm" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
              }`}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Champ label="Titre" className="col-span-2">
            <input className={inputCls} value={f.titre} onChange={set("titre")} placeholder="Sortie longue, fractionné…" />
          </Champ>
          <Champ label="Début">
            <input type="datetime-local" required className={inputCls} value={f.debut} onChange={set("debut")} />
          </Champ>
          <Champ label="Durée (min ou h:mm:ss)">
            <input className={inputCls} value={f.duree} onChange={set("duree")} placeholder="45 ou 1:05:30" />
          </Champ>
          {avecDistance && (
            <>
              <Champ label="Distance (km)">
                <input inputMode="decimal" className={inputCls} value={f.distance_km} onChange={set("distance_km")} />
              </Champ>
              <Champ label="D+ (m)">
                <input inputMode="numeric" className={inputCls} value={f.dplus_m} onChange={set("dplus_m")} />
              </Champ>
            </>
          )}
          <Champ label="FC moyenne">
            <input inputMode="numeric" className={inputCls} value={f.fc_moyenne_bpm} onChange={set("fc_moyenne_bpm")} />
          </Champ>
          <Champ label="FC max">
            <input inputMode="numeric" className={inputCls} value={f.fc_max_bpm} onChange={set("fc_max_bpm")} />
          </Champ>
          <Champ label="RPE (1-10) *">
            <select required className={`${inputCls} ${f.rpe === "" ? "ring-1 ring-orange-400" : ""}`} value={f.rpe} onChange={set("rpe")}>
              <option value="">À noter</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Champ>
          <Champ label="Ressenti">
            <select className={inputCls} value={f.ressenti} onChange={set("ressenti")}>
              <option value="">—</option>
              <option value="1">😫 Très dur</option>
              <option value="2">😕 Difficile</option>
              <option value="3">😐 Correct</option>
              <option value="4">🙂 Bien</option>
              <option value="5">🤩 Excellent</option>
            </select>
          </Champ>
          <Champ label="Calories">
            <input inputMode="numeric" className={inputCls} value={f.calories} onChange={set("calories")} />
          </Champ>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 self-end pb-2">
            <input type="checkbox" checked={f.est_competition} onChange={set("est_competition")} className="accent-violet-600" />
            Compétition
          </label>
          <Champ label="Notes" className="col-span-2">
            <textarea rows={3} className={inputCls} value={f.notes} onChange={set("notes")} />
          </Champ>
        </div>

        {erreur && <p className="text-sm text-red-500">{erreur}</p>}

        <div className="flex gap-2">
          {activite && (
            <button type="button" className={`${btnSecondaire} !text-red-500`} disabled={supprimer.isPending}
              onClick={() => window.confirm("Supprimer cette activité ?") && supprimer.mutate()}>
              Supprimer
            </button>
          )}
          <div className="flex-1" />
          <button type="button" className={btnSecondaire} onClick={onClose}>Annuler</button>
          <button type="submit" className={btnPrimaire} disabled={enregistrer.isPending}>
            {enregistrer.isPending ? "…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </div>
  );
}
