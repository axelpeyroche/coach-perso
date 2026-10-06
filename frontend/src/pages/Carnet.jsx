import { useState, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Card from "../components/Card";
import Page from "../components/Page";
import { BoutonAjout } from "../components/ui";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import { getActivites } from "../api";
import { SPORTS, nombre, fmtDuree } from "../carnet";

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
    <Page titre="Carnet"
      sousTitre={data ? `${data.total} activité${data.total > 1 ? "s" : ""}` : "Toutes tes séances"}
      action={<BoutonAjout onClick={() => setModal(null)} label="Ajouter une activité" />}>

      <div className="space-y-3">
        <label className="relative block md:max-w-sm">
          <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-label-2" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" className="champ !pl-10 !py-2 !rounded-[10px]" placeholder="Rechercher"
            value={q} onChange={(e) => { setQ(e.target.value); setLimite(PAGE); }} />
        </label>
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
          {[["", "Tout"], ...Object.entries(SPORTS).map(([k, s]) => [k, `${s.emoji} ${s.label}`])].map(([k, l]) => (
            <button key={k} onClick={() => { setSport(k); setLimite(PAGE); }}
              className={`puce ${sport === k ? "puce-active" : ""}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-[15px] text-label-2">Chargement…</p>
      ) : activites.length === 0 ? (
        <Card>
          <div className="text-center py-8 space-y-3">
            <p className="text-4xl">📒</p>
            <p className="text-[15px] text-label-2">
              {q || sport ? "Aucune activité ne correspond." : "Ton carnet est vide pour l'instant."}
            </p>
            {!q && !sport && (
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <button className="btn-primaire" onClick={() => setModal(null)}>Saisir une séance</button>
                <Link to="/sources" className="btn-teinte">Importer</Link>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupes.map((g) => (
            <section key={g.cle} className="space-y-1.5">
              <div className="flex items-baseline justify-between px-4">
                <h2 className="text-[13px] uppercase tracking-[0.02em] text-label-2 font-medium">
                  {new Date(`${g.cle}-15`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                </h2>
                <span className="text-[13px] text-label-2 chiffres">
                  {g.items.length} · {fmtDuree(g.sec)}{g.km ? ` · ${nombre(g.km)} km` : ""}
                </span>
              </div>
              <Card pad={false} className="py-1">
                {g.items.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => setModal(a)} />)}
              </Card>
            </section>
          ))}
          {data.total > activites.length && (
            <div className="text-center">
              <button className="btn-teinte" disabled={isFetching} onClick={() => setLimite((l) => l + PAGE)}>
                {isFetching ? "…" : `Afficher plus (${data.total - activites.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {modal !== undefined && <ModalActivite activite={modal} onClose={() => setModal(undefined)} />}
    </Page>
  );
}
