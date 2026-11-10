import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import Card from "../components/Card";
import Page from "../components/Page";
import { Section, Segmente } from "../components/ui";
import CartePassages from "../components/CartePassages";
import FicheActivite from "../components/FicheActivite";
import BilanPeriode from "../components/BilanPeriode";
import Exploration from "../components/Exploration";
import { Actions, Faits, Ligne, ORANGE, Repartition, court, heures, hms, teinte } from "../components/BilanBlocs";
import { getActivite, getBilan } from "../api";
import { fmtDate, nombre, sportInfo } from "../carnet";

const INITIALES = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const majuscule = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function semaine(debut) {
  const d = new Date(`${debut}T12:00`), f = new Date(d);
  f.setDate(d.getDate() + 6);
  return d.getMonth() === f.getMonth()
    ? `${d.getDate()}–${court(iso(f))}`
    : `${court(debut)} – ${court(iso(f))}`;
}

// Comparaison avec l'année précédente (à la même date si l'année est en cours)
function comparaison(b) {
  const p = b.precedente;
  if (!p) return null;
  const ecart = Math.round(b.totaux.km - p.km);
  const signe = ecart > 0 ? "+" : ecart < 0 ? "−" : "±";
  return `${signe}${nombre(Math.abs(ecart), 0)} km par rapport à ${p.annee}${p.a_date ? " à la même date" : ""}`;
}

function Heros({ b }) {
  const comp = comparaison(b);
  return (
    <section aria-label="Résumé de l'année" className="rounded-[20px] text-white px-5 pt-5 pb-[18px]"
      style={{ background: "linear-gradient(135deg, #0a84ff, #5e5ce6)" }}>
      <p className="text-[13px] font-semibold uppercase tracking-[0.06em] opacity-80">
        Ton année {b.annee}{b.en_cours ? ` · au ${fmtDate(b.jusqu_au, { day: "numeric", month: "long" })}` : ""}
      </p>
      <p className="font-rounded chiffres font-extrabold leading-none tracking-[-0.02em] mt-1.5 text-[clamp(54px,15vw,76px)]">
        {nombre(Math.round(b.totaux.km), 0)}<small className="text-[0.38em] font-semibold opacity-85 ml-1">km</small>
      </p>
      {comp && <p className="text-[14px] opacity-90 mt-1">{comp}</p>}
      <div className="grid grid-cols-3 gap-2.5 mt-[18px]">
        {[[heures(b.totaux.duree_sec), "en mouvement"], [nombre(b.totaux.dplus_m, 0), "m de D+"], [b.totaux.nb, "séances"]].map(([v, l]) => (
          <div key={l} className="rounded-[12px] bg-white/[0.14] px-2.5 py-2">
            <b className="block font-rounded chiffres text-[21px] font-bold">{v}</b>
            <span className="text-[12px] opacity-85">{l}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Mois({ b }) {
  const max = Math.max(...b.mois.map((m) => m.km), 1);
  const courant = b.en_cours ? new Date(`${b.jusqu_au}T12:00`).getMonth() : 11;
  const top = b.mois_top?.index;
  return (
    <Card pad={false}>
      <div className="px-4 pt-[18px] pb-3">
        <div className="grid grid-cols-12 gap-[5px] items-end h-[150px] pt-[18px]">
          {b.mois.map((m, i) => {
            const futur = i > courant;
            return (
              <div key={i} className="flex flex-col items-center justify-end gap-[5px] h-full min-w-0"
                title={futur ? "à venir" : `${nombre(m.km, 0)} km · ${heures(m.duree_sec)}`}>
                <div className="relative w-full rounded-t-[5px] rounded-b-[2px]"
                  style={{
                    height: futur ? "18%" : `${Math.max(3, (m.km / max) * 100)}%`,
                    background: futur ? "repeating-linear-gradient(45deg, rgb(120 120 128 / 0.24) 0 4px, transparent 4px 8px)"
                      : i === top ? "rgb(var(--blue))" : "rgb(var(--blue) / 0.35)",
                  }}>
                  {i === top && (
                    <span className="absolute -top-[18px] left-1/2 -translate-x-1/2 text-[11px] font-bold text-brand whitespace-nowrap chiffres">
                      {nombre(m.km, 0)} km
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-label-2">{INITIALES[i]}</span>
              </div>
            );
          })}
        </div>
      </div>
      <Faits items={[
        ...(b.mois_top ? [[majuscule(b.mois_top.nom), `Mois le plus actif · ${heures(b.mois_top.duree_sec)}`]] : []),
        ...(b.semaine_top ? [[`${nombre(b.semaine_top.km, 1)} km`, `Plus grosse semaine · ${semaine(b.semaine_top.debut)}`]] : []),
      ]} />
    </Card>
  );
}

function Regularite({ b }) {
  const minutes = Object.fromEntries(b.jours);
  const debut = new Date(b.annee, 0, 1), fin = new Date(`${b.jusqu_au}T12:00`);
  const cases = [];
  for (let i = 0; i < (debut.getDay() + 6) % 7; i++) cases.push(<i key={`x${i}`} />);
  for (const d = new Date(debut); d <= fin; d.setDate(d.getDate() + 1)) {
    const k = iso(d), m = minutes[k] || 0;
    const n = m === 0 ? 0 : m <= 30 ? 1 : m <= 75 ? 2 : 3;
    cases.push(
      <i key={k} title={`${court(k)}${m ? ` · ${m} min` : ""}`} className="block aspect-square rounded-[1.5px]"
        style={{ background: n ? `rgb(var(--green) / ${[0, 0.4, 0.7, 1][n]})` : "rgb(120 120 128 / 0.16)" }} />
    );
  }
  const s = b.plus_longue_serie;
  return (
    <>
      <Card pad={false}>
        <div className="px-4 pt-3.5 pb-2.5">
          {/* L'année entière tient dans la largeur : les cases rétrécissent au besoin */}
          <div role="img" aria-label={`Jours d'entraînement en ${b.annee}`} className="grid grid-flow-col gap-[2px] max-w-[640px]"
            style={{ gridTemplateRows: "repeat(7, auto)", gridTemplateColumns: `repeat(${Math.ceil(cases.length / 7)}, minmax(0, 1fr))` }}>
            {cases}
          </div>
        </div>
        <Faits items={[
          [b.jours_actifs, `jours actifs sur ${b.jours_ecoules}`],
          [`${s.jours} j`, "plus longue série"],
          [majuscule(b.jour_prefere) ?? "—", "jour préféré"],
        ]} />
      </Card>
      <p className="px-4 text-[13px] text-label-2">Chaque case est un jour ; plus elle est verte, plus l'entraînement a duré.</p>
    </>
  );
}

function Records({ b, ouvrir }) {
  if (!b.records.length && !b.segments.length) return null;
  return (
    <Section titre="Records battus cette année">
      <Card pad={false}>
        <div className="divide-y-[0.5px] divide-separateur">
          {b.records.map((r) => (
            <Ligne key={r.label} ico="🥇" fond={teinte(ORANGE)} titre={r.label} badge="Record"
              sous={`${r.titre || "Sortie"} · ${court(r.date)}${r.nb_fois > 1 ? ` · battu ${r.nb_fois} fois` : ""}`}
              valeur={hms(r.temps_sec)} detail={r.gain_sec > 0 ? `−${hms(r.gain_sec)}` : "premier"}
              onClick={() => ouvrir(r.activite_id)} />
          ))}
          {b.segments.map((s) => (
            <Ligne key={s.id} ico="⛰️" fond="rgb(120 120 128 / 0.16)" titre={s.nom}
              sous={`Segment · ${s.nb_passages} passage${s.nb_passages > 1 ? "s" : ""} cette année`}
              valeur={hms(s.duree_sec)} detail={`record · ${court(s.date)}`} onClick={() => ouvrir(s.activite_id)} />
          ))}
        </div>
      </Card>
    </Section>
  );
}

function Marquantes({ b, ouvrir }) {
  const { plus_longue: l, plus_gros_dplus: d, plus_longue_duree: t } = b.marquantes;
  const lignes = [
    l && <Ligne key="l" ico={sportInfo(l.sport).emoji} fond={teinte("rgb(var(--green))")} titre="Plus longue sortie"
      sous={`${l.titre || sportInfo(l.sport).label} · ${court(l.date)}`} valeur={`${nombre(l.distance_km, 1)} km`}
      detail={l.dplus_m ? `${nombre(l.dplus_m, 0)} m D+` : hms(l.duree_sec)} onClick={() => ouvrir(l.id)} />,
    d && <Ligne key="d" ico="⛰️" fond={teinte("#AF52DE")} titre="Plus gros dénivelé"
      sous={`${d.titre || sportInfo(d.sport).label} · ${court(d.date)}`} valeur={`${nombre(d.dplus_m, 0)} m`}
      detail={d.distance_km ? `${nombre(d.distance_km, 1)} km` : null} onClick={() => ouvrir(d.id)} />,
    t && t.id !== l?.id && <Ligne key="t" ico="⏱️" fond={teinte("rgb(var(--blue))")} titre="Plus longue séance"
      sous={`${t.titre || sportInfo(t.sport).label} · ${court(t.date)}`} valeur={hms(t.duree_sec)}
      detail={t.distance_km ? `${nombre(t.distance_km, 1)} km` : null} onClick={() => ouvrir(t.id)} />,
  ].filter(Boolean);
  if (!lignes.length) return null;
  return (
    <Section titre="Les sorties qui comptent">
      <Card pad={false}><div className="divide-y-[0.5px] divide-separateur">{lignes}</div></Card>
    </Section>
  );
}

// Image carrée à partager : les chiffres du héros et les mois
const carteAnnee = (b) => ({
  surtitre: `Mon année ${b.annee}${b.en_cours ? ` · au ${fmtDate(b.jusqu_au, { day: "numeric", month: "long" })}` : ""}`,
  valeur: nombre(Math.round(b.totaux.km), 0), unite: "km", comp: comparaison(b),
  tuiles: [[heures(b.totaux.duree_sec), "en mouvement"], [nombre(b.totaux.dplus_m, 0), "m de D+"], [String(b.totaux.nb), "séances"]],
  barres: b.mois.map((m, i) => ({ v: m.km, label: INITIALES[i], fort: i === b.mois_top?.index })),
});

function BilanAnnee({ demandee, onAnnee, ouvrir }) {
  const { data: b, isLoading, isError } = useQuery({
    queryKey: ["bilan", demandee], queryFn: () => getBilan(demandee ?? undefined), staleTime: 5 * 60_000,
    placeholderData: (prec) => prec,
  });
  if (isError) return <p className="text-[15px] text-label-2">Le bilan n'a pas pu être calculé. Réessaie dans un instant.</p>;
  if (isLoading || !b) return <p className="text-[15px] text-label-2">Calcul du bilan…</p>;
  return (
    <>
      {b.annees.length > 1 && (
        <nav aria-label="Année" className="no-print flex gap-1.5 overflow-x-auto pb-0.5">
          {b.annees.map((a) => (
            <button key={a} type="button" aria-pressed={a === b.annee} onClick={() => onAnnee(a)}
              className={clsx("rounded-full px-3.5 py-1.5 text-[14px] font-semibold transition chiffres",
                a === b.annee ? "bg-brand text-white" : "bg-remplissage text-label")}>
              {a}
            </button>
          ))}
        </nav>
      )}
      {b.totaux.nb === 0 ? (
        <Card><p className="text-[15px] text-label-2 text-center py-4">Aucune séance en {b.annee}.</p></Card>
      ) : (
        <>
          <Heros b={b} />
          <Section titre="Mois par mois"><Mois b={b} /></Section>
          <Section titre="Régularité"><Regularite b={b} /></Section>
          <Records b={b} ouvrir={ouvrir} />
          <Marquantes b={b} ouvrir={ouvrir} />
          <Repartition sports={b.sports} />
          {b.nb_traces > 0 && (
            <Section titre="Carte de l'année">
              <CartePassages annee={b.annee} />
            </Section>
          )}
          <Exploration annee={b.annee} ouvrir={ouvrir} />
          <Actions carte={() => carteAnnee(b)} nom={`bilan-${b.annee}.png`} titre={`Mon année ${b.annee}`} />
        </>
      )}
    </>
  );
}

const VUES = [["semaine", "Semaine"], ["mois", "Mois"], ["annee", "Année"]];

export default function Bilan() {
  const [params, setParams] = useSearchParams();
  const vue = VUES.some(([v]) => v === params.get("vue")) ? params.get("vue") : "annee";
  const ref = params.get("ref") || null;
  const [fiche, setFiche] = useState(null);
  const ouvrir = async (id) => {
    try { setFiche(await getActivite(id)); } catch { /* séance supprimée entre-temps */ }
  };
  const aller = (p) => setParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v)), { replace: true });

  return (
    <Page titre="Bilan">
      <div className="max-w-[560px] mx-auto space-y-[22px]">
        <Segmente className="no-print w-full" options={VUES} valeur={vue} onChange={(v) => aller({ vue: v === "annee" ? null : v })} />
        {vue === "annee" ? (
          <BilanAnnee demandee={Number(params.get("annee")) || null} onAnnee={(a) => aller({ annee: String(a) })} ouvrir={ouvrir} />
        ) : (
          <BilanPeriode key={vue} type={vue} refp={ref} ouvrir={ouvrir}
            onRef={(r) => aller({ vue, ref: r })} onSemaine={(lundi) => aller({ vue: "semaine", ref: lundi })} />
        )}
      </div>
      {fiche && <FicheActivite key={fiche.id} activite={fiche} onClose={() => setFiche(null)} />}
    </Page>
  );
}
