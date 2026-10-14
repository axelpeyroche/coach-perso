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
  const aujourdhui = new Date().toLocaleDateString("sv-SE"); // AAAA-MM-JJ, heure locale
  const [jour, setJour] = useState(aujourdhui);
  const [err, setErr] = useState("");
  const mut = useMutation({
    mutationFn: () => patchProfilFC({ poids_kg: parseFloat(poids.replace(",", ".")), date: jour || aujourdhui }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["profil-fc"] });
      qc.invalidateQueries({ queryKey: ["historique-poids"] });
      qc.invalidateQueries({ queryKey: ["analyses"] });
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
          <label className="flex items-center justify-between gap-3 text-[15px]">
            <span className="text-label-2">Pesée du</span>
            <input type="date" value={jour} max={aujourdhui} onChange={e => setJour(e.target.value)}
              className="champ !w-auto bg-surface text-[15px]" />
          </label>
          {err && <p className="text-[13px] text-ios-red">{err}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2.5 px-4 pb-4">
          <button onClick={onClose} className="btn-alerte bg-remplissage text-label">Annuler</button>
          <button onClick={() => { setErr(""); mut.mutate(); }} disabled={mut.isPending || !parseFloat(poids.replace(",", "."))}
            className="btn-alerte bg-brand text-white font-semibold">
            {mut.isPending ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
