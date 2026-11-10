import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import clsx from "clsx";
import Card from "../components/Card";
import Page from "../components/Page";
import StatTile from "../components/StatTile";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import FicheActivite from "../components/FicheActivite";
import CartePassages from "../components/CartePassages";
import Feuille from "../components/Feuille";
import { FormeTuiles, useMesures } from "../components/Forme";
import FormeJour from "../components/FormeJour";
import SommeilNuit from "../components/SommeilNuit";
import { AlerteMarche } from "../components/MesuresCompanion";
import ZonesCardiaques from "../components/ZonesCardiaques";
import { axeX, axeY, grille, curseur, InfoBulle, Graphique } from "../components/graphiques";
import { ProchainesSeances, Pastilles } from "./Plan";
import { useAuth } from "../AuthContext";
import { getActivites, getStatsCarnet, getAlertes, getPlan } from "../api";
import { PastilleTon } from "./Alertes";
import { nombre, fmtDistance, sportInfo } from "../carnet";
import { Section, BoutonAjout, Chevron, Interrupteur } from "../components/ui";
import { usePreferences, modifierPreferences, debutSemaine, aujourdhuiIso } from "../preferences";

const ZONE_COULEUR = { "sous-charge": "blue", optimale: "green", vigilance: "orange", risque: "red" };
const jourPlus = (isoJour, n) => {
  const d = new Date(`${isoJour}T12:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Encart du centre d'alertes : la plus importante, et combien d'autres attendent
function EncartAlertes() {
  const { data } = useQuery({ queryKey: ["alertes"], queryFn: getAlertes, staleTime: 300000 });
  const a = data?.alertes?.[0];
  if (!a) return null;
  const autres = data.alertes.length - 1;
  return (
    <Link to="/alertes" className="card p-4 flex items-center gap-3">
      <PastilleTon ton={a.ton} />
      <span className="flex-1 min-w-0">
        <span className="block text-[16px] font-semibold leading-5">{a.titre}</span>
        <span className="block text-[14px] leading-[19px] text-label-2 mt-0.5 line-clamp-2">{a.texte}</span>
        {autres > 0 && <span className="block text-[13px] font-medium text-brand mt-1">+ {autres} autre{autres > 1 ? "s" : ""} point{autres > 1 ? "s" : ""} à voir</span>}
      </span>
      <Chevron />
    </Link>
  );
}

// Séance(s) prévue(s) aujourd'hui, tirées du plan de la semaine
const ETAT_SEANCE = {
  realisee: ["✓ Faite", "text-ios-green"], sautee: ["Sautée", "text-label-2"], manquee: ["! Non faite", "text-ios-orange"],
};
function SeanceDuJour({ depuis }) {
  const jusqu = jourPlus(depuis, 6);
  const { data } = useQuery({ queryKey: ["plan", depuis, jusqu], queryFn: () => getPlan(depuis, jusqu) });
  if (!data) return <div className="card h-[72px] squelette" aria-hidden />;
  const auj = aujourdhuiIso();
  const duJour = data.seances.filter((s) => s.jour === auj);
  if (!duJour.length) {
    const suivante = data.seances.find((s) => s.jour > auj && s.statut !== "sautee" && s.statut !== "realisee");
    return (
      <Link to="/plan" className="card p-4 flex items-center gap-3">
        <span className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[19px] bg-remplissage">🌿</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[16px] font-semibold leading-5">Rien de prévu aujourd'hui</span>
          <span className="block text-[14px] leading-[19px] text-label-2 mt-0.5 truncate">
            {suivante
              ? `Prochaine séance : ${suivante.titre}, ${new Date(`${suivante.jour}T12:00`).toLocaleDateString("fr-FR", { weekday: "long" })}`
              : data.seances.length ? "Plus de séance prévue cette semaine." : "Aucun plan pour cette semaine : ajoute une séance ou importe ton plan."}
          </span>
        </span>
        <Chevron />
      </Link>
    );
  }
  return (
    <Card pad={false} className="py-1">
      {duJour.map((s) => {
        const info = sportInfo(s.sport);
        const etat = ETAT_SEANCE[s.statut];
        return (
          <Link key={s.id} to="/plan" className="ligne" style={{ "--inset": "4.25rem" }}>
            <span className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[19px]"
              style={{ backgroundColor: `${info.couleur}26` }}>{s.emoji ?? info.emoji}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12px] font-semibold text-label-2 uppercase tracking-wide">Séance du jour</span>
              <span className="block text-[16px] font-semibold leading-5 truncate">{s.titre}</span>
              <Pastilles s={s} />
            </span>
            {etat ? <span className={clsx("text-[13px] font-semibold shrink-0", etat[1])}>{etat[0]}</span> : <Chevron />}
          </Link>
        );
      })}
    </Card>
  );
}

// ── Indicateurs épinglés ───────────────────────────────────────────────────
// Catalogue : chaque indicateur sait se dessiner à partir des statistiques et des mesures
export const INDICATEURS = [
  ["semaine", "Cette semaine"], ["28j", "28 derniers jours"], ["acwr", "Charge (ACWR)"], ["regularite", "Régularité"],
  ["distance", "Distance de la semaine"], ["total", "Depuis le début"],
  ["vfc", "VFC"], ["fc_repos", "FC au repos"], ["vo2max", "VO2max"],
];
const MESURE = { vfc: ["VFC", "indigo", 0], fc_repos: ["FC repos", "pink", 0], vo2max: ["VO2max", "green", 1] };

function tuileIndicateur(cle, stats, mesures) {
  const t = stats.totaux;
  const sem8 = stats.semaines.slice(-8);
  if (cle === "semaine") return { label: "Cette semaine", color: "orange", value: `${nombre(t.semaine.duree_h)} h`,
    sub: `${t.semaine.nb} séance(s) · ${fmtDistance(t.semaine.distance_km)}`, serie: sem8.map((s) => s.duree_h) };
  if (cle === "28j") return { label: "28 derniers jours", color: "blue", value: `${nombre(t["28j"].duree_h)} h`,
    sub: `${t["28j"].nb} séances · ${fmtDistance(t["28j"].distance_km)}` };
  if (cle === "acwr") return { label: "Charge (ACWR)", color: ZONE_COULEUR[stats.charge.zone] ?? "blue",
    value: stats.charge.acwr != null ? nombre(stats.charge.acwr, 2) : "—", sub: stats.charge.zone ?? "il manque 4 semaines de séances" };
  if (cle === "regularite") return { label: "Régularité", color: "purple", value: `${stats.regularite.serie_semaines} sem.`,
    sub: `${stats.regularite.jours_actifs_28j} jours actifs / 28` };
  if (cle === "distance") return { label: "Distance de la semaine", color: "teal", value: fmtDistance(t.semaine.distance_km),
    sub: `${t.semaine.nb} séance(s)`, serie: sem8.some((s) => s.distance_km != null) ? sem8.map((s) => s.distance_km) : undefined };
  if (cle === "total") return { label: "Depuis le début", color: "gray", value: `${nombre(t.total.nb, 0)} séances`,
    sub: t.total.duree_h != null ? `${nombre(t.total.duree_h, 0)} h` : undefined };
  const m = mesures?.[cle];
  if (!MESURE[cle]) return null;
  const [label, color, dec] = MESURE[cle];
  if (!m?.points?.length) return { label, color, value: "—", sub: "pas encore de mesure reçue" };
  return { label, color, value: `${nombre(m.derniere.valeur, dec)}${m.unite && m.unite !== "ml/kg/min" ? ` ${m.unite}` : ""}`,
    sub: m.moy_28j != null ? `moy. 28 j : ${nombre(m.moy_28j)}` : undefined, serie: m.points.slice(-30).map((p) => p.valeur) };
}

function Indicateurs({ stats, favoris }) {
  const { data: mesures } = useMesures();
  const tuiles = favoris.map((c) => [c, tuileIndicateur(c, stats, mesures)]).filter(([, x]) => x);
  if (!tuiles.length) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tuiles.map(([c, x]) => <StatTile key={c} {...x} />)}
    </div>
  );
}

// ── Blocs du Résumé : ordre et masquage réglables, par groupe ──────────────
const BLOCS = [
  { cle: "indicateurs", titre: "Indicateurs épinglés", groupe: "semaine", large: true },
  { cle: "prochaines", titre: "À faire cette semaine", groupe: "semaine" },
  { cle: "zones", titre: "Zones cardiaques", groupe: "semaine" },
  { cle: "activites", titre: "Dernières activités", groupe: "semaine", large: true },
  { cle: "forme", titre: "FC repos, VFC, VO2max", groupe: "tendances", large: true },
  { cle: "semaines8", titre: "8 dernières semaines", groupe: "tendances", large: true },
  { cle: "traces", titre: "Mes tracés", groupe: "tendances", large: true },
];
const GROUPES = [["semaine", "Cette semaine"], ["tendances", "Tendances"]];

// Blocs d'un groupe dans l'ordre choisi (les nouveaux blocs, inconnus des préférences, vont à la fin)
function blocsOrdonnes(groupe, ordre) {
  const rang = (c) => { const i = ordre.indexOf(c); return i < 0 ? 1000 + BLOCS.findIndex((b) => b.cle === c) : i; };
  return BLOCS.filter((b) => b.groupe === groupe).sort((a, b) => rang(a.cle) - rang(b.cle));
}

function Personnaliser({ onClose }) {
  const prefs = usePreferences();
  const { ordre, masques } = prefs.resume;
  const majResume = (patch) => modifierPreferences({ resume: { ...prefs.resume, ...patch } });
  const deplacer = (groupe, cle, sens) => {
    const liste = blocsOrdonnes(groupe, ordre).map((b) => b.cle);
    const i = liste.indexOf(cle), j = i + sens;
    if (j < 0 || j >= liste.length) return;
    [liste[i], liste[j]] = [liste[j], liste[i]];
    const autres = GROUPES.filter(([g]) => g !== groupe).flatMap(([g]) => blocsOrdonnes(g, ordre).map((b) => b.cle));
    majResume({ ordre: [...liste, ...autres] });
  };
  const basculer = (cle) => majResume({ masques: masques.includes(cle) ? masques.filter((c) => c !== cle) : [...masques, cle] });
  const epingler = (cle) => modifierPreferences({
    favoris: prefs.favoris.includes(cle) ? prefs.favoris.filter((c) => c !== cle) : [...prefs.favoris, cle],
  });
  const fleche = "btn-rond w-9 h-9 bg-remplissage text-label disabled:opacity-30";

  return (
    <Feuille titre="Personnaliser le Résumé" onClose={onClose}>
      <div className="space-y-5">
        <p className="text-[14px] leading-[19px] text-label-2 px-1">
          Le bloc « Aujourd'hui » reste toujours en tête. Pour le reste, choisis ce qui s'affiche et dans quel ordre. Ces réglages sont gardés sur cet appareil.
        </p>
        {GROUPES.map(([g, nom]) => {
          const liste = blocsOrdonnes(g, ordre);
          return (
            <div key={g}>
              <h3 className="entete-liste">{nom}</h3>
              <div className="card py-0.5 overflow-hidden">
                {liste.map((b, i) => (
                  <div key={b.cle} className="ligne gap-2">
                    <span className={clsx("flex-1 min-w-0 text-[16px] truncate", masques.includes(b.cle) && "text-label-2")}>{b.titre}</span>
                    <button type="button" className={fleche} disabled={i === 0} aria-label={`Monter ${b.titre}`} onClick={() => deplacer(g, b.cle, -1)}>
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
                    </button>
                    <button type="button" className={fleche} disabled={i === liste.length - 1} aria-label={`Descendre ${b.titre}`} onClick={() => deplacer(g, b.cle, 1)}>
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                    <Interrupteur actif={!masques.includes(b.cle)} onChange={() => basculer(b.cle)} label={`Afficher ${b.titre}`} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <div>
          <h3 className="entete-liste">Indicateurs épinglés</h3>
          <div className="card py-0.5 overflow-hidden">
            {INDICATEURS.map(([cle, nom]) => (
              <div key={cle} className="ligne">
                <span className="flex-1 text-[16px]">{nom}</span>
                <Interrupteur actif={prefs.favoris.includes(cle)} onChange={() => epingler(cle)} label={`Épingler ${nom}`} />
              </div>
            ))}
          </div>
          <p className="px-4 pt-1.5 text-[13px] text-label-2">Quatre indicateurs tiennent sur une ligne sur ordinateur, deux sur téléphone.</p>
        </div>
        <button type="button" className="btn-gris w-full"
          onClick={() => modifierPreferences({ resume: { ordre: [], masques: [] }, favoris: ["semaine", "28j", "acwr", "regularite"] })}>
          Revenir à la présentation d'origine
        </button>
      </div>
    </Feuille>
  );
}

export default function Accueil() {
  const { user } = useAuth();
  const prefs = usePreferences();
  const [modal, setModal] = useState(undefined);
  const [fiche, setFiche] = useState(null);
  const [perso, setPerso] = useState(false);
  const { data: stats } = useQuery({ queryKey: ["stats-carnet", ""], queryFn: () => getStatsCarnet() });
  const debut = debutSemaine(new Date(), prefs.premierJour);
  const { data: liste } = useQuery({
    queryKey: ["activites", { semaine: debut }],
    queryFn: () => getActivites({ depuis: debut, limit: 100 }),
  });
  // Carnet vide = aucune séance du tout (pas seulement cette semaine)
  const vide = stats?.totaux?.total?.nb === 0;

  const rendu = {
    indicateurs: () => (stats && !vide ? <Indicateurs stats={stats} favoris={prefs.favoris} /> : null),
    prochaines: () => <ProchainesSeances />,
    zones: () => (
      <Section titre="Zones cardiaques" lien="/analyses#zones" libelleLien="Évolution" className="h-full flex flex-col">
        <ZonesCardiaques />
      </Section>
    ),
    activites: () => (
      <Section titre="Dernières activités" lien="/carnet">
        <Card pad={false}>
          {!liste ? (
            <div className="p-4 space-y-3" aria-busy="true" aria-label="Chargement des activités">
              {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-xl squelette" />)}
            </div>
          ) : liste.activites.length === 0 ? (
            <p className="p-4 text-[15px] text-label-2">Aucune activité cette semaine.</p>
          ) : (
            <div className="py-1">
              {liste.activites.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => setFiche(a)} />)}
            </div>
          )}
        </Card>
      </Section>
    ),
    forme: () => <FormeTuiles />,
    semaines8: () => {
      if (!stats || vide) return null;
      const s8 = stats.semaines.slice(-8);
      const moy = s8.reduce((t, s) => t + (s.duree_h || 0), 0) / (s8.length || 1);
      return (
        <Section titre="8 dernières semaines" lien="/stats" libelleLien="Statistiques">
          <Card>
            <p className="text-[13px] font-semibold text-ios-orange">Durée d'entraînement</p>
            <p className="text-[13px] text-label-2 mb-2">Heures par semaine</p>
            <Graphique label="Durée d'entraînement par semaine sur 8 semaines"
              resume={`Moyenne ${nombre(moy)} heures par semaine, ${nombre(s8[s8.length - 1]?.duree_h ?? 0)} heures cette semaine`}>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={s8} margin={{ left: 0, right: 0, top: 4 }}>
                  <CartesianGrid {...grille} />
                  <XAxis dataKey="label" {...axeX} />
                  <YAxis {...axeY} width={28} />
                  <Tooltip cursor={curseur} content={<InfoBulle format={(v) => `${v} h`} />} />
                  <Bar dataKey="duree_h" name="Durée" fill="rgb(var(--orange))" radius={[5, 5, 5, 5]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </Graphique>
          </Card>
        </Section>
      );
    },
    traces: () => (vide ? null : <Section titre="Mes tracés"><CartePassages /></Section>),
  };

  // Un bloc étroit seul sur sa ligne prend toute la largeur ; deux blocs étroits qui se suivent se partagent la ligne
  const groupe = (g) => {
    const visibles = blocsOrdonnes(g, prefs.resume.ordre).filter((b) => !prefs.resume.masques.includes(b.cle))
      .map((b) => ({ ...b, el: rendu[b.cle]() })).filter((b) => b.el);
    let demi = false;
    return visibles.map((b, i) => {
      const suivantEtroit = visibles[i + 1] && !visibles[i + 1].large;
      const large = b.large || (!demi && !suivantEtroit);
      demi = !large && !demi;
      return <div key={b.cle} className={clsx("min-w-0", large && "lg:col-span-2")}>{b.el}</div>;
    });
  };

  return (
    <Page large
      sousTitre={new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
      titre={user?.prenom ? `Salut ${user.prenom}` : "Résumé"}
      action={<BoutonAjout onClick={() => setModal(null)} label="Nouvelle séance" />}>

      {vide && (
        <Card>
          <div className="text-center py-6 space-y-3">
            <p className="text-4xl">🏃</p>
            <p className="text-[17px] font-semibold">Bienvenue dans ton carnet</p>
            <p className="text-[15px] text-label-2 max-w-sm mx-auto">
              Commence par importer ton historique ou saisir ta dernière séance.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Link to="/sources" className="btn-primaire">Importer mes séances</Link>
              <button className="btn-teinte" onClick={() => setModal(null)}>Saisir une séance</button>
            </div>
          </div>
        </Card>
      )}

      {!vide && (
        <Section titre="Aujourd'hui">
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <FormeJour />
              <SommeilNuit />
            </div>
            <SeanceDuJour depuis={debut} />
            <EncartAlertes />
            <AlerteMarche />
          </div>
        </Section>
      )}

      {GROUPES.map(([g, nom]) => {
        const blocs = groupe(g);
        if (!blocs.length) return null;
        return (
          <div key={g} className="space-y-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-label-2 px-1">{nom}</h2>
            <div className="grid gap-6 lg:grid-cols-2">{blocs}</div>
          </div>
        );
      })}

      <div className="flex justify-center pt-1">
        <button type="button" className="btn-gris btn-sm" onClick={() => setPerso(true)}>Personnaliser le Résumé</button>
      </div>

      {perso && <Personnaliser onClose={() => setPerso(false)} />}
      {modal !== undefined && <ModalActivite activite={modal} onClose={() => setModal(undefined)} />}
      {fiche && <FicheActivite key={fiche.id} activite={fiche} onClose={() => setFiche(null)} />}
    </Page>
  );
}
