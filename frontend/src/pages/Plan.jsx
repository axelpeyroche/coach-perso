import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Card from "../components/Card";
import Page from "../components/Page";
import Feuille from "../components/Feuille";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import ConfirmDialog from "../components/ConfirmDialog";
import { Section, BoutonAjout } from "../components/ui";
import {
  getPlan, getActivites, creerPrevue, modifierPrevue, supprimerPrevue, getActivitesProches,
} from "../api";
import { SPORTS, sportInfo, fmtDuree, fmtDate, nombre, inputCls } from "../carnet";

// ── Dates (jours locaux au format AAAA-MM-JJ) ──────────────────────────────
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ajouter = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const lundiDe = (d) => { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return ajouter(r, -((r.getDay() + 6) % 7)); };

export const STATUTS = {
  realisee:   { label: "Réalisée",     cls: "bg-ios-green/15 text-ios-green" },
  sautee:     { label: "Sautée",       cls: "bg-remplissage text-label-2" },
  a_venir:    { label: "À venir",      cls: "bg-brand/[0.12] text-brand" },
  aujourdhui: { label: "Aujourd'hui",  cls: "bg-ios-indigo/15 text-ios-indigo" },
  manquee:    { label: "Non réalisée", cls: "bg-ios-orange/15 text-ios-orange" },
};

export function Pastilles({ s }) {
  const items = [
    s.duree_min != null && fmtDuree(s.duree_min * 60),
    s.distance_km != null && `${nombre(s.distance_km)} km`,
    s.dplus_m ? `${s.dplus_m} m D+` : null,
    s.rpe_cible != null && `RPE ${nombre(s.rpe_cible)}`,
  ].filter(Boolean);
  if (!items.length) return null;
  return <span className="block text-[13px] text-label-2 chiffres">{items.join(" · ")}</span>;
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
    <div className="tuile py-1">
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-[13px] font-semibold text-label-2">Activités à ± 3 jours</p>
        <button className="btn-texte text-[13px]" onClick={onClose}>Fermer</button>
      </div>
      {isLoading ? <p className="text-[13px] text-label-2 px-4 pb-2">Chargement…</p>
        : !data?.length ? <p className="text-[13px] text-label-2 px-4 pb-2">Aucune activité autour de cette date.</p>
        : data.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => onChoix(a.id)} />)}
    </div>
  );
}

// ── Séance prévue (ligne de la carte du jour) ──────────────────────────────
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

  const action = "btn-gris btn-sm font-medium";
  const retrait = "pl-[3.25rem]";

  return (
    <div className={`ligne !items-stretch flex-col !gap-2.5 !py-3.5 ${s.statut === "sautee" ? "opacity-55" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[19px]"
          style={{ backgroundColor: `${info.couleur}26` }}>{s.emoji ?? info.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-[15px] font-semibold leading-5 ${s.statut === "sautee" ? "line-through" : ""}`}>{s.titre}</p>
            <span className={`badge shrink-0 ${statut.cls}`}>{statut.label}</span>
          </div>
          <Pastilles s={s} />
        </div>
      </div>

      {s.description && (
        <div className={retrait}>
          <p className={`text-[14px] leading-5 whitespace-pre-line ${ouvert ? "" : "line-clamp-2"}`}>{s.description}</p>
          {s.description.length > 120 && (
            <button className="btn-texte text-[13px] mt-0.5" onClick={() => setOuvert(!ouvert)}>
              {ouvert ? "Réduire" : "Plus"}
            </button>
          )}
        </div>
      )}

      {s.activite && (
        <div className={retrait}>
          <div className="tuile py-1">
            <p className="px-4 pt-2 text-[12px] font-semibold text-ios-green">
              ✓ Réalisé {s.lien_manuel ? "(lien manuel)" : ""}
            </p>
            <ActiviteLigne a={s.activite} onClick={() => onOuvrirActivite(s.activite)} />
          </div>
        </div>
      )}

      {s.commentaire && !edition && (
        <p className={`${retrait} text-[13px] text-label-2`}>💬 {s.commentaire}</p>
      )}

      {edition && (
        <div className={`space-y-2 ${retrait}`}>
          <textarea rows={2} className={inputCls} value={commentaire} onChange={(e) => setCommentaire(e.target.value)}
            placeholder="Ressenti, raison d'un report, douleur…" />
          <div className="flex gap-2">
            <button className="btn-primaire btn-sm" disabled={maj.isPending} onClick={() => maj.mutate({ commentaire })}>Enregistrer</button>
            <button className="btn-gris btn-sm" onClick={() => setEdition(false)}>Annuler</button>
          </div>
        </div>
      )}

      {choix && (
        <div className={retrait}>
          <ChoixActivite prevue={s} onClose={() => setChoix(false)} onChoix={(id) => maj.mutate({ activite_id: id })} />
        </div>
      )}

      <div className={`flex gap-1.5 overflow-x-auto scrollbar-hide ${retrait} -mr-4 pr-4`}>
        {s.statut === "sautee" ? (
          <button className={action} disabled={maj.isPending} onClick={() => maj.mutate({ statut: "prevue" })}>Rétablir</button>
        ) : !s.activite && (
          <button className={action} disabled={maj.isPending} onClick={() => maj.mutate({ statut: "sautee" })}>Sautée</button>
        )}
        <button className={action} onClick={() => { setCommentaire(s.commentaire ?? ""); setEdition(true); }}>
          {s.commentaire ? "Commentaire" : "Commenter"}
        </button>
        {s.statut !== "sautee" && (
          <button className={action} onClick={() => setChoix(!choix)}>{s.activite ? "Changer d'activité" : "Relier une activité"}</button>
        )}
        {s.activite && <button className={action} disabled={maj.isPending} onClick={() => maj.mutate({ delier: true })}>Délier</button>}
        <button className="btn-danger btn-sm font-medium" onClick={() => setConfirmSuppr(true)}>Supprimer</button>
      </div>

      <ConfirmDialog open={confirmSuppr} title="Supprimer cette séance prévue ?" danger pending={suppr.isPending}
        message={`« ${s.titre} » du ${fmtDate(s.jour, { weekday: "long", day: "numeric", month: "long" })} sera retirée du plan.`}
        confirmLabel="Supprimer" onConfirm={() => suppr.mutate()} onCancel={() => setConfirmSuppr(false)} />
    </div>
  );
}

// ── Ajout manuel d'une séance prévue ────────────────────────────────────────
function L({ label, className = "", children }) {
  return <label className={`block ${className}`}><span className="libelle">{label}</span>{children}</label>;
}

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
    <Feuille as="form" onSubmit={soumettre} onClose={onClose} titre="Séance prévue"
      action={<button type="submit" className="btn-texte font-semibold" disabled={creer.isPending}>{creer.isPending ? "…" : "Ajouter"}</button>}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <L label="Jour">
          <input type="date" required className={inputCls} value={f.jour} onChange={set("jour")} />
        </L>
        <L label="Sport">
          <select className={inputCls} value={f.sport} onChange={set("sport")}>
            {Object.entries(SPORTS).map(([k, s]) => <option key={k} value={k}>{s.emoji} {s.label}</option>)}
          </select>
        </L>
        <L label="Titre" className="col-span-2">
          <input required className={inputCls} value={f.titre} onChange={set("titre")} placeholder="Footing, fractionné, renfo…" />
        </L>
        <L label="Durée (min)">
          <input inputMode="numeric" className={inputCls} value={f.duree_min} onChange={set("duree_min")} />
        </L>
        <L label="Distance (km)">
          <input inputMode="decimal" className={inputCls} value={f.distance_km} onChange={set("distance_km")} />
        </L>
        <L label="RPE cible">
          <select className={inputCls} value={f.rpe_cible} onChange={set("rpe_cible")}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </L>
        <L label="Contenu" className="col-span-2">
          <textarea rows={4} className={inputCls} value={f.description} onChange={set("description")} />
        </L>
      </div>
      {erreur && <p className="text-[13px] text-ios-red text-center">{erreur}</p>}
      <button type="submit" className="btn-primaire w-full" disabled={creer.isPending}>{creer.isPending ? "…" : "Ajouter au plan"}</button>
    </Feuille>
  );
}

// ── Bandeau de la semaine (façon app Calendrier) ───────────────────────────
function BandeauSemaine({ jours, aujourdhui, seances, activites, onPrec, onSuiv, onAujourdhui }) {
  const titre = `${fmtDate(jours[0], { day: "numeric", month: "short" })} – ${fmtDate(jours[6], { day: "numeric", month: "short", year: "numeric" })}`;
  const aller = (j) => document.getElementById(`jour-${j}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const fleche = (d) => (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center gap-1">
        <button className="btn-rond !bg-transparent text-brand" aria-label="Semaine précédente" onClick={onPrec}>{fleche("M15 5l-7 7 7 7")}</button>
        <p className="flex-1 text-center text-[15px] font-semibold chiffres">{titre}</p>
        <button className="btn-rond !bg-transparent text-brand" aria-label="Semaine suivante" onClick={onSuiv}>{fleche("M9 5l7 7-7 7")}</button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {jours.map((j) => {
          const d = new Date(`${j}T12:00`);
          const estAuj = j === aujourdhui;
          const prevues = seances.filter((s) => s.jour === j && s.statut !== "sautee");
          const faites = activites.filter((a) => a.debut.slice(0, 10) === j).length;
          return (
            <button key={j} onClick={() => aller(j)} className="flex flex-col items-center gap-1 py-1 rounded-xl active:bg-remplissage">
              <span className="text-[11px] font-medium uppercase text-label-2">
                {d.toLocaleDateString("fr-FR", { weekday: "narrow" })}
              </span>
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[17px] chiffres ${
                estAuj ? "bg-ios-red text-white font-semibold" : "text-label"}`}>
                {d.getDate()}
              </span>
              <span className="flex gap-0.5 h-1.5">
                {faites > 0 && <span className="w-1.5 h-1.5 rounded-full bg-ios-green" />}
                {prevues.length > faites && <span className="w-1.5 h-1.5 rounded-full bg-label-3" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="text-center">
        <button className="btn-texte text-[13px]" onClick={onAujourdhui}>Aujourd'hui</button>
      </div>
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
  const activites = acts?.activites ?? [];
  const liees = new Set(seances.map((s) => s.activite?.id).filter(Boolean));
  const horsPlan = activites.filter((a) => !liees.has(a.id));

  const comptees = seances.filter((s) => s.statut !== "sautee");
  const realisees = seances.filter((s) => s.statut === "realisee");
  const minPrevues = comptees.reduce((t, s) => t + (s.duree_min ?? 0), 0);
  const minRealisees = activites.reduce((t, a) => t + (a.duree_sec ?? 0), 0) / 60;

  const jours = Array.from({ length: 7 }, (_, i) => iso(ajouter(lundi, i)));

  return (
    <Page titre="Plan" sousTitre="Préparé par Claude"
      action={<BoutonAjout onClick={() => setAjout(aujourdhui)} label="Ajouter une séance prévue" />}>

      <BandeauSemaine jours={jours} aujourdhui={aujourdhui} seances={seances} activites={activites}
        onPrec={() => setLundi(ajouter(lundi, -7))} onSuiv={() => setLundi(ajouter(lundi, 7))}
        onAujourdhui={() => setLundi(lundiDe(new Date()))} />

      <div className="card grid grid-cols-3 divide-x-[0.5px] divide-separateur py-3">
        {[
          ["Séances", `${realisees.length}/${comptees.length}`, "text-ios-green"],
          ["Prévu", minPrevues ? fmtDuree(minPrevues * 60) : "—", "text-brand"],
          ["Réalisé", minRealisees ? fmtDuree(Math.round(minRealisees) * 60) : "—", "text-ios-orange"],
        ].map(([l, v, c]) => (
          <div key={l} className="px-3 text-center">
            <p className={`text-[12px] font-semibold ${c}`}>{l}</p>
            <p className="font-rounded text-[22px] font-bold tracking-[-0.02em] chiffres">{v}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="text-[15px] text-label-2">Chargement…</p>
      ) : (
        <div className="space-y-5">
          {jours.map((j) => {
            const duJour = seances.filter((s) => s.jour === j);
            const libres = horsPlan.filter((a) => a.debut.slice(0, 10) === j);
            const estAuj = j === aujourdhui;
            return (
              <section key={j} id={`jour-${j}`} className="space-y-1.5 scroll-mt-4">
                <div className="flex items-baseline justify-between px-4">
                  <h2 className={`text-[13px] uppercase tracking-[0.02em] font-medium ${estAuj ? "text-ios-red" : "text-label-2"}`}>
                    {fmtDate(j, { weekday: "long", day: "numeric", month: "short" })}{estAuj ? " · Aujourd'hui" : ""}
                  </h2>
                  <button className="btn-texte text-[13px]" onClick={() => setAjout(j)}>Prévoir</button>
                </div>
                <Card pad={false} className="py-0.5">
                  {duJour.length === 0 && libres.length === 0 && (
                    <p className="ligne text-[15px] text-label-3">Repos</p>
                  )}
                  {duJour.map((s) => <CarteSeance key={s.id} s={s} onOuvrirActivite={setModalActivite} />)}
                  {libres.length > 0 && duJour.length > 0 && (
                    <p className="ligne !min-h-0 !py-2 text-[12px] font-semibold uppercase text-label-2">Hors plan</p>
                  )}
                  {libres.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => setModalActivite(a)} />)}
                </Card>
              </section>
            );
          })}
        </div>
      )}

      {seances.length === 0 && !isLoading && (
        <p className="text-[13px] text-label-2 px-4 text-center">
          Aucune séance prévue cette semaine. Demande à Claude Code de préparer ton plan : il l'envoie ici avec ton token
          (<Link to="/sources#plan" className="text-brand">Sources → Plan avec Claude Code</Link>).
        </p>
      )}

      {modalActivite !== undefined && <ModalActivite activite={modalActivite} onClose={() => setModalActivite(undefined)} />}
      {ajout && <ModalPrevue jour={ajout} onClose={() => setAjout(null)} />}
    </Page>
  );
}

// ── « Prochaines séances » de l'accueil ────────────────────────────────────
export function ProchainesSeances() {
  const debut = new Date();
  const depuis = iso(debut);
  const jusqu = iso(ajouter(debut, 7));
  const { data } = useQuery({ queryKey: ["plan", depuis, jusqu], queryFn: () => getPlan(depuis, jusqu) });
  const prochaines = (data?.seances ?? []).filter((s) => s.statut === "a_venir" || s.statut === "aujourdhui").slice(0, 4);

  return (
    <Section titre="À venir" lien="/plan" libelleLien="Plan">
      <Card pad={false} className="py-1">
        {!data ? (
          <p className="ligne text-[15px] text-label-2">Chargement…</p>
        ) : prochaines.length === 0 ? (
          <p className="ligne text-[15px] text-label-2">Rien de prévu sur les 7 prochains jours.</p>
        ) : (
          prochaines.map((s) => {
            const info = sportInfo(s.sport);
            const auj = s.statut === "aujourdhui";
            return (
              <Link key={s.id} to="/plan" className="ligne" style={{ "--inset": "4.25rem" }}>
                <span className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[19px]"
                  style={{ backgroundColor: `${info.couleur}26` }}>{s.emoji ?? info.emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold truncate">{s.titre}</span>
                  <Pastilles s={s} />
                </span>
                <span className={`shrink-0 text-[13px] capitalize ${auj ? "text-ios-red font-semibold" : "text-label-2"}`}>
                  {auj ? "Aujourd'hui" : fmtDate(s.jour, { weekday: "short", day: "numeric" })}
                </span>
              </Link>
            );
          })
        )}
      </Card>
    </Section>
  );
}
