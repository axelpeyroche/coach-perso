import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { getFormeJour, basculerMarqueur, noterRessenti, adapterPrevue } from "../api";
import { fmtDate, nombre, sportInfo } from "../carnet";
import Aide from "./Aide";

const NIVEAUX = {
  vert:   { texte: "text-ios-green",  fond: "bg-ios-green",  teinte: "bg-ios-green/[0.12]" },
  orange: { texte: "text-ios-orange", fond: "bg-ios-orange", teinte: "bg-ios-orange/[0.12]" },
  rouge:  { texte: "text-ios-red",    fond: "bg-ios-red",    teinte: "bg-ios-red/[0.12]" },
};

function Ecart({ label, valeur, unite, ecart, bon }) {
  if (valeur == null) return null;
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-label-2">{label}</p>
      <p className="chiffres">
        <span className="font-rounded text-[20px] font-bold tracking-[-0.02em]">{nombre(valeur, 0)}</span>
        <span className="text-[13px] font-semibold text-label-2 ml-0.5">{unite}</span>
        {ecart != null && ecart !== 0 && (
          <span className={clsx("text-[13px] font-semibold ml-1.5", bon ? "text-ios-green" : "text-ios-red")}>
            {ecart > 0 ? "▲" : "▼"} {Math.abs(ecart)}{unite === "ms" ? " %" : ""}
          </span>
        )}
      </p>
    </div>
  );
}

const SENS = {
  bon: { texte: "text-ios-green", fond: "bg-ios-green", signe: "✓" },
  neutre: { texte: "text-label-2", fond: "bg-label-3", signe: "•" },
  moyen: { texte: "text-ios-orange", fond: "bg-ios-orange", signe: "!" },
  mauvais: { texte: "text-ios-red", fond: "bg-ios-red", signe: "!" },
};

// Position d'une mesure par rapport à la normale : curseur sur une échelle de −3 à +3 écarts-types
function Echelle({ z, sens }) {
  if (z == null) return null;
  const pos = Math.max(0, Math.min(100, ((z + 3) / 6) * 100));
  return (
    <div className="relative h-1.5 rounded-full bg-remplissage mt-2" role="img"
      aria-label={`${nombre(Math.abs(z), 1)} écart-type ${z < 0 ? "sous" : "au-dessus de"} ta normale`}>
      <span className="absolute inset-y-0 left-[33.3%] right-[33.3%] bg-label-3/40 rounded-full" />
      <span className={clsx("absolute top-1/2 w-3 h-3 -mt-1.5 -ml-1.5 rounded-full ring-2 ring-surface", SENS[sens].fond)} style={{ left: `${pos}%` }} />
    </div>
  );
}

// « Pourquoi ? » : chaque mesure du matin, sa valeur, ta normale et ce qu'elle pèse dans le score
function Pourquoi({ lignes }) {
  return (
    <div className="ml-6 rounded-xl bg-fond/70 divide-y divide-separateur">
      {lignes.map((l) => {
        const s = SENS[l.sens] ?? SENS.neutre;
        return (
          <div key={l.cle} className="px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-semibold min-w-0 truncate">
                <span aria-hidden className={clsx("inline-block w-4 font-bold", s.texte)}>{s.signe}</span>{l.label}
              </span>
              <span className="font-rounded text-[15px] font-bold chiffres shrink-0">{l.valeur}</span>
            </div>
            <p className="text-[13px] leading-[18px] text-label-2 pl-4">
              <span className={s.texte}>{l.texte}</span>{l.ref ? ` · ${l.ref}` : ""}
            </p>
            <div className="pl-4"><Echelle z={l.z} sens={l.sens ?? "neutre"} /></div>
          </div>
        );
      })}
      <p className="px-3 py-2 text-[12px] leading-4 text-label-2 flex items-start gap-1">
        <span className="flex-1">La zone grise est ta plage habituelle (60 jours). Le score vient de la VFC et de la FC de repos ; la nuit et la charge aident à l'interpréter.</span>
        <Aide sujet="recuperation" />
      </p>
    </div>
  );
}

// Contexte du jour : un geste pour dire « malade », « voyage »… Ces jours-là sortent de la référence
function Marqueurs({ types, actifs, onBascule, occupe }) {
  return (
    <div className="pl-6">
      <p className="text-[12px] text-label-2 mb-1.5 flex items-center gap-1">Aujourd'hui, quelque chose de particulier ? <Aide sujet="marqueurs" /></p>
      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => {
          const actif = actifs.includes(t.type);
          return (
            <button key={t.type} type="button" disabled={occupe} aria-pressed={actif} onClick={() => onBascule(t.type, !actif)}
              className={clsx("puce h-8 px-3 text-[13px]", actif && "puce-active")}>
              <span aria-hidden>{t.emoji}</span>{t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const RESSENTIS = [["energie", "Énergie"], ["jambes", "Jambes"], ["humeur", "Humeur"], ["motivation", "Motivation"]];

// Ressenti du matin : quatre notes de 1 à 5, en un toucher chacune
function Ressenti({ valeurs, onNote }) {
  return (
    <div className="ml-6 rounded-xl bg-fond/70 px-3 py-2.5 grid gap-x-6 gap-y-2 grid-cols-[repeat(auto-fit,minmax(min(100%,236px),1fr))]">
      {RESSENTIS.map(([cle, label]) => (
        <div key={cle} className="flex items-center justify-between gap-3">
          <span className="text-[14px]">{label}</span>
          <div className="flex gap-1" role="radiogroup" aria-label={`${label}, de 1 à 5`}>
            {[1, 2, 3, 4, 5].map((v) => {
              const choisi = valeurs?.[cle] === v, rempli = (valeurs?.[cle] ?? 0) >= v;
              return (
                <button key={v} type="button" role="radio" aria-checked={choisi} aria-label={`${v} sur 5`} onClick={() => onNote(cle, v)}
                  className={clsx("w-8 h-8 rounded-full text-[13px] font-semibold chiffres transition active:scale-90",
                    rempli ? "bg-brand text-white" : "bg-remplissage text-label-2")}>
                  {v}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const ACTIONS = { alleger: "Alléger", decaler: "Décaler", sauter: "Sauter" };

// Quand la forme ne suit pas : alléger, décaler ou sauter une séance, en un geste
function Adaptation({ a, onAction, occupe, message }) {
  return (
    <div className="ml-6 rounded-xl bg-ios-orange/[0.12] px-3 py-2.5 space-y-2">
      <div>
        <p className="text-[15px] leading-5 font-semibold">{a.titre}</p>
        <p className="text-[13px] leading-[18px] text-label-2 mt-0.5">{a.texte}</p>
      </div>
      {a.seances.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-separateur pt-2">
          <span className="flex-1 min-w-[150px] text-[14px] leading-5">
            <span aria-hidden className="mr-1">{sportInfo(s.sport).emoji}</span>
            <span className="font-semibold">{s.titre}</span>
            <span className="text-label-2"> · {fmtDate(s.jour, { weekday: "short", day: "numeric" })}{s.duree_min ? ` · ${s.duree_min} min` : ""}</span>
          </span>
          <span className="flex gap-1.5">
            {s.actions.map((act) => (
              <button key={act} type="button" disabled={occupe} onClick={() => onAction(s.id, act)}
                className="puce h-8 px-3 text-[13px] bg-surface disabled:opacity-50">{ACTIONS[act]}</button>
            ))}
          </span>
        </div>
      ))}
      {message && <p role="status" className="text-[13px] font-semibold text-ios-green">{message}</p>}
    </div>
  );
}

// Pastille du matin : VFC et FC repos du jour comparées à la référence personnelle (~2 mois)
export default function FormeJour() {
  const { data: f } = useQuery({ queryKey: ["forme-jour"], queryFn: getFormeJour, staleTime: 5 * 60_000 });
  const [pourquoi, setPourquoi] = useState(false);
  const [ressentiOuvert, setRessentiOuvert] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const qc = useQueryClient();
  const rafraichir = (cles) => cles.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const marquer = useMutation({
    mutationFn: ({ type, actif }) => basculerMarqueur(type, actif),
    onSuccess: () => rafraichir(["forme-jour", "analyses", "corps"]),
  });
  const noter = useMutation({
    mutationFn: (valeurs) => noterRessenti(valeurs),
    onSuccess: (r) => qc.setQueryData(["forme-jour"], (old) => (old ? { ...old, ressenti: r } : old)),
  });
  const adapter = useMutation({
    mutationFn: ({ id, action }) => adapterPrevue(id, action),
    onSuccess: (r) => { setConfirmation(r.message); rafraichir(["forme-jour", "plan"]); },
  });
  if (!f || (!f.statut && !f.derniere_mesure)) return null;
  const n = f.statut ? NIVEAUX[f.statut] : null;
  const suggestion = f.seances_restantes.find((s) => s.id === f.suggestion_id);
  const mesureHier = f.mesure_du && f.mesure_du !== f.jour;

  return (
    <section className="card p-4 md:p-5 min-w-0 space-y-3" aria-label="Forme du matin">
      <div className="flex items-start gap-3">
        <span aria-hidden className={clsx("mt-1 w-3 h-3 rounded-full shrink-0", n ? n.fond : "bg-label-3")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className={clsx("text-[13px] font-semibold", n ? n.texte : "text-label-2")}>Forme du matin</h3>
            {/* 7 derniers jours */}
            <div className="flex gap-1" aria-hidden>
              {f.historique.map((h) => (
                <span key={h.jour} title={fmtDate(h.jour, { weekday: "short", day: "numeric" })}
                  className={clsx("w-1.5 h-1.5 rounded-full", h.statut ? NIVEAUX[h.statut].fond : "bg-label-3")} />
              ))}
            </div>
          </div>
          {n ? (
            <>
              <p className="font-rounded text-[26px] leading-8 font-bold tracking-[-0.02em]">{f.label}</p>
              <p className="text-[15px] text-label-2 leading-5 mt-0.5">{f.message}</p>
            </>
          ) : (
            <p className="text-[15px] text-label-2 leading-5 mt-1">
              Pas encore de mesure ce matin (dernière le {fmtDate(f.derniere_mesure, { day: "numeric", month: "long" })}).
              Porte ta montre la nuit pour obtenir ta VFC.
            </p>
          )}
        </div>
      </div>

      {n && (
        <div className="grid grid-cols-2 gap-3 pl-6">
          <Ecart label={`VFC · réf. ${nombre(f.vfc_ref, 0)} ms`} valeur={f.vfc} unite="ms"
            ecart={f.vfc_ecart_pct} bon={f.vfc_ecart_pct >= 0} />
          <Ecart label={`FC repos · réf. ${nombre(f.fc_ref, 0)}`} valeur={f.fc_repos} unite="bpm"
            ecart={f.fc_ecart} bon={f.fc_ecart <= 0} />
        </div>
      )}
      {n && f.explication?.length > 0 && (
        <>
          <button type="button" onClick={() => setPourquoi((v) => !v)} aria-expanded={pourquoi}
            className="ml-6 btn-texte text-[14px] inline-flex items-center gap-1">
            {pourquoi ? "Masquer le détail" : "Pourquoi ?"}
            <svg viewBox="0 0 24 24" className={clsx("w-3.5 h-3.5 transition-transform", pourquoi && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {pourquoi && <Pourquoi lignes={f.explication} />}
        </>
      )}
      {f.adaptation ? (
        <Adaptation a={f.adaptation} occupe={adapter.isPending} message={confirmation}
          onAction={(id, action) => adapter.mutate({ id, action })} />
      ) : confirmation && <p role="status" className="ml-6 text-[13px] font-semibold text-ios-green">{confirmation}</p>}
      {mesureHier && <p className="pl-6 text-[12px] text-label-2">Mesure d'hier : celle de ce matin n'est pas encore arrivée.</p>}

      {f.vfc_basse_jours >= 3 && (
        <p className="ml-6 rounded-xl bg-ios-red/[0.12] px-3 py-2 text-[13px] leading-[18px] text-ios-red">
          VFC sous ta normale depuis {f.vfc_basse_jours} mesures d'affilée : lève le pied quelques jours.
        </p>
      )}

      {f.alertes_nuit?.alerte && (
        <Link to="/analyses#signaux" className="ml-6 block rounded-xl bg-ios-red/[0.12] px-3 py-2 text-[13px] leading-[18px] text-ios-red active:opacity-60">
          <span className="font-semibold">Nuit inhabituelle</span> · {f.alertes_nuit.signaux.filter((x) => x.alerte)
            .map((x) => `${x.label.toLowerCase()} ${nombre(x.valeur, 1)} ${x.unite} (normale ${nombre(x.ref, 1)})`).join(", ")}
          <span className="block mt-0.5">{f.alertes_nuit.message}</span>
        </Link>
      )}

      {n && f.conseil && !f.seance_faite_aujourdhui && !f.adaptation && (
        <Link to="/plan" className={clsx("ml-6 flex items-center gap-3 rounded-xl px-3 py-2.5 transition active:opacity-60", n.teinte)}>
          <span className="text-xl" aria-hidden>{suggestion ? sportInfo(suggestion.sport).emoji : "🛌"}</span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] leading-5 font-semibold">{f.conseil}</span>
            <span className="block text-[12px] text-label-2">
              {f.seances_restantes.length} séance{f.seances_restantes.length > 1 ? "s" : ""} à faire cette semaine
              {suggestion?.duree_min ? ` · ${suggestion.duree_min} min` : ""}
            </span>
          </span>
        </Link>
      )}

      <Marqueurs types={f.types_marqueurs ?? []} actifs={f.marqueurs ?? []} occupe={marquer.isPending}
        onBascule={(type, actif) => marquer.mutate({ type, actif })} />
      <div className="pl-6">
        <button type="button" onClick={() => setRessentiOuvert((v) => !v)} aria-expanded={ressentiOuvert}
          className="btn-texte text-[14px] inline-flex items-center gap-1">
          {f.ressenti?.moyenne != null ? `Ressenti du matin : ${nombre(f.ressenti.moyenne, 1)} / 5` : "Noter mon ressenti du matin"}
          <svg viewBox="0 0 24 24" className={clsx("w-3.5 h-3.5 transition-transform", ressentiOuvert && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      {ressentiOuvert && <Ressenti valeurs={f.ressenti} onNote={(cle, v) => noter.mutate({ [cle]: v })} />}
    </section>
  );
}
