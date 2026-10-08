import clsx from "clsx";
import { createPortal } from "react-dom";
import { useVerrouDefilement } from "../navigation";

// Alerte de confirmation iOS 26 : verre épais, boutons en capsule côte à côte
export default function ConfirmDialog({
  open, title, message,
  confirmLabel = "Confirmer", cancelLabel = "Annuler",
  danger = false, pending = false, disabled = false,
  onConfirm, onCancel, children,
}) {
  useVerrouDefilement(open);
  if (!open) return null;
  return createPortal(
    <div className="voile !items-center p-6" onClick={onCancel}>
      <div role="alertdialog" className="alerte glass glass-epais" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 space-y-1.5">
          {title && <h3 className="text-[17px] font-semibold">{title}</h3>}
          {message && <p className="text-[14px] text-label whitespace-pre-line">{message}</p>}
          {children}
        </div>
        <div className="grid grid-cols-2 gap-2.5 px-4 pb-4">
          <button onClick={onCancel} disabled={pending} className="btn-alerte bg-remplissage text-label">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={pending || disabled}
            className={clsx("btn-alerte font-semibold disabled:opacity-50", danger ? "bg-ios-red text-white" : "bg-brand text-white")}>
            {pending ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
