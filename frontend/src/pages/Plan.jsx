import { useState, useEffect, useRef, useMemo } from "react";
import { debutSemaine } from "../preferences";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import Card from "../components/Card";
import Page from "../components/Page";
import Feuille from "../components/Feuille";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import ConfirmDialog from "../components/ConfirmDialog";
import ImportPlan from "../components/ImportPlan";
import ContenuSeance from "../components/ContenuSeance";
import SeanceEnCours, { seanceSauvegardee } from "../components/SeanceEnCours";
import CourseEnCours from "../components/CourseEnCours";
import { courseGuidable } from "../seanceCourse";
import { resumeSeance, analyserDescription } from "../seance";
import { DIFFICULTES, fmtChrono } from "../seanceGuidee";
import { debloquerSon } from "../son";
import { Section, BoutonAjout, Squelettes, Segmente, Interrupteur } from "../components/ui";
import EditeurBlocs, { erreurStructure, SPORTS_ALLURE } from "../components/EditeurBlocs";
import {
  typePourSport, structureVide, descriptionDepuis, dureeEstimee, structureDepuisDescription,
} from "../blocs";
import {
  getPlan, getActivites, creerPrevue, modifierPrevue, supprimerPrevue, getActivitesProches, getSeancesTypes,
  getModeles, creerModele, supprimerModele, envoyerMontre, retirerMontre, getIntervals,
} from "../api";
import { SPORTS, sportInfo, fmtDuree, fmtDate, nombre, inputCls, fmtDistance } from "../carnet";

// ── Dates (jours locaux au format AAAA-MM-JJ) ──────────────────────────────
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ajouter = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
// Premier jour de la semaine affichée, selon le réglage du Profil (lundi ou dimanche)
const debutDe = (d) => new Date(`${debutSemaine(d)}T00:00`);
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
    s.distance_km != null && `${fmtDistance(s.distance_km)}`,
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
      {isLoading ? <Squelettes forme="lignes" n={2} label="Chargement des activités" />
        : !data?.length ? <p className="text-[13px] text-label-2 px-4 pb-2">Aucune activité cette semaine.</p>
        : data.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => onChoix(a.id)} />)}
    </div>
  );
}

// ── Détail d'une séance prévue (feuille ouverte au toucher de la carte) ───────
// Sports pour lesquels la page Itinéraires sait proposer un parcours
const ITINERAIRE = { course: 1, trail: 1, randonnee: 1, marche: 1, velo: 1 };

// ── Envoi sur la montre (calendrier Intervals.icu) ─────────────────────────
const CONSEILS_MONTRE = {
  garmin: "Elle arrive dans le calendrier Garmin Connect, puis sur la montre à la synchronisation suivante (si l’envoi des séances prévues est activé dans les réglages Garmin d’Intervals.icu).",
  coros: "Elle arrive dans le calendrier de l’app COROS. Si tu la retires ici, vérifie aussi sur la montre : COROS y garde parfois les séances supprimées.",
  suunto: "Elle arrive dans l’app Suunto, puis sur la montre à la synchronisation suivante.",
  apple: "Sur Apple Watch, ouvre l’app Intervals.icu Companion sur l’iPhone pour l’ajouter à l’app Exercice.",
  polar: "Polar ne reçoit pas les séances d’Intervals.icu : elle restera visible dans ton calendrier Intervals.icu.",
};
const CONSEIL_DEFAUT = "Elle est ajoutée à ton calendrier Intervals.icu ; selon ta montre, elle peut s’y synchroniser.";

function BlocMontre({ s }) {
  const qc = useQueryClient();
  const { data: iv, isLoading } = useQuery({ queryKey: ["intervals"], queryFn: getIntervals, staleTime: 60_000 });
  const aujourdhui = iso(new Date());
  const lundi = lundiDe(new Date(`${s.jour}T00:00`));
  const jours = Array.from({ length: 7 }, (_, i) => ajouter(lundi, i)).filter((d) => iso(d) >= aujourdhui);
  const envoi = s.montre;
  const [jour, setJour] = useState(() => envoi?.jour ?? (jours[0] ? iso(jours[0]) : null));
  const [erreur, setErreur] = useState(null);
  const message = (e) => (typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Envoi impossible pour le moment, réessaie plus tard.");

  const envoyer = useMutation({
    mutationFn: () => envoyerMontre(s.id, jour),
    onSuccess: () => { setErreur(null); invaliderPlan(qc); },
    onError: (e) => setErreur(message(e)),
  });
  const retirer = useMutation({
    mutationFn: () => retirerMontre(s.id),
    onSuccess: () => { setErreur(null); invaliderPlan(qc); },
    onError: (e) => setErreur(message(e)),
  });

  if (!envoi && !jours.length) return null; // semaine passée
  const occupe = envoyer.isPending || retirer.isPending;
  const perime = envoi && (!envoi.a_jour || (jour && jour !== envoi.jour));
  const fmtJour = (j) => fmtDate(new Date(`${j}T00:00`), { weekday: "long", day: "numeric", month: "long" });

  return (
    <section className="space-y-1.5">
      <h4 className="px-1 text-[13px] uppercase tracking-[0.02em] font-medium text-label-2">Sur ma montre</h4>
      <div className="card p-3.5 space-y-3">
        {isLoading ? <Squelettes n={1} /> : !iv?.connecte ? (
          <p className="text-[14px] text-label-2">
            Pour envoyer tes séances sur ta montre, connecte d’abord Intervals.icu.{" "}
            <Link to="/sources" className="text-brand font-medium">Sources</Link>
          </p>
        ) : (
          <>
            {envoi && (
              <p className="text-[14px]">
                <span className="font-semibold text-ios-green">✓ Envoyée</span> pour le {fmtJour(envoi.jour)}
                {!envoi.a_jour && <span className="block text-[13px] text-ios-orange">Séance modifiée depuis l’envoi : renvoie-la pour mettre la montre à jour.</span>}
              </p>
            )}
            {jours.length > 0 && (
              <label className="flex items-center justify-between gap-3">
                <span className="text-[15px]">Jour</span>
                <select className={`${inputCls} !w-auto`} value={jour ?? ""} onChange={(e) => setJour(e.target.value)}>
                  {jours.map((d) => <option key={iso(d)} value={iso(d)}>{fmtJour(iso(d))}</option>)}
                  {envoi && !jours.some((d) => iso(d) === envoi.jour) && <option value={envoi.jour} disabled>{fmtJour(envoi.jour)}</option>}
                </select>
              </label>
            )}
            <div className="flex gap-2">
              {jours.length > 0 && (!envoi || perime) && (
                <button type="button" className="btn-primaire flex-1" disabled={occupe || !jour || !jours.some((d) => iso(d) === jour)}
                  onClick={() => envoyer.mutate()}>
                  {envoyer.isPending ? "Envoi…" : envoi ? "Renvoyer" : "Envoyer sur ma montre"}
                </button>
              )}
              {envoi && (
                <button type="button" className="btn-gris flex-1" disabled={occupe} onClick={() => retirer.mutate()}>
                  {retirer.isPending ? "…" : "Retirer de la montre"}
                </button>
              )}
            </div>
            <p className="text-[12px] leading-4 text-label-2">{CONSEILS_MONTRE[iv.montre] ?? CONSEIL_DEFAUT}</p>
          </>
        )}
        {erreur && <p className="text-[13px] text-ios-red" role="alert">{erreur}</p>}
      </div>
    </section>
  );
}

function DetailSeance({ s, onClose, onOuvrirActivite }) {
  const qc = useQueryClient();
  const info = sportInfo(s.sport);
  const statut = STATUTS[s.statut] ?? STATUTS.a_venir;
  const [enCours, setEnCours] = useState(false);
  const [edition, setEdition] = useState(false);
  const blocsMuscu = s.structure?.type === "muscu";
  const contenu = useMemo(() => (s.description ? analyserDescription(s.description, { muscu: blocsMuscu }) : null), [s.description, blocsMuscu]);
  const muscu = contenu?.type === "muscu" && contenu.sections.some((x) => x.exercices.length);
  const course = !muscu && courseGuidable(contenu);
  const guidable = (muscu || course) && s.statut !== "realisee";
  const reprise = guidable && seanceSauvegardee(s.id);
  const aFaire = s.statut !== "realisee" && !s.activite && !s.deroule?.fin;
  const modifiable = aFaire && !seanceSauvegardee(s.id);
  const mesures = [
    ["Durée", s.duree_min != null ? fmtDuree(s.duree_min * 60) : null],
    ["Distance", s.distance_km != null ? `${fmtDistance(s.distance_km)}` : null],
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
        {guidable && (
          <button type="button" onClick={() => { debloquerSon(); setEnCours(true); }}
            aria-label={reprise ? "Reprendre la séance" : "Lancer la séance"}
            className="ml-auto shrink-0 flex flex-col items-center gap-1 active:scale-95 transition-transform">
            <span className="w-12 h-12 rounded-full flex items-center justify-center text-white shadow-[0_4px_14px_rgba(175,82,222,0.35)]"
              style={{ backgroundColor: info.couleur }}>
              <svg viewBox="0 0 12 14" className="w-4 h-4 ml-0.5" aria-hidden><path d="M1 1.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 1 1.5z" fill="currentColor" /></svg>
            </span>
            <span className="text-[11px] font-semibold" style={{ color: info.couleur }}>{reprise ? "Reprendre" : "Lancer"}</span>
          </button>
        )}
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

      {s.deroule?.fin && <RecapDeroule d={s.deroule} />}

      {s.description && <ContenuSeance description={s.description} couleur={info.couleur} muscu={blocsMuscu} />}

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

      {aFaire && <BlocMontre key={s.id} s={s} />}

      {modifiable && (
        <button type="button" className="btn-gris w-full" onClick={() => setEdition(true)}>Modifier la séance</button>
      )}

      <CommentaireSeance s={s} />

      {edition && <ModalPrevue seance={s} onClose={() => setEdition(false)} />}
      {enCours && course && <CourseEnCours s={s} contenu={contenu} onClose={() => setEnCours(false)} />}
      {enCours && muscu && (
        <SeanceEnCours s={s} contenu={contenu} onClose={() => setEnCours(false)}
          onEnregistree={() => { setEnCours(false); invaliderPlan(qc); onClose(); }} />
      )}
    </Feuille>
  );
}

// ── Séance guidée faite : difficulté et ressenti de chaque exercice ─────────
const LIBELLE_DIFFICULTE = Object.fromEntries(DIFFICULTES);

function RecapDeroule({ d }) {
  const exos = (d.exercices ?? []).filter((e) => e.difficulte || e.ressenti || e.passe);
  return (
    <section className="space-y-1.5">
      <h4 className="px-1 text-[13px] uppercase tracking-[0.02em] font-medium text-ios-green">
        ✓ Séance guidée{d.duree_s ? ` · ${fmtChrono(d.duree_s)}` : ""}
      </h4>
      {exos.length > 0 && (
        <div className="card divide-y-[0.5px] divide-separateur">
          {exos.map((e, i) => (
            <div key={i} className="px-4 py-2.5">
              <p className="flex items-baseline justify-between gap-2 text-[15px] font-semibold">
                <span className="min-w-0 truncate">{e.nom}</span>
                <span className="shrink-0 text-[13px] font-normal text-label-2">
                  {e.passe ? "Passé" : LIBELLE_DIFFICULTE[e.difficulte] ?? ""}
                </span>
              </p>
              {e.ressenti && <p className="mt-0.5 text-[14px] leading-5 text-label-2">{e.ressenti}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
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
function CarteSeance({ s, onOuvrirActivite, ouverte = false }) {
  const qc = useQueryClient();
  const [detail, setDetail] = useState(ouverte);
  const [choix, setChoix] = useState(false);
  const [confirmSuppr, setConfirmSuppr] = useState(false);
  const serie = (s.id_externe ?? "").startsWith("rec-");
  const info = sportInfo(s.sport);
  const sautee = s.statut === "sautee";
  const { formats, exercices } = resumeSeance(s.description, { muscu: s.structure?.type === "muscu" });

  const maj = useMutation({
    mutationFn: (payload) => modifierPrevue(s.id, payload),
    onSuccess: () => { invaliderPlan(qc); setChoix(false); },
  });
  const suppr = useMutation({
    mutationFn: (suite) => supprimerPrevue(s.id, suite),
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
        message={serie ? `« ${s.titre} » fait partie d’une série répétée. Supprimer cette séance seulement, ou aussi les suivantes ?`
          : `« ${s.titre} » sera retirée du plan de la semaine.`}
        confirmLabel={serie ? "Cette séance seulement" : "Supprimer"} onConfirm={() => suppr.mutate(false)} onCancel={() => setConfirmSuppr(false)}>
        {serie && (
          <button type="button" className="btn-danger w-full !mt-3" disabled={suppr.isPending} onClick={() => suppr.mutate(true)}>
            Celle-ci et les suivantes de la série
          </button>
        )}
      </ConfirmDialog>
    </div>
  );
}

// ── Séance réalisée hors plan (vélotaf, import Santé…) : simplement « faite » ──
function LigneFaite({ a, onClick }) {
  const info = sportInfo(a.sport);
  const metriques = [
    a.duree_str,
    a.distance_km != null && `${fmtDistance(a.distance_km, 2)}`,
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

// ── Bibliothèque de séances types (cibles calculées sur les zones du moment) ──
function SeancesTypes({ onClose, onChoisir }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["seances-types"], queryFn: getSeancesTypes, staleTime: 300000 });
  const [categorie, setCategorie] = useState(null);
  const categories = data?.categories ?? [];
  const active = categorie ?? categories[0];
  const liste = (data?.seances ?? []).filter((t) => t.categorie === active);

  return (
    <Feuille titre="Séances types" onClose={onClose} large>
      {isLoading && <Squelettes n={4} label="Chargement des séances types" />}
      {isError && <p className="py-8 text-center text-[15px] text-ios-red">Bibliothèque indisponible pour le moment.</p>}
      {data && (
        <>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap" role="tablist" aria-label="Catégories">
            {categories.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={c === active}
                className={`puce shrink-0 ${c === active ? "puce-active" : ""}`} onClick={() => setCategorie(c)}>{c}</button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {liste.map((t) => {
              const info = sportInfo(t.sport);
              return (
                <button key={t.cle} type="button" onClick={() => onChoisir(t)}
                  className="card p-4 text-left flex flex-col gap-2 active:opacity-70 hover:bg-remplissage/40 transition-colors">
                  <span className="flex items-center gap-2.5">
                    <span className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-[18px]"
                      style={{ backgroundColor: `${info.couleur}26` }}>{info.emoji}</span>
                    <span className="min-w-0">
                      <span className="block text-[16px] font-semibold leading-5">{t.titre}</span>
                      <span className="block text-[13px] text-label-2 chiffres">
                        {t.duree_min ? fmtDuree(t.duree_min * 60) : "—"}{t.rpe_cible ? ` · RPE ${nombre(t.rpe_cible)}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="text-[14px] leading-[19px] text-label-2">{t.resume}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[13px] leading-[18px] text-label-2">
            {data.zones_connues || data.allures_connues
              ? "Les cibles (fréquence cardiaque, allure) sont calculées sur tes zones du moment : elles suivent tes progrès."
              : "Tes zones ne sont pas encore connues : les cibles sont données à l’effort ressenti."}
            {" "}Tout reste modifiable avant d’ajouter la séance.
          </p>
        </>
      )}
    </Feuille>
  );
}

// ── Mes modèles de séance ──────────────────────────────────────────────────
function MesModeles({ onChoisir, onClose }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["modeles"], queryFn: getModeles });
  const [aSupprimer, setASupprimer] = useState(null);
  const suppr = useMutation({
    mutationFn: (id) => supprimerModele(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["modeles"] }); setASupprimer(null); },
  });
  return (
    <Feuille titre="Mes modèles" onClose={onClose}>
      {isLoading ? <Squelettes n={3} /> : !data?.length ? (
        <p className="text-[15px] text-label-2 text-center py-6">
          Aucun modèle pour l’instant. Prépare une séance puis touche « Enregistrer comme modèle ».
        </p>
      ) : (
        <div className="card py-0.5">
          {data.map((m) => {
            const info = sportInfo(m.sport);
            return (
              <div key={m.id} className="ligne">
                <button type="button" className="flex-1 min-w-0 flex items-center gap-3 text-left" onClick={() => onChoisir(m)}>
                  <span className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-[17px]"
                    style={{ backgroundColor: `${info.couleur}26` }} aria-hidden>{info.emoji}</span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold truncate">{m.nom}</span>
                    <span className="block text-[13px] text-label-2 truncate">
                      {m.titre}{m.duree_min ? ` · ${fmtDuree(m.duree_min * 60)}` : ""}{m.structure ? " · blocs" : ""}
                    </span>
                  </span>
                </button>
                <button type="button" className="btn-texte !text-ios-red text-[14px] shrink-0" onClick={() => setASupprimer(m)}>
                  Supprimer
                </button>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog open={!!aSupprimer} title="Supprimer ce modèle ?" danger pending={suppr.isPending}
        message={aSupprimer ? `Le modèle « ${aSupprimer.nom} » sera supprimé. Les séances déjà prévues ne changent pas.` : ""}
        confirmLabel="Supprimer" onConfirm={() => suppr.mutate(aSupprimer.id)} onCancel={() => setASupprimer(null)} />
    </Feuille>
  );
}

// ── Ajouter ou modifier une séance prévue (texte libre ou blocs) ───────────
const versChamp = (v) => (v == null ? "" : String(v));

function ModalPrevue({ semaine, seance = null, onClose }) {
  const qc = useQueryClient();
  const edition = !!seance;
  const [f, setF] = useState(() => ({
    sport: seance?.sport ?? "course", titre: seance?.titre ?? "",
    // durée calculée depuis les blocs : champ laissé vide pour qu'elle suive les modifications
    duree_min: seance?.structure && seance.duree_min === Math.round(dureeEstimee(seance.structure) ?? -1) ? "" : versChamp(seance?.duree_min),
    distance_km: versChamp(seance?.distance_km), dplus_m: versChamp(seance?.dplus_m),
    rpe_cible: versChamp(seance?.rpe_cible), description: seance?.description ?? "",
  }));
  // null : contenu en texte libre ; sinon séance construite par blocs
  const [structure, setStructure] = useState(seance?.structure ?? null);
  // Texte d'avant le passage aux blocs : rendu tel quel si l'on revient au texte sans rien changer
  const origine = useRef(null);
  const [avisBlocs, setAvisBlocs] = useState(null);
  const [rep, setRep] = useState({ actif: false, toutes: 1, fois: 4 });
  const [erreur, setErreur] = useState(null);
  const [biblio, setBiblio] = useState(false);
  const [modeles, setModeles] = useState(false);
  const [nomModele, setNomModele] = useState(null); // null : champ fermé
  const [modeleOk, setModeleOk] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
  const message = (e) => {
    const d = e?.response?.data?.detail;
    return typeof d === "string" ? d : Array.isArray(d) ? "Vérifie les champs saisis." : "Erreur lors de l'enregistrement";
  };

  const estimee = structure ? dureeEstimee(structure) : null;

  // Contenu prêt à envoyer (création, modification, modèle)
  function contenu() {
    const desc = structure ? descriptionDepuis(structure) : f.description.trim();
    return {
      sport: f.sport, titre: f.titre.trim(), description: desc || null,
      duree_min: num(f.duree_min) ?? (estimee ? Math.round(estimee) : null),
      distance_km: num(f.distance_km), dplus_m: num(f.dplus_m), rpe_cible: num(f.rpe_cible),
      structure: structure ?? null,
    };
  }

  const enregistrer = useMutation({
    mutationFn: (payload) => (edition
      ? modifierPrevue(seance.id, payload)
      : creerPrevue({ jour: semaine, ...payload, ...(rep.actif ? { repetition: { toutes: rep.toutes, fois: rep.fois } } : {}) })),
    onSuccess: () => { invaliderPlan(qc); onClose(); },
    onError: (e) => setErreur(message(e)),
  });
  const modele = useMutation({
    mutationFn: (payload) => creerModele(payload),
    onSuccess: (m) => { qc.invalidateQueries({ queryKey: ["modeles"] }); setNomModele(null); setModeleOk(`Modèle « ${m.nom} » enregistré.`); },
    onError: (e) => setErreur(message(e)),
  });

  function verifier() {
    if (!f.titre.trim()) return "Le titre est obligatoire.";
    for (const k of ["duree_min", "distance_km", "dplus_m"]) {
      const v = num(f[k]);
      if (v != null && (Number.isNaN(v) || v < 0)) return "Durée, distance et dénivelé : des nombres positifs.";
    }
    return erreurStructure(structure);
  }

  function soumettre(e) {
    e.preventDefault();
    const err = verifier();
    setErreur(err);
    if (!err) enregistrer.mutate(contenu());
  }

  function enregistrerModele() {
    const err = verifier();
    if (err) { setErreur(err); return; }
    if (!nomModele?.trim()) { setErreur("Donne un nom au modèle."); return; }
    setErreur(null);
    modele.mutate({ nom: nomModele.trim(), ...contenu() });
  }

  function basculer(mode) {
    if (mode === "blocs" && !structure) {
      const texte = f.description.trim();
      const lue = texte ? structureDepuisDescription(f.description, f.sport) : null;
      const s = lue || structureVide(typePourSport(f.sport));
      origine.current = texte ? { texte: f.description, structure: s } : null;
      setAvisBlocs(!texte ? null : lue
        ? "Le texte a été découpé en blocs : vérifie-les avant d'enregistrer. Tant que tu ne changes rien, revenir sur « Texte » rend le texte d'origine."
        : "Ce texte n'a pas pu être découpé : les blocs partent d'une séance vide. Reviens sur « Texte » pour le retrouver ; enregistrer en blocs le remplacera.");
      setStructure(s);
    } else if (mode === "texte" && structure) {
      const o = origine.current;
      const inchange = o && JSON.stringify(o.structure) === JSON.stringify(structure);
      setF((p) => ({ ...p, description: inchange ? o.texte : descriptionDepuis(structure) }));
      origine.current = null;
      setAvisBlocs(null);
      setStructure(null);
    }
  }

  function changerSport(e) {
    const sport = e.target.value;
    setF((p) => ({ ...p, sport }));
    // l'éditeur change de forme (étapes ↔ exercices) : on repart d'une séance vide du bon type
    if (structure && typePourSport(sport) !== structure.type) setStructure(structureVide(typePourSport(sport)));
    // allure sans objet pour ce sport : retirée (champ masqué, rien de caché n'est écrit)
    else if (structure?.type === "endurance" && !SPORTS_ALLURE.has(sport)) {
      setStructure((s) => ({ ...s, etapes: s.etapes.map((e) => ({ ...e, allure_min: null, allure_max: null })) }));
    }
  }

  function appliquer(m) {
    setF({
      sport: m.sport, titre: m.titre ?? "", duree_min: versChamp(m.duree_min), distance_km: versChamp(m.distance_km),
      dplus_m: versChamp(m.dplus_m), rpe_cible: versChamp(m.rpe_cible), description: m.description ?? "",
    });
    setStructure(m.structure ?? null);
    origine.current = null;
    setAvisBlocs(null);
    setModeles(false);
    setBiblio(false);
  }

  const occupe = enregistrer.isPending;
  const libelle = edition ? "Enregistrer" : "Ajouter";

  return (
    <Feuille as="form" onSubmit={soumettre} onClose={onClose} titre={edition ? "Modifier la séance" : "Séance prévue"} large={!!structure}
      action={<button type="submit" className="btn-texte font-semibold" disabled={occupe}>{occupe ? "…" : libelle}</button>}>
      <div className="flex gap-2">
        <button type="button" className="btn-teinte flex-1" onClick={() => setBiblio(true)}>Séance type</button>
        <button type="button" className="btn-teinte flex-1" onClick={() => setModeles(true)}>Mes modèles</button>
      </div>
      {biblio && <SeancesTypes onClose={() => setBiblio(false)} onChoisir={(t) => appliquer({ ...t, structure: null })} />}
      {modeles && <MesModeles onClose={() => setModeles(false)} onChoisir={appliquer} />}

      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <L label="Sport" className="col-span-2">
          <select className={inputCls} value={f.sport} onChange={changerSport}>
            {Object.entries(SPORTS).map(([k, s]) => <option key={k} value={k}>{s.emoji} {s.label}</option>)}
          </select>
        </L>
        <L label="Titre" className="col-span-2">
          <input required maxLength={200} className={inputCls} value={f.titre} onChange={set("titre")} placeholder="Footing, fractionné, renfo…" />
        </L>
        <L label="Durée (min)">
          <input inputMode="numeric" className={inputCls} value={f.duree_min} onChange={set("duree_min")}
            placeholder={estimee ? `≈ ${Math.round(estimee)}` : ""} />
        </L>
        <L label="Distance (km)">
          <input inputMode="decimal" className={inputCls} value={f.distance_km} onChange={set("distance_km")} />
        </L>
        <L label="Dénivelé (m)">
          <input inputMode="numeric" className={inputCls} value={f.dplus_m} onChange={set("dplus_m")} />
        </L>
        <L label="RPE cible">
          <select className={inputCls} value={f.rpe_cible} onChange={set("rpe_cible")}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </L>
      </div>

      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="libelle !mb-0">Contenu</span>
          <Segmente label="Saisie du contenu" options={[["texte", "Texte"], ["blocs", "Blocs"]]}
            valeur={structure ? "blocs" : "texte"} onChange={basculer} />
        </div>
        {structure ? (
          <>
            {avisBlocs && <p className="text-[13px] leading-5 text-label-2 px-0.5" role="status">{avisBlocs}</p>}
            <EditeurBlocs structure={structure} sport={f.sport} onChange={setStructure} />
            <details className="card px-3.5 py-2.5">
              <summary className="text-[13px] text-label-2 cursor-pointer">Aperçu du texte</summary>
              <p className="mt-2 text-[14px] whitespace-pre-line">{descriptionDepuis(structure) || "—"}</p>
            </details>
          </>
        ) : (
          <textarea rows={f.description ? 7 : 4} className={inputCls} value={f.description} onChange={set("description")}
            aria-label="Contenu de la séance" />
        )}
      </section>

      {!edition && (
        <section className="card p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px]">Répéter cette séance</span>
            <Interrupteur actif={rep.actif} onChange={(v) => setRep((r) => ({ ...r, actif: v }))} label="Répéter cette séance" />
          </div>
          {rep.actif && (
            <>
              <Segmente label="Fréquence" options={[[1, "Chaque semaine"], [2, "Une semaine sur deux"]]}
                valeur={rep.toutes} onChange={(v) => setRep((r) => ({ ...r, toutes: Number(v) }))} />
              <label className="flex items-center justify-between gap-3">
                <span className="text-[15px]">Nombre de séances</span>
                <select className={`${inputCls} !w-24`} value={rep.fois} onChange={(e) => setRep((r) => ({ ...r, fois: Number(e.target.value) }))}>
                  {Array.from({ length: 25 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <p className="text-[12px] leading-4 text-label-2">
                Jusqu’à la semaine du {fmtDate(ajouter(new Date(`${semaine}T00:00`), 7 * rep.toutes * (rep.fois - 1)), { day: "numeric", month: "long" })}.
                Chaque séance reste modifiable une à une.
              </p>
            </>
          )}
        </section>
      )}

      {nomModele == null ? (
        <button type="button" className="btn-gris w-full" onClick={() => { setNomModele(f.titre); setModeleOk(null); }}>
          Enregistrer comme modèle
        </button>
      ) : (
        <div className="flex gap-2">
          <input className={`${inputCls} flex-1`} value={nomModele} maxLength={100} autoFocus placeholder="Nom du modèle"
            aria-label="Nom du modèle" onChange={(e) => setNomModele(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enregistrerModele(); } }} />
          <button type="button" className="btn-gris" disabled={modele.isPending} onClick={enregistrerModele}>
            {modele.isPending ? "…" : "OK"}
          </button>
          <button type="button" className="btn-texte" onClick={() => setNomModele(null)}>Annuler</button>
        </div>
      )}
      {modeleOk && <p className="text-[13px] text-ios-green text-center" role="status">{modeleOk}</p>}

      {erreur && <p className="text-[13px] text-ios-red text-center" role="alert">{erreur}</p>}
      <button type="submit" className="btn-primaire w-full" disabled={occupe}>
        {occupe ? "…" : edition ? "Enregistrer les modifications" : rep.actif ? `Ajouter ${rep.fois} séances` : "Ajouter au plan"}
      </button>
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
  const [params, setParams] = useSearchParams();
  const [guidee] = useState(() => !!params.get("guidee"));
  useEffect(() => {
    if (!params.get("guidee")) return;
    const p = new URLSearchParams(params); p.delete("guidee");
    setParams(p, { replace: true });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [lundi, setLundi] = useState(() => debutDe(new Date()));
  const [modalActivite, setModalActivite] = useState(undefined);
  const [ajout, setAjout] = useState(false);
  const [importIa, setImportIa] = useState(false);
  const depuis = iso(lundi);
  const jusqu = iso(ajouter(lundi, 6));
  const courante = depuis === iso(debutDe(new Date()));

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
  // Raccourci « Séance guidée » : la séance prévue aujourd'hui, sinon la première à faire
  const aOuvrir = (aFaire.find((s) => s.jour === iso(new Date())) ?? aFaire[0])?.id;
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
      action={<span className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap">
        <Link to="/saison" className="btn-texte">Saison</Link>
        <Link to="/itineraires" className="btn-texte" aria-label="Itinéraires">Itinéraires</Link>
        <button className="btn-texte" onClick={() => setImportIa(true)}>Plan IA</button>
        <BoutonAjout onClick={() => setAjout(true)} label="Ajouter une séance prévue" />
      </span>}>

      <BandeauSemaine lundi={depuis} dimanche={jusqu} courante={courante}
        onPrec={() => setLundi(ajouter(lundi, -7))} onSuiv={() => setLundi(ajouter(lundi, 7))}
        onAujourdhui={() => setLundi(debutDe(new Date()))} />

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
        <Squelettes n={4} label="Chargement du plan" />
      ) : (
        <div className="space-y-5">
          {seances.length > 0 && groupe(`À faire · ${aFaire.length}`,
            aFaire.length ? aFaire.map((s) => <CarteSeance key={s.id} s={s} onOuvrirActivite={setModalActivite} ouverte={guidee && courante && s.id === aOuvrir} />)
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
      {importIa && <ImportPlan semaine={iso(lundiDe(ajouter(lundi, 1)))} onClose={() => setImportIa(false)} />}
    </Page>
  );
}

// ── « Prochaines séances » de l'accueil ────────────────────────────────────
export function ProchainesSeances() {
  const lundi = debutDe(new Date());
  const depuis = iso(lundi);
  const jusqu = iso(ajouter(lundi, 6));
  const { data } = useQuery({ queryKey: ["plan", depuis, jusqu], queryFn: () => getPlan(depuis, jusqu) });
  // Même liste que « À faire » sur la page Plan, sans plafond
  const prochaines = (data?.seances ?? []).filter((s) => s.statut !== "realisee" && s.statut !== "sautee");
  const comptees = (data?.seances ?? []).filter((s) => s.statut !== "sautee").length;
  const faites = comptees - prochaines.length;

  return (
    <Section titre={comptees ? `À faire cette semaine · ${faites}/${comptees} faite${faites > 1 ? "s" : ""}` : "À faire cette semaine"}
      lien="/plan" libelleLien="Plan" className="h-full flex flex-col">
      <Card pad={false} className="py-1 flex-1">
        {!data ? (
          <Squelettes forme="lignes" n={3} label="Chargement du plan" />
        ) : prochaines.length === 0 ? (
          <p className="ligne text-[15px] text-label-2">{comptees ? "Semaine bouclée : tout est fait." : "Rien de prévu cette semaine."}</p>
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
