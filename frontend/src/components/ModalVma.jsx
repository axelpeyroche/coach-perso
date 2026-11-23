import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchProfilFC } from "../api";
import { getErrorMessage } from "../utils/errors";
import { createPortal } from "react-dom";
import { useVerrouDefilement } from "../navigation";

// Résultat exact d'un test VMA : il remplace la distance mesurée par le GPS ce jour-là.
export default function ModalVma({ zones, onClose }) {
  const qc = useQueryClient();
  const aujourdhui = new Date().toLocaleDateString("sv-SE"); // AAAA-MM-JJ, heure locale
  const duTest = zones?.vma_source === "test";
  const [vma, setVma] = useState(duTest && zones?.vma_kmh ? String(zones.vma_kmh) : "");
  const [jour, setJour] = useState((duTest && zones?.vma_test_le) || aujourdhui);
  const [err, setErr] = useState("");
  const valeur = parseFloat(vma.replace(",", "."));
  const mut = useMutation({
    mutationFn: (payload) => patchProfilFC(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zones"] });
      qc.invalidateQueries({ queryKey: ["analyses"] });
      qc.invalidateQueries({ queryKey: ["tests"] });
      onClose();
    },
    onError: (e) => setErr(getErrorMessage(e, "Erreur — réessaie")),
  });
  useVerrouDefilement();
  return createPortal(
    <div className="voile !items-center p-6" onClick={onClose}>
      <div role="dialog" className="alerte glass glass-epais" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 space-y-3">
          <h3 className="text-[17px] font-semibold">VMA du test</h3>
          <p className="text-[13px] text-label-2">
            Distance réelle en 6 min × 10 (1 600 m = 16 km/h). Elle remplace la mesure GPS du test de ce jour-là ; un test plus récent prendra le relais tout seul.
          </p>
          <input type="number" inputMode="decimal" step="0.1" autoFocus placeholder="16 km/h" value={vma} onChange={e => setVma(e.target.value)}
            className="champ text-center bg-surface" />
          <label className="flex items-center justify-between gap-3 text-[15px]">
            <span className="text-label-2">Test du</span>
            <input type="date" value={jour} max={aujourdhui} onChange={e => setJour(e.target.value)}
              className="champ !w-auto bg-surface text-[15px]" />
          </label>
          {zones?.vma_saisie && (
            <button onClick={() => { setErr(""); mut.mutate({ vma_test_kmh: 0 }); }} disabled={mut.isPending}
              className="text-[13px] text-ios-red">Retirer la valeur saisie</button>
          )}
          {err && <p className="text-[13px] text-ios-red">{err}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2.5 px-4 pb-4">
          <button onClick={onClose} className="btn-alerte bg-remplissage text-label">Annuler</button>
          <button onClick={() => { setErr(""); mut.mutate({ vma_test_kmh: valeur, vma_test_le: jour || aujourdhui }); }}
            disabled={mut.isPending || !valeur}
            className="btn-alerte bg-brand text-white font-semibold">
            {mut.isPending ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
