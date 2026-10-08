import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVerrouDefilement } from "../navigation";

// Feuille modale iOS 26 : poignée, ✕ en verre à gauche, titre, validation en
// capsule bleue à droite. On la ferme en la tirant vers le bas (depuis le
// haut de son contenu), en touchant le voile ou le ✕ ; la page derrière ne
// défile pas tant qu'elle est ouverte.
export default function Feuille({ titre, onClose, action, children, large = false, as: Tag = "div", ...props }) {
  const feuille = useRef(null);
  const voile = useRef(null);
  const [ferme, setFerme] = useState(false);
  const fermeture = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useVerrouDefilement();

  const fermer = () => {
    if (fermeture.current) return;
    fermeture.current = true;
    setFerme(true);
    setTimeout(() => onCloseRef.current?.(), 250);
  };
  const fermerRef = useRef(fermer);
  fermerRef.current = fermer;

  // Glisser vers le bas pour fermer
  useEffect(() => {
    const el = feuille.current;
    if (!el) return;
    let y0 = 0, x0 = 0, t0 = 0, dy = 0, actif = false, decide = false;

    const debut = (e) => {
      if (fermeture.current || window.innerWidth >= 768) return;
      // Pas de glisser depuis un champ ou une carte (MapLibre gère ses gestes)
      if (e.target.closest("input, textarea, select, .maplibregl-map")) return;
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = performance.now();
      dy = 0; decide = false;
      actif = el.scrollTop <= 0;
    };
    const bouge = (e) => {
      if (!actif) return;
      const d = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
      if (!decide) {
        if (Math.abs(d) < 6 && Math.abs(dx) < 6) return;
        decide = true;
        if (d <= 0 || Math.abs(dx) > Math.abs(d) || el.scrollTop > 0) { actif = false; return; }
        el.style.animation = "none";
        el.style.transition = "none";
      }
      e.preventDefault();
      // Résistance progressive, comme une feuille UIKit
      dy = Math.max(0, d);
      el.style.transform = `translateY(${dy}px)`;
      if (voile.current) voile.current.style.backgroundColor = `rgb(0 0 0 / ${0.4 * Math.max(0, 1 - dy / el.offsetHeight)})`;
    };
    const fin = () => {
      if (!actif || !decide) { actif = false; return; }
      actif = false;
      const vitesse = dy / Math.max(1, performance.now() - t0);
      if (dy > 140 || vitesse > 0.6) {
        el.style.transition = "transform 0.24s cubic-bezier(0.3, 0, 0.8, 0.15)";
        el.style.transform = "translateY(100%)";
        if (voile.current) {
          voile.current.style.transition = "background-color 0.24s ease";
          voile.current.style.backgroundColor = "rgb(0 0 0 / 0)";
        }
        fermeture.current = true;
        setTimeout(() => onCloseRef.current?.(), 230);
      } else {
        el.style.transition = "transform 0.45s var(--ressort)";
        el.style.transform = "";
        if (voile.current) voile.current.style.backgroundColor = "";
      }
    };

    el.addEventListener("touchstart", debut, { passive: true });
    el.addEventListener("touchmove", bouge, { passive: false });
    el.addEventListener("touchend", fin);
    el.addEventListener("touchcancel", fin);
    return () => {
      el.removeEventListener("touchstart", debut);
      el.removeEventListener("touchmove", bouge);
      el.removeEventListener("touchend", fin);
      el.removeEventListener("touchcancel", fin);
    };
  }, []);

  // Échap ferme la feuille (clavier, ordinateur)
  useEffect(() => {
    const f = (e) => { if (e.key === "Escape") fermerRef.current(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  return createPortal(
    <div ref={voile} className={`voile ${ferme ? "ferme" : ""}`} onClick={fermer}>
      <Tag ref={feuille} className={`feuille ${large ? "feuille-large" : ""} ${ferme ? "ferme" : ""}`} onClick={(e) => e.stopPropagation()} {...props}>
        <div className="feuille-barre sticky top-0 z-10 bg-inherit">
          <div className="poignee" />
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 h-[52px] md:h-14">
            <button type="button" onClick={fermer} aria-label="Annuler" className="btn-verre justify-self-start">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="w-[17px] h-[17px]">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <h3 className="text-[17px] font-semibold text-center truncate">{titre}</h3>
            <div className="justify-self-end">{action}</div>
          </div>
        </div>
        <div className="px-4 pt-2 pb-6 space-y-5">{children}</div>
      </Tag>
    </div>,
    document.body
  );
}
