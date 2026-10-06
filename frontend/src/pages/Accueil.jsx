import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import Card from "../components/Card";
import Page from "../components/Page";
import StatTile from "../components/StatTile";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import { FormeTuiles } from "../components/Forme";
import { axeX, axeY, grille, curseur, InfoBulle } from "../components/graphiques";
import { ObjectifCarte } from "./Objectifs";
import { ProchainesSeances } from "./Plan";
import { useAuth } from "../AuthContext";
import { getActivites, getObjectifs, getStatsCarnet } from "../api";
import { nombre } from "../carnet";
import { Section, BoutonAjout, Chevron } from "../components/ui";

const ZONE_COULEUR = { "sous-charge": "blue", optimale: "green", vigilance: "orange", risque: "red" };

export default function Accueil() {
  const { user } = useAuth();
  const [modal, setModal] = useState(undefined);
  const { data: stats } = useQuery({ queryKey: ["stats-carnet", ""], queryFn: () => getStatsCarnet() });
  const { data: liste } = useQuery({ queryKey: ["activites", { recentes: true }], queryFn: () => getActivites({ limit: 6 }) });
  const { data: objectifs = [] } = useQuery({ queryKey: ["objectifs"], queryFn: getObjectifs });

  const actifs = objectifs.filter((o) => o.statut === "actif").slice(0, 2);
  const t = stats?.totaux;
  const vide = liste && liste.total === 0;

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

      {t && !vide && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Cette semaine" color="orange" value={`${nombre(t.semaine.duree_h)} h`}
            sub={`${t.semaine.nb} séance(s) · ${nombre(t.semaine.distance_km)} km`} />
          <StatTile label="28 derniers jours" color="blue" value={`${nombre(t["28j"].duree_h)} h`}
            sub={`${t["28j"].nb} séances · ${nombre(t["28j"].distance_km)} km`} />
          <StatTile label="Charge (ACWR)" color={ZONE_COULEUR[stats.charge.zone] ?? "blue"}
            value={stats.charge.acwr != null ? nombre(stats.charge.acwr, 2) : "—"}
            sub={stats.charge.zone ?? "pas assez de données"} />
          <StatTile label="Régularité" color="purple" value={`${stats.regularite.serie_semaines} sem.`}
            sub={`${stats.regularite.jours_actifs_28j} jours actifs / 28`} />
        </div>
      )}

      <FormeTuiles />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-6 min-w-0">
          <ProchainesSeances />

          <Section titre="Dernières activités" lien="/carnet">
            <Card pad={false}>
              {!liste ? (
                <p className="p-4 text-[15px] text-label-2">Chargement…</p>
              ) : liste.activites.length === 0 ? (
                <p className="p-4 text-[15px] text-label-2">Aucune activité.</p>
              ) : (
                <div className="py-1">
                  {liste.activites.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => setModal(a)} />)}
                </div>
              )}
            </Card>
          </Section>

          {stats && !vide && (
            <Section titre="8 dernières semaines" lien="/stats" libelleLien="Statistiques">
              <Card>
                <p className="text-[13px] font-semibold text-ios-orange">Durée d'entraînement</p>
                <p className="text-[13px] text-label-2 mb-2">Heures par semaine</p>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={stats.semaines.slice(-8)} margin={{ left: 0, right: 0, top: 4 }}>
                    <CartesianGrid {...grille} />
                    <XAxis dataKey="label" {...axeX} />
                    <YAxis {...axeY} width={28} />
                    <Tooltip cursor={curseur} content={<InfoBulle format={(v) => `${v} h`} />} />
                    <Bar dataKey="duree_h" name="Durée" fill="#FF9500" radius={[5, 5, 5, 5]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </Section>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Section titre="Objectifs" lien="/objectifs" libelleLien="Gérer">
            {actifs.length === 0 ? (
              <Card>
                <p className="text-[15px] text-label-2">Aucun objectif actif.</p>
                <Link to="/objectifs" className="btn-texte mt-1">Ajouter une course ou un défi</Link>
              </Card>
            ) : (
              <div className="space-y-3">
                {actifs.map((o) => <ObjectifCarte key={o.id} o={o} compact />)}
              </div>
            )}
          </Section>

          <Link to="/sources#claude" className="card flex items-center gap-3 p-4 active:opacity-70 transition">
            <span className="w-10 h-10 rounded-full bg-ios-orange/15 flex items-center justify-center text-[19px] shrink-0">✳️</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-semibold">Analyse avec Claude</span>
              <span className="block text-[13px] text-label-2">Partage ton carnet pour une analyse approfondie</span>
            </span>
            <Chevron />
          </Link>
        </div>
      </div>

      {modal !== undefined && <ModalActivite activite={modal} onClose={() => setModal(undefined)} />}
    </Page>
  );
}
