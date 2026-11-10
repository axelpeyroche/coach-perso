import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import clsx from "clsx";
import Card from "./Card";
import Aide from "./Aide";
import { duree } from "./BilanBlocs";
import { getCalendrier, modifierPrevue } from "../api";
import { fmtDate, nombre, sportInfo, fmtDistance } from "../carnet";
import { joursSemaine, usePreferences } from "../preferences";

// Fond de la case selon la charge du jour (0 = repos … 4 = grosse journée pour toi)
const FOND = [null, 0.08, 0.16, 0.26, 0.38];
const STATUTS = { a_venir: "À venir", manquee: "Non faite", sautee: "Sautée", realisee: "Faite" };
// Totaux de la ligne : lien vers le bilan quand la ligne est une semaine du lundi au dimanche
// (les bilans restent comptés ainsi), simple total sinon
function LienSemaine({ s, className, children }) {
  return s.bilan
    ? <Link to={`/bilan?vue=semaine&ref=${s.lundi}`} title="Bilan de la semaine" className={className}>{children}</Link>
    : <div className={className}>{children}</div>;
}

const GRILLE = "grid grid-cols-7 lg:grid-cols-[repeat(7,minmax(0,1fr))_84px] gap-[3px] md:gap-1";

function Fleche({ sens, onClick, label }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className="w-10 h-10 rounded-full bg-remplissage grid place-items-center shrink-0 transition active:scale-90">
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={sens < 0 ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
      </svg>
    </button>
  );
}

function Case({ j, auj, choisi, cible, survol, onChoisir, glisser }) {
  const num = Number(j.jour.slice(8));
  const nb = j.activites.length + j.prevues.length;
  const visibles = [...j.activites.map((a) => ({ ...a, fait: true })), ...j.prevues].slice(0, 3);
  return (
    <div role="button" tabIndex={0} aria-pressed={choisi}
      aria-label={`${fmtDate(j.jour, { weekday: "long", day: "numeric", month: "long" })} : ${j.activites.length} séance${j.activites.length > 1 ? "s" : ""} faite${j.activites.length > 1 ? "s" : ""}, ${j.prevues.length} prévue${j.prevues.length > 1 ? "s" : ""}`}
      onClick={() => onChoisir(j.jour)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChoisir(j.jour); } }}
      onDragOver={glisser.actif ? (e) => { e.preventDefault(); glisser.survoler(j.jour); } : undefined}
      onDrop={glisser.actif ? (e) => { e.preventDefault(); glisser.deposer(j.jour); } : undefined}
      className={clsx("relative rounded-[10px] md:rounded-[12px] p-1 md:p-1.5 min-h-[54px] md:min-h-[104px] cursor-pointer select-none transition-shadow outline-none overflow-hidden bg-surface",
        !j.dans_mois && "opacity-45",
        choisi ? "ring-2 ring-brand" : survol ? "ring-2 ring-brand/60" : cible ? "ring-1 ring-brand/40" : "focus-visible:ring-2 focus-visible:ring-brand/60")}>
      {FOND[j.niveau] && <span aria-hidden className="absolute inset-0" style={{ background: `rgb(var(--blue) / ${FOND[j.niveau]})` }} />}
      <div className="relative flex items-center justify-between gap-1">
        <span className={clsx("chiffres text-[13px] md:text-[13px] font-semibold w-[22px] h-[22px] grid place-items-center rounded-full",
          j.jour === auj ? "bg-brand text-white" : "text-label")}>{num}</span>
        {j.marqueurs.length > 0 && <span className="text-[10px] md:text-[12px] leading-none" aria-hidden>{j.marqueurs.slice(0, 2).map((m) => m.emoji).join("")}</span>}
      </div>
      {/* Téléphone : une pastille par séance (pleine = faite, cerclée = prévue) */}
      <div className="relative md:hidden flex flex-wrap gap-[3px] mt-1.5 px-0.5">
        {visibles.map((x) => (
          <span key={`${x.fait ? "a" : "p"}${x.id}`} className="w-[7px] h-[7px] rounded-full"
            style={x.fait ? { background: sportInfo(x.sport).couleur } : { boxShadow: `inset 0 0 0 1.5px ${x.statut === "manquee" ? "rgb(var(--red))" : sportInfo(x.sport).couleur}`, opacity: x.statut === "sautee" ? 0.4 : 1 }} />
        ))}
        {nb > 3 && <span className="text-[9px] leading-[7px] text-label-2 chiffres">+{nb - 3}</span>}
      </div>
      {/* Ordinateur : les titres dans la case */}
      <div className="relative hidden md:block space-y-[3px] mt-1">
        {visibles.map((x) => x.fait ? (
          <p key={`a${x.id}`} className="text-[11px] leading-[15px] rounded-[5px] px-1 whitespace-nowrap overflow-hidden text-ellipsis text-white"
            style={{ background: sportInfo(x.sport).couleur }}>
            {x.titre || sportInfo(x.sport).label}
          </p>
        ) : (
          <p key={`p${x.id}`} draggable={x.deplacable} title={x.deplacable ? "Glisse sur un autre jour pour déplacer" : undefined}
            onDragStart={x.deplacable ? (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(x.id)); glisser.debuter(x); } : undefined}
            onDragEnd={glisser.finir}
            className={clsx("text-[11px] leading-[15px] rounded-[5px] px-1 whitespace-nowrap overflow-hidden text-ellipsis border border-dashed",
              x.deplacable && "cursor-grab active:cursor-grabbing", x.statut === "sautee" && "line-through opacity-50",
              x.statut === "manquee" ? "border-ios-red/70 text-ios-red" : "border-label-3 text-label-2")}>
            {x.titre}
          </p>
        ))}
        {nb > 3 && <p className="text-[10px] text-label-2 px-1">+{nb - 3} autre{nb - 3 > 1 ? "s" : ""}</p>}
      </div>
    </div>
  );
}

function Detail({ j, auj, onFiche, onDeplacer, enDeplacement }) {
  const total = j.activites.reduce((s, a) => s + (a.duree_sec || 0), 0);
  return (
    <Card pad={false}>
      <div className="px-4 pt-3.5 pb-2.5">
        <h3 className="text-[17px] font-semibold first-letter:uppercase">{fmtDate(j.jour, { weekday: "long", day: "numeric", month: "long" })}</h3>
        <p className="text-[13px] text-label-2 chiffres">
          {j.activites.length ? `${duree(total)} · charge ${j.charge}` : j.jour > auj ? (j.prevues.length ? "À venir" : "Rien de prévu") : j.prevues.length ? "Rien de fait" : "Repos"}
          {j.marqueurs.map((m) => ` · ${m.emoji} ${m.label}`).join("")}
        </p>
      </div>
      {(j.activites.length > 0 || j.prevues.length > 0) && (
        <div className="divide-y-[0.5px] divide-separateur border-t-[0.5px] border-separateur">
          {j.activites.map((a) => (
            <button key={a.id} type="button" onClick={() => onFiche(a.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[44px] text-left active:bg-remplissage transition">
              <span className="w-[30px] h-[30px] rounded-[8px] grid place-items-center text-[16px] shrink-0"
                style={{ background: `color-mix(in srgb, ${sportInfo(a.sport).couleur} 18%, transparent)` }}>{sportInfo(a.sport).emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] leading-[19px]">{a.titre || sportInfo(a.sport).label}</span>
                <span className="block text-[12px] text-label-2 chiffres">
                  {[a.type, duree(a.duree_sec), a.distance_km >= 0.5 && `${fmtDistance(a.distance_km, 1)}`, a.dplus_m >= 50 && `${a.dplus_m} m D+`, a.prevue && "prévue au plan"].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
          {j.prevues.map((p) => (
            <div key={p.id} className="px-4 py-2.5">
              <div className="flex items-start gap-3">
                <span className="w-[30px] h-[30px] rounded-[8px] grid place-items-center text-[16px] shrink-0 border border-dashed border-label-3">{sportInfo(p.sport).emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className={clsx("block text-[15px] leading-[19px]", p.statut === "sautee" && "line-through text-label-2")}>{p.titre}</span>
                  <span className="block text-[12px] text-label-2 chiffres">
                    <span className={p.statut === "manquee" ? "text-ios-red" : undefined}>{STATUTS[p.statut]}</span>
                    {[p.duree_min && ` · ${duree(p.duree_min * 60)}`, p.distance_km && ` · ${fmtDistance(p.distance_km, 1)}`].filter(Boolean).join("")}
                  </span>
                </span>
              </div>
              {p.description && <p className="text-[13px] text-label-2 mt-1.5 line-clamp-3">{p.description}</p>}
              <div className="flex flex-wrap gap-2 mt-2">
                {p.deplacable && (
                  <button type="button" className={clsx("btn-sm", enDeplacement === p.id ? "btn-primaire" : "btn-teinte")} onClick={() => onDeplacer(p)}>
                    {enDeplacement === p.id ? "Annuler le déplacement" : "Déplacer"}
                  </button>
                )}
                <Link to="/plan" className="btn-gris btn-sm">Voir dans le plan</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Vue calendrier du carnet : un mois, les séances faites et prévues, la charge en fond de case
export default function CalendrierCarnet({ onFiche }) {
  const [mois, setMois] = useState(null);
  const [choisi, setChoisi] = useState(null);
  const [deplace, setDeplace] = useState(null);   // séance prévue en cours de déplacement (au doigt)
  const [traine, setTraine] = useState(null);     // séance prévue en cours de glisser-déposer (souris)
  const [survol, setSurvol] = useState(null);
  const [erreur, setErreur] = useState(null);
  const qc = useQueryClient();
  const detail = useRef(null);
  // Au téléphone le détail est sous la grille : on l'amène à l'écran quand on touche un jour
  useEffect(() => {
    if (choisi) detail.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [choisi]);
  const { premierJour } = usePreferences();
  const { data: c, isLoading } = useQuery({
    queryKey: ["calendrier", mois, premierJour], queryFn: () => getCalendrier(mois ?? undefined, premierJour), placeholderData: (prec) => prec,
  });
  const bouger = useMutation({
    mutationFn: ({ id, jour }) => modifierPrevue(id, { jour }),
    onSuccess: (_, { jour }) => { setChoisi(jour); setErreur(null); },
    onError: (e) => setErreur(e?.response?.data?.detail || "Le déplacement n'a pas pu être enregistré."),
    onSettled: () => { qc.invalidateQueries({ queryKey: ["calendrier"] }); qc.invalidateQueries({ queryKey: ["plan"] }); },
  });
  if (isLoading || !c) return <p className="text-[15px] text-label-2">Chargement…</p>;

  const labels = Object.fromEntries(c.types_marqueurs.map((m) => [m.type, m]));
  const jours = c.jours.map((j) => ({ ...j, marqueurs: j.marqueurs.map((t) => labels[t] ?? { emoji: "•", label: t }) }));
  const semaines = c.semaines.map((s, i) => ({ ...s, jours: jours.slice(i * 7, i * 7 + 7) }));
  const jourChoisi = jours.find((j) => j.jour === (choisi ?? c.aujourdhui)) ?? null;
  const choisir = (jour) => {
    if (deplace) {
      if (jour !== deplace.jour) bouger.mutate({ id: deplace.id, jour });
      setDeplace(null);
    } else setChoisi(jour);
  };
  const glisser = {
    actif: !!traine,
    debuter: (p) => setTraine(p),
    survoler: (jour) => setSurvol(jour),
    finir: () => { setTraine(null); setSurvol(null); },
    deposer: (jour) => {
      if (traine && jour !== traine.jour) bouger.mutate({ id: traine.id, jour });
      setTraine(null); setSurvol(null);
    },
  };
  const t = c.totaux;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Fleche sens={-1} label="Mois précédent" onClick={() => { setMois(c.mois_precedent); setChoisi(null); }} />
        <div className="flex-1 text-center min-w-0">
          <h2 className="text-[17px] font-semibold flex items-center justify-center gap-1.5">{c.libelle} <Aide sujet="calendrier" /></h2>
          <p className="text-[12px] text-label-2 chiffres">
            {t.nb ? `${t.nb} séance${t.nb > 1 ? "s" : ""} · ${duree(t.duree_sec)}${t.km >= 1 ? ` · ${nombre(t.km, 0)} km` : ""}` : "Aucune séance"}
          </p>
        </div>
        <Fleche sens={1} label="Mois suivant" onClick={() => { setMois(c.mois_suivant); setChoisi(null); }} />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {c.mois !== c.aujourdhui.slice(0, 7) && (
          <button type="button" className="btn-gris btn-sm" onClick={() => { setMois(null); setChoisi(null); }}>Aujourd'hui</button>
        )}
        <Link to={`/bilan?vue=mois&ref=${c.mois}`} className="btn-teinte btn-sm">Bilan du mois</Link>
      </div>

      {deplace && (
        <div role="status" className="rounded-[12px] bg-brand/[0.12] text-brand px-4 py-2.5 flex items-center gap-3">
          <p className="flex-1 text-[14px] leading-[19px]">Touche le jour où placer « {deplace.titre} ».</p>
          <button type="button" className="btn-texte shrink-0" onClick={() => setDeplace(null)}>Annuler</button>
        </div>
      )}
      {erreur && <p role="alert" className="text-[13px] text-ios-red px-1">{erreur}</p>}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_330px] items-start">
        <div className="min-w-0">
          <div className={clsx(GRILLE, "mb-1")}>
            {joursSemaine(premierJour).map((l) => <span key={l} className="text-center text-[11px] md:text-[12px] text-label-2 font-medium">{l}</span>)}
            <span className="hidden lg:block text-right text-[12px] text-label-2 font-medium pr-1">Semaine</span>
          </div>
          <div className="space-y-[3px] md:space-y-1">
            {semaines.map((s) => (
              <div key={s.lundi} className={GRILLE}>
                {s.jours.map((j) => (
                  <Case key={j.jour} j={j} auj={c.aujourdhui} choisi={!deplace && jourChoisi?.jour === j.jour}
                    cible={!!deplace} survol={survol === j.jour} onChoisir={choisir} glisser={glisser} />
                ))}
                <LienSemaine s={s}
                  className="hidden lg:flex flex-col justify-center items-end text-right pr-1 rounded-[10px] hover:bg-remplissage transition chiffres">
                  {s.nb ? (
                    <>
                      <b className="text-[13px]">{duree(s.duree_sec)}</b>
                      <span className="text-[11px] text-label-2">{s.km >= 1 ? `${nombre(s.km, 0)} km` : `${s.nb} séance${s.nb > 1 ? "s" : ""}`}</span>
                      {s.dplus_m >= 100 && <span className="text-[11px] text-label-2">{nombre(s.dplus_m, 0)} m D+</span>}
                    </>
                  ) : <span className="text-[12px] text-label-3">—</span>}
                </LienSemaine>
              </div>
            ))}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-label-2 mt-2.5 px-1">
            <span className="flex items-center gap-1.5">Charge du jour
              {FOND.slice(1).map((a) => <i key={a} className="w-3 h-3 rounded-[3px]" style={{ background: `rgb(var(--blue) / ${a + 0.06})` }} />)}
            </span>
            <span className="flex items-center gap-1.5"><i className="w-[9px] h-[9px] rounded-full bg-label-2" /> faite</span>
            <span className="flex items-center gap-1.5"><i className="w-[9px] h-[9px] rounded-full" style={{ boxShadow: "inset 0 0 0 1.5px currentColor" }} /> prévue</span>
            <span className="hidden md:inline">Glisse une séance prévue sur un autre jour pour la déplacer.</span>
          </p>
        </div>
        {jourChoisi && (
          <div ref={detail} className="scroll-mb-28 md:scroll-mb-6">
          <Detail j={jourChoisi} auj={c.aujourdhui} onFiche={onFiche} enDeplacement={deplace?.id}
            onDeplacer={(p) => setDeplace(deplace?.id === p.id ? null : { ...p, jour: jourChoisi.jour })} />
          </div>
        )}
      </div>
    </div>
  );
}
