import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchProfilFC } from "../api";
import { useAuth } from "../AuthContext";
import { getErrorMessage } from "../utils/errors";

export default function ModalPoids({ initialValue, onClose }) {
  const qc = useQueryClient();
  const { setUser } = useAuth();
  const [poids, setPoids] = useState(initialValue ? String(initialValue) : "");
  const [err, setErr] = useState("");
  const mut = useMutation({
    mutationFn: () => patchProfilFC({ poids_kg: parseFloat(poids) }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["profil-fc"] });
      qc.invalidateQueries({ queryKey: ["historique-poids"] });
      setUser(u => u ? { ...u, poids_kg: data.poids_kg } : u);
      onClose();
    },
    onError: (e) => setErr(getErrorMessage(e, "Erreur — réessaie")),
  });
  return (
    <div className="voile !items-center p-6" onClick={onClose}>
      <div className="alerte" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4 space-y-3">
          <h3 className="text-[17px] font-semibold">Nouveau poids</h3>
          <input type="number" step="0.1" autoFocus placeholder="72,5 kg" value={poids} onChange={e => setPoids(e.target.value)}
            className="champ text-center" />
          {err && <p className="text-[13px] text-ios-red">{err}</p>}
        </div>
        <div className="grid grid-cols-2 border-t-[0.5px] border-separateur">
          <button onClick={onClose} className="h-11 text-[17px] text-brand border-r-[0.5px] border-separateur active:bg-remplissage">Annuler</button>
          <button onClick={() => { setErr(""); mut.mutate(); }} disabled={mut.isPending || !parseFloat(poids)}
            className="h-11 text-[17px] font-semibold text-brand active:bg-remplissage disabled:opacity-40">
            {mut.isPending ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
