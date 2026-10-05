import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Card from "../components/Card";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  getPlan, getActivites, creerPrevue, modifierPrevue, supprimerPrevue, getActivitesProches,
} from "../api";
import { SPORTS, sportInfo, fmtDuree, fmtDate, nombre, inputCls, btnPrimaire, btnSecondaire } from "../carnet";

// ── Dates (jours locaux au format AAAA-MM-JJ) ──────────────────────────────
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ajouter = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const lundiDe = (d) => { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return ajouter(r, -((r.getDay() + 6) % 7)); };

export const STATUTS = {
  realisee:   { label: "Réalisée",     cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  sautee:     { label: "Sautée",       cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
  a_venir:    { label: "À venir",      cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  aujourdhui: { label: "Aujourd'hui",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  manquee:    { label: "Non réalisée", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
};

export function Pastilles({ s }) {
  const items = [
    s.duree_min != null && fmtDuree(s.duree_min * 60),
    s.distance_km != null && `${nombre(s.distance_km)} km`,
    s.dplus_m ? `${s.dplus_m} m D+` : null,
    s.rpe_cible != null && `RPE ${nombre(s.rpe_cible)}`,
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((t) => (
        <span key={t} className="rounded-md bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-600 dark:text-gray-300">{t}</span>
      ))}
    </span>
  );
}

function invaliderPlan(qc) {
  ["plan", "activites"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

// ── Choix manuel de l'activité réalisée ─────────────────────────────────────
function ChoixActivite({ prevue, onChoix, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ["plan", "proches", prevue.id], queryFn: () => getActivitesProches(prevue.id),
  });
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-2 space-y-1">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Activités à ± 3 jours</p>
        <button className="text-xs text-gray-400 hover:underline" onClick={onClose}>Fermer</button>
      </div>
      {isLoading ? <p className="text-xs text-gray-400 px-1">Chargement…</p>
        : !data?.length ? <p className="text-xs text-gray-500 px-1">Aucune activité autour de cette date.</p>
        : data.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => onChoix(a.id)} />)}
    </div>
  );
}

// ── Carte d'une séance prévue ───────────────────────────────────────────────
function CarteSeance({ s, onOuvrirActivite }) {
  const qc = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState(false);
  const [edition, setEdition] = useState(false);
  const [commentaire, setCommentaire] = useState(s.commentaire ?? "");
  const [confirmSuppr, setConfirmSuppr] = useState(false);
  const info = sportInfo(s.sport);
  const statut = STATUTS[s.statut] ?? STATUTS.a_venir;

  const maj = useMutation({
    mutationFn: (payload) => modifierPrevue(s.id, payload),
    onSuccess: () => { invaliderPlan(qc); setChoix(false); setEdition(false); },
  });
  const suppr = useMutation({
    mutationFn: () => supprimerPrevue(s.id),
    onSuccess: () => { invaliderPlan(qc); setConfirmSuppr(false); },
  });

  const lien = "text-xs text-gray-500 dark:text-gray-400 hover:text-brand hover:underline disabled:opacity-50";

  return (
    <div className={`rounded-xl border border-gray-100 dark:border-gray-800 bg-white/60 dark:bg-gray-900/40 p-3 space-y-2 ${s.statut === "sautee" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-lg"
          style={{ backgroundColor: `${info.couleur}22` }}>{s.emoji ?? info.emoji}</span>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm font-semibold text-gray-900 dark:text-white ${s.statut === "sautee" ? "line-through" : ""}`}>{s.titre}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statut.cls}`}>{statut.label}</span>
          </div>
          <Pastilles s={s} />
        </div>
      </div>

      {s.description && (
        <div>
          <p className={`text-xs text-gray-600 dark:text-gray-300 whitespace-pre-line ${ouvert ? "" : "line-clamp-2"}`}>{s.description}</p>
          {s.description.length > 120 && (
            <button className="text-[11px] text-brand hover:underline" onClick={() => setOuvert(!ouvert)}>
              {ouvert ? "Réduire" : "Voir le détail"}
            </button>
          )}
        </div>
      )}

      {s.activite && (
        <div className="rounded-xl bg-green-50/70 dark:bg-green-900/20 -mx-1">
          <p className="px-3 pt-2 text-[10px] font-bold uppercase text-green-700 dark:text-green-400">
            Réalisé {s.lien_manuel ? "(lien manuel)" : ""}
          </p>
          <ActiviteLigne a={s.activite} onClick={() => onOuvrirActivite(s.activite)} />
        </div>
      )}

      {s.commentaire && !edition && (
        <p className="text-xs italic text-gray-500 dark:text-gray-400">💬 {s.commentaire}</p>
      )}

      {edition && (
        <div className="space-y-2">
          <textarea rows={2} className={inputCls} value={commentaire} onChange={(e) => setCommentaire(e.target.value)}
            placeholder="Ressenti, raison d'un report, douleur…" />
          <div className="flex gap-2">
            <button className={btnPrimaire} disabled={maj.isPending} onClick={() => maj.mutate({ commentaire })}>Enregistrer</button>
            <button className={btnSecondaire} onClick={() => setEdition(false)}>Annuler</button>
          </div>
        </div>
      )}

      {choix && <ChoixActivite prevue={s} onClose={() => setChoix(false)} onChoix={(id) => maj.mutate({ activite_id: id })} />}

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {s.statut === "sautee" ? (
          <button className={lien} disabled={maj.isPending} onClick={() => maj.mutate({ statut: "prevue" })}>Rétablir</button>
        ) : !s.activite && (
          <button className={lien} disabled={maj.isPending} onClick={() => maj.mutate({ statut: "sautee" })}>Marquer sautée</button>
        )}
        <button className={lien} onClick={() => { setCommentaire(s.commentaire ?? ""); setEdition(true); }}>
          {s.commentaire ? "Modifier le commentaire" : "Commenter"}
        </button>
        {s.statut !== "sautee" && (
          <button className={lien} onClick={() => setChoix(!choix)}>{s.activite ? "Changer d'activité" : "Relier une activité"}</button>
        )}
        {s.activite && <button className={lien} disabled={maj.isPending} onClick={() => maj.mutate({ delier: true })}>Délier</button>}
        <button className={`${lien} hover:!text-red-500`} onClick={() => setConfirmSuppr(true)}>Supprimer</button>
      </div>

      <ConfirmDialog open={confirmSuppr} title="Supprimer cette séance prévue ?" danger pending={suppr.isPending}
        message={`« ${s.titre} » du ${fmtDate(s.jour, { weekday: "long", day: "numeric", month: "long" })} sera retirée du plan.`}
        confirmLabel="Supprimer" onConfirm={() => suppr.mutate()} onCancel={() => setConfirmSuppr(false)} />
    </div>
  );
}

// ── Ajout manuel d'une séance prévue ────────────────────────────────────────
function ModalPrevue({ jour, onClose }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ jour, sport: "course", titre: "", duree_min: "", distance_km: "", rpe_cible: "", description: "" });
  const [erreur, setErreur] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const num = (v) => (v === "" ? null : Number(String(v).replace(",", ".")));

  const creer = useMutation({
    mutationFn: creerPrevue,
    onSuccess: () => { invaliderPlan(qc); onClose(); },
    onError: (e) => setErreur(e?.response?.data?.detail?.toString?.() ?? "Erreur lors de l'enregistrement"),
  });

  function soumettre(e) {
    e.preventDefault();
    creer.mutate({
      jour: f.jour, sport: f.sport, titre: f.titre, description: f.description || null,
      duree_min: num(f.duree_min), distance_km: num(f.distance_km), rpe_cible: num(f.rpe_cible),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <form onSubmit={soumettre} onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-lg max-h-[92vh] overflow-y-auto space-y-4"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
        <h3 className="text-base font-bold text-gray-900 dark:text-white">Nouvelle séance prévue</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-500">Jour</span>
            <input type="date" required className={inputCls} value={f.jour} onChange={set("jour")} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-500">Sport</span>
            <select className={inputCls} value={f.sport} onChange={set("sport")}>
              {Object.entries(SPORTS).map(([k, s]) => <option key={k} value={k}>{s.emoji} {s.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1 col-span-2">
            <span className="text-xs font-medium text-gray-500">Titre</span>
            <input required className={inputCls} value={f.titre} onChange={set("titre")} placeholder="Footing, fractionné, renfo…" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-500">Durée (min)</span>
            <input inputMode="numeric" className={inputCls} value={f.duree_min} onChange={set("duree_min")} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-500">Distance (km)</span>
            <input inputMode="decimal" className={inputCls} value={f.distance_km} onChange={set("distance_km")} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-500">RPE cible</span>
            <select className={inputCls} value={f.rpe_cible} onChange={set("rpe_cible")}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="block space-y-1 col-span-2">
            <span className="text-xs font-medium text-gray-500">Contenu</span>
            <textarea rows={3} className={inputCls} value={f.description} onChange={set("description")} />
          </label>
        </div>
        {erreur && <p className="text-sm text-red-500">{erreur}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondaire} onClick={onClose}>Annuler</button>
          <button type="submit" className={btnPrimaire} disabled={creer.isPending}>{creer.isPending ? "…" : "Ajouter"}</button>
        </div>
      </form>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Plan() {
  const [lundi, setLundi] = useState(() => lundiDe(new Date()));
  const [modalActivite, setModalActivite] = useState(undefined);
  const [ajout, setAjout] = useState(null);
  const depuis = iso(lundi);
  const jusqu = iso(ajouter(lundi, 6));
  const aujourdhui = iso(new Date());

  const { data: plan, isLoading } = useQuery({ queryKey: ["plan", depuis, jusqu], queryFn: () => getPlan(depuis, jusqu) });
  const { data: acts } = useQuery({
    queryKey: ["activites", { depuis, jusqu }], queryFn: () => getActivites({ depuis, jusqu_a: jusqu, limit: 200 }),
  });

  const seances = plan?.seances ?? [];
  const liees = new Set(seances.map((s) => s.activite?.id).filter(Boolean));
  const horsPlan = (acts?.activites ?? []).filter((a) => !liees.has(a.id));

  const comptees = seances.filter((s) => s.statut !== "sautee");
  const realisees = seances.filter((s) => s.statut === "realisee");
  const minPrevues = comptees.reduce((t, s) => t + (s.duree_min ?? 0), 0);
  const minRealisees = (acts?.activites ?? []).reduce((t, a) => t + (a.duree_sec ?? 0), 0) / 60;

  const jours = Array.from({ length: 7 }, (_, i) => iso(ajouter(lundi, i)));
  const titreSemaine = `${fmtDate(depuis, { day: "numeric", month: "short" })} → ${fmtDate(jusqu, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="p-4 md:p-8 w-full space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Plan</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Séances prévues par Claude, rapprochées automatiquement de tes activités</p>
        </div>
        <button className={btnSecondaire} onClick={() => setAjout(aujourdhui)}>+ Séance prévue</button>
      </div>

      <div className="flex items-center gap-2">
        <button className={btnSecondaire} aria-label="Semaine précédente" onClick={() => setLundi(ajouter(lundi, -7))}>‹</button>
        <p className="flex-1 text-center text-sm font-semibold text-gray-800 dark:text-gray-200">{titreSemaine}</p>
        <button className={btnSecondaire} aria-label="Semaine suivante" onClick={() => setLundi(ajouter(lundi, 7))}>›</button>
        <button className={btnSecondaire} onClick={() => setLundi(lundiDe(new Date()))}>Aujourd'hui</button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          ["Séances", `${realisees.length} / ${comptees.length}`, "réalisées / prévues"],
          ["Prévu", minPrevues ? fmtDuree(minPrevues * 60) : "—", "durée planifiée"],
          ["Réalisé", minRealisees ? fmtDuree(Math.round(minRealisees) * 60) : "—", "toutes activités"],
        ].map(([l, v, sub]) => (
          <div key={l} className="glass-sm rounded-2xl p-3">
            <p className="text-[11px] font-medium uppercase text-gray-400">{l}</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{v}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{sub}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : (
        <div className="space-y-3">
          {jours.map((j) => {
            const duJour = seances.filter((s) => s.jour === j);
            const libres = horsPlan.filter((a) => a.debut.slice(0, 10) === j);
            const estAuj = j === aujourdhui;
            return (
              <Card key={j}>
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-sm font-semibold capitalize ${estAuj ? "text-brand" : "text-gray-800 dark:text-gray-200"}`}>
                    {fmtDate(j, { weekday: "long", day: "numeric", month: "short" })}{estAuj ? " · aujourd'hui" : ""}
                  </p>
                  <button className="text-xs text-gray-400 hover:text-brand" onClick={() => setAjout(j)}>+ prévoir</button>
                </div>
                <div className="space-y-2">
                  {duJour.length === 0 && libres.length === 0 && (
                    <p className="text-xs text-gray-400">Repos</p>
                  )}
                  {duJour.map((s) => <CarteSeance key={s.id} s={s} onOuvrirActivite={setModalActivite} />)}
                  {libres.length > 0 && (
                    <div className="-mx-2">
                      {duJour.length > 0 && <p className="px-3 text-[10px] font-bold uppercase text-gray-400">Hors plan</p>}
                      {libres.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => setModalActivite(a)} />)}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {seances.length === 0 && !isLoading && (
        <Card>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Aucune séance prévue cette semaine. Demande à Claude Code de préparer ton plan : il l'envoie ici avec ton token
            (<Link to="/sources#plan" className="text-brand hover:underline">Sources → Plan avec Claude Code</Link>).
          </p>
        </Card>
      )}

      {modalActivite !== undefined && <ModalActivite activite={modalActivite} onClose={() => setModalActivite(undefined)} />}
      {ajout && <ModalPrevue jour={ajout} onClose={() => setAjout(null)} />}
    </div>
  );
}

// ── Carte « Prochaines séances » de l'accueil ───────────────────────────────
export function ProchainesSeances() {
  const debut = new Date();
  const depuis = iso(debut);
  const jusqu = iso(ajouter(debut, 7));
  const { data } = useQuery({ queryKey: ["plan", depuis, jusqu], queryFn: () => getPlan(depuis, jusqu) });
  const prochaines = (data?.seances ?? []).filter((s) => s.statut === "a_venir" || s.statut === "aujourdhui").slice(0, 4);

  return (
    <Card title="Prochaines séances" action={<Link to="/plan" className="text-xs text-brand hover:underline">Plan</Link>}>
      {!data ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : prochaines.length === 0 ? (
        <p className="text-sm text-gray-500">Rien de prévu sur les 7 prochains jours.</p>
      ) : (
        <div className="space-y-2">
          {prochaines.map((s) => (
            <Link key={s.id} to="/plan" className="flex items-start gap-3 rounded-xl px-1 py-1 hover:bg-white/50 dark:hover:bg-white/5">
              <span className="text-lg">{s.emoji ?? sportInfo(s.sport).emoji}</span>
              <span className="flex-1 min-w-0 space-y-0.5">
                <span className="block text-sm font-semibold text-gray-900 dark:text-white truncate">{s.titre}</span>
                <Pastilles s={s} />
              </span>
              <span className={`shrink-0 text-xs capitalize ${s.statut === "aujourdhui" ? "text-brand font-semibold" : "text-gray-500"}`}>
                {s.statut === "aujourdhui" ? "Aujourd'hui" : fmtDate(s.jour, { weekday: "short", day: "numeric" })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
