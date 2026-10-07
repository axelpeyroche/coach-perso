import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Card from "../components/Card";
import Page from "../components/Page";
import Feuille from "../components/Feuille";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import ConfirmDialog from "../components/ConfirmDialog";
import Menu, { IconesMenu } from "../components/Menu";
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
  a_venir:    { label: "À faire",      cls: "bg-brand/[0.12] text-brand" },
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
        <p className="text-[13px] font-semibold text-label-2">Activités de la semaine</p>
        <button className="btn-texte text-[13px]" onClick={onClose}>Fermer</button>
      </div>
      {isLoading ? <p className="text-[13px] text-label-2 px-4 pb-2">Chargement…</p>
        : !data?.length ? <p className="text-[13px] text-label-2 px-4 pb-2">Aucune activité cette semaine.</p>
        : data.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => onChoix(a.id)} />)}
    </div>
  );
}

// ── Séance prévue (ligne de la liste de la semaine) ────────────────────────
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
            <div className="flex items-center gap-1 shrink-0 -mt-1 md:mt-0">
              <span className={`badge ${statut.cls}`}>{statut.label}</span>
              <Menu className="md:hidden -mr-1" items={[
                { label: s.commentaire ? "Modifier le commentaire" : "Commenter", icone: IconesMenu.commenter,
                  onClick: () => { setCommentaire(s.commentaire ?? ""); setEdition(true); } },
                s.statut !== "sautee" && { label: s.activite ? "Changer d'activité" : "Relier une activité", icone: IconesMenu.relier,
                  onClick: () => setChoix(true) },
                s.activite && { label: "Délier l'activité", icone: IconesMenu.delier, disabled: maj.isPending,
                  onClick: () => maj.mutate({ delier: true }) },
                s.statut === "sautee"
                  ? { label: "Rétablir", icone: IconesMenu.retablir, disabled: maj.isPending, onClick: () => maj.mutate({ statut: "prevue" }) }
                  : !s.activite && { label: "Marquer comme sautée", icone: IconesMenu.sauter, disabled: maj.isPending, onClick: () => maj.mutate({ statut: "sautee" }) },
                { separateur: true },
                { label: "Supprimer", icone: IconesMenu.supprimer, danger: true, onClick: () => setConfirmSuppr(true) },
              ]} />
            </div>
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

      <div className={`hidden md:flex gap-1.5 flex-wrap ${retrait}`}>
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
        message={`« ${s.titre} » sera retirée du plan de la semaine.`}
        confirmLabel="Supprimer" onConfirm={() => suppr.mutate()} onCancel={() => setConfirmSuppr(false)} />
    </div>
  );
}

// ── Séance réalisée hors plan (vélotaf, import Santé…) : simplement « faite » ──
function LigneFaite({ a, onClick }) {
  const info = sportInfo(a.sport);
  const metriques = [
    a.duree_str,
    a.distance_km != null && `${nombre(a.distance_km, 2)} km`,
    a.dplus_m ? `${a.dplus_m} m D+` : null,
    a.rpe ? `RPE ${a.rpe}${a.rpe_estime ? " (estimé)" : ""}` : null,
  ].filter(Boolean);
  return (
    <button onClick={onClick} className="ligne !py-3.5 text-left" style={{ "--inset": "4.25rem" }}>
      <span className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[19px]"
        style={{ backgroundColor: `${info.couleur}26` }}>{a.emoji ?? info.emoji}</span>
      <span className="flex-1 min-w-0">
        <span className="flex items-start justify-between gap-2">
          <span className="text-[15px] font-semibold leading-5 truncate">{a.titre || a.sport_label || info.label}</span>
          <span className={`badge shrink-0 ${STATUTS.realisee.cls}`}>Faite</span>
        </span>
        <span className="block text-[13px] text-label-2 truncate chiffres">{metriques.join(" · ") || "—"}</span>
      </span>
    </button>
  );
}

// ── Ajout manuel d'une séance prévue ────────────────────────────────────────
function L({ label, className = "", children }) {
  return <label className={`block ${className}`}><span className="libelle">{label}</span>{children}</label>;
}

function ModalPrevue({ semaine, onClose }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ sport: "course", titre: "", duree_min: "", distance_km: "", rpe_cible: "", description: "" });
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
      jour: semaine, sport: f.sport, titre: f.titre, description: f.description || null,
      duree_min: num(f.duree_min), distance_km: num(f.distance_km), rpe_cible: num(f.rpe_cible),
    });
  }

  return (
    <Feuille as="form" onSubmit={soumettre} onClose={onClose} titre="Séance prévue"
      action={<button type="submit" className="btn-texte font-semibold" disabled={creer.isPending}>{creer.isPending ? "…" : "Ajouter"}</button>}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <L label="Sport" className="col-span-2">
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

// ── Navigation de semaine ──────────────────────────────────────────────────
function BandeauSemaine({ lundi, dimanche, courante, onPrec, onSuiv, onAujourdhui }) {
  const titre = `${fmtDate(lundi, { day: "numeric", month: "short" })} – ${fmtDate(dimanche, { day: "numeric", month: "short", year: "numeric" })}`;
  const fleche = (d) => (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1">
        <button className="btn-rond !bg-transparent text-brand" aria-label="Semaine précédente" onClick={onPrec}>{fleche("M15 5l-7 7 7 7")}</button>
        <div className="flex-1 text-center">
          <p className="text-[15px] font-semibold chiffres">{titre}</p>
          {courante ? <p className="text-[12px] font-medium text-ios-red">Cette semaine</p>
            : <button className="btn-texte text-[12px]" onClick={onAujourdhui}>Revenir à cette semaine</button>}
        </div>
        <button className="btn-rond !bg-transparent text-brand" aria-label="Semaine suivante" onClick={onSuiv}>{fleche("M9 5l7 7-7 7")}</button>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Plan() {
  const [lundi, setLundi] = useState(() => lundiDe(new Date()));
  const [modalActivite, setModalActivite] = useState(undefined);
  const [ajout, setAjout] = useState(false);
  const depuis = iso(lundi);
  const jusqu = iso(ajouter(lundi, 6));
  const courante = depuis === iso(lundiDe(new Date()));

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

  // À faire dans l'ordre du plan, puis ce qui est fait (prévu ou non), puis les séances sautées.
  // Aucun jour affiché : c'est l'athlète qui place ses séances dans la semaine.
  const aFaire = seances.filter((s) => s.statut !== "realisee" && s.statut !== "sautee");
  const sautees = seances.filter((s) => s.statut === "sautee");
  const faites = [
    ...realisees.map((s) => ({ cle: `p${s.id}`, debut: s.activite?.debut ?? "", prevue: s })),
    ...horsPlan.map((a) => ({ cle: `a${a.id}`, debut: a.debut ?? "", activite: a })),
  ].sort((x, y) => x.debut.localeCompare(y.debut));

  const groupe = (titre, contenu) => (
    <section className="space-y-1.5">
      <h2 className="px-4 text-[13px] uppercase tracking-[0.02em] font-medium text-label-2">{titre}</h2>
      <Card pad={false} className="py-0.5">{contenu}</Card>
    </section>
  );

  return (
    <Page titre="Plan" sousTitre="Préparé par Claude"
      action={<BoutonAjout onClick={() => setAjout(true)} label="Ajouter une séance prévue" />}>

      <BandeauSemaine lundi={depuis} dimanche={jusqu} courante={courante}
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
          {seances.length > 0 && groupe(`À faire · ${aFaire.length}`,
            aFaire.length ? aFaire.map((s) => <CarteSeance key={s.id} s={s} onOuvrirActivite={setModalActivite} />)
              : <p className="ligne text-[15px] text-label-2">Tout est fait 🎉</p>)}
          {faites.length > 0 && groupe(`Faites · ${faites.length}`, faites.map((f) => (f.prevue
            ? <CarteSeance key={f.cle} s={f.prevue} onOuvrirActivite={setModalActivite} />
            : <LigneFaite key={f.cle} a={f.activite} onClick={() => setModalActivite(f.activite)} />)))}
          {sautees.length > 0 && groupe(`Sautées · ${sautees.length}`,
            sautees.map((s) => <CarteSeance key={s.id} s={s} onOuvrirActivite={setModalActivite} />))}
        </div>
      )}

      {seances.length === 0 && !isLoading && (
        <p className="text-[13px] text-label-2 px-4 text-center">
          Aucune séance prévue cette semaine. Demande à Claude Code de préparer ton plan : il l'envoie ici avec ton token
          (<Link to="/sources#plan" className="text-brand">Sources → Plan avec Claude Code</Link>).
        </p>
      )}

      {modalActivite !== undefined && <ModalActivite activite={modalActivite} onClose={() => setModalActivite(undefined)} />}
      {ajout && <ModalPrevue semaine={depuis} onClose={() => setAjout(false)} />}
    </Page>
  );
}

// ── « Prochaines séances » de l'accueil ────────────────────────────────────
export function ProchainesSeances() {
  const lundi = lundiDe(new Date());
  const depuis = iso(lundi);
  const jusqu = iso(ajouter(lundi, 6));
  const { data } = useQuery({ queryKey: ["plan", depuis, jusqu], queryFn: () => getPlan(depuis, jusqu) });
  const prochaines = (data?.seances ?? []).filter((s) => s.statut === "a_venir" || s.statut === "aujourdhui").slice(0, 4);

  return (
    <Section titre="À faire cette semaine" lien="/plan" libelleLien="Plan">
      <Card pad={false} className="py-1">
        {!data ? (
          <p className="ligne text-[15px] text-label-2">Chargement…</p>
        ) : prochaines.length === 0 ? (
          <p className="ligne text-[15px] text-label-2">Plus rien à faire cette semaine.</p>
        ) : (
          prochaines.map((s) => {
            const info = sportInfo(s.sport);
            return (
              <Link key={s.id} to="/plan" className="ligne" style={{ "--inset": "4.25rem" }}>
                <span className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[19px]"
                  style={{ backgroundColor: `${info.couleur}26` }}>{s.emoji ?? info.emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold truncate">{s.titre}</span>
                  <Pastilles s={s} />
                </span>
              </Link>
            );
          })
        )}
      </Card>
    </Section>
  );
}
