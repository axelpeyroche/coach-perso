import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { PARENTS, estPoussee } from "../navigation";

// Barre de navigation mobile (iOS 26) : boutons de verre flottants, retour
// sur les pages poussées, et au défilement un bord flouté avec le titre
// compact centré dès que le grand titre passe dessous.
function BarreNav({ titre, action, titreRef }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const barre = useRef(null);
  const [defile, setDefile] = useState(false);
  const [titreVisible, setTitreVisible] = useState(false);

  useEffect(() => {
    const f = () => {
      setDefile(window.scrollY > 2);
      const h = titreRef.current, b = barre.current;
      if (h && b) setTitreVisible(h.getBoundingClientRect().bottom < b.getBoundingClientRect().bottom - 4);
    };
    f();
    window.addEventListener("scroll", f, { passive: true });
    window.addEventListener("resize", f);
    return () => { window.removeEventListener("scroll", f); window.removeEventListener("resize", f); };
  }, [titreRef]);

  const retour = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(PARENTS[pathname] ?? "/");
  };

  return createPortal(
    <div ref={barre} className={`barre-nav md:hidden ${defile ? "defile" : ""}`}>
      <div className="relative flex items-center justify-between gap-3 h-[52px] px-4">
        {estPoussee(pathname) ? (
          <button type="button" onClick={retour} aria-label="Retour" className="btn-verre">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px] -ml-0.5">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
        ) : <span />}
        <span aria-hidden className={`barre-nav-titre ${titreVisible ? "visible" : ""}`}>{titre}</span>
        <div className="barre-nav-actions flex items-center gap-2">{action}</div>
      </div>
    </div>,
    document.body
  );
}

// Gabarit de page : grand titre iOS, sous-titre et action à droite
// (dans la barre de navigation flottante sur téléphone)
export default function Page({ titre, sousTitre, action, children, large = false }) {
  const titreRef = useRef(null);
  return (
    <div className={`mx-auto w-full ${large ? "max-w-6xl" : "max-w-5xl"} px-4 md:px-8 pt-[calc(env(safe-area-inset-top)+52px)] md:pt-10 pb-8 space-y-6`}>
      <BarreNav titre={titre} action={action} titreRef={titreRef} />
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {sousTitre && <p className="text-[13px] font-semibold uppercase tracking-[0.02em] text-label-2 mb-0.5">{sousTitre}</p>}
          <h1 ref={titreRef} className="large-title truncate">{titre}</h1>
        </div>
        {action && <div className="hidden md:block shrink-0 pb-1">{action}</div>}
      </header>
      {children}
    </div>
  );
}
