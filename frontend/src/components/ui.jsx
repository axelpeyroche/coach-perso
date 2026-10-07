import clsx from "clsx";
import { Link } from "react-router-dom";

// En-tête de section façon app Santé : titre en gras et lien à droite
export function Section({ titre, lien, libelleLien = "Tout voir", action, children }) {
  return (
    <section className="space-y-2.5 min-w-0">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="titre-section">{titre}</h2>
        {action ?? (lien && <Link to={lien} className="btn-texte">{libelleLien}</Link>)}
      </div>
      {children}
    </section>
  );
}

export function BoutonAjout({ onClick, label = "Ajouter" }) {
  return (
    <button onClick={onClick} aria-label={label} className="btn-rond bg-brand/[0.12] text-brand w-10 h-10">
      <svg viewBox="0 0 24 24" className="w-5 h-5" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" fill="none">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

export function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 text-label-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

// Contrôle segmenté iOS 26 : le curseur glisse avec un ressort.
// options : [[valeur, libellé], …]
export function Segmente({ options, valeur, onChange, className }) {
  const idx = options.findIndex(([v]) => v === valeur);
  return (
    <div className={clsx("segmente", className)}>
      {idx >= 0 && (
        <span aria-hidden className="curseur-segment"
          style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }} />
      )}
      {options.map(([v, l]) => (
        <button type="button" key={v} onClick={() => onChange(v)}
          className={clsx("segment", valeur === v && "segment-actif")}>
          {l}
        </button>
      ))}
    </div>
  );
}

// Interrupteur iOS
export function Interrupteur({ actif, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!actif} aria-label={label}
      className="interrupteur" onClick={() => onChange(!actif)}>
      <span />
    </button>
  );
}
