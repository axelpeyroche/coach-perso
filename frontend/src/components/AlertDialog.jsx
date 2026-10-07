import { createPortal } from "react-dom";
import { useVerrouDefilement } from "../navigation";

// Alerte iOS 26 : verre épais, texte centré, bouton en capsule pleine largeur
export default function AlertDialog({ open, title, message, closeLabel = "OK", onClose }) {
  useVerrouDefilement(open);
  if (!open) return null;
  return createPortal(
    <div className="voile !items-center p-6" onClick={onClose}>
      <div role="alertdialog" className="alerte glass glass-epais" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 space-y-1.5">
          {title && <h3 className="text-[17px] font-semibold">{title}</h3>}
          {message && <p className="text-[14px] text-label whitespace-pre-line">{message}</p>}
        </div>
        <div className="px-4 pb-4">
          <button onClick={onClose} className="btn-alerte w-full bg-brand text-white font-semibold">
            {closeLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
