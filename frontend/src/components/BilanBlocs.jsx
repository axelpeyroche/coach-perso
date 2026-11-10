import { useState } from "react";
import clsx from "clsx";
import Card from "./Card";
import { Section } from "./ui";
import { fmtDate, nombre, sportInfo } from "../carnet";
import { dessinerCarte, partagerImage } from "../partageImage";

// Blocs communs aux bilans de l'année, du mois et de la semaine
export const ORANGE = "#FF9500";
export const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
export const heures = (s) => `${nombre(Math.round((s || 0) / 3600), 0)} h`;
export const hms = (s) => {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
// Durée lisible : « 5 h 06 », « 45 min »
export const duree = (s) => {
  const m = Math.round((s || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
};
export const teinte = (c) => `color-mix(in srgb, ${c} 18%, transparent)`;

export function Faits({ items }) {
  return (
    <div className="grid border-t-[0.5px] border-separateur" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(([v, l], i) => (
        <div key={l} className={clsx("px-4 py-[11px] min-w-0", i > 0 && "border-l-[0.5px] border-separateur")}>
          <b className="block text-[17px] chiffres truncate">{v}</b>
          <span className="text-[12px] text-label-2">{l}</span>
        </div>
      ))}
    </div>
  );
}

export function Ligne({ ico, fond, titre, badge, sous, valeur, detail, couleur, onClick }) {
  const Corps = onClick ? "button" : "div";
  return (
    <Corps type={onClick ? "button" : undefined} onClick={onClick}
      className={clsx("w-full flex items-center gap-3 px-4 py-[11px] min-h-[44px] text-left", onClick && "active:bg-remplissage transition")}>
      <span className="w-[30px] h-[30px] rounded-[8px] grid place-items-center text-[16px] shrink-0" style={{ background: fond }}>{ico}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[16px] truncate">
          {titre}
          {badge && <span className="ml-1.5 align-[2px] rounded-[6px] px-1.5 py-px text-[11px] font-bold text-white" style={{ background: ORANGE }}>{badge}</span>}
        </span>
        <span className="block text-[12px] text-label-2 truncate">{sous}</span>
      </span>
      <span className="text-right font-semibold chiffres shrink-0" style={{ color: couleur }}>
        {valeur}
        {detail && <small className="block font-normal text-[12px] text-label-2">{detail}</small>}
      </span>
    </Corps>
  );
}

export function Repartition({ sports, precis = false }) {
  const liste = sports.filter((s) => s.duree_sec > 0);
  if (!liste.length) return null;
  return (
    <Section titre="Répartition des heures">
      <Card>
        <div className="flex h-3 rounded-[6px] overflow-hidden gap-[2px] mt-1 mb-3" aria-hidden>
          {liste.map((s) => <i key={s.sport} style={{ flex: s.duree_sec, background: sportInfo(s.sport).couleur }} />)}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
          {liste.map((s) => (
            <span key={s.sport} className="flex items-center gap-1.5 chiffres">
              <span className="w-[9px] h-[9px] rounded-[3px]" style={{ background: sportInfo(s.sport).couleur }} />
              {s.label} · {precis ? duree(s.duree_sec) : heures(s.duree_sec)}{s.km >= 1 && sportInfo(s.sport).distance ? ` · ${nombre(s.km, 0)} km` : ""}
            </span>
          ))}
        </div>
      </Card>
    </Section>
  );
}

// Deux boutons : image à partager et export PDF (impression du navigateur, « Enregistrer au format PDF »)
export function Actions({ carte, nom, titre, libelle = "Partager mon bilan" }) {
  const [etat, setEtat] = useState(null);
  const lancer = async () => {
    setEtat("…");
    try {
      await partagerImage(await dessinerCarte(carte()), nom, titre);
      setEtat(null);
    } catch (e) {
      setEtat(e?.name === "AbortError" ? null : "Échec");
    }
  };
  return (
    <div className="no-print grid gap-2.5 sm:grid-cols-2">
      <button type="button" className="btn-primaire w-full" onClick={lancer} disabled={etat === "…"}>
        {etat === "…" ? "Préparation de l'image…" : etat === "Échec" ? "Réessayer le partage" : libelle}
      </button>
      <BoutonPDF />
    </div>
  );
}

export function BoutonPDF({ className = "btn-gris w-full" }) {
  return (
    <button type="button" className={clsx("no-print flex items-center justify-center gap-2", className)} onClick={() => window.print()}>
      <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" />
      </svg>
      Exporter en PDF
    </button>
  );
}
