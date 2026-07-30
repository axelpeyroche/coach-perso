export default function AlertDialog({ open, title, message, closeLabel = "OK", onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
        {title && <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>}
        {message && <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">{message}</p>}
        <button onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-dark transition-colors">
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
