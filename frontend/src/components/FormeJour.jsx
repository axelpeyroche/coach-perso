import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { getFormeJour } from "../api";
import { fmtDate, nombre, sportInfo } from "../carnet";

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

// Pastille du matin : VFC et FC repos du jour comparées à la référence personnelle (~2 mois)
export default function FormeJour() {
  const { data: f } = useQuery({ queryKey: ["forme-jour"], queryFn: getFormeJour, staleTime: 5 * 60_000 });
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
      {mesureHier && <p className="pl-6 text-[12px] text-label-2">Mesure d'hier : celle de ce matin n'est pas encore arrivée.</p>}

      {f.vfc_basse_jours >= 3 && (
        <p className="ml-6 rounded-xl bg-ios-red/[0.12] px-3 py-2 text-[13px] leading-[18px] text-ios-red">
          VFC sous ta normale depuis {f.vfc_basse_jours} mesures d'affilée : lève le pied quelques jours.
        </p>
      )}

      {n && f.conseil && !f.seance_faite_aujourdhui && (
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
    </section>
  );
}
