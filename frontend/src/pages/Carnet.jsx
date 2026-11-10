import { useState, useMemo, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Card from "../components/Card";
import Page from "../components/Page";
import { BoutonAjout } from "../components/ui";
import ActiviteLigne from "../components/ActiviteLigne";
import ModalActivite from "../components/ModalActivite";
import FicheActivite from "../components/FicheActivite";
import api, { getActivites } from "../api";
import { CRITERES_VIDES, PanneauFiltres, RETRAIT, detailFiltre, nbActifs, resume, useFiltresCarnet, versParams } from "../components/FiltresCarnet";
import { SPORTS, nombre, fmtDuree } from "../carnet";

const PAGE = 50;

function cleMois(iso) {
  return iso.slice(0, 7);
}

// Attend la fin de la frappe avant de lancer la recherche
function useDiffere(valeur, delai = 300) {
  const [v, setV] = useState(valeur);
  useEffect(() => {
    const t = setTimeout(() => setV(valeur), delai);
    return () => clearTimeout(t);
  }, [valeur, delai]);
  return v;
}

export default function Carnet() {
  const [sport, setSport] = useState("");
  const [q, setQ] = useState("");
  const [limite, setLimite] = useState(PAGE);
  const [modal, setModal] = useState(undefined); // undefined = fermé, null = création, objet = édition
  const [fiche, setFiche] = useState(null);

  const [criteres, setCriteres] = useState(CRITERES_VIDES);
  const [panneau, setPanneau] = useState(false);
  const { data: meta } = useFiltresCarnet();
  const majCriteres = (c) => { setCriteres(c); setLimite(PAGE); };
  const actifs = nbActifs(criteres);
  const filtre = !!(q || sport || actifs);

  const qDiff = useDiffere(q);
  const avances = useDiffere(JSON.stringify(versParams(criteres)));
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["activites", { sport, q: qDiff, avances, limite }],
    queryFn: () => getActivites({ sport: sport || undefined, q: qDiff.trim() || undefined, ...JSON.parse(avances), limit: limite }),
    placeholderData: keepPreviousData,
  });

  // Filtre enregistré : remplace la recherche, le sport et les critères
  const appliquer = (f) => {
    const { q: fq = "", sport: fs = "", ...reste } = f.criteres;
    setQ(fq); setSport(fs);
    majCriteres({ ...CRITERES_VIDES, ...Object.fromEntries(Object.entries(reste).map(([k, v]) => [k, String(v)])) });
  };
  const estApplique = (f) => {
    const { q: fq = "", sport: fs = "", ...reste } = f.criteres;
    return fq === q && fs === sport && JSON.stringify(reste, Object.keys(reste).sort()) === JSON.stringify(versParams(criteres), Object.keys(reste).sort())
      && Object.keys(reste).length === Object.keys(versParams(criteres)).length;
  };

  // Sports ayant au moins une activité : seuls ceux-là apparaissent dans les filtres
  // (clé sous « activites » pour suivre les invalidations après ajout/suppression)
  const { data: presents } = useQuery({
    queryKey: ["activites", "sports-presents"],
    queryFn: () => api.get("/carnet/sports-presents").then((r) => r.data),
  });
  const sportsFiltre = presents ? Object.keys(SPORTS).filter((k) => presents[k] > 0) : [];
  useEffect(() => {
    // Filtre actif devenu sans activité → retour à « Tout »
    if (presents && sport && !(presents[sport] > 0)) { setSport(""); setLimite(PAGE); }
  }, [presents, sport]);

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
        <div className="flex items-center gap-2">
          <label className="relative block flex-1 min-w-0 md:max-w-sm">
            <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-label-2" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
            </svg>
            <input type="search" className="champ !pl-10 !py-2 !rounded-[10px]" placeholder="Titre, notes…"
              aria-label="Rechercher dans les titres et les notes"
              value={q} onChange={(e) => { setQ(e.target.value); setLimite(PAGE); }} />
          </label>
          <button type="button" aria-expanded={panneau} onClick={() => setPanneau((p) => !p)}
            className={`shrink-0 inline-flex items-center gap-1.5 h-[38px] px-3.5 rounded-[10px] text-[15px] font-medium transition active:scale-95 ${actifs || panneau ? "bg-brand/15 text-brand" : "bg-remplissage text-label"}`}>
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M4 7h16M7 12h10M10 17h4" />
            </svg>
            Filtres
            {actifs > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-brand text-white text-[12px] font-semibold flex items-center justify-center chiffres">{actifs}</span>}
          </button>
        </div>

        {panneau && (
          <PanneauFiltres criteres={criteres} onChange={majCriteres} meta={meta} q={q.trim()} sport={sport}
            onFermer={() => setPanneau(false)} />
        )}

        {/* Critères actifs, retirables d'un geste quand le panneau est fermé */}
        {!panneau && actifs > 0 && (
          <div className="flex flex-wrap gap-2">
            {resume(criteres, meta).map(([k, l]) => (
              <button key={k} type="button" className="puce !bg-brand/15 !text-brand" aria-label={`Retirer le filtre ${l}`}
                onClick={() => majCriteres({ ...criteres, ...RETRAIT[k] })}>
                {l} <span aria-hidden className="text-[12px] opacity-70">✕</span>
              </button>
            ))}
          </div>
        )}

        {meta?.filtres?.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
            {meta.filtres.map((f) => {
              const on = estApplique(f);
              return (
                <button key={f.nom} type="button" title={detailFiltre(f, meta)} aria-pressed={on}
                  className={`puce ${on ? "puce-active" : ""}`}
                  onClick={() => (on ? (setQ(""), setSport(""), majCriteres(CRITERES_VIDES)) : appliquer(f))}>
                  <span aria-hidden className="text-[12px]">★</span> {f.nom}
                </button>
              );
            })}
          </div>
        )}
        {sportsFiltre.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
          {[["", "Tout"], ...sportsFiltre.map((k) => [k, `${SPORTS[k].emoji} ${SPORTS[k].label}`])].map(([k, l]) => (
            <button key={k} onClick={() => { setSport(k); setLimite(PAGE); }}
              className={`puce ${sport === k ? "puce-active" : ""}`}>
              {l}
            </button>
          ))}
        </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-[15px] text-label-2">Chargement…</p>
      ) : activites.length === 0 ? (
        <Card>
          <div className="text-center py-8 space-y-3">
            <p className="text-4xl">📒</p>
            <p className="text-[15px] text-label-2">
              {filtre ? "Aucune activité ne correspond." : "Ton carnet est vide pour l'instant."}
            </p>
            {filtre && (
              <button className="btn-teinte" onClick={() => { setQ(""); setSport(""); majCriteres(CRITERES_VIDES); }}>
                Effacer la recherche et les filtres
              </button>
            )}
            {!filtre && (
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
                {g.items.map((a) => <ActiviteLigne key={a.id} a={a} onClick={() => setFiche(a)} />)}
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
      {fiche && <FicheActivite key={fiche.id} activite={fiche} onClose={() => setFiche(null)} />}
    </Page>
  );
}
