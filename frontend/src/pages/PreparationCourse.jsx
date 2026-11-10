import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Page from "../components/Page";
import Card from "../components/Card";
import { Section } from "../components/ui";
import { getPreparation, putPreparation } from "../api";
import { fmtDate, fmtAllureSec, nombre, inputCls, fmtDistance } from "../carnet";

// Préparation d'une course : compte à rebours, plan d'allure, météo du jour J,
// ravitaillement, check-list à cocher et étapes des deux dernières semaines.

const hms = (sec) => {
  if (sec == null) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
const plage = (p, unite) => (p && !p[1] ? "Aucun" : p ? (p[0] === p[1] ? `${p[0]} ${unite}` : `${p[0]}–${p[1]} ${unite}`) : "—");

const CIEL = [
  [[0], "☀️", "Ciel dégagé"], [[1, 2], "🌤️", "Peu nuageux"], [[3], "☁️", "Couvert"], [[45, 48], "🌫️", "Brouillard"],
  [[51, 53, 55, 56, 57], "🌦️", "Bruine"], [[61, 63, 65, 66, 67, 80, 81, 82], "🌧️", "Pluie"],
  [[71, 73, 75, 77, 85, 86], "🌨️", "Neige"], [[95, 96, 99], "⛈️", "Orage"],
];
const ciel = (code) => CIEL.find(([codes]) => codes.includes(code)) ?? [null, "🌡️", "Prévision"];

function Rebours({ jours }) {
  const texte = jours > 0 ? `J-${jours}` : jours === 0 ? "Jour J" : "Passée";
  return (
    <div className="shrink-0 w-[92px] h-[92px] rounded-full bg-ios-red text-white flex items-center justify-center">
      <span className={clsx("font-rounded font-bold chiffres", texte.length > 5 ? "text-[19px]" : "text-[26px]")}>{texte}</span>
    </div>
  );
}

function Profil({ profil }) {
  if (!profil || profil.length < 2) return null;
  const kmMax = profil[profil.length - 1][0] || 1;
  const alts = profil.map((p) => p[1]);
  const bas = Math.min(...alts);
  const haut = Math.max(...alts);
  const etendue = Math.max(1, haut - bas);
  const pts = profil.map(([km, alt]) => `${(km / kmMax) * 100},${38 - ((alt - bas) / etendue) * 34}`);
  return (
    <div className="mb-3">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-[70px] sm:h-[90px] text-ios-orange" role="img"
        aria-label={`Profil du parcours, de ${Math.round(bas)} à ${Math.round(haut)} mètres`}>
        <polygon points={`0,40 ${pts.join(" ")} 100,40`} fill="currentColor" opacity="0.18" />
        <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[11px] text-label-2 chiffres">
        <span>0 km · {Math.round(bas)} m</span><span>point haut {Math.round(haut)} m</span><span>{nombre(kmMax)} km</span>
      </div>
    </div>
  );
}

function Passages({ passages, parTroncon }) {
  const [tout, setTout] = useState(false);
  const visibles = tout ? passages : passages.slice(0, 8);
  return (
    <>
      <div className="chiffres">
        <div className="flex items-center gap-2 pb-1.5 text-[12px] font-semibold text-label-2">
          <span className="w-[64px]">Au km</span>
          <span className="flex-1">Allure</span>
          {parTroncon && <span className="w-[86px] text-right">Dénivelé</span>}
          <span className="w-[70px] text-right">Passage</span>
        </div>
        {visibles.map((p) => (
          <div key={p.km} className="flex items-center gap-2 py-2 border-t-[0.5px] border-separateur text-[15px]">
            <span className="w-[64px] font-semibold">{nombre(p.km)}</span>
            <span className="flex-1">{fmtAllureSec(p.allure_sec_km)}</span>
            {parTroncon && (
              <span className="w-[86px] text-right text-[13px] text-label-2">
                {p.dplus_m ? `+${Math.round(p.dplus_m)}` : ""}{p.dplus_m && p.dmoins_m ? " " : ""}{p.dmoins_m ? `−${Math.round(p.dmoins_m)}` : ""}{!p.dplus_m && !p.dmoins_m ? "plat" : " m"}
              </span>
            )}
            <span className="w-[70px] text-right font-semibold">{hms(p.cumul_sec)}</span>
          </div>
        ))}
      </div>
      {passages.length > 8 && (
        <button type="button" className="btn-texte mt-2 text-[15px]" onClick={() => setTout(!tout)}>
          {tout ? "Réduire" : `Voir les ${passages.length} passages`}
        </button>
      )}
    </>
  );
}

function Meteo({ d }) {
  const m = d.meteo;
  if (!m) {
    const texte = {
      trop_tot: "La prévision n’est fiable que deux semaines avant : elle apparaîtra ici automatiquement.",
      sans_lieu: "Lie un parcours à l’objectif (ou renseigne ton adresse dans le Profil) pour avoir la météo du départ.",
      passee: "La course est passée.",
      indisponible: "Prévision indisponible pour le moment.",
    }[d.meteo_etat] ?? "Prévision indisponible pour le moment.";
    return <p className="text-[15px] leading-5 text-label-2">{texte}</p>;
  }
  const [, picto, libelle] = ciel(m.code);
  const faits = [
    ["Ressenti", m.ressentie != null ? `${Math.round(m.ressentie)} °C` : "—"],
    ["Vent", m.vent_kmh != null ? `${Math.round(m.vent_kmh)} km/h` : "—", m.rafales_kmh ? `rafales ${Math.round(m.rafales_kmh)}` : null],
    ["Pluie", m.precipitation_mm != null ? `${nombre(m.precipitation_mm)} mm` : "—"],
    ["Humidité", m.humidite != null ? `${Math.round(m.humidite)} %` : "—"],
  ];
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="text-[40px] leading-none" aria-hidden>{picto}</span>
        <div>
          <p className="font-rounded text-[28px] font-bold leading-8 chiffres">{m.temperature != null ? `${Math.round(m.temperature)} °C` : "—"}</p>
          <p className="text-[14px] text-label-2">{libelle} · départ à {d.heure}{d.meteo_lieu ? ` · ${d.meteo_lieu}` : ""}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4 gap-2">
        {faits.map(([l, v, sous]) => (
          <div key={l} className="tuile px-3 py-2">
            <p className="text-[12px] font-semibold text-label-2">{l}</p>
            <p className="font-rounded text-[17px] font-bold chiffres">{v}</p>
            {sous && <p className="text-[12px] text-label-2 chiffres">{sous}</p>}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-label-2">Prévision sur la durée de la course, mise à jour à chaque ouverture.</p>
    </div>
  );
}

function Ravitaillement({ r }) {
  const faits = [
    ["Glucides", plage(r.glucides_g_h, "g/h"), r.glucides_total_g ? `${plage(r.glucides_total_g, "g")} au total` : null],
    ["Eau", plage(r.eau_ml_h, "ml/h"), r.eau_total_l ? `${plage(r.eau_total_l, "l")} au total` : null],
    r.sodium_mg_h ? ["Sodium", plage(r.sodium_mg_h, "mg/h"), null] : null,
    r.gels ? ["Gels", `${r.gels}`, "à emporter"] : null,
  ].filter(Boolean);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {faits.map(([l, v, sous]) => (
          <div key={l} className="tuile px-3 py-2">
            <p className="text-[12px] font-semibold text-label-2">{l}</p>
            <p className="font-rounded text-[17px] font-bold chiffres">{v}</p>
            {sous && <p className="text-[12px] text-label-2 chiffres">{sous}</p>}
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-[15px] leading-5 text-label-2">
        {[r.glucides_texte, r.prises, r.eau_texte, r.avant].filter(Boolean).map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}

function Case({ coche, label, onChange, onRetirer }) {
  return (
    <div className="flex items-start gap-1">
      <label className="flex-1 min-w-0 flex items-start gap-3 py-2 cursor-pointer">
        <input type="checkbox" className="sr-only peer" checked={coche} onChange={onChange} />
        <span aria-hidden className={clsx("mt-[1px] w-[22px] h-[22px] shrink-0 rounded-full border-2 flex items-center justify-center transition-colors peer-focus-visible:ring-2 ring-brand ring-offset-2",
          coche ? "bg-ios-green border-ios-green text-white" : "border-label-3")}>
          {coche && <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 12.5l4 4 8-9" /></svg>}
        </span>
        <span className={clsx("text-[15px] leading-5", coche && "text-label-2 line-through")}>{label}</span>
      </label>
      {onRetirer && (
        <button type="button" onClick={onRetirer} aria-label={`Retirer « ${label} »`} className="shrink-0 w-9 h-9 flex items-center justify-center text-label-2 hover:text-ios-red">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}
    </div>
  );
}

function Checklist({ d, enregistrer }) {
  const [ajout, setAjout] = useState("");
  const coches = new Set(d.coches);
  const idAjout = (t) => `perso:${t}`;
  const total = d.checklist.reduce((n, g) => n + g.elements.length, 0) + d.ajouts.length;
  const faits = d.checklist.reduce((n, g) => n + g.elements.filter((e) => coches.has(e.id)).length, 0)
    + d.ajouts.filter((a) => coches.has(idAjout(a))).length;

  const basculer = (id) => {
    const s = new Set(coches);
    if (s.has(id)) s.delete(id); else s.add(id);
    enregistrer({ coches: [...s] });
  };
  const ajouter = (e) => {
    e.preventDefault();
    const t = ajout.trim().slice(0, 80);
    if (!t || d.ajouts.includes(t)) return;
    enregistrer({ ajouts: [...d.ajouts, t] });
    setAjout("");
  };
  const retirer = (t) => enregistrer({ ajouts: d.ajouts.filter((a) => a !== t), coches: d.coches.filter((c) => c !== idAjout(t)) });

  return (
    <Card title="Check-list" action={<span className="text-[14px] font-semibold text-label-2 chiffres">{faits}/{total}</span>}>
      <div className="h-1.5 rounded-full bg-remplissage overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={faits} aria-label="Avancement de la check-list">
        <i className="block h-full rounded-full bg-ios-green transition-[width]" style={{ width: `${total ? (faits / total) * 100 : 0}%` }} />
      </div>
      <div className="mt-3 grid gap-x-8 gap-y-4 lg:grid-cols-2">
        {d.checklist.map((g) => (
          <div key={g.groupe}>
            <p className="text-[12px] font-semibold uppercase tracking-[0.02em] text-label-2">{g.groupe}</p>
            {g.elements.map((e) => <Case key={e.id} coche={coches.has(e.id)} label={e.label} onChange={() => basculer(e.id)} />)}
          </div>
        ))}
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.02em] text-label-2">Mes ajouts</p>
          {d.ajouts.map((a) => (
            <Case key={a} coche={coches.has(idAjout(a))} label={a} onChange={() => basculer(idAjout(a))} onRetirer={() => retirer(a)} />
          ))}
          {d.ajouts.length < 30 && (
            <form onSubmit={ajouter} className="mt-1.5 flex gap-2">
              <input className={clsx(inputCls, "flex-1 min-w-0")} value={ajout} onChange={(e) => setAjout(e.target.value)}
                maxLength={80} placeholder="Ajouter un élément" aria-label="Ajouter un élément à la check-list" />
              <button type="submit" className="btn-teinte shrink-0" disabled={!ajout.trim()}>Ajouter</button>
            </form>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function PreparationCourse() {
  const [params] = useSearchParams();
  const id = Number(params.get("id")) || null;
  const qc = useQueryClient();
  const cle = ["preparation", id];
  const { data: d, isLoading, isError } = useQuery({ queryKey: cle, queryFn: () => getPreparation(id), enabled: !!id, staleTime: 300000 });

  // Coches et ajouts : mise à jour immédiate à l'écran, puis enregistrement
  const cocher = useMutation({
    mutationFn: (payload) => putPreparation(id, payload),
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: cle });
      const avant = qc.getQueryData(cle);
      qc.setQueryData(cle, (v) => (v ? { ...v, ...payload } : v));
      return { avant };
    },
    onError: (_e, _p, ctx) => qc.setQueryData(cle, ctx?.avant),
  });
  // L'heure de départ change la météo : on recharge tout
  const heure = useMutation({
    mutationFn: (h) => putPreparation(id, { heure: h }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cle }),
  });

  const o = d?.objectif;
  return (
    <Page titre="Préparation" sousTitre={o?.titre ?? "Course"} large>
      {!id && <p className="card p-6 text-center text-[15px] text-label-2">Ouvre cette page depuis un objectif de course. <Link to="/objectifs" className="text-brand font-medium">Voir les objectifs</Link></p>}
      {isLoading && (
        <div className="space-y-4" aria-busy="true">
          <div className="card h-[130px] animate-pulse" />
          <div className="grid gap-4 lg:grid-cols-2"><div className="card h-[260px] animate-pulse" /><div className="card h-[260px] animate-pulse" /></div>
        </div>
      )}
      {isError && <p className="card p-6 text-center text-[15px] text-label-2">Préparation indisponible : l’objectif est introuvable ou le serveur ne répond pas.</p>}

      {d && (
        <>
          <Card>
            <div className="flex items-center gap-4">
              <Rebours jours={d.jours} />
              <div className="flex-1 min-w-0">
                <p className="text-[20px] font-bold leading-6 text-balance">{o.titre}</p>
                <p className="mt-1 text-[14px] text-label-2">
                  {o.date ? fmtDate(o.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Date à préciser"}
                  {o.distance_km ? ` · ${fmtDistance(o.distance_km)}` : ""}{o.dplus_m ? ` · ${nombre(o.dplus_m, 0)} m D+` : ""}
                </p>
                <label className="mt-2 inline-flex items-center gap-2 text-[14px] text-label-2">
                  Départ à
                  <input type="time" className={clsx(inputCls, "!w-[112px] !py-1.5 chiffres")} defaultValue={d.heure} key={d.heure}
                    onBlur={(e) => { const v = e.target.value; if (v && v !== d.heure) heure.mutate(v); }} />
                </label>
              </div>
            </div>
            {d.temps ? (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="tuile px-3 py-2.5 col-span-2 sm:col-span-1">
                  <p className="text-[12px] font-semibold text-label-2">{d.temps.source === "cible" ? "Temps visé" : "Temps prédit"}</p>
                  <p className="font-rounded text-[22px] font-bold chiffres leading-7">{d.temps.texte}</p>
                  {d.temps.allure_sec_km && <p className="text-[12px] text-label-2 chiffres">{fmtAllureSec(d.temps.allure_sec_km)} en moyenne</p>}
                </div>
                {d.fourchette && (d.temps.source === "cible"
                  ? [["visee", "Prédit aujourd’hui"], ["optimiste", "Si tout va bien"], ["prudente", "Prudent"]]
                  : [["optimiste", "Si tout va bien"], ["prudente", "Prudent"]]).map(([k, l]) => d.fourchette[k] && (
                  <div key={k} className={clsx("tuile px-3 py-2.5", k === "visee" && "col-span-2 sm:col-span-1")}>
                    <p className="text-[12px] font-semibold text-label-2">{l}</p>
                    <p className="font-rounded text-[17px] font-bold chiffres leading-7">{d.fourchette[k].texte}</p>
                    {k === "visee" && <p className="text-[12px] text-label-2">d’après tes séances récentes</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-[15px] leading-5 text-label-2">
                {d.prediction_raison ?? "Pas encore de temps visé."} Renseigne un temps cible et une distance dans l’objectif pour obtenir le plan d’allure et le ravitaillement chiffré.
              </p>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2 items-start">
            {d.passages?.length > 0 && (
              <Card title="Plan d’allure">
                <Profil profil={d.profil} />
                <Passages passages={d.passages} parTroncon={d.par_troncon} />
                <p className="mt-2 text-[12px] leading-4 text-label-2">
                  {d.par_troncon ? "Allures ajustées au relief du parcours lié : plus lent en montée, plus vite en descente."
                    : "Allure régulière : lie un parcours à l’objectif pour un plan ajusté au relief."}
                </p>
              </Card>
            )}
            <div className="space-y-4">
              <Card title="Météo du jour J"><Meteo d={d} /></Card>
              {d.ravitaillement && <Card title="Ravitaillement"><Ravitaillement r={d.ravitaillement} /></Card>}
            </div>
          </div>

          <Checklist d={d} enregistrer={(p) => cocher.mutate(p)} />

          {d.etapes.length > 0 && (
            <Section titre="Les deux dernières semaines">
              <div className="card py-0.5">
                {d.etapes.map((e) => (
                  <div key={e.j} className={clsx("ligne flex items-start gap-3 px-4 py-3", e.passee && "opacity-55")} style={{ "--inset": "4.25rem" }}>
                    <span className={clsx("mt-0.5 w-11 shrink-0 rounded-[8px] py-1 text-center text-[13px] font-bold chiffres",
                      e.aujourd_hui ? "bg-ios-red text-white" : "bg-remplissage text-label-2")}>{e.j ? `J-${e.j}` : "J"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-[16px] font-semibold">
                        {e.titre}
                        <span className="text-[13px] font-normal text-label-2">{fmtDate(e.date, { weekday: "short", day: "numeric", month: "short" })}{e.aujourd_hui ? " · aujourd’hui" : ""}</span>
                      </p>
                      <p className="mt-0.5 text-[14px] leading-[19px] text-label-2">{e.texte}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
