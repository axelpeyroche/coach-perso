// Alerte iOS : verre, texte centré, bouton pleine largeur
export default function AlertDialog({ open, title, message, closeLabel = "OK", onClose }) {
  if (!open) return null;
  return (
    <div className="voile !items-center p-6" onClick={onClose}>
      <div className="alerte" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4 space-y-1">
          {title && <h3 className="text-[17px] font-semibold">{title}</h3>}
          {message && <p className="text-[13px] text-label whitespace-pre-line">{message}</p>}
        </div>
        <button onClick={onClose}
          className="w-full h-11 border-t-[0.5px] border-separateur text-[17px] font-semibold text-brand active:bg-remplissage">
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
