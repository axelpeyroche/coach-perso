import { useEffect } from "react";

// Onglets de la barre mobile, et pages « poussées » depuis un onglet
// (comme dans une app iOS : l'onglet parent reste sélectionné et un bouton
// retour apparaît en haut à gauche).
export const ONGLETS = ["/", "/plan", "/carnet", "/stats", "/profil"];
export const PARENTS = { "/objectifs": "/", "/analyses": "/stats", "/sources": "/profil" };

// Onglet auquel appartient une route
export function ongletDe(pathname) {
  if (pathname === "/") return "/";
  if (PARENTS[pathname]) return PARENTS[pathname];
  return ONGLETS.find((o) => o !== "/" && pathname.startsWith(o)) ?? null;
}

export const estPoussee = (pathname) => pathname in PARENTS;

// Verrouille le défilement de la page tant qu'une feuille ou une alerte est
// ouverte (compteur partagé : plusieurs calques peuvent s'empiler).
let verrous = 0;
export function useVerrouDefilement(actif = true) {
  useEffect(() => {
    if (!actif) return;
    verrous += 1;
    document.documentElement.classList.add("verrou");
    return () => {
      verrous -= 1;
      if (verrous === 0) document.documentElement.classList.remove("verrou");
    };
  }, [actif]);
}
