import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getExclusions, ecarterDesCalculs, reintegrerDansCalculs } from "../api";

// Fiche d'une séance : la tenir à l'écart des analyses (capteur décroché, GPS faux, doublon) sans la supprimer.
export default function EcartCalculs({ activiteId }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["exclusions"], queryFn: getExclusions, staleTime: 300000 });
  const ecart = (data ?? []).find((e) => e.activite_id === activiteId);
  const rafraichir = () => ["exclusions", "sante-carnet", "analyses", "alertes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const ecarter = useMutation({ mutationFn: () => ecarterDesCalculs({ activite_id: activiteId }), onSuccess: rafraichir });
  const reintegrer = useMutation({ mutationFn: () => reintegrerDansCalculs(ecart.id), onSuccess: rafraichir });
  const occupe = ecarter.isPending || reintegrer.isPending;
  const echec = ecarter.isError || reintegrer.isError;

  if (!data) return null;
  return (
    <div className="no-print sm:col-span-2 card p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-semibold">{ecart ? "Séance écartée des calculs" : "Données fausses ?"}</p>
        <p className="text-[13px] leading-[18px] text-label-2 mt-0.5">
          {echec ? "Action impossible pour le moment. Réessaie dans un instant."
            : ecart ? "Elle reste dans ton carnet, mais ne compte plus dans les analyses (charge, forme, allures, records d’effort)."
              : "Capteur décroché, GPS faux, doublon : écarte la séance des analyses. Elle reste dans ton carnet, intacte."}
        </p>
      </div>
      <button type="button" className={ecart ? "btn-teinte btn-sm shrink-0 self-start sm:self-center" : "btn-gris btn-sm shrink-0 self-start sm:self-center"}
        disabled={occupe} onClick={() => (ecart ? reintegrer.mutate() : ecarter.mutate())}>
        {ecart ? "Réintégrer" : "Écarter des calculs"}
      </button>
    </div>
  );
}
