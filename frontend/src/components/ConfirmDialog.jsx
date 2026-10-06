import clsx from "clsx";

// Alerte de confirmation iOS : deux boutons côte à côte
export default function ConfirmDialog({
  open, title, message,
  confirmLabel = "Confirmer", cancelLabel = "Annuler",
  danger = false, pending = false,
  onConfirm, onCancel,
}) {
  if (!open) return null;
  return (
    <div className="voile !items-center p-6" onClick={onCancel}>
      <div className="alerte" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4 space-y-1">
          {title && <h3 className="text-[17px] font-semibold">{title}</h3>}
          {message && <p className="text-[13px] text-label whitespace-pre-line">{message}</p>}
        </div>
        <div className="grid grid-cols-2 border-t-[0.5px] border-separateur">
          <button onClick={onCancel} disabled={pending}
            className="h-11 text-[17px] text-brand border-r-[0.5px] border-separateur active:bg-remplissage disabled:opacity-40">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={pending}
            className={clsx("h-11 text-[17px] font-semibold active:bg-remplissage disabled:opacity-40",
              danger ? "text-ios-red" : "text-brand")}>
            {pending ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
