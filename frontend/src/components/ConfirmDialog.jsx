import clsx from "clsx";

export default function ConfirmDialog({
  open, title, message,
  confirmLabel = "Confirmer", cancelLabel = "Annuler",
  danger = false, pending = false,
  onConfirm, onCancel,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
        {title && <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>}
        {message && <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">{message}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} disabled={pending}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={pending}
            className={clsx(
              "flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-50",
              danger ? "bg-red-500 hover:bg-red-600" : "bg-brand hover:bg-brand-dark"
            )}>
            {pending ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
