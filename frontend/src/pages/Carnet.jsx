import { useState, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Card from "../components/Card";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import { getActivites } from "../api";
import { SPORTS, inputCls, btnPrimaire, btnSecondaire, nombre, fmtDuree } from "../carnet";

const PAGE = 50;

function cleMois(iso) {
  return iso.slice(0, 7);
}

export default function Carnet() {
  const [sport, setSport] = useState("");
  const [q, setQ] = useState("");
  const [limite, setLimite] = useState(PAGE);
  const [modal, setModal] = useState(undefined); // undefined = fermé, null = création, objet = édition

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["activites", { sport, q, limite }],
    queryFn: () => getActivites({ sport: sport || undefined, q: q || undefined, limit: limite }),
    placeholderData: keepPreviousData,
  });

  const activites = data?.activites ?? [];
  const groupes = useMemo(() => {
    const g = [];
    for (const a of activites) {
      const k = cleMois(a.debut);
      let cur = g[g.length - 1];
      if (!cur || cur.cle !== k) { cur = { cle: k, items: [], km: 0, sec: 0 }; g.push(cur); }
      cur.items.push(a);
      cur.km += a.distance_km || 0;
      cur.sec += a.duree_sec || 0;
    }
    return g;
  }, [activites]);

  return (
    <div className="p-4 md:p-8 w-full space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Carnet</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {data ? `${data.total} activité${data.total > 1 ? "s" : ""}` : "Toutes tes séances, toutes sources confondues"}
          </p>
        </div>
        <button className={btnPrimaire} onClick={() => setModal(null)}>+ Ajouter</button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input className={`${inputCls} sm:max-w-xs`} placeholder="Rechercher (titre, notes)…"
          value={q} onChange={(e) => { setQ(e.target.value); setLimite(PAGE); }} />
        <div className="flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1 overflow-x-auto">
          {[["", "Tout"], ...Object.entries(SPORTS).map(([k, s]) => [k, `${s.emoji} ${s.label}`])].map(([k, l]) => (
            <button key={k} onClick={() => { setSport(k); setLimite(PAGE); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                sport === k ? "bg-white dark:bg-gray-700 text-brand shadow-sm" : "text-gray-500 dark:text-gray-400"
              }`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : activites.length === 0 ? (
        <Card>
          <div className="text-center py-8 space-y-3">
            <p className="text-3xl">📒</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {q || sport ? "Aucune activité ne correspond." : "Ton carnet est vide pour l'instant."}
            </p>
            {!q && !sport && (
              <div className="flex justify-center gap-2">
                <button className={btnPrimaire} onClick={() => setModal(null)}>Saisir une séance</button>
                <Link to="/sources" className={btnSecondaire}>Importer (Strava, Apple Santé, CSV)</Link>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupes.map((g) => (
            <Card key={g.cle}
              title={new Date(`${g.cle}-15`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
              action={
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {g.items.length} · {fmtDuree(g.sec)}{g.km ? ` · ${nombre(g.km)} km` : ""}
                </span>
              }>
              <div className="-mx-2 divide-y divide-gray-100 dark:divide-gray-800">
                {g.items.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => setModal(a)} />)}
              </div>
            </Card>
          ))}
          {data.total > activites.length && (
            <div className="text-center">
              <button className={btnSecondaire} disabled={isFetching} onClick={() => setLimite((l) => l + PAGE)}>
                {isFetching ? "…" : `Afficher plus (${data.total - activites.length} restantes)`}
              </button>
            </div>
          )}
        </div>
      )}

      {modal !== undefined && <ModalActivite activite={modal} onClose={() => setModal(undefined)} />}
    </div>
  );
}
