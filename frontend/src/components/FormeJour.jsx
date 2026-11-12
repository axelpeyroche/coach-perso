import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { getFormeJour, basculerMarqueur } from "../api";
import { fmtDate, nombre } from "../carnet";
import Aide from "./Aide";
import Feuille from "./Feuille";

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

// Bouton « ? » : chaque mesure du matin, sa valeur, ta normale et ce qu'elle pèse dans le score
function Pourquoi({ lignes }) {
  return (
    <div className="card divide-y divide-separateur">
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

// Contexte du jour : un toucher pour dire « malade », « voyage »… Ces jours-là sortent de la référence
function Marqueurs({ types, actifs, onBascule, occupe }) {
  return (
    <div className="pl-6 flex items-center gap-1.5 min-w-0">
      <p className="text-[12px] text-label-2 shrink-0 flex items-center gap-1">Aujourd'hui <Aide sujet="marqueurs" /></p>
      <div className="flex gap-1">
        {types.map((t) => {
          const actif = actifs.includes(t.type);
          return (
            <button key={t.type} type="button" disabled={occupe} aria-pressed={actif} onClick={() => onBascule(t.type, !actif)}
              title={t.label} aria-label={t.label}
              className={clsx("puce h-8 w-8 px-0 justify-center text-[16px] shrink-0", actif && "puce-active")}>
              <span aria-hidden>{t.emoji}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Pastille du matin : VFC et FC repos du jour comparées à la référence personnelle (~2 mois)
export default function FormeJour() {
  const { data: f } = useQuery({ queryKey: ["forme-jour"], queryFn: getFormeJour, staleTime: 5 * 60_000 });
  const [pourquoi, setPourquoi] = useState(false);
  const qc = useQueryClient();
  const rafraichir = (cles) => cles.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const marquer = useMutation({
    mutationFn: ({ type, actif }) => basculerMarqueur(type, actif),
    onSuccess: () => rafraichir(["forme-jour", "analyses", "corps"]),
  });
  if (!f || (!f.statut && !f.derniere_mesure)) return null;
  const n = f.statut ? NIVEAUX[f.statut] : null;
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
              <div className="flex items-center gap-2">
                <p className="font-rounded text-[26px] leading-8 font-bold tracking-[-0.02em]">{f.label}</p>
                {f.explication?.length > 0 && (
                  <button type="button" onClick={() => setPourquoi(true)} aria-label="Pourquoi cette forme ?"
                    className="w-6 h-6 rounded-full bg-remplissage text-label-2 text-[14px] font-bold leading-none flex items-center justify-center hover:text-brand active:opacity-60 transition shrink-0">
                    ?
                  </button>
                )}
              </div>
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

      <Marqueurs types={f.types_marqueurs ?? []} actifs={f.marqueurs ?? []} occupe={marquer.isPending}
        onBascule={(type, actif) => marquer.mutate({ type, actif })} />
      {pourquoi && (
        <Feuille titre={`Forme du matin : ${f.label}`} onClose={() => setPourquoi(false)}>
          <Pourquoi lignes={f.explication} />
        </Feuille>
      )}
    </section>
  );
}
