import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Card from "../components/Card";
import Page from "../components/Page";
import Feuille from "../components/Feuille";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import ConfirmDialog from "../components/ConfirmDialog";
import ImportPlan from "../components/ImportPlan";
import ContenuSeance from "../components/ContenuSeance";
import { resumeSeance } from "../seance";
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
  ["plan", "activites", "forme-jour"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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

// ── Détail d'une séance prévue (feuille ouverte au toucher de la carte) ───────
// Sports pour lesquels la page Itinéraires sait proposer un parcours
const ITINERAIRE = { course: 1, trail: 1, randonnee: 1, marche: 1, velo: 1 };

function DetailSeance({ s, onClose, onOuvrirActivite }) {
  const info = sportInfo(s.sport);
  const statut = STATUTS[s.statut] ?? STATUTS.a_venir;
  const mesures = [
    ["Durée", s.duree_min != null ? fmtDuree(s.duree_min * 60) : null],
    ["Distance", s.distance_km != null ? `${nombre(s.distance_km)} km` : null],
    ["Dénivelé", s.dplus_m ? `${s.dplus_m} m` : null],
    ["RPE cible", s.rpe_cible != null ? nombre(s.rpe_cible) : null],
  ].filter(([, v]) => v);

  return (
    <Feuille titre="Séance prévue" onClose={onClose} classe="feuille-detail">
      <div className="flex items-center gap-3.5">
        <span className="w-14 h-14 shrink-0 rounded-full flex items-center justify-center text-[28px]"
          style={{ backgroundColor: `${info.couleur}26` }}>{s.emoji ?? info.emoji}</span>
        <div className="min-w-0">
          <p className="text-[20px] font-bold leading-6">{s.titre}</p>
          <p className="mt-1 flex items-center gap-2 text-[13px] text-label-2">
            {info.label}<span className={`badge ${statut.cls}`}>{statut.label}</span>
          </p>
        </div>
      </div>

      {mesures.length > 0 && (
        <div className={`card grid divide-x-[0.5px] divide-separateur py-3`}
          style={{ gridTemplateColumns: `repeat(${mesures.length}, minmax(0, 1fr))` }}>
          {mesures.map(([l, v]) => (
            <div key={l} className="px-2 text-center">
              <p className="text-[12px] font-semibold text-label-2">{l}</p>
              <p className="font-rounded text-[19px] font-bold tracking-[-0.02em] chiffres">{v}</p>
            </div>
          ))}
        </div>
      )}

      {s.description && <ContenuSeance description={s.description} couleur={info.couleur} />}

      {s.activite && (
        <section className="space-y-1.5">
          <h4 className="px-1 text-[13px] uppercase tracking-[0.02em] font-medium text-ios-green">
            ✓ Réalisée{s.lien_manuel ? " · lien manuel" : ""}
          </h4>
          <div className="card py-0.5">
            <ActiviteLigne a={s.activite} onClick={() => { onClose(); onOuvrirActivite(s.activite); }} />
          </div>
        </section>
      )}

      {!s.description && !s.activite && !mesures.length && (
        <p className="text-[15px] text-label-2 text-center">Aucun détail pour cette séance.</p>
      )}

      {ITINERAIRE[s.sport] && s.statut !== "realisee" && !s.activite && (
        <Link onClick={onClose} className="btn-teinte w-full"
          to={`/itineraires?${new URLSearchParams(Object.entries({ sport: s.sport, distance: s.distance_km ?? "", dplus: s.dplus_m ?? "" }).filter(([, v]) => v !== ""))}`}>
          Proposer un parcours
        </Link>
      )}

      <CommentaireSeance s={s} />
    </Feuille>
  );
}

// ── Commentaire de l'athlète (bas de la feuille) ───────────────────────────
// Enregistré au fil de la frappe ; conservé quand la séance est reliée à une
// activité et lu par le coach pour le bilan de la semaine et le plan suivant.
function CommentaireSeance({ s }) {
  const qc = useQueryClient();
  const [texte, setTexte] = useState(s.commentaire ?? "");
  const [etat, setEtat] = useState(null); // null | "attente" | "ok" | "erreur"
  const enregistre = useRef((s.commentaire ?? "").trim());
  const minuteur = useRef(null);
  const courant = useRef(texte);
  courant.current = texte;

  const enregistrer = async () => {
    clearTimeout(minuteur.current);
    const valeur = courant.current.trim();
    if (valeur === enregistre.current) { setEtat((e) => (e === "attente" ? null : e)); return; }
    enregistre.current = valeur;
    try {
      await modifierPrevue(s.id, { commentaire: valeur });
      setEtat("ok");
      invaliderPlan(qc);
    } catch {
      enregistre.current = null;
      setEtat("erreur");
    }
  };
  const enregistrerRef = useRef(enregistrer);
  enregistrerRef.current = enregistrer;
  // Fermeture de la feuille : on n'abandonne pas une saisie en cours
  useEffect(() => () => { enregistrerRef.current(); }, []);

  const changer = (v) => {
    setTexte(v);
    setEtat("attente");
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => enregistrerRef.current(), 900);
  };

  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h4 className="text-[13px] uppercase tracking-[0.02em] font-medium text-label-2">Commentaire</h4>
        <span className={`text-[12px] ${etat === "erreur" ? "text-ios-red" : "text-label-2"}`} aria-live="polite">
          {etat === "ok" ? "Enregistré ✓" : etat === "erreur" ? "Échec de l'enregistrement" : ""}
        </span>
      </div>
      <div className="card">
        <textarea rows={3} value={texte} onChange={(e) => changer(e.target.value)} onBlur={() => enregistrerRef.current()}
          aria-label="Commentaire sur la séance"
          placeholder="Ressenti, charge trop lourde ou trop légère, douleur, raison d'un report…"
          className="block w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-6 outline-none placeholder:text-label-3" />
      </div>
      <p className="px-1 text-[12px] leading-4 text-label-2">
        Gardé quand la séance est reliée à une activité, et pris en compte pour le bilan de la semaine et le prochain plan.
      </p>
    </section>
  );
}

// ── Séance prévue (ligne de la liste de la semaine) ────────────────────────
// Sport, intitulé et durée estimée ; le reste s'affiche dans la feuille de détail.
function CarteSeance({ s, onOuvrirActivite }) {
  const qc = useQueryClient();
  const [detail, setDetail] = useState(false);
  const [choix, setChoix] = useState(false);
  const [confirmSuppr, setConfirmSuppr] = useState(false);
  const info = sportInfo(s.sport);
  const sautee = s.statut === "sautee";
  const { formats, exercices } = resumeSeance(s.description);

  const maj = useMutation({
    mutationFn: (payload) => modifierPrevue(s.id, payload),
    onSuccess: () => { invaliderPlan(qc); setChoix(false); },
  });
  const suppr = useMutation({
    mutationFn: () => supprimerPrevue(s.id),
    onSuccess: () => { invaliderPlan(qc); setConfirmSuppr(false); },
  });

  const action = "btn-sm font-medium !px-3 md:!px-3.5 !text-[13px] md:!text-[15px]";
  const pastille = "inline-flex items-center h-[22px] px-2 rounded-md text-[12px] font-medium whitespace-nowrap";
  // Exercices : 2 sur téléphone, 6 sur ordinateur, le reste en « +N »
  const reste = (n) => exercices.length - n;

  return (
    <div className="ligne !items-stretch flex-col !gap-2.5 !py-3">
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
        <button type="button" onClick={() => setDetail(true)} aria-label={`Voir le détail : ${s.titre}`}
          className={`flex-1 min-w-0 flex items-center gap-3 text-left -mx-2 px-2 py-1 rounded-xl transition-colors active:bg-remplissage md:hover:bg-remplissage/60 ${sautee ? "opacity-55" : ""}`}>
          <span className="w-10 h-10 shrink-0 self-start rounded-full flex items-center justify-center text-[19px]"
            style={{ backgroundColor: `${info.couleur}26` }} aria-hidden>{s.emoji ?? info.emoji}</span>
          <span className="flex-1 min-w-0">
            <span className={`block text-[15px] font-semibold leading-5 truncate ${sautee ? "line-through" : ""}`}>{s.titre}</span>
            <span className="flex items-center gap-1.5 text-[13px] text-label-2 chiffres">
              {s.duree_min != null ? fmtDuree(s.duree_min * 60) : "Durée non précisée"}
              {s.commentaire && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round"
                  className="w-[13px] h-[13px]" role="img" aria-label="Commentée"><path d="M4 5h16v11H9l-5 4V5z" /></svg>
              )}
            </span>
            {(formats.length > 0 || exercices.length > 0) && (
              <span className="mt-1.5 flex flex-wrap gap-1">
                {formats.map((f) => <span key={f} className={`${pastille} !font-semibold bg-ios-indigo/15 text-ios-indigo`}>{f}</span>)}
                {exercices.map((e, i) => (
                  <span key={i} className={`${pastille} bg-remplissage text-label ${i >= 6 ? "hidden" : i >= 2 ? "hidden md:inline-flex" : ""}`}>{e}</span>
                ))}
                {reste(2) > 0 && <span className={`${pastille} !px-1 text-label-2 md:hidden`}>+{reste(2)}</span>}
                {reste(6) > 0 && <span className={`${pastille} !px-1 text-label-2 hidden md:inline-flex`}>+{reste(6)}</span>}
              </span>
            )}
          </span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
            className="w-[14px] h-[14px] shrink-0 text-label-3 md:hidden" aria-hidden><path d="M9 5l7 7-7 7" /></svg>
        </button>

        <div className="flex justify-end gap-1.5 shrink-0">
          {sautee ? (
            <button className={`btn-gris ${action}`} disabled={maj.isPending} onClick={() => maj.mutate({ statut: "prevue" })}>Rétablir</button>
          ) : s.activite ? (
            <button className={`btn-gris ${action}`} disabled={maj.isPending} onClick={() => maj.mutate({ delier: true })}>Délier</button>
          ) : (
            <button className={`btn-gris ${action}`} disabled={maj.isPending} onClick={() => maj.mutate({ statut: "sautee" })}>Sautée</button>
          )}
          <button className={`btn-gris ${action}`} disabled={sautee} onClick={() => setChoix(!choix)}>{s.activite ? "Changer" : "Relier"}</button>
          <button className={`btn-danger ${action}`} onClick={() => setConfirmSuppr(true)}>Supprimer</button>
        </div>
      </div>

      {choix && (
        <div className="md:pl-[3.25rem]">
          <ChoixActivite prevue={s} onClose={() => setChoix(false)} onChoix={(id) => maj.mutate({ activite_id: id })} />
        </div>
      )}

      {detail && <DetailSeance s={s} onClose={() => setDetail(false)} onOuvrirActivite={onOuvrirActivite} />}

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
// ── Bilan prévu / réalisé par sport ────────────────────────────────────────
// Jauge en minutes par sport (séances sautées exclues du prévu), puis les écarts
// au plan : séances non réalisées, sautées ou faites dans un autre sport.
function BilanSports({ seances, activites, courante }) {
  const parSport = {};
  const ligne = (sp) => (parSport[sp] ??= { sport: sp, prevu: 0, fait: 0 });
  seances.filter((s) => s.statut !== "sautee").forEach((s) => { ligne(s.sport).prevu += s.duree_min ?? 0; });
  activites.forEach((a) => { ligne(a.sport).fait += (a.duree_sec ?? 0) / 60; });
  const lignes = Object.values(parSport).filter((l) => l.prevu || l.fait).sort((a, b) => b.prevu - a.prevu || b.fait - a.fait);

  const ecarts = [
    ...seances.filter((s) => s.statut === "manquee").map((s) => ({ s, label: "Non réalisée", cls: "text-ios-orange" })),
    ...seances.filter((s) => s.statut === "sautee").map((s) => ({ s, label: "Sautée", cls: "text-label-2" })),
    ...seances.filter((s) => s.statut === "realisee" && s.activite?.sport && s.activite.sport !== s.sport)
      .map((s) => ({ s, label: `Faite en ${sportInfo(s.activite.sport).label.toLowerCase()}`, cls: "text-brand" })),
  ];
  if (!lignes.length) return null;

  return (
    <Card>
      <p className="text-[13px] font-semibold text-label-2 mb-3">{courante ? "Bilan de la semaine en cours" : "Bilan de la semaine"}</p>
      <div className="space-y-3">
        {lignes.map((l) => {
          const info = sportInfo(l.sport);
          const pct = l.prevu ? Math.min(100, (l.fait / l.prevu) * 100) : 100;
          const depasse = !!l.prevu && l.fait > l.prevu * 1.05;  // sans `!!`, React afficherait « 0 »
          return (
            <div key={l.sport}>
              <div className="flex items-baseline justify-between gap-2 text-[15px]">
                <span className="truncate"><span aria-hidden className="mr-1.5">{info.emoji}</span>{info.label}</span>
                <span className="chiffres text-label-2 shrink-0">
                  <span className="font-semibold text-label">{l.fait ? fmtDuree(Math.round(l.fait) * 60) : "0 min"}</span>
                  {" / "}{l.prevu ? fmtDuree(l.prevu * 60) : "hors plan"}
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-remplissage overflow-hidden" role="progressbar"
                aria-label={info.label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${pct}%`, background: info.couleur, opacity: l.prevu ? 1 : 0.45 }} />
              </div>
              {depasse && <p className="text-[12px] text-label-2 mt-1">+{fmtDuree(Math.round(l.fait - l.prevu) * 60)} au-delà du plan</p>}
            </div>
          );
        })}
      </div>
      {ecarts.length > 0 && (
        <div className="mt-4 pt-3 border-t-[0.5px] border-separateur space-y-1.5">
          <p className="text-[13px] font-semibold text-label-2">Écarts au plan</p>
          {ecarts.map(({ s, label, cls }) => (
            <div key={`${s.id}-${label}`} className="flex items-center gap-2 text-[15px]">
              <span aria-hidden>{sportInfo(s.sport).emoji}</span>
              <span className="flex-1 min-w-0 truncate">{s.titre}</span>
              <span className={`text-[13px] font-semibold shrink-0 ${cls}`}>{label}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Plan() {
  const [lundi, setLundi] = useState(() => lundiDe(new Date()));
  const [modalActivite, setModalActivite] = useState(undefined);
  const [ajout, setAjout] = useState(false);
  const [importIa, setImportIa] = useState(false);
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
    <Page titre="Plan" sousTitre="Séances prévues"
      action={<span className="flex items-center gap-2">
        <Link to="/itineraires" className="btn-texte" aria-label="Itinéraires">Itinéraires</Link>
        <button className="btn-texte" onClick={() => setImportIa(true)}>Plan IA</button>
        <BoutonAjout onClick={() => setAjout(true)} label="Ajouter une séance prévue" />
      </span>}>

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

      {!isLoading && <BilanSports seances={seances} activites={activites} courante={courante} />}

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
        <div className="text-center space-y-3 px-4">
          <p className="text-[13px] text-label-2">
            Aucune séance prévue cette semaine. Fais préparer ton plan par ton IA (ChatGPT, Gemini, Claude…)
            ou ajoute tes séances avec le bouton +.
          </p>
          <button className="btn-primaire btn-sm" onClick={() => setImportIa(true)}>Préparer le plan avec une IA</button>
        </div>
      )}

      {modalActivite !== undefined && <ModalActivite activite={modalActivite} onClose={() => setModalActivite(undefined)} />}
      {ajout && <ModalPrevue semaine={depuis} onClose={() => setAjout(false)} />}
      {importIa && <ImportPlan semaine={depuis} onClose={() => setImportIa(false)} />}
    </Page>
  );
}

// ── « Prochaines séances » de l'accueil ────────────────────────────────────
export function ProchainesSeances() {
  const lundi = lundiDe(new Date());
  const depuis = iso(lundi);
  const jusqu = iso(ajouter(lundi, 6));
  const { data } = useQuery({ queryKey: ["plan", depuis, jusqu], queryFn: () => getPlan(depuis, jusqu) });
  // Même liste que « À faire » sur la page Plan, sans plafond
  const prochaines = (data?.seances ?? []).filter((s) => s.statut !== "realisee" && s.statut !== "sautee");

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
