import { useState } from "react";
import Feuille from "./Feuille";
import { GLOSSAIRE } from "../glossaire";

// Corps d'une fiche du glossaire
export function FicheAide({ sujet }) {
  const g = GLOSSAIRE[sujet];
  if (!g) return null;
  const blocs = [["Ce que c'est", g.quoi], ["Comment c'est calculé", g.calcul], ["Comment le lire", g.lire]];
  return (
    <div className="space-y-3">
      {blocs.filter(([, t]) => t).map(([titre, texte]) => (
        <div key={titre} className="card p-4">
          <p className="text-[13px] font-semibold text-label-2 mb-1">{titre}</p>
          <p className="text-[15px] leading-[21px]">{texte}</p>
        </div>
      ))}
    </div>
  );
}

// Bouton « i » : ouvre l'explication d'un indicateur (feuille en bas sur téléphone, fenêtre sur ordinateur)
export default function Aide({ sujet, className = "" }) {
  const [ouvert, setOuvert] = useState(false);
  const g = GLOSSAIRE[sujet];
  if (!g) return null;
  return (
    <>
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOuvert(true); }}
        aria-label={`Comprendre : ${g.titre}`}
        className={`inline-flex items-center justify-center w-[22px] h-[22px] -my-1 rounded-full text-label-3 hover:text-brand active:opacity-60 transition shrink-0 align-middle ${className}`}>
        <svg viewBox="0 0 24 24" className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
        </svg>
      </button>
      {ouvert && (
        <Feuille titre={g.titre} onClose={() => setOuvert(false)}>
          <FicheAide sujet={sujet} />
        </Feuille>
      )}
    </>
  );
}
