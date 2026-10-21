import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import Page from "../components/Page";
import ConfirmDialog from "../components/ConfirmDialog";
import { BarreSurfaces, Carte, Chiffre, COULEURS, km, nomSport, TACTILE, telecharger } from "../components/CarteItineraire";
import Profil, { profil } from "../components/ProfilAltitude";
import {
  getAlluresItineraire, getFavoriItineraire, getFavorisItineraire, renommerFavoriItineraire, supprimerFavoriItineraire,
} from "../api";
import { nombre } from "../carnet";
import * as T from "./itineraireTrace";

const EMOJIS = { course: "🏃", trail: "⛰️", randonnee: "🥾", velo: "🚴", gravel: "🚵", vtt: "🚵‍♂️" };
const COULEUR = COULEURS[0];

const detail = (e, defaut) => (typeof e?.response?.data?.detail === "string" ? e.response.data.detail : defaut);

// ── Parcours ouvert sous sa ligne : carte, chiffres, surfaces, profil, actions ──
function Detail({ id, allures, onModifier, onSupprimer }) {
  const qc = useQueryClient();
  const zone = useRef(null);
  const [curseur, setCurseur] = useState(null);
  const [renommage, setRenommage] = useState(false);
  const [nom, setNom] = useState("");
  const { data: f, isLoading, error } = useQuery({ queryKey: ["itineraire-favori", id], queryFn: () => getFavoriItineraire(id), staleTime: 300_000 });

  useEffect(() => { zone.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [f]);

  const calc = useMemo(() => {
    if (!f?.points?.length) return null;
    const prof = profil(f.points);
    const alts = f.points.map((p) => p[2]).filter((a) => a != null);
    const pentes = T.pentes(prof);
    return {
      dmoins: T.denivele([...f.points].reverse()),
      altMax: alts.length ? Math.round(Math.max(...alts)) : null,
      altMin: alts.length ? Math.round(Math.min(...alts)) : null,
      penteMax: pentes.length ? Math.round(Math.max(...pentes.map(Math.abs))) : null,
      repartition: f.repartition ?? (f.terrains?.length ? T.repartitionDepuis(f.terrains) : null),
    };
  }, [f]);

  const renommer = useMutation({
    mutationFn: (n) => renommerFavoriItineraire(id, n),
    onSuccess: (r) => {
      qc.setQueryData(["itineraire-favori", id], (v) => (v ? { ...v, nom: r.nom } : v));
      qc.invalidateQueries({ queryKey: ["itineraires-favoris"] });
    },
  });
  const valider = () => {
    const t = nom.trim();
    setRenommage(false);
    if (t && t !== f.nom) renommer.mutate(t.slice(0, 120));
  };

  if (isLoading) return <p className="px-4 pb-4 text-[14px] text-label-2">Chargement du parcours…</p>;
  if (error || !f) return <p className="px-4 pb-4 text-[14px] text-ios-red" role="alert">{detail(error, "Ouverture impossible pour le moment.")}</p>;

  const r = { points: f.points, terrains: f.terrains, etapes: f.etapes, distance_km: f.distance_km, dplus_m: f.dplus_m, nom: f.nom };
  const temps = T.duree(T.tempsEstime(r, allures?.[f.sport]));
  const posCurseur = curseur != null && f.points[curseur] ? { pos: f.points[curseur], c: COULEUR } : null;

  return (
    <div ref={zone} className="px-3 pb-3 pt-1 space-y-3 scroll-mt-20">
      <Carte propositions={[r]} choisie={0} onChoisir={() => {}} cadrage={f.id}
        traceSurvol={f.points} onSurvol={TACTILE ? null : setCurseur} curseur={posCurseur} />

      <div className="rounded-[12px] bg-remplissage/60 p-3.5 space-y-2.5">
        <div className="grid grid-cols-[1fr_0.8fr_0.8fr_1.3fr] gap-2">
          <Chiffre titre="Distance" valeur={km(f.distance_km)} unite="km" />
          <Chiffre titre="D+" valeur={f.dplus_m} unite="m" />
          <Chiffre titre="D−" valeur={calc?.dmoins ?? "—"} unite={calc ? "m" : ""} />
          <Chiffre titre="Temps estimé" valeur={temps || "—"} unite="" />
        </div>
        <BarreSurfaces repartition={calc?.repartition} />
        <p className="text-[12px] text-label-2 chiffres">
          {[nomSport(f.sport), f.boucle ? "Boucle" : "Aller simple",
            calc?.altMin != null && `alt. ${calc.altMin}–${calc.altMax} m`,
            calc?.penteMax != null && `pente max ${calc.penteMax} %`,
            f.maj_le && `enregistré le ${new Date(f.maj_le).toLocaleDateString("fr-FR")}`].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div className="px-1">
        <Profil points={f.points} couleur={COULEUR} hauteur={100} detail axes terrains={f.terrains}
          curseur={curseur} onCurseur={setCurseur} entete={(l) => (
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.02em] text-label-2">Profil</h3>
              <p className="text-[12px] text-label-2 chiffres shrink-0 truncate">
                {l && [`${nombre(l.km, 2)} km`, `${Math.round(l.alt)} m`, l.pente != null && `${l.pente > 0 ? "+" : l.pente < 0 ? "−" : ""}${Math.abs(l.pente)} %`, l.terrain]
                  .filter(Boolean).join(" · ")}
              </p>
            </div>
          )} />
      </div>

      {renommage && (
        <input autoFocus value={nom} onChange={(e) => setNom(e.target.value)} maxLength={120} aria-label="Nom du parcours"
          onKeyDown={(e) => { if (e.key === "Enter") valider(); if (e.key === "Escape") setRenommage(false); }} onBlur={valider}
          className="champ" />
      )}
      {renommer.isError && <p className="px-1 text-[13px] text-ios-red" role="alert">{detail(renommer.error, "Renommage impossible pour le moment.")}</p>}

      <div className="flex flex-wrap items-center gap-2 px-1">
        <button type="button" onClick={() => telecharger(r, f.sport, f.boucle)} className="btn-teinte btn-sm gap-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
          GPX
        </button>
        <button type="button" onClick={onModifier} className="btn-gris btn-sm">Modifier le tracé</button>
        {!renommage && (
          <button type="button" onClick={() => { setNom(f.nom); setRenommage(true); }} className="btn-texte !text-[13px]">Renommer</button>
        )}
        <button type="button" onClick={() => onSupprimer(f)} className="btn-texte !text-[13px] !text-ios-red">Supprimer</button>
      </div>
    </div>
  );
}

// Tous les itinéraires enregistrés ; un appui ouvre le parcours juste en dessous
export default function Parcours() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [ouvert, setOuvert] = useState(null);
  const [aSupprimer, setASupprimer] = useState(null);
  const { data: favoris, isLoading } = useQuery({ queryKey: ["itineraires-favoris"], queryFn: getFavorisItineraire, staleTime: 60_000 });
  const { data: allures } = useQuery({ queryKey: ["itineraires-allures"], queryFn: getAlluresItineraire, staleTime: 600_000 });

  // Retouche sur la page Itinéraires, par l'historique pour ne pas l'empiler deux fois
  const modifier = (id) => {
    qc.setQueryData(["itineraire-a-ouvrir"], id);
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate("/itineraires", { replace: true });
  };
  const supprimer = useMutation({
    mutationFn: (id) => supprimerFavoriItineraire(id),
    onSuccess: (_, id) => {
      setASupprimer(null);
      if (ouvert === id) setOuvert(null);
      qc.removeQueries({ queryKey: ["itineraire-favori", id] });
      qc.invalidateQueries({ queryKey: ["itineraires-favoris"] });
    },
  });

  return (
    <Page titre="Mes parcours" sousTitre="Itinéraires enregistrés">
      {isLoading && <p className="px-1 text-[14px] text-label-2">Chargement…</p>}
      {favoris?.length === 0 && (
        <div className="card p-4 text-[14px] text-label-2">
          Aucun parcours enregistré pour le moment. Enregistre un itinéraire proposé ou créé pour le retrouver ici.
        </div>
      )}
      {favoris?.length > 0 && (
        <div>
          <h2 className="entete-liste">{favoris.length} parcours</h2>
          <div className="card py-0.5">
            {favoris.map((f) => {
              const sel = ouvert === f.id;
              return (
                <div key={f.id}>
                  <button type="button" onClick={() => setOuvert(sel ? null : f.id)} aria-expanded={sel}
                    className="ligne w-full text-left" style={{ "--inset": "3rem" }}>
                    <span className="w-5 text-center text-[17px] shrink-0" aria-hidden>{EMOJIS[f.sport] ?? "📍"}</span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-[15px] truncate ${sel ? "font-semibold" : ""}`}>{f.nom}</span>
                      <span className="block text-[12px] text-label-2 chiffres">
                        {km(f.distance_km)} km · {f.dplus_m} m D+ · {f.boucle ? "boucle" : "aller simple"}
                      </span>
                    </span>
                    <span className={`text-[18px] text-label-3 transition-transform ${sel ? "rotate-90" : ""}`} aria-hidden>›</span>
                  </button>
                  {sel && <Detail id={f.id} allures={allures} onModifier={() => modifier(f.id)} onSupprimer={setASupprimer} />}
                </div>
              );
            })}
          </div>
          {supprimer.isError && <p className="px-4 pt-2 text-[13px] text-ios-red" role="alert">{detail(supprimer.error, "Suppression impossible pour le moment.")}</p>}
        </div>
      )}

      <ConfirmDialog open={aSupprimer != null} title="Supprimer ce parcours ?"
        message={aSupprimer ? `« ${aSupprimer.nom} » sera retiré de tes parcours enregistrés.` : ""}
        confirmLabel="Supprimer" cancelLabel="Annuler" danger pending={supprimer.isPending}
        onConfirm={() => supprimer.mutate(aSupprimer.id)} onCancel={() => setASupprimer(null)} />
    </Page>
  );
}
