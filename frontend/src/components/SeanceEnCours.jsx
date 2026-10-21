import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { modifierPrevue } from "../api";
import { useVerrouDefilement } from "../navigation";
import { construireSeance, prescription, fmtChrono, DIFFICULTES } from "../seanceGuidee";
import { debloquerSon, bipCourt, bipLong } from "../son";

// Séance de muscu guidée, en plein écran (toujours sombre, comme l'app Forme) :
// une étape à la fois, un seul gros bouton en bas. Les minuteurs reposent sur
// des horodatages : la séance reprend juste après une coupure (état gardé
// dans le navigateur jusqu'à l'enregistrement).

const VIOLET = "#BF5AF2";
const VERT = "#30D158";
const ORANGE = "#FF9F0A";

const cle = (id) => `seance-guidee-${id}`;

export function seanceSauvegardee(id) {
  try { return !!localStorage.getItem(cle(id)); } catch { return false; }
}

function lire(id, n) {
  try {
    const s = JSON.parse(localStorage.getItem(cle(id)));
    return s && s.v === 1 && s.n === n ? s : null;
  } catch { return null; }
}

function ecrire(id, etat) {
  try { localStorage.setItem(cle(id), JSON.stringify(etat)); } catch { /* stockage indisponible */ }
}

function effacer(id) {
  try { localStorage.removeItem(cle(id)); } catch { /* idem */ }
}

// Barre d'état noire pendant la séance : iOS teinte le haut de l'écran avec la
// couleur du thème (gris clair en mode clair), ce qui posait un voile blanc
// flouté sur l'écran noir de la séance.
function useBarreEtatNoire() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const avant = meta?.getAttribute("content");
    meta?.setAttribute("content", "#000000");
    document.documentElement.classList.add("barre-noire");
    return () => {
      document.documentElement.classList.remove("barre-noire");
      if (avant) meta?.setAttribute("content", avant);
    };
  }, []);
}

// Écran allumé pendant la séance (redemandé au retour sur la page)
function useEcranAllume() {
  useEffect(() => {
    let verrou = null;
    let actif = true;
    const demander = async () => {
      try {
        if (actif && document.visibilityState === "visible" && navigator.wakeLock) {
          verrou = await navigator.wakeLock.request("screen");
        }
      } catch { /* refusé : tant pis */ }
    };
    demander();
    document.addEventListener("visibilitychange", demander);
    return () => {
      actif = false;
      document.removeEventListener("visibilitychange", demander);
      verrou?.release?.().catch(() => {});
    };
  }, []);
}

// ── Petits éléments ─────────────────────────────────────────────────────────
function Anneau({ part, couleur, children, className = "w-[220px] lg:w-[300px]" }) {
  const c = 2 * Math.PI * 45;
  return (
    <div className={clsx("relative mx-auto aspect-square max-w-full", className)}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r="45" fill="none" stroke="#2c2c2e" strokeWidth="7" />
        <circle cx="50" cy="50" r="45" fill="none" stroke={couleur} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, part)))}
          style={{ transition: "stroke-dashoffset 0.25s linear" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

function Surtitre({ couleur = VIOLET, children }) {
  return <p className="text-[13px] lg:text-[15px] font-semibold uppercase tracking-[0.06em]" style={{ color: couleur }}>{children}</p>;
}

function Nom({ children }) {
  return <h2 className="mt-1.5 text-[28px] lg:text-[40px] font-bold leading-[1.1] tracking-[-0.02em] text-balance">{children}</h2>;
}

function Puce({ children }) {
  return <span className="rounded-[10px] bg-[#1c1c1e] px-2.5 py-1.5 text-[13px] lg:text-[15px] text-white/60 [&_b]:font-semibold [&_b]:text-white">{children}</span>;
}

function Bouton({ couleur = VIOLET, sombre = false, className, children, ...p }) {
  return (
    <button type="button" {...p}
      className={clsx("h-14 w-full rounded-[16px] text-[17px] font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#0A84FF]", className)}
      style={sombre ? { background: "#2c2c2e", color: "#fff" } : { background: couleur, color: couleur === VIOLET ? "#fff" : "#000" }}>
      {children}
    </button>
  );
}

function Ensuite({ titre, detail }) {
  if (!titre) return null;
  return (
    <div className="rounded-[14px] bg-[#1c1c1e] px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-white/30">Ensuite</p>
        <p className="text-[15px] font-semibold truncate">{titre}</p>
      </div>
      {detail && <span className="font-rounded text-[15px] font-semibold text-white/60 shrink-0">{detail}</span>}
    </div>
  );
}

// « 12 » → 12 reps ; « 45 s » → 45 s ; « max » → texte
function GrandNombre({ e }) {
  const m = /^(\d+(?:[,.]\d+)?)\s*(.*)$/.exec(e.reps ?? "");
  return (
    <div className="text-center">
      {m ? (
        <p className="font-rounded font-bold leading-none tracking-[-0.04em] chiffres">
          <span className="text-[96px] lg:text-[136px]">{m[1]}</span>
          <span className="ml-1 text-[22px] lg:text-[28px] font-semibold text-white/60">{e.duree ? "s" : m[2] || "reps"}</span>
        </p>
      ) : (
        <p className="font-rounded text-[44px] font-bold">{e.reps}</p>
      )}
      {e.unite && <p className="mt-1 text-[15px] text-white/60">{e.unite}</p>}
    </div>
  );
}

function Points({ total, faites }) {
  if (total < 2) return null;
  return (
    <div className="flex justify-center gap-2" aria-label={`${faites} séries sur ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className="w-[9px] h-[9px] rounded-full"
          style={{ background: i < faites ? VIOLET : i === faites ? "#fff" : "#2c2c2e" }} />
      ))}
    </div>
  );
}

const Croix = () => (
  <svg viewBox="0 0 12 12" className="w-3 h-3" aria-hidden><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const Lecture = ({ className = "w-3.5 h-3.5" }) => (
  <svg viewBox="0 0 12 14" className={className} aria-hidden><path d="M1 1.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 1 1.5z" fill="currentColor" /></svg>
);
const Coche = ({ className = "w-[18px] h-[18px]" }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden><path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

// ── Séance ───────────────────────────────────────────────────────────────────
export default function SeanceEnCours({ s, contenu, onClose, onEnregistree }) {
  useVerrouDefilement(true);
  useEcranAllume();
  useBarreEtatNoire();
  const { exercices, etapes } = useMemo(() => construireSeance(contenu), [contenu]);

  const [etat, setEtat] = useState(() => lire(s.id, etapes.length) ?? {
    v: 1, n: etapes.length, idx: 0, debut: Date.now(),
    minuteurFin: null, minuteurTotal: null, decompteFin: null, emomDebut: null, ex: {},
  });
  const [now, setNow] = useState(Date.now());
  const [menu, setMenu] = useState(false);
  const [goJusqua, setGoJusqua] = useState(0);
  const dernierBip = useRef(null);

  useEffect(() => { ecrire(s.id, etat); }, [s.id, etat]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  const etape = etapes[etat.idx] ?? etapes[etapes.length - 1];
  const k = etape.k;
  const ex = k != null ? exercices[k] : null;
  const suivi = (k != null && etat.ex[k]) || {};

  // Passage à l'étape `idx` (le repos démarre tout seul)
  function aller(st, idx, exMaj = st.ex) {
    const et = etapes[Math.min(idx, etapes.length - 1)];
    const t = Date.now();
    const exS = { ...exMaj };
    if (et.k != null && !exS[et.k]?.debut) exS[et.k] = { ...exS[et.k], debut: t };
    return {
      ...st, idx: Math.min(idx, etapes.length - 1), ex: exS,
      minuteurFin: et.type === "repos" ? t + et.duree * 1000 : null,
      minuteurTotal: et.type === "repos" ? et.duree : null,
      decompteFin: null, emomDebut: null,
    };
  }
  const suivant = () => setEtat((st) => aller(st, st.idx + 1));
  const majEx = (kk, champs) => setEtat((st) => ({ ...st, ex: { ...st.ex, [kk]: { ...st.ex[kk], ...champs } } }));

  function validerSerie(i) {
    setEtat((st) => aller(st, st.idx + 1, { ...st.ex, [k]: { ...st.ex[k], series_faites: i } }));
  }
  function finEmom(faites) {
    setEtat((st) => aller(st, st.idx + 1, { ...st.ex, [k]: { ...st.ex[k], series_faites: faites } }));
  }
  function finExercice() {
    setEtat((st) => aller(st, st.idx + 1, { ...st.ex, [k]: { ...st.ex[k], fin: Date.now() } }));
  }
  function passerExercice() {
    setMenu(false);
    setEtat((st) => {
      const prochaine = etapes.findIndex((et, i) => i > st.idx && (et.k == null || et.k > k));
      return aller(st, prochaine < 0 ? etapes.length - 1 : prochaine,
        { ...st.ex, [k]: { ...st.ex[k], passe: true, fin: Date.now() } });
    });
  }
  const lancerDecompte = () => { debloquerSon(); setEtat((st) => ({ ...st, decompteFin: Date.now() + 3000 })); };
  const ajouter15 = () => setEtat((st) => ({ ...st, minuteurFin: st.minuteurFin + 15000, minuteurTotal: st.minuteurTotal + 15 }));

  // Bips et fins de minuteur
  const bipUneFois = (c) => { if (dernierBip.current !== c) { dernierBip.current = c; return true; } return false; };
  useEffect(() => {
    if (etat.decompteFin) {
      const r = Math.ceil((etat.decompteFin - now) / 1000);
      if (r <= 0) {
        bipLong("go");
        setGoJusqua(Date.now() + 700);
        setEtat((st) => (etape.type === "emom"
          ? { ...st, decompteFin: null, emomDebut: st.decompteFin }
          : { ...st, decompteFin: null, minuteurFin: st.decompteFin + ex.duree * 1000, minuteurTotal: ex.duree }));
      } else if (r <= 3 && bipUneFois(`d${etat.decompteFin}-${r}`)) bipCourt(r);
    } else if (etat.minuteurFin) {
      const r = Math.ceil((etat.minuteurFin - now) / 1000);
      if (r <= 0) {
        if (bipUneFois(`f${etat.minuteurFin}`)) {
          // fin du repos → on repart ; fin d'un exercice chronométré → repos ;
          // fin de la pause avant un EMOM : simple bip (l'EMOM a son propre décompte avec « go »)
          bipLong(etape.type !== "repos" ? "repos" : etape.avantEmom ? "bip" : "go");
          if (etape.type === "repos") suivant();
          else if (etape.type === "serie") validerSerie(etape.i);
        }
      } else if (r <= 3 && bipUneFois(`m${etat.minuteurFin}-${r}`)) bipCourt(r);
    } else if (etape.type === "emom" && etat.emomDebut) {
      const ecoule = now - etat.emomDebut;
      if (ecoule >= ex.series * 60000) {
        if (bipUneFois(`e-fin${etat.emomDebut}`)) { bipLong("repos"); finEmom(ex.series); }
      } else {
        const m = Math.floor(ecoule / 60000);
        const r = Math.ceil((60000 - (ecoule % 60000)) / 1000);
        if (m > 0 && bipUneFois(`g${etat.emomDebut}-${m}`)) bipLong("go");
        else if (r <= 3 && bipUneFois(`e${etat.emomDebut}-${m}-${r}`)) bipCourt(r);
      }
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  const enregistrer = useMutation({
    mutationFn: () => {
      const fin = Date.now();
      const deroule = {
        debut: new Date(etat.debut).toISOString(),
        fin: new Date(fin).toISOString(),
        duree_s: Math.round((fin - etat.debut) / 1000),
        exercices: exercices.map((e, i) => {
          const x = etat.ex[i] || {};
          return {
            numero: e.numero, nom: e.nom, emom: e.emom, prescription: prescription(e), charge: e.charge,
            series_prevues: e.series, series_faites: x.series_faites ?? 0, passe: !!x.passe,
            difficulte: x.difficulte ?? null, ressenti: (x.ressenti || "").trim() || null,
            duree_s: x.debut && x.fin ? Math.round((x.fin - x.debut) / 1000) : null,
          };
        }),
      };
      return modifierPrevue(s.id, { deroule });
    },
    onSuccess: () => { effacer(s.id); onEnregistree(); },
  });

  // Action principale (Espace / Entrée au clavier)
  let principale = null;
  if (etape.type === "echauffement") principale = suivant;
  else if (etape.type === "serie") principale = ex.duree && !etat.minuteurFin ? (etat.decompteFin ? null : lancerDecompte) : () => validerSerie(etape.i);
  else if (etape.type === "emom") principale = etat.emomDebut || etat.decompteFin ? null : lancerDecompte;
  else if (etape.type === "repos") principale = suivant;
  else if (etape.type === "ressenti") principale = finExercice;
  else if (etape.type === "fin") principale = enregistrer.isPending ? null : () => enregistrer.mutate();
  const principaleRef = useRef(principale);
  principaleRef.current = principale;
  useEffect(() => {
    const touche = (ev) => {
      if (ev.target.closest?.("textarea, input")) return;
      if (ev.key === " " || ev.key === "Enter") { ev.preventDefault(); debloquerSon(); principaleRef.current?.(); }
      if (ev.key === "ArrowRight" && etapes[etat.idx]?.type === "repos") { ev.preventDefault(); suivant(); }
      if (ev.key === "Escape") setMenu((m) => !m);
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [etat.idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avancement : un segment par exercice
  const avancement = exercices.map((_, i) => {
    if (etape.type === "fin") return 1;
    if (k == null) return 0;
    if (i < k) return 1;
    if (i > k) return 0;
    // Seules les étapes d'effort comptent (séries, EMOM) : pas les repos ni le ressenti
    const siennes = etapes.map((et, j) => [et, j]).filter(([et]) => et.k === i && (et.type === "serie" || et.type === "emom"));
    if (!siennes.length) return etat.idx > etapes.findIndex((et) => et.k === i) ? 1 : 0;
    // Étape en cours remplie en temps réel : minutes écoulées de l'EMOM, chrono d'un exercice en durée
    let enCours = 0;
    if (etape.type === "emom" && etat.emomDebut) {
      enCours = Math.min(1, (now - etat.emomDebut) / (ex.series * 60000));
    } else if (etape.type === "serie" && etat.minuteurFin && etat.minuteurTotal) {
      enCours = Math.min(1, Math.max(0, 1 - (etat.minuteurFin - now) / (etat.minuteurTotal * 1000)));
    }
    return (siennes.filter(([, j]) => j < etat.idx).length + enCours) / siennes.length;
  });

  const decompte = etat.decompteFin ? Math.max(1, Math.ceil((etat.decompteFin - now) / 1000)) : null;
  const reste = etat.minuteurFin ? Math.max(0, (etat.minuteurFin - now) / 1000) : null;

  // Description courte de l'étape suivante
  function ensuite() {
    const et = etapes[etat.idx + 1];
    if (!et || et.type === "fin") return [null];
    const e = exercices[et.k];
    if (et.type === "serie") {
      const titre = et.k === k && e.series > 1 ? `Série ${et.i} · ${e.reps}` : `${e.nom} · ${prescription(e)}`;
      return [titre, e.charge];
    }
    if (et.type === "emom") return [`${e.nom} · EMOM ${e.series} min`, e.reps ? `${e.reps} reps` : null];
    if (et.type === "repos") return ["Repos", fmtChrono(et.duree)];
    return [null];
  }
  const [ensTitre, ensDetail] = ensuite();
  const premier = exercices[0];

  let corps;
  if (etape.type === "echauffement") {
    corps = (
      <>
        <Surtitre>Échauffement</Surtitre>
        <Nom>{etape.texte}</Nom>
        <div className="flex-1" />
        {premier && <Ensuite titre={`${premier.nom} · ${prescription(premier)}`} detail={premier.emom ? `${premier.reps} reps` : premier.charge} />}
        <div className="h-3" />
        <Bouton onClick={suivant}>Échauffement terminé</Bouton>
      </>
    );
  } else if (etape.type === "repos") {
    corps = (
      <>
        <Surtitre couleur={VERT}>{etape.avantEmom ? "Pause avant l'EMOM" : "Repos"}</Surtitre>
        <div className="flex-1" />
        <Anneau part={reste / etat.minuteurTotal} couleur={VERT}>
          <span className="font-rounded text-[56px] lg:text-[76px] font-bold leading-none tracking-[-0.03em] chiffres">{fmtChrono(Math.ceil(reste))}</span>
          <span className="mt-1.5 text-[13px] lg:text-[15px] text-white/60">sur {fmtChrono(etat.minuteurTotal)}</span>
        </Anneau>
        <div className="flex-1" />
        <Ensuite titre={ensTitre} detail={ensDetail} />
        <div className="h-3" />
        <div className="flex gap-2.5">
          <Bouton sombre className="!h-12 !text-[15px]" onClick={ajouter15}>+15 s</Bouton>
          <Bouton sombre className="!h-12 !text-[15px]" onClick={suivant}>Passer</Bouton>
        </div>
      </>
    );
  } else if (etape.type === "emom") {
    const enCours = !!etat.emomDebut;
    const ecoule = enCours ? now - etat.emomDebut : 0;
    const minute = Math.min(ex.series, Math.floor(ecoule / 60000) + 1);
    const resteMinute = 60 - (ecoule % 60000) / 1000;
    corps = enCours ? (
      <>
        <Surtitre couleur={ORANGE}>Minute {minute} / {ex.series}</Surtitre>
        <Nom>{ex.nom}{ex.reps ? ` · ${ex.reps} reps` : ""}</Nom>
        <div className="flex-1" />
        <Anneau part={resteMinute / 60} couleur={ORANGE}>
          <span className="font-rounded text-[56px] lg:text-[76px] font-bold leading-none tracking-[-0.03em] chiffres">{fmtChrono(Math.ceil(resteMinute))}</span>
          <span className="mt-1.5 text-[13px] lg:text-[15px] text-white/60">{minute < ex.series ? `avant la minute ${minute + 1}` : "dernière minute"}</span>
        </Anneau>
        <div className="flex-1" />
        <p className="text-center text-[13px] text-white/60 mb-3">Bips automatiques à 3, 2, 1, GO</p>
        <Bouton sombre onClick={() => finEmom(minute)}>Arrêter l'EMOM</Bouton>
      </>
    ) : (
      <>
        <Surtitre couleur={ORANGE}>EMOM · {ex.series} min</Surtitre>
        <Nom>{ex.nom}</Nom>
        {ex.consigne && <p className="mt-2 text-[14px] leading-5 text-white/60 line-clamp-3">{ex.consigne}</p>}
        <div className="flex-1" />
        <GrandNombre e={ex} />
        <p className="text-center text-[14px] text-white/60 mt-1">au début de chaque minute</p>
        <div className="flex-1" />
        {(ex.charge || ex.historique) && (
          <div className="flex flex-wrap justify-center gap-1.5 mb-3.5">
            {ex.charge && <Puce><b>{ex.charge}</b></Puce>}
            {ex.historique && <Puce>Dernière fois <b>{ex.historique}</b></Puce>}
          </div>
        )}
        <Bouton couleur={ORANGE} onClick={lancerDecompte}><Lecture />Lancer l'EMOM</Bouton>
      </>
    );
  } else if (etape.type === "serie") {
    const chrono = ex.duree && etat.minuteurFin;
    corps = (
      <>
        <Surtitre>{ex.series > 1 ? `Série ${etape.i} sur ${ex.series}` : ex.section ?? "Exercice"}</Surtitre>
        <Nom>{ex.nom}</Nom>
        {ex.consigne && <p className="mt-2 text-[14px] leading-5 text-white/60 line-clamp-3">{ex.consigne}</p>}
        <div className="flex-1" />
        {chrono ? (
          <Anneau part={reste / etat.minuteurTotal} couleur={VIOLET}>
            <span className="font-rounded text-[56px] lg:text-[76px] font-bold leading-none tracking-[-0.03em] chiffres">{fmtChrono(Math.ceil(reste))}</span>
            {ex.unite && <span className="mt-1.5 text-[13px] text-white/60">{ex.unite}</span>}
          </Anneau>
        ) : <GrandNombre e={ex} />}
        <div className="h-4" />
        <Points total={ex.series} faites={etape.i - 1} />
        <div className="flex-1" />
        {(ex.charge || ex.historique) && (
          <div className="flex flex-wrap justify-center gap-1.5 mb-3.5">
            {ex.charge && <Puce><b>{ex.charge}</b></Puce>}
            {ex.historique && <Puce>Dernière fois <b>{ex.historique}</b></Puce>}
          </div>
        )}
        {ex.duree && !chrono ? (
          <Bouton onClick={lancerDecompte}><Lecture />Lancer {ex.reps}</Bouton>
        ) : (
          <Bouton onClick={() => validerSerie(etape.i)}><Coche />{chrono ? "Terminer la série" : "Série terminée"}</Bouton>
        )}
      </>
    );
  } else if (etape.type === "ressenti") {
    const dernier = exercices.length - 1 === k;
    corps = (
      <>
        <Surtitre couleur={VERT}>Exercice terminé</Surtitre>
        <Nom>{ex.nom}</Nom>
        <p className="mt-6 mb-2 ml-0.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-white/30">Difficulté</p>
        <div className="grid grid-cols-4 gap-1.5">
          {DIFFICULTES.map(([v, l]) => (
            <button key={v} type="button" onClick={() => majEx(k, { difficulte: suivi.difficulte === v ? null : v })}
              aria-pressed={suivi.difficulte === v}
              className="rounded-[12px] py-2.5 text-[14px] font-semibold border-[1.5px] transition-colors"
              style={suivi.difficulte === v
                ? { borderColor: VIOLET, background: "rgba(191,90,242,0.18)", color: "#fff" }
                : { borderColor: "transparent", background: "#1c1c1e", color: "rgba(235,235,245,0.6)" }}>
              {l}
            </button>
          ))}
        </div>
        <label htmlFor="ressenti-exercice" className="block mt-5 mb-2 ml-0.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-white/30">Ressenti</label>
        <textarea id="ressenti-exercice" rows={4} value={suivi.ressenti ?? ""}
          onChange={(ev) => majEx(k, { ressenti: ev.target.value })}
          placeholder="Dernière série à la limite, douleur, charge trop légère…"
          className="w-full resize-none rounded-[14px] bg-[#1c1c1e] px-3.5 py-3 text-[16px] leading-[22px] text-white placeholder:text-white/30 outline-none focus:ring-2 focus:ring-[#BF5AF2]" />
        <div className="flex-1 min-h-4" />
        <Bouton onClick={finExercice}>{dernier ? "Terminer la séance" : "Exercice suivant"}</Bouton>
      </>
    );
  } else {
    const faits = exercices.filter((_, i) => !etat.ex[i]?.passe && (etat.ex[i]?.series_faites ?? 0) > 0).length;
    const series = exercices.reduce((n, e, i) => n + (e.emom ? 0 : etat.ex[i]?.series_faites ?? 0), 0);
    const notes = exercices.filter((_, i) => (etat.ex[i]?.ressenti || "").trim() || etat.ex[i]?.difficulte).length;
    const stats = [["Durée", fmtChrono((now - etat.debut) / 1000)], ["Exercices", `${faits}/${exercices.length}`], ["Séries", series], ["Ressentis", notes]];
    corps = (
      <>
        <div className="flex-1" />
        <span className="mx-auto w-16 h-16 rounded-full flex items-center justify-center text-white" style={{ background: VIOLET }}><Coche className="w-8 h-8" /></span>
        <h2 className="mt-4 text-center text-[28px] lg:text-[36px] font-bold tracking-[-0.02em]">Séance terminée</h2>
        <p className="mt-1 text-center text-[14px] text-white/60">{s.titre}</p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          {stats.map(([l, v]) => (
            <div key={l} className="rounded-[14px] bg-[#1c1c1e] px-3.5 py-3">
              <p className="text-[12px] text-white/60">{l}</p>
              <p className="font-rounded text-[26px] font-bold chiffres">{v}</p>
            </div>
          ))}
        </div>
        <div className="flex-1" />
        {enregistrer.isError && <p className="mb-3 text-center text-[14px] text-[#FF453A]">Enregistrement impossible. Vérifie la connexion puis réessaie.</p>}
        <Bouton onClick={() => enregistrer.mutate()} disabled={enregistrer.isPending}>{enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}</Bouton>
      </>
    );
  }

  const ecran = (
    <div className="fixed inset-0 z-[60] flex bg-black text-white font-sans antialiased select-none [&_textarea]:select-text"
      role="dialog" aria-modal="true" aria-label={`Séance en cours : ${s.titre}`}
      onClickCapture={debloquerSon} onTouchEndCapture={debloquerSon}>
      <div className="relative flex-1 min-w-0 flex flex-col"
        style={{ paddingTop: "calc(max(12px, env(safe-area-inset-top)) + var(--marge-flou))", paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
        {/* Barre du haut : quitter, avancement, chrono de la séance */}
        <div className="flex items-center gap-3 px-4 lg:px-10 pt-1">
          <button type="button" onClick={() => setMenu(true)} aria-label="Options de la séance"
            className="w-[30px] h-[30px] shrink-0 rounded-full bg-[#2c2c2e] text-white/60 flex items-center justify-center"><Croix /></button>
          <div className="flex-1 flex gap-[3px]">
            {avancement.map((p, i) => (
              <i key={i} className="flex-1 h-1 rounded-full bg-[#2c2c2e] overflow-hidden">
                <i className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${p * 100}%`, background: VIOLET }} />
              </i>
            ))}
          </div>
          <span className="font-rounded text-[13px] lg:text-[15px] font-semibold text-white/60 chiffres shrink-0">{fmtChrono((now - etat.debut) / 1000)}</span>
        </div>

        <main key={etat.idx} className="flex-1 min-h-0 overflow-y-auto scrollbar-hide w-full max-w-[560px] mx-auto px-5 pt-6 flex flex-col animate-[fondu_0.25s_ease-out]">
          {corps}
        </main>

        {/* 3, 2, 1… GO */}
        {(decompte || now < goJusqua) && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/75 backdrop-blur-md" aria-live="assertive">
            <span key={decompte ?? "go"} className="font-rounded font-extrabold leading-none text-[150px] lg:text-[200px] animate-[decompte_0.35s_ease-out]"
              style={{ color: decompte ? ORANGE : VERT }}>{decompte ?? "GO"}</span>
          </div>
        )}

        {/* Options : continuer, passer l'exercice, quitter */}
        {menu && (
          <div className="absolute inset-0 z-20 flex items-end lg:items-center justify-center bg-black/60 p-4" onClick={() => setMenu(false)}>
            <div className="w-full max-w-[400px] space-y-2" onClick={(ev) => ev.stopPropagation()}>
              <div className="rounded-[16px] bg-[#1c1c1e] overflow-hidden divide-y divide-white/10">
                {ex && etape.type !== "ressenti" && (
                  <button type="button" className="w-full h-14 text-[17px]" onClick={passerExercice}>Passer cet exercice</button>
                )}
                <button type="button" className="w-full h-14 text-[17px]" onClick={onClose}>Quitter et reprendre plus tard</button>
                <button type="button" className="w-full h-14 text-[17px] text-[#FF453A]" onClick={() => { effacer(s.id); onClose(); }}>Abandonner la séance</button>
              </div>
              <button type="button" className="w-full h-14 rounded-[16px] bg-[#2c2c2e] text-[17px] font-semibold" onClick={() => setMenu(false)}>Continuer</button>
            </div>
          </div>
        )}
      </div>

      {/* Ordinateur : déroulé de la séance */}
      <aside className="hidden lg:flex w-[300px] shrink-0 flex-col bg-[#1c1c1e] px-4 py-7 overflow-y-auto scrollbar-hide">
        <h3 className="mx-2 mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-white/30 truncate">{s.titre}</h3>
        {exercices.map((e, i) => {
          const x = etat.ex[i] || {};
          const fait = etape.type === "fin" || (k != null && i < k);
          const enCours = i === k && etape.type !== "fin";
          const sectionNouvelle = i > 0 && e.section !== exercices[i - 1].section && e.section;
          return (
            <div key={i}>
              {sectionNouvelle && <p className="mx-2.5 mt-3 mb-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/30">{e.section}</p>}
              <div className={clsx("flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[14px]",
                enCours ? "bg-[#2c2c2e] font-semibold text-white" : fait ? "text-white/30" : "text-white/60")}>
                <b className="w-[22px] h-[22px] shrink-0 rounded-full flex items-center justify-center text-[11px] chiffres"
                  style={enCours ? { background: "#fff", color: "#000" } : fait && !x.passe ? { background: VIOLET, color: "#fff" } : { background: "#2c2c2e" }}>
                  {e.numero}
                </b>
                <span className="flex-1 min-w-0 truncate">{e.nom}</span>
                <em className="not-italic text-[12px] text-white/30 chiffres shrink-0">
                  {x.passe ? "passé" : enCours && !e.emom ? `${x.series_faites ?? 0}/${e.series}` : e.emom ? `${e.series}′` : `${e.series} × ${e.reps}`}
                </em>
              </div>
            </div>
          );
        })}
        <p className="mt-auto pt-6 mx-2 text-[12px] leading-5 text-white/30">Espace : valider · → : passer le repos · Échap : options</p>
      </aside>
    </div>
  );
  return createPortal(ecran, document.body);
}
