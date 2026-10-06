// Feuille modale iOS : poignée, barre Annuler / titre / action, contenu défilant
export default function Feuille({ titre, onClose, action, children, as: Tag = "div", ...props }) {
  return (
    <div className="voile" onClick={onClose}>
      <Tag className="feuille" onClick={(e) => e.stopPropagation()} {...props}>
        <div className="sticky top-0 z-10 bg-inherit">
          <div className="poignee" />
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 h-12">
            <button type="button" onClick={onClose} className="btn-texte justify-self-start">Annuler</button>
            <h3 className="text-[17px] font-semibold text-center truncate">{titre}</h3>
            <div className="justify-self-end">{action}</div>
          </div>
        </div>
        <div className="px-4 pt-2 pb-6 space-y-5">{children}</div>
      </Tag>
    </div>
  );
}
