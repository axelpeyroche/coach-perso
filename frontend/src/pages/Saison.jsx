import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Page from "../components/Page";
import Card from "../components/Card";
import { Section, Chevron } from "../components/ui";
import { Legende } from "../components/graphiques";
import { PastilleTon } from "./Alertes";
import { getSaison } from "../api";
import { fmtDate, nombre } from "../carnet";

// Vue de la saison : les semaines jusqu'à la course, découpées en phases,
// avec la charge réalisée contre la charge prévue et les semaines allégées.

const COULEURS = {
  base: "#007AFF", specifique: "#FF9500", affutage: "#AF52DE", course: "#FF3B30",
  recuperation: "#34C759", entretien: "#8E8E93",
};
const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const dimanche = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
};

function Frise({ semaines, phases, choisie, onChoisir }) {
  const max = Math.max(1, ...semaines.map((s) => Math.max(s.charge ?? 0, s.charge_prevue ?? 0)));
  const ctls = semaines.map((s) => s.ctl).filter((v) => v != null);
  const ctlMax = Math.max(1, ...ctls) * 1.15;
  const n = semaines.length;
  // Courbe de forme : un point au centre de chaque colonne
  const points = semaines.map((s, i) => (s.ctl != null ? `${((i + 0.5) / n) * 100},${100 - (s.ctl / ctlMax) * 100}` : null)).filter(Boolean);
  const large = n > 26;

  return (
    <div className={clsx(large && "overflow-x-auto scrollbar-hide -mx-4 px-4")}>
      <div style={large ? { minWidth: n * 22 } : undefined}>
        {/* Bandeau des phases */}
        <div className="flex gap-[2px]">
          {phases.map((p) => (
            <div key={p.debut} className="min-w-0 rounded-[6px] px-1.5 py-1 text-[11px] sm:text-[12px] font-semibold text-white truncate text-center"
              style={{ flex: `${p.semaines} 1 0`, background: COULEURS[p.cle] }} title={`${p.label} · ${p.semaines} sem.`}>
              {p.semaines >= 2 ? p.label : ""}
            </div>
          ))}
        </div>

        {/* Barres : prévu en fond, réalisé devant */}
        <div className="relative mt-3 h-[150px] sm:h-[190px]">
          <div className="absolute inset-0 flex items-end gap-[2px] sm:gap-1">
            {semaines.map((s) => {
              const c = COULEURS[s.phase];
              const active = s.lundi === choisie;
              return (
                <button key={s.lundi} type="button" onClick={() => onChoisir(s.lundi)}
                  aria-label={`Semaine du ${court(s.lundi)}${s.charge != null ? `, charge ${s.charge}` : ""}${s.charge_prevue != null ? `, prévue ${s.charge_prevue}` : ""}`}
                  aria-pressed={active}
                  className={clsx("relative flex-1 min-w-0 h-full rounded-[6px] transition-colors", active ? "bg-remplissage" : "hover:bg-remplissage/50")}>
                  {s.charge_prevue != null && (
                    <i className="absolute inset-x-[12%] bottom-0 rounded-t-[4px] border border-b-0 border-dashed"
                      style={{ height: `${(s.charge_prevue / max) * 100}%`, borderColor: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }} />
                  )}
                  {s.charge != null && s.charge > 0 && (
                    <i className="absolute inset-x-[12%] bottom-0 rounded-t-[4px]"
                      style={{ height: `${Math.max(2, (s.charge / max) * 100)}%`, background: c, opacity: s.courante ? 0.75 : 1 }} />
                  )}
                  {s.courses.length > 0 && <span className="absolute top-0 inset-x-0 text-center text-[13px] leading-none" aria-hidden>🏁</span>}
                </button>
              );
            })}
          </div>
          {points.length > 1 && (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
              <polyline points={points.join(" ")} fill="none" stroke="currentColor" className="text-label" strokeWidth="2"
                vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          )}
        </div>

        {/* Repères sous les barres : semaine en cours, décharges */}
        <div className="mt-1 flex gap-[2px] sm:gap-1 h-4">
          {semaines.map((s) => (
            <span key={s.lundi} className="flex-1 min-w-0 text-center text-[10px] leading-4 font-semibold text-label-2">
              {s.courante ? <i className="inline-block w-1.5 h-1.5 rounded-full bg-label align-middle" title="Semaine en cours" />
                : s.decharge ? <span title="Semaine allégée">↓</span> : ""}
            </span>
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-label-2 chiffres">
          <span>{court(semaines[0].lundi)}</span>
          <span>{court(dimanche(semaines[n - 1].lundi))}</span>
        </div>
      </div>
    </div>
  );
}

function DetailSemaine({ s }) {
  const faits = [
    ["Charge", s.charge != null ? nombre(s.charge, 0) : "—", s.charge_prevue != null ? `prévue ${nombre(s.charge_prevue, 0)}` : null],
    ["Durée", s.duree_h != null ? `${nombre(s.duree_h)} h` : "—", null],
    ["Distance", s.distance_km != null ? `${nombre(s.distance_km, 0)} km` : "—", s.dplus_m ? `${nombre(s.dplus_m, 0)} m D+` : null],
    ["Séances", s.seances != null ? s.seances : "—", s.seances_prevues ? `${s.seances_faites}/${s.seances_prevues} du plan` : null],
    ["Forme (CTL)", s.ctl != null ? nombre(s.ctl, 0) : "—", null],
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-[17px] font-semibold">Semaine du {court(s.lundi)} au {court(dimanche(s.lundi))}</p>
        <span className="badge text-white" style={{ background: COULEURS[s.phase] }}>{s.phase_label}</span>
        {s.courante && <span className="badge bg-remplissage text-label-2">en cours</span>}
        {s.decharge && <span className="badge bg-ios-green/[0.16] text-ios-green">allégée</span>}
        {s.avant_course != null && s.avant_course > 0 && <span className="text-[13px] text-label-2">S-{s.avant_course}</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {faits.map(([l, v, sous]) => (
          <div key={l} className="tuile px-3 py-2.5">
            <p className="text-[12px] font-semibold text-label-2">{l}</p>
            <p className="font-rounded text-[20px] font-bold chiffres leading-6">{v}</p>
            {sous && <p className="text-[12px] text-label-2 chiffres">{sous}</p>}
          </div>
        ))}
      </div>
      {s.courses.map((c) => (
        <p key={c.id} className="mt-3 text-[15px]">🏁 <span className="font-semibold">{c.titre}</span> · {fmtDate(c.date, { weekday: "long", day: "numeric", month: "long" })}</p>
      ))}
      {!s.passee && !s.courante && s.charge_prevue == null && (
        <p className="mt-3 text-[14px] text-label-2">Pas encore de séances prévues pour cette semaine.</p>
      )}
    </div>
  );
}

export default function Saison() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["saison"], queryFn: getSaison, staleTime: 300000 });
  const [choisie, setChoisie] = useState(null);

  const semaines = data?.semaines ?? [];
  const labels = Object.fromEntries((data?.phases ?? []).map((p) => [p.cle, p.label]));
  const lundi = choisie ?? semaines.find((s) => s.courante)?.lundi ?? semaines[0]?.lundi;
  const sem = semaines.find((s) => s.lundi === lundi);
  const o = data?.objectif;

  return (
    <Page titre="Saison" sousTitre={o ? `${o.semaines} semaine${o.semaines > 1 ? "s" : ""} avant la course` : "Vue d’ensemble"} large
      action={<Link to="/objectifs" className="btn-texte">Objectifs</Link>}>
      {isLoading && (
        <div className="space-y-4" aria-busy="true">
          <div className="card h-[120px] animate-pulse" />
          <div className="card h-[320px] animate-pulse" />
        </div>
      )}
      {isError && <p className="card p-6 text-center text-[15px] text-label-2">Vue de la saison indisponible pour le moment.</p>}

      {data && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              {o ? (
                <div className="flex items-center gap-4">
                  <div className="shrink-0 w-[84px] h-[84px] rounded-full flex flex-col items-center justify-center text-white" style={{ background: COULEURS.course }}>
                    <span className="font-rounded text-[26px] font-bold leading-7 chiffres">J-{o.jours}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.02em] text-label-2">Objectif</p>
                    <p className="text-[20px] font-bold leading-6 text-balance">{o.titre}</p>
                    <p className="mt-1 text-[14px] text-label-2">
                      {fmtDate(o.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                      {o.distance_km ? ` · ${nombre(o.distance_km)} km` : ""}{o.dplus_m ? ` · ${nombre(o.dplus_m, 0)} m D+` : ""}
                    </p>
                    <Link to={`/objectifs/preparation?id=${o.id}`} className="mt-1.5 inline-flex items-center gap-1 text-[15px] font-medium text-brand">
                      Préparer la course <Chevron />
                    </Link>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-[17px] font-semibold">Aucune course en vue</p>
                  <p className="mt-1 text-[15px] leading-5 text-label-2">
                    Ajoute un objectif de type course avec une date : la saison sera découpée en base, spécifique et affûtage.
                  </p>
                  <Link to="/objectifs" className="btn-teinte mt-3 inline-flex">Ajouter un objectif</Link>
                </div>
              )}
            </Card>
            <Card>
              <p className="text-[12px] font-semibold uppercase tracking-[0.02em] text-label-2">Phase en cours</p>
              <p className="mt-0.5 flex items-center gap-2 text-[20px] font-bold">
                <i className="w-3 h-3 rounded-full" style={{ background: COULEURS[data.phase.cle] }} />{data.phase.label}
              </p>
              <p className="mt-1 text-[15px] leading-5 text-label-2">{data.phase.texte}</p>
              {(data.repere.charge_moy_4s != null || data.repere.semaines_pleines > 0) && (
                <p className="mt-2 text-[13px] text-label-2 chiffres">
                  {data.repere.charge_moy_4s != null && <>Charge moyenne sur 4 semaines : <b className="text-label">{nombre(data.repere.charge_moy_4s, 0)}</b></>}
                  {data.repere.semaines_pleines > 0 && <> · {data.repere.semaines_pleines} semaine{data.repere.semaines_pleines > 1 ? "s" : ""} pleine{data.repere.semaines_pleines > 1 ? "s" : ""} d’affilée</>}
                </p>
              )}
            </Card>
          </div>

          {data.conseils.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              {data.conseils.map((c) => (
                <div key={c.titre} className="card p-4 flex items-start gap-3">
                  {c.ton === "attention" ? <PastilleTon ton="attention" />
                    : <span aria-hidden className="w-9 h-9 shrink-0 rounded-full bg-brand/[0.14] text-brand flex items-center justify-center text-[17px] font-bold">i</span>}
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold leading-5">{c.titre}</p>
                    <p className="mt-0.5 text-[15px] leading-5 text-label-2">{c.texte}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {semaines.length > 0 && (
            <Card title="Les semaines">
              <Frise semaines={semaines} phases={data.phases} choisie={lundi} onChoisir={setChoisie} />
              <div className="mt-3">
                <Legende items={[
                  { label: "Charge réalisée", couleur: COULEURS[data.phase.cle] },
                  { label: "Charge prévue", couleur: `color-mix(in srgb, ${COULEURS[data.phase.cle]} 35%, transparent)` },
                  { label: "Forme (CTL)", couleur: "currentColor", ligne: true },
                ]} />
                <p className="mt-1.5 text-[12px] leading-4 text-label-2">↓ semaine allégée · ● semaine en cours · 🏁 course. Touche une semaine pour son détail.</p>
              </div>
              {sem && (
                <div className="mt-4 pt-4 border-t-[0.5px] border-separateur">
                  <DetailSemaine s={{ ...sem, phase_label: labels[sem.phase] ?? sem.phase }} />
                </div>
              )}
              {data.tronquee && <p className="mt-3 text-[13px] text-label-2">La course est encore loin : seules les semaines les plus proches sont affichées.</p>}
            </Card>
          )}

          <Section titre="Les phases">
            <div className="card py-0.5">
              {data.phases.map((p) => (
                <div key={p.debut} className="ligne flex items-start gap-3 px-4 py-3" style={{ "--inset": "2.5rem" }}>
                  <i className="mt-1.5 w-3 h-3 shrink-0 rounded-full" style={{ background: COULEURS[p.cle] }} />
                  <div className="flex-1 min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[16px] font-semibold">
                      {p.label}
                      <span className="text-[13px] font-normal text-label-2 chiffres">
                        {court(p.debut)} → {court(dimanche(p.fin))} · {p.semaines} sem.
                      </span>
                    </p>
                    <p className="mt-0.5 text-[14px] leading-[19px] text-label-2">{p.texte}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {data.autres.length > 0 && (
            <Section titre="Autres courses">
              <div className="card py-0.5">
                {data.autres.map((a) => (
                  <Link key={a.id} to={`/objectifs/preparation?id=${a.id}`} className="ligne flex items-center gap-3 px-4 py-3" style={{ "--inset": "1rem" }}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[16px] font-semibold truncate">{a.titre}</span>
                      <span className="block text-[13px] text-label-2">{fmtDate(a.date, { day: "numeric", month: "long", year: "numeric" })}</span>
                    </span>
                    <span className="font-rounded text-[15px] font-semibold text-label-2 chiffres">J-{a.jours}</span>
                    <Chevron />
                  </Link>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
