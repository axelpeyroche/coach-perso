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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-xs p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900 dark:text-white">Nouveau poids</h3>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Poids (kg)</label>
          <input type="number" step="0.1" autoFocus placeholder="72.5" value={poids} onChange={e => setPoids(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500">Annuler</button>
          <button onClick={() => { setErr(""); mut.mutate(); }} disabled={mut.isPending || !parseFloat(poids)}
            className="flex-1 py-2 rounded-xl bg-brand text-white font-semibold text-sm disabled:opacity-50">
            {mut.isPending ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
