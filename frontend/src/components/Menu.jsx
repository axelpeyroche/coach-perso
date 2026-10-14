import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

// Menu contextuel en Liquid Glass (iOS 26) : un bouton « ⋯ » ouvre une
// bulle de verre qui jaillit du bouton. Chaque entrée : { label, icone,
// onClick, danger, disabled } ; { separateur: true } pour un séparateur.
export default function Menu({ items, label = "Plus d'actions", className = "" }) {
  const [ouvert, setOuvert] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);

  useLayoutEffect(() => {
    if (!ouvert || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const enBas = r.top > window.innerHeight * 0.55;
    const droite = Math.max(12, window.innerWidth - r.right);
    setPos(enBas
      ? { bottom: window.innerHeight - r.top + 8, right: droite, origine: "bottom right" }
      : { top: r.bottom + 8, right: droite, origine: "top right" });
  }, [ouvert]);

  const fermer = () => { setOuvert(false); setPos(null); };

  return (
    <>
      <button ref={btn} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={ouvert}
        onClick={(e) => { e.stopPropagation(); setOuvert(true); }}
        className={`btn-rond w-8 h-8 text-label-2 ${className}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
          <circle cx="5.5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18.5" cy="12" r="1.8" />
        </svg>
      </button>
      {ouvert && createPortal(
        <div className="fixed inset-0 z-[60]" onClick={fermer}
          onTouchMove={fermer} onWheel={fermer}>
          {pos && (
            <div role="menu" className="menu-verre fixed"
              style={{ top: pos.top, bottom: pos.bottom, right: pos.right, transformOrigin: pos.origine }}
              onClick={(e) => e.stopPropagation()}>
              {items.filter(Boolean).map((it, i) => it.separateur
                ? <div key={i} className="menu-separateur" />
                : (
                  <button key={i} type="button" role="menuitem" disabled={it.disabled}
                    onClick={() => { fermer(); it.onClick?.(); }}
                    className={`menu-item ${it.danger ? "!text-ios-red" : ""}`}>
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.icone}
                  </button>
                ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// Icônes du menu (traits SF Symbols)
const ic = (d) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
export const IconesMenu = {
  commenter: ic(<path d="M4 5h16v11H9l-5 4V5z" />),
  relier: ic(<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>),
  delier: ic(<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /><path d="M4 4l16 16" /></>),
  sauter: ic(<><circle cx="12" cy="12" r="8.5" /><path d="M9 9l6 6M15 9l-6 6" /></>),
  retablir: ic(<><path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7" /><path d="M4 4v4h4" /></>),
  supprimer: ic(<><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></>),
};

// Menu déroulant façon iOS (bouton pop-up) : la valeur suivie de ⌃⌄ ouvre une bulle de verre
// où le choix courant est coché. options : [{ valeur, label }, { separateur: true }]
export function MenuChoix({ valeur, options, onChange, label }) {
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const courante = options.find((o) => !o.separateur && o.valeur === valeur);

  const ouvrir = () => {
    const r = btn.current.getBoundingClientRect();
    const droite = Math.max(12, window.innerWidth - r.right);
    // Hauteur estimée du menu (items de 44 px, séparateurs de 8 px) : s'ouvre vers le bas
    // s'il y tient, sinon du côté où il reste le plus de place.
    const hauteur = options.reduce((h, o) => h + (o.separateur ? 8 : 44), 12);
    const dessous = window.innerHeight - r.bottom - 18;
    const dessus = r.top - 18;
    setPos(dessous < hauteur && dessus > dessous
      ? { bottom: window.innerHeight - r.top + 6, right: droite, origine: "bottom right", max: dessus }
      : { top: r.bottom + 6, right: droite, origine: "top right", max: dessous });
  };
  const fermer = () => setPos(null);

  return (
    <>
      <button ref={btn} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={!!pos}
        onClick={ouvrir} className="flex items-center gap-1 text-[17px] text-label-2 active:opacity-50 transition-opacity">
        <span>{courante?.label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
          className="w-[13px] h-[13px]" aria-hidden><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" /></svg>
      </button>
      {pos && createPortal(
        <div className="fixed inset-0 z-[60]" onClick={fermer} onTouchMove={fermer} onWheel={fermer}>
          <div role="menu" aria-label={label} className="menu-verre fixed !min-w-[200px] overflow-y-auto scrollbar-hide overscroll-contain"
            style={{ top: pos.top, bottom: pos.bottom, right: pos.right, maxHeight: pos.max, transformOrigin: pos.origine }}
            onClick={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            {options.map((o, i) => o.separateur
              ? <div key={i} className="menu-separateur" />
              : (
                <button key={i} type="button" role="menuitemradio" aria-checked={o.valeur === valeur}
                  onClick={() => { fermer(); if (o.valeur !== valeur) onChange(o.valeur); }}
                  className="menu-item !pl-3">
                  <span className="w-[19px] shrink-0 flex justify-center" aria-hidden>
                    {o.valeur === valeur && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
                        className="!w-[15px] !h-[15px]"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                    )}
                  </span>
                  <span className="flex-1 truncate">{o.label}</span>
                </button>
              ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
