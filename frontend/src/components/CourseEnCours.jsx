import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { useVerrouDefilement } from "../navigation";
import { construireCourse, dureeCourse, LIBELLES_ETAPE } from "../seanceCourse";
import { fmtChrono } from "../seanceGuidee";
import { debloquerSon, bipCourt, bipLong, couperSon, lancerDecompteSon, prechargerSon } from "../son";
import BandeauSpotify, { useSpotify } from "./BandeauSpotify";
import {
  Anneau, Surtitre, Nom, Puce, Bouton, Ensuite, Croix, Lecture, Coche, useBarreEtatNoire, useEcranAllume,
} from "./SeanceEnCours";

// Séance de course guidée (fractionné, seuil, côtes…) : même plein écran sombre que la
// muscu, mais ici tout s'enchaîne seul — un minuteur par étape, « trois, deux, un »
// avant chaque changement, « go » au départ d'un effort et « repos » à la fin.
// Rien n'est enregistré : la séance réalisée arrive par la montre.

const COULEURS = { echauffement: "#0A84FF", effort: "#FF9F0A", recup: "#30D158", retour: "#0A84FF" };
const VERT = "#30D158";
const ORANGE = "#FF9F0A";

const cle = (id) => `seance-guidee-${id}`;
function lire(id, n) {
  try {
    const s = JSON.parse(localStorage.getItem(cle(id)));
    return s && s.v === "c1" && s.n === n ? s : null;
  } catch { return null; }
}
function ecrire(id, etat) {
  try { localStorage.setItem(cle(id), JSON.stringify(etat)); } catch { /* stockage indisponible */ }
}
function effacer(id) {
  try { localStorage.removeItem(cle(id)); } catch { /* idem */ }
}

const titreEtape = (e) => (e.reps ? `${e.type === "recup" ? "Récupération" : e.nom} ${e.rep}/${e.reps}` : e.nom);
const surtitreEtape = (e) => (e.reps && e.type === "effort" ? `${e.label} · ${e.rep}/${e.reps}` : e.type === "recup" ? "Récupération" : e.label);

export default function CourseEnCours({ s, contenu, onClose }) {
  useVerrouDefilement(true);
  useEcranAllume();
  useBarreEtatNoire();
  const etapes = useMemo(() => construireCourse(contenu), [contenu]);
  const n = etapes.length;
  const total = useMemo(() => dureeCourse(etapes), [etapes]);

  const [etat, setEtat] = useState(() => lire(s.id, n) ?? {
    v: "c1", n, idx: 0, debut: null, fin: null, pauseReste: null, decompteFin: null, termine: null,
  });
  const [now, setNow] = useState(Date.now());
  const [menu, setMenu] = useState(false);
  const [goJusqua, setGoJusqua] = useState(0);
  const dernierBip = useRef(null);
  const sp = useSpotify();

  useEffect(() => { if (etat.debut) ecrire(s.id, etat); }, [s.id, etat]);
  useEffect(() => {
    prechargerSon();
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => { clearInterval(t); couperSon(); };
  }, []);

  const fini = etat.idx >= n;
  const etape = etapes[Math.min(etat.idx, n - 1)];
  const suivante = etapes[etat.idx + 1];
  const enPause = etat.pauseReste != null;

  // Étape `idx` lancée à l'instant `base` (la fin de la précédente : aucun retard ne s'accumule)
  function placer(st, idx, base) {
    if (idx >= n) return { ...st, idx: n, fin: null, pauseReste: null, termine: base };
    const e = etapes[Math.max(0, idx)];
    return { ...st, idx: Math.max(0, idx), fin: e.duree_s ? base + e.duree_s * 1000 : null, pauseReste: null };
  }
  const demarrer = () => { lancerDecompteSon("go"); setEtat((st) => ({ ...st, decompteFin: Date.now() + 3000 })); };
  const passer = () => { couperSon(); setEtat((st) => placer(st, st.idx + 1, Date.now())); };
  const precedent = () => { couperSon(); setEtat((st) => placer(st, st.idx - 1, Date.now())); };
  const pause = () => { couperSon(); setEtat((st) => (st.fin ? { ...st, pauseReste: Math.max(0, st.fin - Date.now()), fin: null } : st)); };
  const reprendre = () => setEtat((st) => (st.pauseReste != null ? { ...st, fin: Date.now() + st.pauseReste, pauseReste: null } : st));

  // Bips et enchaînement
  const bipUneFois = (c) => { if (dernierBip.current !== c) { dernierBip.current = c; return true; } return false; };
  useEffect(() => {
    if (etat.decompteFin) {
      const r = Math.ceil((etat.decompteFin - now) / 1000);
      if (r <= 0) {
        bipLong("go");
        setGoJusqua(Date.now() + 700);
        setEtat((st) => (st.decompteFin ? placer({ ...st, decompteFin: null, debut: st.decompteFin }, 0, st.decompteFin) : st));
      } else if (r <= 3 && bipUneFois(`d${etat.decompteFin}-${r}`)) bipCourt(r, "go", etat.decompteFin - now);
    } else if (etat.fin) {
      const r = Math.ceil((etat.fin - now) / 1000);
      const motFin = suivante?.type === "effort" ? "go" : "repos";
      if (r <= 0) {
        if (bipUneFois(`f${etat.fin}`)) {
          bipLong(motFin);
          // après une longue mise en veille, plusieurs étapes ont pu passer
          setEtat((st) => {
            let x = st;
            while (x.fin && x.fin <= Date.now() && x.idx < n) x = placer(x, x.idx + 1, x.fin);
            return x;
          });
        }
      } else if (r <= 3 && bipUneFois(`m${etat.fin}-${r}`)) bipCourt(r, motFin, etat.fin - now);
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clavier : Espace = pause / reprise, → = étape suivante, ← = précédente, Échap = options
  useEffect(() => {
    function touche(ev) {
      if (ev.key === "Escape") { setMenu((m) => !m); return; }
      if (menu || !etat.debut || fini) return;
      if (ev.key === " " || ev.key === "Enter") { ev.preventDefault(); if (enPause) reprendre(); else if (etat.fin) pause(); else passer(); }
      else if (ev.key === "ArrowRight") passer();
      else if (ev.key === "ArrowLeft") precedent();
    }
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [menu, etat.debut, etat.fin, fini, enPause]); // eslint-disable-line react-hooks/exhaustive-deps

  const reste = enPause ? etat.pauseReste / 1000 : etat.fin ? Math.max(0, (etat.fin - now) / 1000) : null;
  const decompte = etat.decompteFin ? Math.max(1, Math.ceil((etat.decompteFin - now) / 1000)) : null;
  const ecoule = etat.debut ? ((etat.termine ?? now) - etat.debut) / 1000 : 0;
  const efforts = etapes.filter((e) => e.type === "effort" && e.reps).length;

  let corps;
  if (!etat.debut) {
    corps = (
      <>
        <Surtitre couleur={ORANGE}>Séance guidée</Surtitre>
        <Nom>{s.titre}</Nom>
        <div className="mt-3 flex flex-wrap gap-2">
          <Puce><b>{n}</b> étapes</Puce>
          {total > 0 && <Puce><b>{fmtChrono(total)}</b> minutés</Puce>}
          {efforts > 0 && <Puce><b>{efforts}</b> efforts</Puce>}
        </div>
        <ol className="mt-5 space-y-1.5 lg:hidden">
          {etapes.map((e, i) => (
            <li key={i} className="flex items-center gap-3 rounded-[12px] bg-[#1c1c1e] px-3.5 py-2.5 text-[15px]">
              <i className="w-2 h-2 shrink-0 rounded-full" style={{ background: COULEURS[e.type] }} />
              <span className="flex-1 min-w-0 truncate">{titreEtape(e)}</span>
              <span className="font-rounded font-semibold text-white/60 chiffres shrink-0">{e.duree_s ? fmtChrono(e.duree_s) : "libre"}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[13px] leading-[18px] text-white/40">
          Les étapes s’enchaînent toutes seules, avec un décompte avant chaque changement. Lance aussi l’enregistrement sur ta montre :
          c’est elle qui garde la séance.
        </p>
        <div className="flex-1 min-h-4" />
        <div className="mt-4"><BandeauSpotify sp={sp} /></div>
        <Bouton couleur={ORANGE} className="mt-3" onClick={demarrer}><Lecture /> Démarrer</Bouton>
      </>
    );
  } else if (fini) {
    corps = (
      <>
        <div className="flex-1" />
        <span className="mx-auto w-16 h-16 rounded-full flex items-center justify-center text-black" style={{ background: VERT }}><Coche className="w-8 h-8" /></span>
        <h2 className="mt-4 text-center text-[28px] lg:text-[36px] font-bold tracking-[-0.02em]">Séance terminée</h2>
        <p className="mt-1 text-center text-[14px] text-white/60">{s.titre}</p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          {[["Durée", fmtChrono(ecoule)], [efforts ? "Efforts" : "Étapes", efforts || n]].map(([l, v]) => (
            <div key={l} className="rounded-[14px] bg-[#1c1c1e] px-3.5 py-3">
              <p className="text-[12px] text-white/60">{l}</p>
              <p className="font-rounded text-[26px] font-bold chiffres">{v}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[13px] leading-[18px] text-white/40">
          La séance réalisée rejoindra le carnet à la prochaine synchro de ta montre.
        </p>
        <div className="flex-1" />
        <Bouton couleur={VERT} onClick={() => { effacer(s.id); onClose(); }}>Terminer</Bouton>
      </>
    );
  } else {
    const couleur = COULEURS[etape.type];
    corps = (
      <>
        <div className="text-center">
          <Surtitre couleur={couleur}>{surtitreEtape(etape)}</Surtitre>
          <Nom>{etape.nom}</Nom>
        </div>
        <div className="mt-5">
          <Anneau part={etape.duree_s && reste != null ? 1 - reste / etape.duree_s : 0} couleur={couleur}>
            {reste != null ? (
              <>
                <span className="font-rounded font-bold leading-none tracking-[-0.03em] chiffres text-[64px] lg:text-[88px]"
                  role="timer" aria-live="off">{fmtChrono(Math.ceil(reste))}</span>
                <span className="mt-1.5 text-[13px] lg:text-[15px] text-white/50">{enPause ? "en pause" : `sur ${fmtChrono(etape.duree_s)}`}</span>
              </>
            ) : (
              <span className="px-6 text-center text-[17px] font-semibold text-white/70">À ton rythme</span>
            )}
          </Anneau>
        </div>
        {etape.cible && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {etape.cible.split(/\s*[,·]\s*/).filter(Boolean).map((c) => <Puce key={c}><b>{c}</b></Puce>)}
          </div>
        )}
        <div className="flex-1 min-h-4" />
        <Ensuite titre={suivante ? titreEtape(suivante) : "Fin de la séance"}
          detail={suivante?.duree_s ? fmtChrono(suivante.duree_s) : null} />
        <div className="mt-3"><BandeauSpotify sp={sp} /></div>
        <div className="mt-3 flex gap-2">
          {etat.idx > 0 && (
            <Bouton sombre className="!w-14 shrink-0" onClick={precedent} aria-label="Étape précédente">
              <svg viewBox="0 0 12 14" className="w-4 h-4 rotate-180" aria-hidden><path d="M1 1.5v11l7-5.5zM9.5 1.5h1.5v11H9.5z" fill="currentColor" /></svg>
            </Bouton>
          )}
          {reste != null ? (
            <Bouton couleur={enPause ? VERT : couleur} sombre={!enPause} onClick={enPause ? reprendre : pause}>
              {enPause ? <><Lecture /> Reprendre</> : "Pause"}
            </Bouton>
          ) : (
            <Bouton couleur={couleur} onClick={passer}>Étape suivante</Bouton>
          )}
          {reste != null && (
            <Bouton sombre className="!w-14 shrink-0" onClick={passer} aria-label="Passer à l’étape suivante">
              <svg viewBox="0 0 12 14" className="w-4 h-4" aria-hidden><path d="M1 1.5v11l7-5.5zM9.5 1.5h1.5v11H9.5z" fill="currentColor" /></svg>
            </Bouton>
          )}
        </div>
      </>
    );
  }

  const debloquer = (ev) => { if (!ev.target.closest?.("[data-spotify]")) debloquerSon(); };

  const ecran = (
    <div className="fixed inset-0 z-[60] flex bg-black text-white font-sans antialiased select-none"
      role="dialog" aria-modal="true" aria-label={`Séance en cours : ${s.titre}`}
      onClickCapture={debloquer} onTouchEndCapture={debloquer}>
      <div className="relative flex-1 min-w-0 flex flex-col"
        style={{ paddingTop: "calc(max(12px, env(safe-area-inset-top)) + var(--marge-flou))", paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center gap-3 px-4 lg:px-10 pt-1">
          <button type="button" onClick={() => setMenu(true)} aria-label="Options de la séance"
            className="w-[30px] h-[30px] shrink-0 rounded-full bg-[#2c2c2e] text-white/60 flex items-center justify-center"><Croix /></button>
          {/* Un segment par étape, large comme sa durée */}
          <div className="flex-1 flex gap-[2px]" aria-hidden>
            {etapes.map((e, i) => {
              const part = i < etat.idx ? 1 : i > etat.idx || !etat.debut ? 0 : e.duree_s && reste != null ? 1 - reste / e.duree_s : 0;
              return (
                <i key={i} className="block h-1 min-w-[3px] rounded-full bg-[#2c2c2e] overflow-hidden" style={{ flex: `${Math.max(30, e.duree_s || 60)} 1 0` }}>
                  <i className="block h-full rounded-full" style={{ width: `${part * 100}%`, background: COULEURS[e.type] }} />
                </i>
              );
            })}
          </div>
          <span className="font-rounded text-[13px] lg:text-[15px] font-semibold text-white/60 chiffres shrink-0">{fmtChrono(ecoule)}</span>
        </div>

        <main key={fini ? "fin" : etat.debut ? etat.idx : "pret"}
          className="flex-1 min-h-0 overflow-y-auto scrollbar-hide w-full max-w-[560px] mx-auto px-5 pt-6 flex flex-col animate-[fondu_0.25s_ease-out]">
          {corps}
        </main>

        {(decompte || now < goJusqua) && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/75 backdrop-blur-md" aria-live="assertive">
            <span key={decompte ?? "go"} className="font-rounded font-extrabold leading-none text-[150px] lg:text-[200px] animate-[decompte_0.35s_ease-out]"
              style={{ color: decompte ? ORANGE : VERT }}>{decompte ?? "GO"}</span>
          </div>
        )}

        {menu && (
          <div className="absolute inset-0 z-20 flex items-end lg:items-center justify-center bg-black/60 p-4" onClick={() => setMenu(false)}>
            <div className="w-full max-w-[400px] space-y-2" onClick={(ev) => ev.stopPropagation()}>
              <div className="rounded-[16px] bg-[#1c1c1e] overflow-hidden divide-y divide-white/10">
                {etat.debut && !fini && (
                  <button type="button" className="w-full h-14 text-[17px]" onClick={() => {
                    // mise en pause écrite tout de suite : l'écran se ferme avant le prochain rendu
                    ecrire(s.id, etat.fin ? { ...etat, pauseReste: Math.max(0, etat.fin - Date.now()), fin: null } : etat);
                    couperSon();
                    onClose();
                  }}>Quitter et reprendre plus tard</button>
                )}
                <button type="button" className="w-full h-14 text-[17px] text-[#FF453A]" onClick={() => { effacer(s.id); onClose(); }}>
                  {etat.debut && !fini ? "Abandonner la séance" : "Fermer"}
                </button>
              </div>
              <button type="button" className="w-full h-14 rounded-[16px] bg-[#2c2c2e] text-[17px] font-semibold" onClick={() => setMenu(false)}>Continuer</button>
            </div>
          </div>
        )}
      </div>

      {/* Ordinateur : déroulé de la séance */}
      <aside className="hidden lg:flex w-[300px] shrink-0 flex-col bg-[#1c1c1e] px-4 py-7 overflow-y-auto scrollbar-hide">
        <h3 className="mx-2 mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-white/30 truncate">{s.titre}</h3>
        {etapes.map((e, i) => {
          const enCours = etat.debut && i === etat.idx;
          const fait = etat.debut && i < etat.idx;
          return (
            <button type="button" key={i} disabled={!etat.debut || fini}
              onClick={() => { couperSon(); setEtat((st) => placer(st, i, Date.now())); }}
              className={clsx("flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[14px] text-left",
                enCours ? "bg-[#2c2c2e] font-semibold text-white" : fait ? "text-white/30" : "text-white/60")}>
              <i className="w-2 h-2 shrink-0 rounded-full" style={{ background: COULEURS[e.type], opacity: fait ? 0.4 : 1 }} />
              <span className="flex-1 min-w-0 truncate">{titreEtape(e)}</span>
              <em className="not-italic text-[12px] text-white/30 chiffres shrink-0">{e.duree_s ? fmtChrono(e.duree_s) : "libre"}</em>
            </button>
          );
        })}
        <p className="mx-2.5 mt-4 text-[12px] leading-[16px] text-white/30">Espace : pause · → : étape suivante · {LIBELLES_ETAPE.effort} en orange, récupération en vert.</p>
      </aside>
    </div>
  );

  return createPortal(ecran, document.body);
}
