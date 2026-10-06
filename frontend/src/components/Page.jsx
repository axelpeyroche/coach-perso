// Gabarit de page : grand titre iOS, sous-titre et action à droite
export default function Page({ titre, sousTitre, action, children, large = false }) {
  return (
    <div className={`mx-auto w-full ${large ? "max-w-6xl" : "max-w-5xl"} px-4 md:px-8 pt-[calc(env(safe-area-inset-top)+1rem)] md:pt-10 pb-8 space-y-6`}>
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {sousTitre && <p className="text-[13px] font-semibold uppercase tracking-[0.02em] text-label-2 mb-0.5">{sousTitre}</p>}
          <h1 className="large-title truncate">{titre}</h1>
        </div>
        {action && <div className="shrink-0 pb-1">{action}</div>}
      </header>
      {children}
    </div>
  );
}
