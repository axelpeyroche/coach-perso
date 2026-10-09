import clsx from "clsx";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
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

// ── Sélecteur d'heure iOS : pastille grise, roue à deux colonnes dépliée sous la ligne ──
const H_ROUE = 32;          // hauteur d'une ligne de la roue
const VISIBLES = 7;         // lignes visibles (3 au-dessus, 3 en dessous)
const MARGE_ROUE = ((VISIBLES - 1) / 2) * H_ROUE;
const PAS_ROUE = 22;        // degrés entre deux lignes
const RAYON_ROUE = H_ROUE / ((PAS_ROUE * Math.PI) / 180);

function Roue({ items, index, tour, onFin, alignement }) {
  const ref = useRef(null);
  const minuterie = useRef(null);

  // Effet cylindre : chaque ligne pivote et s'estompe selon sa distance au centre
  const peindre = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const centre = el.scrollTop / H_ROUE;
    el.querySelectorAll("[data-i]").forEach((li) => {
      const d = Number(li.dataset.i) - centre;
      const angle = Math.max(-90, Math.min(90, d * PAS_ROUE));  // au-delà de 90° : face cachée du cylindre
      // Projection sur le cylindre : les lignes se resserrent en s'éloignant du centre
      const dy = RAYON_ROUE * Math.sin((angle * Math.PI) / 180) - d * H_ROUE;
      li.style.transform = `perspective(500px) translateY(${dy}px) rotateX(${-angle}deg)`;
      li.style.opacity = Math.abs(angle) >= 85 ? "0" : String(Math.cos((angle * Math.PI) / 180) ** 1.6);
    });
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    const cible = index * H_ROUE;
    if (Math.abs(el.scrollTop - cible) > 1) {
      if (el.dataset.pret) el.scrollTo({ top: cible, behavior: "smooth" });
      else el.scrollTop = cible;
    }
    el.dataset.pret = "1";
    peindre();
  }, [index, tour, peindre]);  // `tour` : recale aussi quand la valeur ne change pas (combinaison refusée)

  useEffect(() => () => clearTimeout(minuterie.current), []);

  return (
    <div ref={ref} className="relative overflow-y-scroll scrollbar-hide snap-y snap-mandatory overscroll-contain"
      style={{ height: VISIBLES * H_ROUE }}
      onScroll={() => {
        peindre();
        clearTimeout(minuterie.current);
        minuterie.current = setTimeout(() => {
          const i = Math.max(0, Math.min(items.length - 1, Math.round(ref.current.scrollTop / H_ROUE)));
          onFin(i);
        }, 130);
      }}>
      <div style={{ height: MARGE_ROUE }} />
      {items.map((it, i) => (
        <div key={it} data-i={i} className={clsx("snap-center chiffres text-[22px] leading-none flex items-center px-1 cursor-default select-none",
          alignement === "droite" ? "justify-end" : "justify-start")}
          style={{ height: H_ROUE }}
          onClick={() => ref.current.scrollTo({ top: i * H_ROUE, behavior: "smooth" })}>
          {it}
        </div>
      ))}
      <div style={{ height: MARGE_ROUE }} />
    </div>
  );
}

// `valeurs` : heures autorisées « HH:MM » ; une combinaison hors liste revient à la plus proche
export function SelecteurHeure({ libelle, valeur, valeurs, onChange }) {
  const [ouvert, setOuvert] = useState(false);
  const [courante, setCourante] = useState(valeur);
  const [tour, setTour] = useState(0);
  useEffect(() => setCourante(valeur), [valeur]);

  const heures = [...new Set(valeurs.map((v) => v.slice(0, 2)))];
  const minutes = [...new Set(valeurs.map((v) => v.slice(3)))].sort();
  const [h, m] = courante.split(":");

  const choisir = (nh, nm) => {
    const minu = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
    const voulu = `${nh}:${nm}`;
    const v = valeurs.includes(voulu) ? voulu
      : valeurs.reduce((a, b) => (Math.abs(minu(b) - minu(voulu)) < Math.abs(minu(a) - minu(voulu)) ? b : a));
    setCourante(v);
    setTour((t) => t + 1);
    if (v !== valeur) onChange(v);
  };

  return (
    <>
      <div className="ligne">
        <span className="flex-1 text-[17px]">{libelle}</span>
        <button type="button" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)}
          className={clsx("bg-remplissage rounded-[8px] px-[11px] py-[6px] text-[17px] chiffres transition-colors",
            ouvert ? "text-brand" : "text-label")}>
          {courante}
        </button>
      </div>
      {ouvert && (
        <div className="ligne justify-center !py-2">
          <div className="relative flex justify-center w-full max-w-[320px]">
            <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 rounded-[8px] bg-remplissage pointer-events-none"
              style={{ height: H_ROUE }} />
            <div className="w-[72px]"><Roue items={heures} index={Math.max(0, heures.indexOf(h))} tour={tour} alignement="droite"
              onFin={(i) => choisir(heures[i], m)} /></div>
            <div className="w-[72px] pl-3"><Roue items={minutes} index={Math.max(0, minutes.indexOf(m))} tour={tour}
              onFin={(i) => choisir(h, minutes[i])} /></div>
          </div>
        </div>
      )}
    </>
  );
}
