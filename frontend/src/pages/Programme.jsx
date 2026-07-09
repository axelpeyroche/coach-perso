import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMacrocycles, getSemainesMacrocycle, journaliserSeance } from "../api";
import clsx from "clsx";

const USER_ID = 1;

// ─── Constantes ────────────────────────────────────────────────────────────

const TYPE_ICONS   = { COURSE: "🏃", AMRAP: "🔥", EMOM: "⏱️", EVALUATION: "🎯", DECHARGE: "🧘", REPOS: "😴" };
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
const RPE_COLOR = ["","text-blue-400","text-blue-500","text-green-400","text-green-500",
  "text-yellow-400","text-yellow-500","text-orange-400","text-orange-500","text-red-400","text-red-500"];
const RPE_LABEL = ["","Très facile","Facile","Modéré","Confortable",
  "Un peu difficile","Difficile","Très difficile","Très dur","Extrême","Maximum"];

function fmt(min) {
  if (!min) return null;
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h${m ? String(m).padStart(2,"0") : ""}` : `${min} min`;
}

// ─── Formulaire de journalisation ──────────────────────────────────────────

function FormulaireLog({ seance, onClose, onDone }) {
  const qc = useQueryClient();
  const [rpe, setRpe]     = useState(7);
  const [champs, set_]    = useState({});
  const [notes, setNotes] = useState("");
  const setC = (k, v) => set_(c => ({ ...c, [k]: v }));

  const mut = useMutation({
    mutationFn: () => {
      const nums = Object.fromEntries(
        Object.entries(champs).filter(([,v]) => v !== "").map(([k,v]) => [k, Number(v)])
      );
      return journaliserSeance(seance.id, { utilisateur_id: USER_ID, rpe, notes: notes || undefined, ...nums });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["semaines"] }); onDone(); },
  });

  const isCourse = seance.type === "COURSE";
  const isAMRAP  = seance.type === "AMRAP";
  const isEMOM   = seance.type === "EMOM";

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 px-4 py-4 space-y-4">

      {/* Champs course */}
      {isCourse && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { k: "duree_reelle_min",   label: "Durée réelle (min)",  ph: seance.duree_cible_min ?? "60" },
            { k: "distance_reelle_km", label: "Distance (km)",       ph: "12.0", step: "0.1" },
            { k: "dplus_reel_m",       label: "D+ réel (m)",         ph: seance.dplus_cible_m ?? "0" },
            { k: "fc_moyenne_bpm",     label: "FC moy (bpm)",        ph: "152" },
            { k: "fc_max_bpm",         label: "FC max (bpm)",        ph: "178" },
          ].map(({ k, label, ph, step }) => (
            <div key={k}>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
              <input type="number" step={step} placeholder={ph} value={champs[k] ?? ""}
                onChange={e => setC(k, e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          ))}
        </div>
      )}

      {/* Champs AMRAP */}
      {isAMRAP && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tours complétés</label>
            <input type="number" step="0.1" placeholder="2.9" value={champs.tours_amrap_completes ?? ""}
              onChange={e => setC("tours_amrap_completes", e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Total reps</label>
            <input type="number" placeholder="180" value={champs.total_reps_enregistrees ?? ""}
              onChange={e => setC("total_reps_enregistrees", e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
        </div>
      )}

      {/* Champs EMOM */}
      {isEMOM && (
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Total reps réalisées</label>
          <input type="number" placeholder="160" value={champs.total_reps_enregistrees ?? ""}
            onChange={e => setC("total_reps_enregistrees", e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
      )}

      {/* RPE */}
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
      <div className="flex gap-2">
        <button onClick={onClose}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          Annuler
        </button>
        <button onClick={() => mut.mutate()} disabled={mut.isPending}
          className="flex-2 px-6 py-2.5 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-dark transition-colors disabled:opacity-50">
          {mut.isPending ? "..." : "Valider ✓"}
        </button>
      </div>
      {mut.isError && <p className="text-xs text-red-500 text-center">Erreur — réessaie.</p>}
    </div>
  );
}

// ─── Carte séance ───────────────────────────────────────────────────────────

function CarteSeance({ seance }) {
  const [ouvert, setOuvert]   = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [valide, setValide]   = useState(false);

  const fait = valide || seance.journal?.completee;

  return (
    <div className={clsx(
      "rounded-2xl border overflow-hidden transition-colors",
      fait ? "border-green-200 dark:border-green-900/50" : "border-gray-200 dark:border-gray-700"
    )}>
      {/* ── Ligne principale ── */}
      <div className={clsx(
        "flex items-center gap-3 px-4 py-3",
        fait ? "bg-green-50 dark:bg-green-900/10" : "bg-white dark:bg-gray-900"
      )}>
        <span className="text-xl shrink-0">{TYPE_ICONS[seance.type] ?? "📌"}</span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">{seance.titre}</p>
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
            {seance.temps_limite_min && (
              <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand text-xs font-bold">
                {seance.temps_limite_min} min
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {fait ? (
            <span className="text-sm text-green-600 dark:text-green-400 font-bold">✓</span>
          ) : (
            <button onClick={() => { setLogOpen(v => !v); setOuvert(false); }}
              className="px-3 py-1.5 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-dark transition-colors">
              Logger
            </button>
          )}
          <button onClick={() => { setOuvert(v => !v); setLogOpen(false); }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1">
            <span className={clsx("inline-block transition-transform text-xs", ouvert ? "rotate-180" : "")}>▼</span>
          </button>
        </div>
      </div>

      {/* ── Résumé si loggé ── */}
      {fait && seance.journal && (
        <div className="px-4 py-1.5 border-t border-green-100 dark:border-green-900/20 flex gap-4 text-xs text-gray-500 bg-green-50/50 dark:bg-green-900/5">
          {seance.journal.rpe && <span>RPE {seance.journal.rpe}/10</span>}
          {seance.journal.notes && <span className="truncate italic">{seance.journal.notes}</span>}
        </div>
      )}

      {/* ── Détail séance ── */}
      {ouvert && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-4 space-y-3 bg-white dark:bg-gray-900">

          {/* Exercices */}
          {seance.exercices?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {seance.type === "AMRAP" ? `Circuit AMRAP ${seance.temps_limite_min} min` :
                 seance.type === "EMOM"  ? `EMOM ${seance.temps_limite_min} min` : "Exercices"}
              </p>
              <div className="divide-y divide-gray-50 dark:divide-gray-800 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                {seance.exercices.map((ex, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-900 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-4">{i + 1}.</span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">{ex.nom}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {ex.duree_bloc_min && seance.type === "EMOM" && (
                        <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold">
                          {ex.duree_bloc_min} min
                        </span>
                      )}
                      {ex.repetitions && (
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
            <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
              {seance.description}
            </pre>
          )}
        </div>
      )}

      {/* ── Formulaire log ── */}
      {logOpen && !fait && (
        <FormulaireLog seance={seance}
          onClose={() => setLogOpen(false)}
          onDone={() => { setLogOpen(false); setValide(true); }} />
      )}
    </div>
  );
}

// ─── Page principale ────────────────────────────────────────────────────────

export default function Programme() {
  const [mcId, setMcId]         = useState(null);
  const [semIdx, setSemIdx]     = useState(null);

  const { data: macrocycles = [], isLoading: loadingMC } = useQuery({
    queryKey: ["macrocycles"],
    queryFn: () => getMacrocycles(1),
  });

  const resolvedMcId = mcId ?? macrocycles[0]?.id ?? null;
  const mcActif = macrocycles.find(m => m.id === resolvedMcId) ?? macrocycles[0];

  const { data, isLoading, error } = useQuery({
    queryKey: ["semaines", resolvedMcId],
    queryFn: () => getSemainesMacrocycle(resolvedMcId),
    enabled: !!resolvedMcId,
  });

  if (loadingMC) return <Loader />;
  if (!loadingMC && macrocycles.length === 0)
    return <Erreur msg="Aucun macrocycle. Lance /api/admin/init-macrocycles puis /api/admin/seed-seances." />;
  if (isLoading) return <Loader />;
  if (error) return <Erreur msg={`Erreur : ${error.message}`} />;

  const semaines = data?.semaines ?? [];
  const idx = semIdx !== null ? semIdx : 0;
  const semaine = semaines[idx];

  const seancesVisibles = semaine?.seances?.filter(s => s.type !== "REPOS") ?? [];
  const nbFaites = seancesVisibles.filter(s => s.journal?.completee).length;

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-5">

      {/* En-tête */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Programme</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Séances de la semaine + journalisation
        </p>
      </div>

      {/* Sélecteur module */}
      {macrocycles.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
          {macrocycles.map(mc => (
            <button key={mc.id} onClick={() => { setMcId(mc.id); setSemIdx(null); }}
              className={clsx(
                "shrink-0 px-3 py-1.5 rounded-xl text-sm font-semibold border transition-colors",
                mc.id === resolvedMcId
                  ? "border-brand bg-brand/10 text-brand dark:bg-brand/20"
                  : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300"
              )}>
              {mc.nom}
            </button>
          ))}
        </div>
      )}

      {/* Sélecteur semaine */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
        {semaines.map((s, i) => {
          const nbFait = (s.seances ?? []).filter(x => x.journal?.completee).length;
          const nbTotal = (s.seances ?? []).filter(x => x.type !== "REPOS").length;
          const complet = nbFait === nbTotal && nbTotal > 0;
          return (
            <button key={s.numero_semaine} onClick={() => setSemIdx(i)}
              className={clsx(
                "shrink-0 flex flex-col items-center px-3 py-2 rounded-xl border text-xs font-medium transition-colors",
                idx === i
                  ? "border-brand bg-brand/10 text-brand dark:bg-brand/20"
                  : complet
                  ? "border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400"
                  : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300"
              )}>
              <span className="font-bold">S{s.numero_semaine}</span>
              <span className="opacity-70 mt-0.5">{complet ? "✓" : s.macrophase === "surcharge" ? "↑" : s.macrophase === "decharge" ? "↓" : "★"}</span>
            </button>
          );
        })}
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
              ? seancesVisibles.map(s => <CarteSeance key={s.id} seance={s} />)
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
