import clsx from "clsx";
import { Link } from "react-router-dom";
import { Miniature } from "./graphiques";

// Couleur du libellé (façon tuiles de l'app Santé)
const COULEURS = {
  green: "text-ios-green",
  blue: "text-ios-blue",
  orange: "text-ios-orange",
  red: "text-ios-red",
  purple: "text-ios-purple",
  indigo: "text-ios-indigo",
  pink: "text-ios-pink",
  teal: "text-ios-teal",
  gray: "text-label-2",
};

// `serie` : valeurs récentes, dessinées en courbe miniature sous le chiffre
// `lien` : le titre mène à l'analyse détaillée
export default function StatTile({ label, value, sub, color = "blue", serie, lien, children }) {
  return (
    <div className="card p-4 flex flex-col gap-1 min-w-0">
      {lien ? (
        <Link to={lien} className={clsx("text-[13px] font-semibold truncate self-start max-w-full transition-opacity hover:opacity-80 active:opacity-60", COULEURS[color])}>
          {label}<span aria-hidden className="ml-1">›</span>
        </Link>
      ) : <p className={clsx("text-[13px] font-semibold truncate", COULEURS[color])}>{label}</p>}
      {children ?? (
        <>
          <p className="font-rounded text-[22px] md:text-[26px] leading-8 font-bold tracking-[-0.02em] chiffres truncate">{value}</p>
          {sub && <p className="text-[12px] text-label-2 truncate">{sub}</p>}
          {serie && <span className={clsx("block mt-1", COULEURS[color])}><Miniature valeurs={serie} /></span>}
        </>
      )}
    </div>
  );
}
