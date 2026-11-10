import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Card from "./Card";
import Aide from "./Aide";
import { Section, Squelettes } from "./ui";
import { Actions, Faits, Ligne, ORANGE, Repartition, court, duree, teinte } from "./BilanBlocs";
import { ExplorationMois } from "./Exploration";
import { getBilanPeriode } from "../api";
import { fmtDate, nombre, sportInfo, fmtDistance } from "../carnet";

const JOURS = ["L", "M", "M", "J", "V", "S", "D"];
const hm = (h) => `${Math.floor(h)} h ${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, "0")}`;

function ecart(v, ref) {
  if (!ref) return null;
  const p = Math.round(((v - ref) / ref) * 100);
  return `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p)} %`;
}

function Fleche({ sens, onClick, label }) {
  return (
    <button type="button" aria-label={label} disabled={!onClick} onClick={onClick}
      className="w-10 h-10 rounded-full bg-remplissage grid place-items-center shrink-0 transition active:scale-90 disabled:opacity-30">
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={sens < 0 ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
      </svg>
    </button>
  );
}

function Heros({ b }) {
  const nom = b.type === "semaine" ? "Ta semaine" : "Ton mois";
  const t = b.totaux;
  const comp = b.precedente?.duree_sec
    ? `${ecart(t.duree_sec, b.precedente.duree_sec)} de temps par rapport ${b.type === "semaine" ? "à la semaine précédente" : "au mois précédent"}${b.a_date ? " à la même date" : ""}`
    : null;
  return (
    <section aria-label="Résumé" className="rounded-[20px] text-white px-5 pt-5 pb-[18px]"
      style={{ background: "linear-gradient(135deg, #0a84ff, #5e5ce6)" }}>
      <p className="text-[13px] font-semibold uppercase tracking-[0.06em] opacity-80">
        {nom}{b.en_cours ? ` · au ${fmtDate(b.jusqu_au, { day: "numeric", month: "long" })}` : ""}
      </p>
      <p className="font-rounded chiffres font-extrabold leading-none tracking-[-0.02em] mt-1.5 text-[clamp(46px,13vw,66px)]">
        {duree(t.duree_sec)}
      </p>
      {comp && <p className="text-[14px] opacity-90 mt-1.5">{comp}</p>}
      <div className="grid grid-cols-3 gap-2.5 mt-[18px]">
        {[[`${nombre(t.km, t.km < 100 ? 1 : 0)} km`, "parcourus"], [nombre(t.dplus_m, 0), "m de D+"], [t.nb, t.nb > 1 ? "séances" : "séance"]].map(([v, l]) => (
          <div key={l} className="rounded-[12px] bg-white/[0.14] px-2.5 py-2">
            <b className="block font-rounded chiffres text-[19px] sm:text-[21px] font-bold">{v}</b>
            <span className="text-[12px] opacity-85">{l}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Chaque grandeur face à la période précédente et à la moyenne des quatre dernières
function Comparaison({ b }) {
  const t = b.totaux, p = b.precedente, m = b.moyenne4;
  const lignes = [
    ["Temps", "duree_sec", duree],
    ["Distance", "km", (v) => `${nombre(v, 1)} km`],
    ["Dénivelé", "dplus_m", (v) => `${nombre(Math.round(v), 0)} m`],
    ["Séances", "nb", (v) => nombre(v, Number.isInteger(v) ? 0 : 1)],
    ["Charge", "charge", (v) => nombre(Math.round(v), 0)],
  ];
  const Ref = ({ v, base, f }) => (
    <span className="text-right chiffres">
      <span className="block text-[14px] font-semibold">{base ? ecart(v, base) : "—"}</span>
      <span className="block text-[12px] text-label-2">{base != null ? f(base) : ""}</span>
    </span>
  );
  return (
    <Card pad={false}>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 px-4 pt-3 pb-1 text-[12px] text-label-2">
        <span />
        <span className="text-right">{b.type === "semaine" ? "Sem. précédente" : "Mois précédent"}</span>
        <span className="text-right">Moyenne des 4</span>
      </div>
      <div className="divide-y-[0.5px] divide-separateur">
        {lignes.map(([l, k, f]) => (
          <div key={k} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 items-center px-4 py-2.5">
            <span>
              <span className="block text-[12px] text-label-2">{l}</span>
              <b className="block text-[17px] chiffres">{f(t[k])}</b>
            </span>
            <Ref v={t[k]} base={p?.[k]} f={f} />
            <Ref v={t[k]} base={m?.[k]} f={f} />
          </div>
        ))}
      </div>
      {b.a_date && <p className="px-4 py-2.5 text-[12px] text-label-2 border-t-[0.5px] border-separateur">Période en cours : comparée au même nombre de jours des périodes précédentes.</p>}
    </Card>
  );
}

function Jours({ b }) {
  const max = Math.max(...b.jours.map((j) => j.min), 1);
  const sem = b.type === "semaine";
  return (
    <Card pad={false}>
      <div className="px-4 pt-[18px] pb-3">
        <div className="grid items-end h-[120px]" style={{ gridTemplateColumns: `repeat(${b.jours.length}, minmax(0, 1fr))`, gap: sem ? 10 : 2 }}>
          {b.jours.map((j, i) => {
            const d = new Date(`${j.jour}T12:00`);
            return (
              <div key={j.jour} className="flex flex-col items-center justify-end gap-[5px] h-full min-w-0"
                title={`${court(j.jour)}${j.min ? ` · ${duree(j.min * 60)}` : j.futur ? " · à venir" : " · repos"}`}>
                <div className="w-full rounded-t-[5px] rounded-b-[2px]"
                  style={{
                    height: j.futur ? "12%" : j.min ? `${Math.max(4, (j.min / max) * 100)}%` : "2px",
                    background: j.futur ? "repeating-linear-gradient(45deg, rgb(120 120 128 / 0.24) 0 4px, transparent 4px 8px)"
                      : j.min === max ? "rgb(var(--blue))" : j.min ? "rgb(var(--blue) / 0.4)" : "rgb(120 120 128 / 0.3)",
                  }} />
                <span className="text-[11px] text-label-2 chiffres h-[14px]">
                  {sem ? JOURS[i] : (d.getDate() === 1 || d.getDate() % 5 === 0) ? d.getDate() : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <Faits items={[
        [b.jours_actifs, `jour${b.jours_actifs > 1 ? "s" : ""} actif${b.jours_actifs > 1 ? "s" : ""} sur ${b.jours.filter((j) => !j.futur).length}`],
        [duree(max * 60), "plus grosse journée"],
      ]} />
    </Card>
  );
}

const NIVEAUX = [["facile", "Facile", "rgb(var(--green))"], ["modere", "Modéré", ORANGE], ["dur", "Dur", "rgb(var(--red))"]];

function Intensite({ x }) {
  return (
    <Card>
      <div className="flex h-3 rounded-[6px] overflow-hidden gap-[2px] mt-1 mb-3" aria-hidden>
        {NIVEAUX.map(([k, , c]) => x[`${k}_min`] > 0 && <i key={k} style={{ flex: x[`${k}_min`], background: c }} />)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {NIVEAUX.map(([k, l, c]) => (
          <div key={k} className="min-w-0">
            <span className="flex items-center gap-1.5 text-[12px] text-label-2">
              <span className="w-[9px] h-[9px] rounded-[3px] shrink-0" style={{ background: c }} />{l}
            </span>
            <b className="block text-[17px] chiffres">{x[`${k}_pct`]} %</b>
            <span className="block text-[12px] text-label-2 chiffres">{duree(x[`${k}_min`] * 60)}</span>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-label-2 mt-3">
        {[x.par_fc && `${x.par_fc} séance${x.par_fc > 1 ? "s" : ""} d'après la fréquence cardiaque`,
          x.par_rpe && `${x.par_rpe} d'après l'effort ressenti`,
          x.non_classees && `${x.non_classees} non classée${x.non_classees > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}
      </p>
    </Card>
  );
}

function carteImage(b) {
  const t = b.totaux, sem = b.type === "semaine";
  const max = Math.max(...b.jours.map((j) => j.min), 1);
  return {
    surtitre: `${b.libelle}${b.en_cours ? " · en cours" : ""}`,
    valeur: duree(t.duree_sec), unite: "",
    comp: b.precedente?.duree_sec ? `${ecart(t.duree_sec, b.precedente.duree_sec)} par rapport ${sem ? "à la semaine précédente" : "au mois précédent"}` : null,
    tuiles: [[`${nombre(t.km, t.km < 100 ? 1 : 0)} km`, "parcourus"], [nombre(t.dplus_m, 0), "m de D+"], [String(t.nb), t.nb > 1 ? "séances" : "séance"]],
    barres: b.jours.map((j, i) => ({ v: j.futur ? 0 : j.min, label: sem ? JOURS[i] : "", fort: j.min === max && j.min > 0 })),
  };
}

export default function BilanPeriode({ type, refp, onRef, ouvrir, onSemaine }) {
  const { data: b, isLoading, isError } = useQuery({
    queryKey: ["bilan-periode", type, refp ?? null], queryFn: () => getBilanPeriode(type, refp ?? undefined),
    staleTime: 2 * 60_000, placeholderData: (prec) => (prec?.type === type ? prec : undefined),
  });
  if (isError) return <p className="text-[15px] text-label-2">Le bilan n'a pas pu être calculé. Réessaie dans un instant.</p>;
  if (isLoading || !b) return <Squelettes forme="page" n={2} label="Calcul du bilan" />;
  const s = b.sommeil;
  return (
    <>
      <nav aria-label="Période" className="flex items-center gap-2">
        <span className="no-print contents">
          <Fleche sens={-1} label="Période précédente" onClick={b.ref_precedente ? () => onRef(b.ref_precedente) : null} />
        </span>
        <h2 className="flex-1 text-center text-[17px] font-semibold flex items-center justify-center gap-1.5">
          {b.libelle} <Aide sujet="bilan_periode" className="no-print" />
        </h2>
        <span className="no-print contents">
          <Fleche sens={1} label="Période suivante" onClick={b.ref_suivante ? () => onRef(b.ref_suivante) : null} />
        </span>
      </nav>

      {b.totaux.nb === 0 ? (
        <Card><p className="text-[15px] text-label-2 text-center py-4">
          {b.futur ? "Cette période n'a pas commencé." : b.en_cours ? "Aucune séance pour l'instant." : "Aucune séance sur cette période."}
        </p></Card>
      ) : (
        <>
          <Heros b={b} />
          {b.phrase && <p className="px-1 text-[15px] leading-[21px]">{b.phrase}</p>}
          <Section titre="Par rapport à d'habitude"><Comparaison b={b} /></Section>
          <Section titre="Jour par jour"><Jours b={b} /></Section>
          {b.intensite && (
            <Section titre={<span className="flex items-center gap-1.5">Intensité <Aide sujet="bilan_intensite" className="no-print" /></span>}>
              <Intensite x={b.intensite} />
            </Section>
          )}
          {s && (
            <Section titre="Sommeil">
              <Card pad={false}>
                <Faits items={[
                  [hm(s.moyenne_h), `par nuit · ${s.nuits} nuit${s.nuits > 1 ? "s" : ""}`],
                  ...(s.precedente_h ? [[hm(s.precedente_h), b.type === "semaine" ? "semaine précédente" : "mois précédent"]] : []),
                  ...(s.courtes ? [[s.courtes, `nuit${s.courtes > 1 ? "s" : ""} de moins de 6 h 30`]] : []),
                ]} />
              </Card>
            </Section>
          )}
          {b.faits.length > 0 && (
            <Section titre="Faits marquants">
              <Card pad={false}>
                <div className="divide-y-[0.5px] divide-separateur">
                  {b.faits.map((f) => (
                    <Ligne key={f.cle} ico={f.ico} fond={f.record ? teinte(ORANGE) : "rgb(120 120 128 / 0.16)"}
                      titre={f.titre} badge={f.record ? "Record" : null} sous={f.sous} valeur={f.valeur} detail={f.detail}
                      onClick={f.activite_id ? () => ouvrir(f.activite_id) : f.ref_semaine ? () => onSemaine(f.ref_semaine) : undefined} />
                  ))}
                  {b.type === "mois" && <ExplorationMois mois={b.ref} />}
                </div>
              </Card>
            </Section>
          )}
          <Repartition sports={b.sports} precis />
          <Section titre="Séances">
            <Card pad={false}>
              <div className="divide-y-[0.5px] divide-separateur">
                {b.seances.map((a) => (
                  <Ligne key={a.id} ico={sportInfo(a.sport).emoji} fond={teinte(sportInfo(a.sport).couleur)}
                    titre={a.titre || sportInfo(a.sport).label}
                    sous={[fmtDate(a.date, { weekday: "short", day: "numeric", month: "short" }), a.type].filter(Boolean).join(" · ")}
                    valeur={a.distance_km >= 0.5 && sportInfo(a.sport).distance ? `${fmtDistance(a.distance_km, 1)}` : duree(a.duree_sec)}
                    detail={a.distance_km >= 0.5 && sportInfo(a.sport).distance ? duree(a.duree_sec) : null}
                    onClick={() => ouvrir(a.id)} />
                ))}
              </div>
            </Card>
          </Section>
          <Actions carte={() => carteImage(b)} nom={`bilan-${b.ref}.png`} titre={b.libelle} />
        </>
      )}
    </>
  );
}
