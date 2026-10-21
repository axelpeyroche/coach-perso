import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import Page from "../components/Page";
import { getFavorisItineraire } from "../api";
import { nombre } from "../carnet";

const EMOJIS = { course: "🏃", trail: "⛰️", randonnee: "🥾", velo: "🚴", gravel: "🚵", vtt: "🚵‍♂️" };
const km = (v) => nombre(v, v < 10 ? 2 : 1);

// Tous les itinéraires enregistrés ; un appui rouvre le parcours sur la carte
export default function Parcours() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Retour à la carte par l'historique, pour ne pas empiler deux fois la page Itinéraires
  const choisir = (id) => {
    qc.setQueryData(["itineraire-a-ouvrir"], id);
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate("/itineraires", { replace: true });
  };
  const { data: favoris, isLoading } = useQuery({ queryKey: ["itineraires-favoris"], queryFn: getFavorisItineraire, staleTime: 60_000 });

  return (
    <Page titre="Mes parcours" sousTitre="Itinéraires enregistrés">
      {isLoading && <p className="px-1 text-[14px] text-label-2">Chargement…</p>}
      {favoris?.length === 0 && (
        <div className="card p-4 text-[14px] text-label-2">
          Aucun parcours enregistré pour le moment. Enregistre un itinéraire proposé pour le retrouver ici.
        </div>
      )}
      {favoris?.length > 0 && (
        <div>
          <h2 className="entete-liste">{favoris.length} parcours</h2>
          <div className="card py-0.5">
            {favoris.map((f) => (
              <button type="button" key={f.id} onClick={() => choisir(f.id)}
                className="ligne w-full text-left" style={{ "--inset": "3rem" }}>
                <span className="w-5 text-center text-[17px] shrink-0" aria-hidden>{EMOJIS[f.sport] ?? "📍"}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] truncate">{f.nom}</span>
                  <span className="block text-[12px] text-label-2 chiffres">
                    {km(f.distance_km)} km · {f.dplus_m} m D+ · {f.boucle ? "boucle" : "aller simple"}
                  </span>
                </span>
                <span className="text-[18px] text-label-3" aria-hidden>›</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
