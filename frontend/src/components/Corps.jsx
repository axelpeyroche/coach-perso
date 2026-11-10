import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import clsx from "clsx";
import Card from "./Card";
import Feuille from "./Feuille";
import ConfirmDialog from "./ConfirmDialog";
import Aide from "./Aide";
import { Segmente, Chevron } from "./ui";
import { axeX, axeY, grille, InfoBulle, zoom } from "./graphiques";
import {
  getDouleurs, creerDouleur, modifierDouleur, releverDouleur, supprimerDouleur,
  getMarqueurs, basculerMarqueur,
} from "../api";
import { fmtDate } from "../carnet";

const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const NEUTRE = "rgb(var(--fill) / 0.22)";

// 0 vert, 1–3 jaune, 4–6 orange, 7–10 rouge
export function couleurIntensite(i) {
  if (i == null) return "rgb(var(--gray))";
  if (i === 0) return "rgb(var(--green))";
  if (i <= 3) return "rgb(var(--yellow))";
  if (i <= 6) return "rgb(var(--orange))";
  return "rgb(var(--red))";
}
const motIntensite = (i) => (i == null ? "non notée" : i === 0 ? "plus rien" : i <= 3 ? "légère" : i <= 6 ? "gênante" : "forte");

// ── Mannequin ─────────────────────────────────────────────────────────────
// Formes dessinées sur la moitié gauche de l'écran (x < 60) ; les zones qui ont un côté sont
// reflétées. De face, la gauche de l'écran est la droite de la personne ; de dos, c'est sa gauche.
const R = (x, y, w, h, rx = 5) => ({ t: "rect", x, y, w, h, rx });
const E = (cx, cy, rx, ry) => ({ t: "ellipse", cx, cy, rx, ry });
const COMMUN_HAUT = {
  tete: E(60, 18, 13, 14),
  cou: R(54, 32, 12, 9, 3),
  epaule: E(35, 49, 10, 7.5),
  bras: R(24, 57, 11.5, 26, 5.5),
  coude: E(28.5, 89, 6, 5.5),
  avant_bras: R(20.5, 95, 11, 25, 5.5),
  poignet: R(20, 121, 10.5, 7.5, 3),
};
const VUES = {
  face: {
    ...COMMUN_HAUT,
    poitrine: R(45, 42, 30, 30, 7),
    abdos: R(46, 74, 28, 28, 6),
    hanche: R(42, 104, 17, 15, 6),
    quadriceps: R(40.5, 121, 12, 43, 6),
    adducteur: R(53.5, 121, 5.5, 30, 2.75),
    genou: E(49, 172, 8, 7),
    tibia: R(43, 181, 12.5, 42, 6),
    cheville: R(44, 225, 10.5, 9, 4),
    pied: R(40.5, 236, 15, 14, 6),
  },
  dos: {
    ...COMMUN_HAUT,
    haut_dos: R(45, 42, 30, 30, 7),
    lombaires: R(46, 74, 28, 28, 6),
    fessier: R(42, 104, 17, 18, 7),
    ischio: R(41, 124, 17, 40, 7),
    genou: E(49, 172, 8, 7),
    mollet: R(42.5, 181, 13.5, 42, 6.5),
    achille: R(46, 224.5, 7, 11, 3),
    pied: R(41.5, 237, 14, 13, 6),
  },
};
const MAIN = E(25, 137, 5.5, 7.5);

function Forme({ f, miroir, ...props }) {
  if (f.t === "ellipse") return <ellipse cx={miroir ? 120 - f.cx : f.cx} cy={f.cy} rx={f.rx} ry={f.ry} {...props} />;
  return <rect x={miroir ? 120 - f.x - f.w : f.x} y={f.y} width={f.w} height={f.h} rx={f.rx} {...props} />;
}

function Vue({ vue, zones, parZone, onZone }) {
  const formes = VUES[vue];
  const [gaucheEcran, droiteEcran] = vue === "face" ? ["droite", "gauche"] : ["gauche", "droite"];
  const pieces = [];
  for (const [zone, f] of Object.entries(formes)) {
    const z = zones[zone];
    if (!z) continue;
    if (z.cote) pieces.push([zone, gaucheEcran, f, false], [zone, droiteEcran, f, true]);
    else pieces.push([zone, null, f, false]);
  }
  return (
    <figure className="flex-1 min-w-0 max-w-[200px]">
      <svg viewBox="0 0 120 256" className="w-full h-auto select-none" role="group" aria-label={`Corps vu de ${vue}`}>
        <Forme f={MAIN} fill={NEUTRE} />
        <Forme f={MAIN} miroir fill={NEUTRE} />
        {pieces.map(([zone, cote, f, miroir]) => {
          const d = parZone[`${zone}:${cote ?? ""}`];
          const nom = `${zones[zone].label}${cote ? ` ${cote}` : ""}`;
          return (
            <Forme key={`${zone}${cote}`} f={f} miroir={miroir}
              role="button" tabIndex={0} aria-label={d ? `${nom} : douleur ${motIntensite(d.intensite)}` : `${nom} : signaler une douleur`}
              onClick={() => onZone(zone, cote, d)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onZone(zone, cote, d); } }}
              fill={d ? couleurIntensite(d.intensite) : NEUTRE} fillOpacity={d ? 0.9 : 1}
              stroke="transparent" strokeWidth={3} pointerEvents="all"
              className="cursor-pointer outline-none transition-opacity hover:opacity-70 focus-visible:opacity-60 active:opacity-50">
              <title>{nom}</title>
            </Forme>
          );
        })}
      </svg>
      <figcaption className="text-center text-[12px] text-label-2 mt-1">{vue === "face" ? "De face" : "De dos"}</figcaption>
    </figure>
  );
}

// ── Saisie de l'intensité : onze pastilles, de 0 à 10 ─────────────────────
function Intensite({ valeur, onChange, disabled }) {
  return (
    <div>
      <div className="grid grid-cols-11 gap-1" role="radiogroup" aria-label="Intensité de 0 à 10">
        {Array.from({ length: 11 }, (_, i) => (
          <button key={i} type="button" role="radio" aria-checked={valeur === i} disabled={disabled} onClick={() => onChange(i)}
            className={clsx("h-9 rounded-lg text-[14px] font-semibold chiffres transition active:scale-90",
              valeur === i ? "text-white" : "bg-remplissage text-label")}
            style={valeur === i ? { background: couleurIntensite(i), color: i >= 1 && i <= 3 ? "#000" : "#fff" } : undefined}>
            {i}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-label-2 mt-1 px-0.5"><span>Rien</span><span>Gênante</span><span>Insupportable</span></div>
    </div>
  );
}

const Champ = ({ label, children }) => (
  <label className="block space-y-1">
    <span className="text-[13px] text-label-2 px-1">{label}</span>
    {children}
  </label>
);

function NouvelleDouleur({ journal, initial, onClose, onCree }) {
  const [zone, setZone] = useState(initial?.zone ?? journal.zones[0].zone);
  const [cote, setCote] = useState(initial?.cote ?? "gauche");
  const [debut, setDebut] = useState(journal.jour);
  const [intensite, setIntensite] = useState(null);
  const [notes, setNotes] = useState("");
  const aCote = journal.zones.find((z) => z.zone === zone)?.cote;
  const creer = useMutation({
    mutationFn: () => creerDouleur({ zone, cote: aCote ? cote : null, debut, intensite, notes: notes.trim() || null }),
    onSuccess: (j) => { onCree(j); onClose(); },
  });
  return (
    <Feuille titre="Nouvelle douleur" onClose={onClose}
      action={<button type="button" className="btn-primaire" disabled={creer.isPending} onClick={() => creer.mutate()}>Ajouter</button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ label="Zone">
          <select className="champ w-full" value={zone} onChange={(e) => setZone(e.target.value)}>
            {journal.zones.map((z) => <option key={z.zone} value={z.zone}>{z.label}</option>)}
          </select>
        </Champ>
        <Champ label="Depuis le">
          <input type="date" className="champ w-full" value={debut} max={journal.jour} onChange={(e) => setDebut(e.target.value || journal.jour)} />
        </Champ>
      </div>
      {aCote && (
        <div className="space-y-1">
          <span className="text-[13px] text-label-2 px-1">Côté</span>
          <Segmente options={[["gauche", "Gauche"], ["droite", "Droite"]]} valeur={cote} onChange={setCote} />
        </div>
      )}
      <div className="space-y-1.5">
        <span className="text-[13px] text-label-2 px-1">Intensité aujourd'hui</span>
        <Intensite valeur={intensite} onChange={setIntensite} />
      </div>
      <Champ label="Notes (circonstances, avis kiné…)">
        <textarea className="champ w-full min-h-[84px]" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
      </Champ>
      {creer.isError && <p className="text-[13px] text-ios-red">Enregistrement impossible. Réessaie.</p>}
    </Feuille>
  );
}

function DetailDouleur({ d, jour, onClose, onJournal }) {
  const [notes, setNotes] = useState(d.notes ?? "");
  const [confirmer, setConfirmer] = useState(false);
  const duJour = d.releves.find((r) => r.jour === jour)?.intensite ?? null;
  const opts = { onSuccess: onJournal };
  const relever = useMutation({ mutationFn: (i) => releverDouleur(d.id, { intensite: i }), ...opts });
  const modifier = useMutation({ mutationFn: (p) => modifierDouleur(d.id, p), ...opts });
  const supprimer = useMutation({ mutationFn: () => supprimerDouleur(d.id), onSuccess: (j) => { onJournal(j); onClose(); } });
  const data = d.releves.map((r) => ({ label: court(r.jour), intensite: r.intensite }));
  const notesModifiees = notes.trim() !== (d.notes ?? "");
  return (
    <Feuille titre={d.label} onClose={onClose} large>
      <p className="text-[14px] text-label-2 -mt-2">
        {d.en_cours ? `En cours depuis le ${court(d.debut)}` : `Du ${court(d.debut)} au ${court(d.fin)}`} · {d.duree_jours} jour{d.duree_jours > 1 ? "s" : ""}
        {d.intensite_max != null && ` · pic à ${d.intensite_max}/10`}
      </p>
      <div className="grid gap-5 md:grid-cols-2 md:gap-6">
        <div className="space-y-5 min-w-0">
          {d.en_cours && (
            <div className="space-y-1.5">
              <p className="text-[15px] font-semibold">Intensité aujourd'hui</p>
              <Intensite valeur={duJour} disabled={relever.isPending} onChange={(i) => relever.mutate(i)} />
              {duJour === 0 && <p className="text-[13px] text-label-2">Plus rien ? Tu peux la marquer comme guérie ci-dessous.</p>}
            </div>
          )}
          {data.length >= 2 ? (
            <div>
              <p className="text-[15px] font-semibold mb-1.5">Évolution</p>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={data} margin={{ left: 0, right: 6, top: 6 }}>
                  <CartesianGrid {...grille} />
                  <XAxis dataKey="label" {...axeX} minTickGap={28} />
                  {zoom(data)}
                  <YAxis {...axeY} domain={[0, 10]} ticks={[0, 5, 10]} width={24} />
                  <Tooltip content={<InfoBulle format={(v) => `${v}/10`} />} />
                  <Line dataKey="intensite" name="Intensité" stroke="rgb(var(--orange))" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: "rgb(var(--orange))" }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : d.en_cours && <p className="text-[13px] text-label-2">Note l'intensité chaque jour : la courbe d'évolution apparaît dès le deuxième relevé.</p>}
        </div>
        <div className="space-y-5 min-w-0">
          {d.charge?.texte && (
            <div className={clsx("rounded-xl px-3 py-2.5", d.charge.hausse ? "bg-ios-orange/[0.12]" : "bg-remplissage")}>
              <p className="text-[13px] font-semibold flex items-center gap-1">Charge avant le début <Aide sujet="douleurs" /></p>
              <p className="text-[14px] leading-5 mt-0.5">{d.charge.texte}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-[15px] font-semibold">Notes</p>
            <textarea className="champ w-full min-h-[96px]" value={notes} maxLength={4000} placeholder="Circonstances, exercices du kiné, ce qui soulage…"
              onChange={(e) => setNotes(e.target.value)} />
            {notesModifiees && (
              <button type="button" className="btn-texte text-[14px]" disabled={modifier.isPending} onClick={() => modifier.mutate({ notes })}>Enregistrer les notes</button>
            )}
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 pt-1">
        <button type="button" className="btn-gris" disabled={modifier.isPending}
          onClick={() => modifier.mutate({ terminee: d.en_cours })}>
          {d.en_cours ? "Marquer comme guérie" : "Rouvrir"}
        </button>
        <button type="button" className="btn-gris !text-ios-red" onClick={() => setConfirmer(true)}>Supprimer</button>
      </div>
      <ConfirmDialog open={confirmer} danger title="Supprimer cette douleur ?" pending={supprimer.isPending}
        message="À réserver aux saisies par erreur : ses relevés disparaissent aussi. Pour une douleur passée, préfère « Marquer comme guérie »."
        confirmLabel="Supprimer" onConfirm={() => supprimer.mutate()} onCancel={() => setConfirmer(false)} />
    </Feuille>
  );
}

function LigneDouleur({ d, onClick }) {
  return (
    <button type="button" onClick={onClick} className="ligne w-full text-left flex items-center gap-3 px-4 py-3">
      <span aria-hidden className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-[14px] font-bold chiffres"
        style={{ background: d.en_cours ? couleurIntensite(d.intensite) : NEUTRE, color: d.en_cours && d.intensite >= 1 && d.intensite <= 3 ? "#000" : d.en_cours ? "#fff" : undefined }}>
        {d.en_cours ? (d.intensite ?? "?") : "✓"}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold truncate">{d.label}</span>
        <span className="block text-[13px] text-label-2 truncate">
          {d.en_cours
            ? `Depuis le ${court(d.debut)} · ${d.duree_jours} j · ${motIntensite(d.intensite)}`
            : `${court(d.debut)} → ${court(d.fin)} · ${d.duree_jours} j${d.intensite_max != null ? ` · pic ${d.intensite_max}/10` : ""}`}
        </span>
      </span>
      <Chevron />
    </button>
  );
}

// ── Journal des douleurs ──────────────────────────────────────────────────
export function JournalDouleurs() {
  const qc = useQueryClient();
  const { data: j } = useQuery({ queryKey: ["corps", "douleurs"], queryFn: getDouleurs });
  const [nouvelle, setNouvelle] = useState(null);     // {zone, cote} ou {}
  const [ouverte, setOuverte] = useState(null);       // id
  const [passees, setPassees] = useState(false);
  const zones = useMemo(() => Object.fromEntries((j?.zones ?? []).map((z) => [z.zone, z])), [j]);
  const enCours = useMemo(() => (j?.douleurs ?? []).filter((d) => d.en_cours), [j]);
  const finies = useMemo(() => (j?.douleurs ?? []).filter((d) => !d.en_cours), [j]);
  const parZone = useMemo(() => {
    const m = {};
    for (const d of enCours) {
      const k = `${d.zone}:${d.cote ?? ""}`;
      if (!m[k] || (d.intensite ?? -1) > (m[k].intensite ?? -1)) m[k] = d;
    }
    return m;
  }, [enCours]);
  if (!j) return null;
  const majJournal = (nv) => {
    qc.setQueryData(["corps", "douleurs"], nv);
    qc.invalidateQueries({ queryKey: ["forme-jour"] });
  };
  const detail = ouverte != null ? j.douleurs.find((d) => d.id === ouverte) : null;
  const onZone = (zone, cote, d) => (d ? setOuverte(d.id) : setNouvelle({ zone, cote }));
  return (
    <>
      <div className="grid gap-3 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] items-start">
        <Card>
          <p className="text-[13px] font-semibold text-label-2 flex items-center gap-1 mb-2">Où as-tu mal ? <Aide sujet="douleurs" /></p>
          <div className="flex justify-center gap-3">
            <Vue vue="face" zones={zones} parZone={parZone} onZone={onZone} />
            <Vue vue="dos" zones={zones} parZone={parZone} onZone={onZone} />
          </div>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3 text-[12px] text-label-2">
            {[[2, "légère"], [5, "gênante"], [8, "forte"], [0, "plus rien"]].map(([i, l]) => (
              <span key={l} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: couleurIntensite(i) }} />{l}</span>
            ))}
          </div>
          <p className="text-[12px] text-label-3 text-center mt-2">Touche une zone pour signaler ou suivre une douleur.</p>
        </Card>
        <div className="space-y-3 min-w-0">
          <Card pad={false} title={enCours.length ? `En cours (${enCours.length})` : "En cours"}
            action={<button type="button" className="btn-texte mr-4 md:mr-0" onClick={() => setNouvelle({})}>Ajouter</button>}>
            {enCours.length ? (
              <div className="divide-y divide-separateur">{enCours.map((d) => <LigneDouleur key={d.id} d={d} onClick={() => setOuverte(d.id)} />)}</div>
            ) : <p className="text-[15px] text-label-2 px-4 pb-4">Aucune douleur en cours. Tant mieux.</p>}
          </Card>
          {j.signalements.length > 0 && (
            <Card title="Signalé pendant tes séances">
              <ul className="space-y-2.5">
                {j.signalements.slice(0, 5).map((s, i) => (
                  <li key={i} className="text-[14px] leading-5">
                    <span className="text-label-2">{court(s.jour)} · {s.exercice || s.seance} : </span>« {s.ressenti} »
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-label-3 mt-2.5">Relevé dans tes ressentis de séance guidée. Si ça dure, ouvre une douleur pour la suivre.</p>
            </Card>
          )}
          {finies.length > 0 && (
            <Card pad={false}>
              <button type="button" onClick={() => setPassees((v) => !v)} aria-expanded={passees}
                className="w-full flex items-center justify-between px-4 py-3 text-left">
                <span className="text-[15px] font-semibold">Douleurs passées ({finies.length})</span>
                <span className="btn-texte text-[14px]">{passees ? "Masquer" : "Afficher"}</span>
              </button>
              {passees && <div className="divide-y divide-separateur border-t border-separateur">{finies.map((d) => <LigneDouleur key={d.id} d={d} onClick={() => setOuverte(d.id)} />)}</div>}
            </Card>
          )}
        </div>
      </div>
      {nouvelle && <NouvelleDouleur journal={j} initial={nouvelle} onClose={() => setNouvelle(null)} onCree={majJournal} />}
      {detail && <DetailDouleur key={detail.id} d={detail} jour={j.jour} onClose={() => setOuverte(null)} onJournal={majJournal} />}
    </>
  );
}

// ── Jours marqués : rattraper un jour passé, relire les derniers ──────────
export function JoursMarques() {
  const qc = useQueryClient();
  const { data: m } = useQuery({ queryKey: ["corps", "marqueurs"], queryFn: getMarqueurs });
  const auj = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const [jour, setJour] = useState(auj);
  const basculer = useMutation({
    mutationFn: ({ type, actif }) => basculerMarqueur(type, actif, jour),
    onSuccess: () => ["corps", "forme-jour", "analyses"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
  if (!m) return null;
  const actifs = m.jours.find((x) => x.jour === jour)?.types ?? [];
  const info = Object.fromEntries(m.types.map((t) => [t.type, t]));
  const recents = [...m.jours].reverse().slice(0, 8);
  return (
    <Card>
      <p className="text-[13px] font-semibold text-label-2 flex items-center gap-1">Jours marqués <Aide sujet="marqueurs" /></p>
      <p className="text-[13px] text-label-2 mt-0.5">Malade, en voyage, soirée arrosée, gros stress : ces jours sortent de ta référence de récupération.</p>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <input type="date" aria-label="Jour à marquer" className="champ !w-auto" value={jour} max={auj} onChange={(e) => setJour(e.target.value || auj)} />
        <div className="flex flex-wrap gap-1.5">
          {m.types.map((t) => {
            const actif = actifs.includes(t.type);
            return (
              <button key={t.type} type="button" aria-pressed={actif} disabled={basculer.isPending}
                onClick={() => basculer.mutate({ type: t.type, actif: !actif })}
                className={clsx("puce h-8 px-3 text-[13px]", actif && "puce-active")}>
                <span aria-hidden>{t.emoji}</span>{t.label}
              </button>
            );
          })}
        </div>
      </div>
      {recents.length > 0 && (
        <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {recents.map((x) => (
            <li key={x.jour}>
              <button type="button" onClick={() => setJour(x.jour)} className="text-left text-[14px] leading-5">
                <span className="text-label-2">{court(x.jour)} : </span>
                {x.types.map((t) => `${info[t]?.emoji ?? ""} ${info[t]?.label ?? t}`).join(", ")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
