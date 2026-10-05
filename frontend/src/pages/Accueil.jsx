import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import Card from "../components/Card";
import StatTile from "../components/StatTile";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import { ObjectifCarte } from "./Objectifs";
import { useAuth } from "../AuthContext";
import { getActivites, getObjectifs, getStatsCarnet } from "../api";
import { nombre, btnPrimaire, btnSecondaire } from "../carnet";

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
    <div className="p-4 md:p-8 w-full space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Salut {user?.prenom ?? ""} 👋</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 capitalize">
            {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <button className={btnPrimaire} onClick={() => setModal(null)}>+ Séance</button>
      </div>

      {vide && (
        <Card>
          <div className="text-center py-6 space-y-3">
            <p className="text-3xl">🚀</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Bienvenue dans ton carnet ! Commence par importer ton historique ou saisir ta dernière séance.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/sources" className={btnPrimaire}>Importer mes séances</Link>
              <button className={btnSecondaire} onClick={() => setModal(null)}>Saisir une séance</button>
            </div>
          </div>
        </Card>
      )}

      {t && !vide && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Cette semaine" color="purple" value={`${nombre(t.semaine.duree_h)} h`}
            sub={`${t.semaine.nb} séance(s) · ${nombre(t.semaine.distance_km)} km`} />
          <StatTile label="28 derniers jours" color="blue" value={`${nombre(t["28j"].duree_h)} h`}
            sub={`${t["28j"].nb} séances · ${nombre(t["28j"].distance_km)} km`} />
          <StatTile label="Charge (ACWR)" color={ZONE_COULEUR[stats.charge.zone] ?? "blue"}
            value={stats.charge.acwr != null ? nombre(stats.charge.acwr, 2) : "—"}
            sub={stats.charge.zone ?? "pas assez de données"} />
          <StatTile label="Régularité" color="orange" value={`${stats.regularite.serie_semaines} sem.`}
            sub={`${stats.regularite.jours_actifs_28j} jours actifs / 28`} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-4">
          <Card title="Dernières activités" action={<Link to="/carnet" className="text-xs text-brand hover:underline">Tout voir</Link>}>
            {!liste ? (
              <p className="text-sm text-gray-400">Chargement…</p>
            ) : liste.activites.length === 0 ? (
              <p className="text-sm text-gray-500">Aucune activité.</p>
            ) : (
              <div className="-mx-2 divide-y divide-gray-100 dark:divide-gray-800">
                {liste.activites.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => setModal(a)} />)}
              </div>
            )}
          </Card>
          {stats && !vide && (
            <Card title="8 dernières semaines (heures)" action={<Link to="/stats" className="text-xs text-brand hover:underline">Stats</Link>}>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={stats.semaines.slice(-8)}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "none", fontSize: 12 }} formatter={(v) => [`${v} h`, "Durée"]} />
                  <Bar dataKey="duree_h" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Objectifs en cours</h3>
            <Link to="/objectifs" className="text-xs text-brand hover:underline">Gérer</Link>
          </div>
          {actifs.length === 0 ? (
            <Card>
              <p className="text-sm text-gray-500">Aucun objectif actif.</p>
              <Link to="/objectifs" className="text-sm text-brand hover:underline">Ajouter une course ou un défi →</Link>
            </Card>
          ) : (
            actifs.map((o) => <ObjectifCarte key={o.id} o={o} compact />)
          )}
          <Card title="Analyse avec Claude">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Donne à Claude l'accès à tout ton carnet (lien secret ou copie en un clic) pour une analyse approfondie.
            </p>
            <Link to="/sources#claude" className="text-sm text-brand hover:underline">Préparer l'analyse →</Link>
          </Card>
        </div>
      </div>

      {/* Sur mobile, la barre du bas ne montre que le carnet : accès à l'ancien programme ici */}
      <div className="md:hidden">
        <Card title="Programme EPC">
          <div className="flex flex-wrap gap-2">
            {[["/programme-dashboard", "Tableau de bord"], ["/programme", "Programme"], ["/calendrier", "Calendrier"],
              ["/evaluation", "Évaluation"], ["/analytics", "Analytics"], ["/timers", "Timers"]].map(([to, l]) => (
              <Link key={to} to={to} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{l}</Link>
            ))}
          </div>
        </Card>
      </div>

      {modal !== undefined && <ModalActivite activite={modal} onClose={() => setModal(undefined)} />}
    </div>
  );
}
