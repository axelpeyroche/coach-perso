import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Lecteur plein écran du mouvement : le mannequin 3D (mannequin.js, chargé à la
// demande) répète l'exercice en boucle. Un doigt / clic glissé tourne autour,
// pincer / molette zoome, deux doigts / clic droit déplacent, double tap recentre.

const ROSE = "#D9A6F0";

const Rond = ({ className = "", ...p }) => (
  <button type="button" {...p}
    className={`h-10 min-w-10 rounded-full bg-white/[0.14] text-white flex items-center justify-center text-[13px] font-semibold active:scale-95 transition-transform ${className}`} />
);

const Icone = ({ d, plein }) => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden fill={plein ? "currentColor" : "none"}
    stroke={plein ? "none" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const CROIX = "M6 6l12 12M18 6L6 18";
const PAUSE = "M7 5h3v14H7zM14 5h3v14h-3z";
const LECTURE = "M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5z";
const ANGLE = "M12 4a8 8 0 1 1-7.4 5M4 4v5h5";
const CENTRE = "M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z";

export default function LecteurMouvement({ nom, animation, onClose }) {
  const boite = useRef(null);
  const scene = useRef(null);
  const [phase, setPhase] = useState("");
  const [pause, setPause] = useState(false);
  const [lent, setLent] = useState(false);
  const [manip, setManip] = useState(false);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let fini = false, minuteur;
    import("../mannequin.js").then(({ creerScene }) => {
      if (fini || !boite.current) return;
      scene.current = creerScene(boite.current, animation, {
        surPhase: setPhase,
        // Les consignes s'effacent pendant la manipulation, puis reviennent
        surManip: () => { setManip(true); clearTimeout(minuteur); minuteur = setTimeout(() => setManip(false), 1200); },
      });
    }).catch(() => setErreur(true));
    return () => { fini = true; clearTimeout(minuteur); scene.current?.detruire(); scene.current = null; };
  }, [animation]);

  // Échap ferme le lecteur (sans ouvrir le menu de la séance dessous)
  useEffect(() => {
    const touche = (ev) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopImmediatePropagation(); onClose(); }
      if (ev.key === " ") { ev.preventDefault(); ev.stopImmediatePropagation(); setPause(scene.current?.pause() ?? false); }
    };
    window.addEventListener("keydown", touche, true);
    return () => window.removeEventListener("keydown", touche, true);
  }, [onClose]);

  const ralentir = () => { const v = !lent; setLent(v); scene.current?.vitesse(v ? 0.5 : 1); };

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-[#0d0d0f] text-white font-sans antialiased select-none"
      role="dialog" aria-modal="true" aria-label={`Mouvement : ${nom}`}>
      <div ref={boite} className="absolute inset-0 cursor-grab active:cursor-grabbing" style={{ touchAction: "none" }} />

      <div className="absolute inset-x-0 top-0 px-4 pointer-events-none"
        style={{ paddingTop: "calc(max(12px, env(safe-area-inset-top)) + var(--marge-flou))" }}>
        <div className="max-w-[560px] mx-auto flex items-center gap-2.5">
          <Rond className="pointer-events-auto" onClick={onClose} aria-label="Fermer"><Icone d={CROIX} /></Rond>
          <h2 className="flex-1 min-w-0 text-center text-[16px] font-semibold truncate">{nom}</h2>
          <Rond className="pointer-events-auto" onClick={() => scene.current?.recentrer()} aria-label="Recentrer la vue"><Icone d={CENTRE} /></Rond>
        </div>
        <p className="mt-3 text-center text-[14px] font-medium min-h-5" style={{ color: ROSE }} aria-live="polite">{erreur ? "Impossible d'afficher le mouvement" : phase}</p>
      </div>

      <div className="absolute inset-x-0 bottom-0 px-4" style={{ paddingBottom: "max(18px, env(safe-area-inset-bottom))" }}>
        <div className="max-w-[560px] mx-auto">
          {animation.consignes?.length > 0 && (
            <ul className="rounded-[14px] bg-black/55 px-3 py-2.5 text-[14px] leading-[1.55] text-white/85 transition-opacity duration-300 pointer-events-none"
              style={{ opacity: manip ? 0.15 : 1 }}>
              {animation.consignes.map((c, i) => <li key={i}>• {c}</li>)}
            </ul>
          )}
          <div className="flex justify-center gap-3.5 mt-3">
            <Rond onClick={() => setPause(scene.current?.pause() ?? false)} aria-label={pause ? "Reprendre" : "Pause"}>
              <Icone d={pause ? LECTURE : PAUSE} plein />
            </Rond>
            <Rond onClick={ralentir} aria-pressed={lent} aria-label="Ralenti" className="px-3.5"
              style={lent ? { background: "rgba(175,82,222,.35)", color: ROSE } : undefined}>0,5×</Rond>
            <Rond onClick={() => scene.current?.angleSuivant()} aria-label="Changer d'angle"><Icone d={ANGLE} /></Rond>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
