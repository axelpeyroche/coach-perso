import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchProfilFC } from "../api";
import { useAuth } from "../AuthContext";
import { getErrorMessage } from "../utils/errors";
import { createPortal } from "react-dom";
import { useVerrouDefilement } from "../navigation";

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
  useVerrouDefilement();
  return createPortal(
    <div className="voile !items-center p-6" onClick={onClose}>
      <div role="dialog" className="alerte glass glass-epais" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 space-y-3">
          <h3 className="text-[17px] font-semibold">Nouveau poids</h3>
          <input type="number" inputMode="decimal" step="0.1" autoFocus placeholder="72,5 kg" value={poids} onChange={e => setPoids(e.target.value)}
            className="champ text-center bg-surface" />
          {err && <p className="text-[13px] text-ios-red">{err}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2.5 px-4 pb-4">
          <button onClick={onClose} className="btn-alerte bg-remplissage text-label">Annuler</button>
          <button onClick={() => { setErr(""); mut.mutate(); }} disabled={mut.isPending || !parseFloat(poids)}
            className="btn-alerte bg-brand text-white font-semibold">
            {mut.isPending ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
