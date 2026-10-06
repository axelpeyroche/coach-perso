import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { creerActivite, modifierActivite, supprimerActivite } from "../api";
import { SPORTS, sportInfo, parseDuree, dureeVersTexte, inputCls, SOURCES } from "../carnet";
import Feuille from "./Feuille";

function maintenantLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function Champ({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="libelle">{label}</span>
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
    ["activites", "stats-carnet", "objectifs", "plan"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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
    <Feuille as="form" onSubmit={soumettre} onClose={onClose}
      titre={activite ? "Activité" : "Nouvelle activité"}
      action={<button type="submit" className="btn-texte font-semibold" disabled={enregistrer.isPending}>
        {enregistrer.isPending ? "…" : activite ? "OK" : "Ajouter"}
      </button>}>
      {activite && (
        <p className="text-[13px] text-label-2 text-center -mt-2">Source : {SOURCES[activite.source] ?? activite.source}</p>
      )}

      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
        {Object.entries(SPORTS).map(([k, s]) => (
          <button type="button" key={k} onClick={() => setF((p) => ({ ...p, sport: k }))}
            className={`puce ${f.sport === k ? "puce-active" : ""}`}>
            <span>{s.emoji}</span>{s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <Champ label="Titre" className="col-span-2">
          <input className={inputCls} value={f.titre} onChange={set("titre")} placeholder="Sortie longue, fractionné…" />
        </Champ>
        <Champ label="Début">
          <input type="datetime-local" required className={inputCls} value={f.debut} onChange={set("debut")} />
        </Champ>
        <Champ label="Durée">
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
        <Champ label="Effort (RPE /10)" className="col-span-2">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button type="button" key={n} onClick={() => setF((p) => ({ ...p, rpe: String(n) }))}
                className={`flex-1 h-10 rounded-[10px] text-[15px] font-semibold chiffres transition ${
                  String(f.rpe) === String(n) ? "bg-brand text-white" : "bg-remplissage text-label"
                }`}>
                {n}
              </button>
            ))}
          </div>
          {f.rpe === "" && <p className="text-[12px] text-ios-orange mt-1.5 px-1">À noter avant d'enregistrer</p>}
          {activite?.rpe_estime && (
            <p className="text-[12px] text-label-2 mt-1.5 px-1">Pré-rempli avec l'effort estimé par l'Apple Watch : enregistre pour le confirmer.</p>
          )}
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
        <div className="col-span-2 card flex items-center justify-between px-4 h-12">
          <span className="text-[15px]">Compétition</span>
          <button type="button" role="switch" aria-checked={f.est_competition} className="interrupteur"
            onClick={() => setF((p) => ({ ...p, est_competition: !p.est_competition }))}>
            <span />
          </button>
        </div>
        <Champ label="Notes" className="col-span-2">
          <textarea rows={3} className={inputCls} value={f.notes} onChange={set("notes")} />
        </Champ>
      </div>

      {erreur && <p className="text-[13px] text-ios-red text-center">{erreur}</p>}

      <button type="submit" className="btn-primaire w-full" disabled={enregistrer.isPending}>
        {enregistrer.isPending ? "…" : "Enregistrer"}
      </button>
      {activite && (
        <button type="button" className="btn-danger w-full" disabled={supprimer.isPending}
          onClick={() => window.confirm("Supprimer cette activité ?") && supprimer.mutate()}>
          Supprimer l'activité
        </button>
      )}
    </Feuille>
  );
}
