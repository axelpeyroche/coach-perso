import clsx from "clsx";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
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

// ── Sélecteur d'heure iOS : pastille grise qui ouvre une bulle avec la roue à deux colonnes ──
const H_ROUE = 32;          // hauteur d'une ligne de la roue
const VISIBLES = 7;         // lignes visibles (3 au-dessus, 3 en dessous)
const MARGE_ROUE = ((VISIBLES - 1) / 2) * H_ROUE;
const PAS_ROUE = 22;        // degrés entre deux lignes
const RAYON_ROUE = H_ROUE / ((PAS_ROUE * Math.PI) / 180);

function Roue({ items, index, tour, onFin, alignement }) {
  const ref = useRef(null);
  const minuterie = useRef(null);
  const glisse = useRef(null);  // glisser à la souris (le doigt et la molette font défiler nativement)

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

  const borner = (i) => Math.max(0, Math.min(items.length - 1, i));
  // Le recalage (scroll-snap) reste coupé jusqu'à l'arrêt de la roue : au relâchement du clic,
  // Chrome recalerait sur place et annulerait le défilement animé
  const aller = (i) => {
    const el = ref.current;
    const cible = borner(i) * H_ROUE;
    if (Math.abs(el.scrollTop - cible) < 1) { el.style.scrollSnapType = ""; onFin(borner(i)); return; }
    el.style.scrollSnapType = "none";
    setTimeout(() => el.scrollTo({ top: cible, behavior: "smooth" }), 0);
  };

  // Ligne visée par un clic : on inverse la projection sur le cylindre
  const ligneSous = (clientY) => {
    const el = ref.current;
    const r = el.getBoundingClientRect();
    const v = Math.max(-RAYON_ROUE, Math.min(RAYON_ROUE, clientY - (r.top + r.height / 2)));
    return Math.round(el.scrollTop / H_ROUE + (Math.asin(v / RAYON_ROUE) * 180) / Math.PI / PAS_ROUE);
  };

  return (
    <div ref={ref} className="relative overflow-y-scroll scrollbar-hide snap-y snap-mandatory overscroll-contain select-none cursor-grab active:cursor-grabbing"
      style={{ height: VISIBLES * H_ROUE }}
      onScroll={() => {
        peindre();
        clearTimeout(minuterie.current);
        minuterie.current = setTimeout(() => {
          if (glisse.current) return;
          ref.current.style.scrollSnapType = "";
          onFin(borner(Math.round(ref.current.scrollTop / H_ROUE)));
        }, 130);
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "touch") return;  // au doigt : défilement natif avec élan
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        glisse.current = { y: e.clientY, top: ref.current.scrollTop, bouge: false, t: e.timeStamp, v: 0 };
      }}
      onPointerMove={(e) => {
        const g = glisse.current;
        if (!g) return;
        const dy = e.clientY - g.y;
        if (Math.abs(dy) > 3) g.bouge = true;
        if (!g.bouge) return;
        ref.current.style.scrollSnapType = "none";  // sinon le navigateur recale la roue à chaque pixel
        const avant = ref.current.scrollTop;
        ref.current.scrollTop = g.top - dy;
        if (e.timeStamp > g.t) g.v = (ref.current.scrollTop - avant) / (e.timeStamp - g.t);  // élan au lâcher
        g.t = e.timeStamp;
      }}
      onPointerUp={(e) => {
        const g = glisse.current;
        if (!g) return;
        glisse.current = null;
        aller(g.bouge ? Math.round((ref.current.scrollTop + g.v * 120) / H_ROUE) : ligneSous(e.clientY));
      }}
      onPointerCancel={() => {
        if (!glisse.current) return;
        glisse.current = null;
        aller(Math.round(ref.current.scrollTop / H_ROUE));
      }}>
      <div style={{ height: MARGE_ROUE }} />
      {items.map((it, i) => (
        <div key={it} data-i={i} className={clsx("snap-center chiffres text-[22px] leading-none flex items-center px-1",
          alignement === "droite" ? "justify-end" : "justify-start")}
          style={{ height: H_ROUE }}>
          {it}
        </div>
      ))}
      <div style={{ height: MARGE_ROUE }} />
    </div>
  );
}

// `valeurs` : heures autorisées « HH:MM » ; une combinaison hors liste revient à la plus proche
export function SelecteurHeure({ libelle, valeur, valeurs, onChange }) {
  const [ouvert, setOuvert] = useState(null);  // position de la bulle
  const pastille = useRef(null);
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

  // Bulle ancrée sous la pastille (au-dessus si la pastille est en bas de l'écran), comme sur iOS
  const ouvrir = () => {
    const r = pastille.current.getBoundingClientRect();
    const droite = Math.max(12, window.innerWidth - r.right);
    setOuvert(r.bottom > window.innerHeight * 0.6
      ? { bottom: window.innerHeight - r.top + 8, right: droite, origine: "bottom right" }
      : { top: r.bottom + 8, right: droite, origine: "top right" });
  };

  useEffect(() => {
    if (!ouvert) return;
    const touche = (e) => e.key === "Escape" && setOuvert(null);
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [ouvert]);

  return (
    <div className="ligne">
      <span className="flex-1 text-[17px]">{libelle}</span>
      <button ref={pastille} type="button" aria-haspopup="dialog" aria-expanded={!!ouvert} onClick={ouvrir}
        className={clsx("bg-remplissage rounded-[8px] px-[11px] py-[6px] text-[17px] chiffres transition-colors",
          ouvert ? "text-brand" : "text-label")}>
        {courante}
      </button>
      {ouvert && createPortal(
        <div className="fixed inset-0 z-[60]" onClick={() => setOuvert(null)}>
          <div role="dialog" aria-label={libelle} className="menu-verre fixed !min-w-0 !py-2 px-3"
            style={{ top: ouvert.top, bottom: ouvert.bottom, right: ouvert.right, transformOrigin: ouvert.origine }}
            onClick={(e) => e.stopPropagation()}>
            <div className="relative flex justify-center">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-[8px] bg-remplissage pointer-events-none"
                style={{ height: H_ROUE }} />
              <div className="w-[64px]"><Roue items={heures} index={Math.max(0, heures.indexOf(h))} tour={tour} alignement="droite"
                onFin={(i) => choisir(heures[i], m)} /></div>
              <div className="w-[64px] pl-3"><Roue items={minutes} index={Math.max(0, minutes.indexOf(m))} tour={tour}
                onFin={(i) => choisir(h, minutes[i])} /></div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
