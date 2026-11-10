// Capacités : tests guidés (planification, reconnaissance, comparaison) et prédiction de course par tronçon.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import clsx from "clsx";
import Card from "./Card";
import { Chevron } from "./ui";
import { axeX, axeY, grille, GRIS } from "./graphiques";
import { Entete, Vide, Message, VERT, ORANGE, ROUGE, CYAN, BLEU, INDIGO } from "./Capacites";
import { planifierTest, supprimerPrevue, lierParcoursObjectif } from "../api";
import { fmtAllureSec, fmtDate, nombre, fmtDistance } from "../carnet";

const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const avecAn = (iso) => fmtDate(iso, { day: "numeric", month: "short", year: "2-digit" });
const isoPlus = (iso, j) => {
  const d = new Date(`${iso}T12:00`);
  d.setDate(d.getDate() + j);
  return d.toISOString().slice(0, 10);
};
const horloge = (sec) => {
  const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const duree = (sec) => {
  const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min ${String(s).padStart(2, "0")}`;
};

function useRafraichir() {
  const qc = useQueryClient();
  return () => ["analyses", "plan", "objectifs", "forme-jour"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

// ── 2.3 Tests guidés ───────────────────────────────────────────────────────
function Etat({ p }) {
  const [texte, couleur] = p.prochain
    ? [p.prochain.dans_j === 0 ? "Prévu aujourd'hui" : `Prévu le ${court(p.prochain.jour)}`, BLEU]
    : !p.dernier ? ["Jamais fait", GRIS]
      : p.a_refaire ? ["À refaire", ORANGE] : ["À jour", VERT];
  return (
    <span className="text-[12px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0" style={{ color: couleur }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: couleur }} />{texte}
    </span>
  );
}

const Ecart = ({ r }) => r?.ecart_texte ? (
  <span className="text-[12px] font-semibold chiffres whitespace-nowrap"
    style={{ color: r.mieux == null ? GRIS : r.mieux ? VERT : ROUGE }}>{r.ecart_texte}</span>
) : null;

function Protocole({ p, bornes }) {
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState(false);
  const [jour, setJour] = useState(() => isoPlus(bornes.min, 7));
  const rafraichir = useRafraichir();
  const planifier = useMutation({ mutationFn: () => planifierTest({ cle: p.cle, jour }), onSuccess: () => { setSaisie(false); rafraichir(); } });
  const annuler = useMutation({ mutationFn: () => supprimerPrevue(p.prochain.id), onSuccess: rafraichir });
  const d = p.dernier;
  return (
    <li className="tuile p-3 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-5">{p.titre}</p>
          <p className="text-[12px] text-label-2 leading-4">{p.sous_titre} · {p.duree_min} min en tout</p>
        </div>
        <Etat p={p} />
      </div>

      <div className="mt-2.5 min-h-[44px]">
        {d ? (
          <>
            <p className="flex items-baseline flex-wrap gap-x-2">
              <span className="font-rounded text-[20px] font-bold chiffres leading-6">{d.texte}</span>
              <Ecart r={d} />
            </p>
            <p className="text-[12px] text-label-2 leading-4">
              {avecAn(d.date)}{p.age_j != null && ` · il y a ${p.age_j} j`}{d.ecart_texte && " · écart avec le test précédent"}
            </p>
          </>
        ) : (
          <p className="text-[13px] text-label-2 leading-[18px]">{p.sert}</p>
        )}
      </div>

      {saisie ? (
        <div className="mt-2.5 space-y-2">
          <label className="block">
            <span className="text-[12px] font-medium text-label-2">Jour du test</span>
            <input type="date" className="champ w-full mt-1" value={jour} min={bornes.min} max={bornes.max}
              onChange={(e) => setJour(e.target.value || bornes.min)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn-primaire btn-sm flex-1" disabled={planifier.isPending} onClick={() => planifier.mutate()}>
              {planifier.isPending ? "Ajout…" : "Ajouter au plan"}
            </button>
            <button type="button" className="btn-gris btn-sm" onClick={() => setSaisie(false)}>Fermer</button>
          </div>
          {planifier.isError && <p className="text-[12px] text-ios-red">{planifier.error?.response?.data?.detail || "Impossible d'ajouter ce test."}</p>}
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {p.prochain ? (
            <>
              <Link to="/plan" className="btn-teinte btn-sm">Voir dans le plan</Link>
              <button type="button" className="btn-gris btn-sm" disabled={annuler.isPending} onClick={() => annuler.mutate()}>
                {annuler.isPending ? "Retrait…" : "Retirer"}
              </button>
            </>
          ) : (
            <button type="button" className="btn-teinte btn-sm" onClick={() => setSaisie(true)}>Planifier</button>
          )}
          <button type="button" className="btn-texte !text-[13px] ml-auto" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
            {ouvert ? "Masquer" : "Déroulé"}
            <span className={clsx("transition-transform", ouvert ? "-rotate-90" : "rotate-90")}><Chevron /></span>
          </button>
        </div>
      )}

      {ouvert && (
        <div className="mt-3 pt-3 border-t border-separateur space-y-3">
          {d && <p className="text-[13px] text-label-2 leading-[18px]">{p.sert}</p>}
          <ol className="space-y-1.5">
            {p.etapes.map((e, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-[18px]">
                <span className="w-[18px] h-[18px] rounded-full bg-brand/[0.12] text-brand text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="min-w-0">{e}</span>
              </li>
            ))}
          </ol>
          <p className="text-[12px] text-label-2 leading-4">{p.conseil} À refaire toutes les {Math.round(p.refaire_j / 7)} semaines environ.</p>
          {d?.detail && <Message>{d.detail}</Message>}
          {p.resultats.length > 1 && (
            <div>
              <p className="text-[12px] font-medium text-label-2 mb-1">Historique · {p.mesure}</p>
              <ul className="divide-y divide-separateur">
                {p.resultats.map((r) => (
                  <li key={r.date} className="flex items-baseline justify-between gap-2 py-1.5 text-[13px]">
                    <span className="text-label-2 whitespace-nowrap">{avecAn(r.date)}</span>
                    <span className="flex items-baseline gap-2 min-w-0 justify-end flex-wrap">
                      <Ecart r={r} />
                      <span className="font-semibold chiffres whitespace-nowrap">{r.texte}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function Tests({ t }) {
  if (!t?.protocoles?.length) return null;
  const faits = t.protocoles.filter((p) => p.dernier).length;
  return (
    <Card>
      <Entete titre="Tests guidés" couleur={INDIGO} aide="tests_guides"
        sousTitre={`${faits} test${faits > 1 ? "s" : ""} sur ${t.protocoles.length} déjà mesuré${faits > 1 ? "s" : ""} · reconnus tout seuls à la synchro`} />
      <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 items-start">
        {t.protocoles.map((p) => <Protocole key={p.cle} p={p} bornes={{ min: t.min_jour, max: t.max_jour }} />)}
      </ul>
      <p className="text-[12px] text-label-2 leading-4 mt-3">
        Un test planifié s'ajoute à ton plan. Une fois la séance faite et synchronisée, le résultat est calculé et comparé au précédent.
        Une séance dont le titre contient le nom du test est reconnue aussi.
      </p>
    </Card>
  );
}

// ── 2.4 Prédiction de course ───────────────────────────────────────────────
const NIVEAUX = [["optimiste", "Optimiste", "tout se passe bien", VERT], ["visee", "Visée", "le plus probable", BLEU],
  ["prudente", "Prudente", "jour sans, ou chaleur", ORANGE]];
const COULEURS_CLASSE = { m3: "#C93400", m2: ORANGE, m1: "#FFC266", p: GRIS, d1: "#8FD3F4", d2: CYAN, d3: "#0A7EA4" };

function BulleProfil({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="glass rounded-xl px-3 py-2 text-[12px]">
      <p className="font-semibold chiffres">km {nombre(d.km, 1)}</p>
      <p className="text-label-2 chiffres">{d.alt} m d'altitude</p>
    </div>
  );
}

function Profil({ o }) {
  const data = useMemo(() => o.profil.map(([km, alt]) => ({ km, alt })), [o.profil]);
  const alts = data.map((d) => d.alt);
  const bas = Math.floor((Math.min(...alts) - 20) / 50) * 50, haut = Math.ceil((Math.max(...alts) + 20) / 50) * 50;
  return (
    <div className="h-[150px] -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 0, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={`profil-${o.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BLEU} stopOpacity={0.35} /><stop offset="100%" stopColor={BLEU} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid {...grille} />
          <XAxis {...axeX} dataKey="km" type="number" domain={[0, "dataMax"]} tickCount={6} tickFormatter={(v) => `${nombre(v, 0)} km`} />
          <YAxis {...axeY} domain={[bas, haut]} tickCount={4} tickFormatter={(v) => `${v} m`} width={44} />
          <Tooltip content={<BulleProfil />} cursor={{ stroke: GRIS, strokeOpacity: 0.3 }} />
          {o.passages.slice(0, -1).map((p) => <ReferenceLine key={p.km} x={p.km} stroke={GRIS} strokeOpacity={0.25} strokeDasharray="2 3" />)}
          <Area type="monotone" dataKey="alt" stroke={BLEU} strokeWidth={1.8} fill={`url(#profil-${o.id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Repartition({ classes, coef }) {
  return (
    <div>
      <p className="text-[12px] font-medium text-label-2 mb-1.5">Où passe le temps</p>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-remplissage" role="img"
        aria-label={classes.map((c) => `${c.label} ${c.part_temps_pct} %`).join(", ")}>
        {classes.map((c) => <span key={c.cle} style={{ width: `${c.part_temps_pct}%`, background: COULEURS_CLASSE[c.cle] }} />)}
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2 gap-x-4 gap-y-1 mt-2">
        {classes.map((c) => (
          <li key={c.cle} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COULEURS_CLASSE[c.cle] }} />
              <span className="leading-4">{c.label}</span>
            </span>
            <span className="text-label-2 chiffres whitespace-nowrap">{nombre(c.km, 1)} km · {fmtAllureSec(Math.round(c.allure_sec_km * coef))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Passages({ o, coef }) {
  return (
    <div>
      <p className="text-[12px] font-medium text-label-2 mb-1">Tableau de passage</p>
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 sm:gap-x-5 text-[13px] chiffres">
        <div className="contents text-[11px] text-label-2 font-medium">
          <span className="pb-1">Km</span><span className="pb-1">Dénivelé</span><span className="pb-1 text-right">Allure</span><span className="pb-1 text-right">Passage</span>
        </div>
        {o.passages.map((p, i) => (
          <div key={p.km} className="contents">
            <span className={clsx("py-1.5 font-semibold border-t border-separateur", i === o.passages.length - 1 && "text-brand")}>{nombre(p.km, 1)}</span>
            <span className="py-1.5 border-t border-separateur text-label-2 whitespace-nowrap">
              <span style={{ color: p.dplus_m >= 20 ? ORANGE : undefined }}>+{p.dplus_m}</span>
              {" / "}
              <span style={{ color: p.dmoins_m >= 20 ? CYAN : undefined }}>−{p.dmoins_m}</span> m
            </span>
            <span className="py-1.5 border-t border-separateur text-right whitespace-nowrap">{fmtAllureSec(Math.round(p.allure_sec_km * coef)).replace("/km", "")}</span>
            <span className="py-1.5 border-t border-separateur text-right font-semibold whitespace-nowrap">{horloge(p.cumul_sec * coef)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Prediction({ p }) {
  const [choisi, setChoisi] = useState(null);
  const [niveau, setNiveau] = useState("visee");
  const [details, setDetails] = useState(false);
  const rafraichir = useRafraichir();
  const lier = useMutation({ mutationFn: ({ id, itineraire_id }) => lierParcoursObjectif(id, itineraire_id), onSuccess: rafraichir });
  if (!p) return null;
  if (!p.objectifs.length) {
    return (
      <Card>
        <Entete titre="Prédiction de course" couleur={BLEU} aide="prediction_course" />
        <Vide>Ajoute une course à venir dans tes <Link to="/objectifs" className="text-brand">objectifs</Link> pour obtenir un temps estimé et un tableau de passage.</Vide>
      </Card>
    );
  }
  const o = p.objectifs.find((x) => String(x.id) === String(choisi)) || p.objectifs[0];
  const coef = o.coefs?.[niveau] ?? 1;
  return (
    <Card>
      <Entete titre="Prédiction de course" couleur={BLEU} aide="prediction_course"
        sousTitre={`${o.titre} · ${fmtDate(o.date)}${o.jours != null ? ` · dans ${o.jours} j` : ""}`} />
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-5">
        <div className="lg:col-span-2 min-w-0 space-y-3">
          {p.objectifs.length > 1 && (
            <label className="block">
              <span className="text-[12px] font-medium text-label-2">Course</span>
              <select className="champ w-full mt-1" value={o.id} onChange={(e) => setChoisi(e.target.value)}>
                {p.objectifs.map((x) => <option key={x.id} value={x.id}>{x.titre} · {court(x.date)}</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-[12px] font-medium text-label-2">Parcours</span>
            <select className="champ w-full mt-1" value={o.itineraire_id ?? ""} disabled={lier.isPending}
              onChange={(e) => lier.mutate({ id: o.id, itineraire_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Sans tracé</option>
              {p.parcours.map((f) => <option key={f.id} value={f.id}>{f.nom} · {fmtDistance(f.distance_km, 1)}, {f.dplus_m} m D+</option>)}
            </select>
            <span className="block text-[12px] text-label-2 leading-4 mt-1.5">
              {lier.isPending ? "Calcul en cours…" : (
                <>Le tracé donne l'estimation par tronçon. <Link to="/itineraires/creer" className="text-brand whitespace-nowrap">Importer un GPX</Link></>
              )}
            </span>
          </label>

          {o.disponible ? (
            <>
              <ul className="space-y-1.5">
                {NIVEAUX.map(([cle, nom, quand, couleur]) => {
                  const t = o.temps[cle], actif = cle === niveau;
                  return (
                    <li key={cle}>
                      <button type="button" onClick={() => setNiveau(cle)} aria-pressed={actif}
                        className={clsx("w-full text-left rounded-xl px-3 py-2 transition-colors flex items-center justify-between gap-3",
                          actif ? "bg-brand/[0.10] ring-1 ring-brand/40" : "bg-remplissage")}>
                        <span className="min-w-0">
                          <span className="text-[13px] font-semibold flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: couleur }} />{nom}
                          </span>
                          <span className="text-[12px] text-label-2 block leading-4">{quand}</span>
                        </span>
                        <span className="text-right shrink-0">
                          <span className={clsx("font-rounded font-bold chiffres block leading-6", actif ? "text-[20px]" : "text-[17px]")}>{t.texte}</span>
                          <span className="text-[12px] text-label-2 chiffres block leading-4">{t.allure}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[12px] text-label-2 chiffres leading-4">
                {fmtDistance(o.distance_km, 1)} · {o.dplus_m} m D+{o.parcours?.dmoins_m != null && ` · ${o.parcours.dmoins_m} m D−`} · équivaut à {nombre(o.km_effort, 1)} km à plat
              </p>
              {o.cible_lecture && (
                <Message ton={o.cible_ecart_sec >= 0 ? "bien" : o.cible_sec < o.temps.optimiste.sec ? "alerte" : ""}>
                  Ton objectif de {o.cible_texte} est {o.cible_lecture}.
                </Message>
              )}
            </>
          ) : (
            <Message>{o.raison}</Message>
          )}
          {o.alertes.map((a, i) => <Message key={i} ton="alerte">{a}</Message>)}
          {o.hypotheses.length > 0 && (
            <div>
              <button type="button" className="btn-texte !text-[13px]" aria-expanded={details} onClick={() => setDetails(!details)}>
                {details ? "Masquer le calcul" : "Comment c'est calculé"}
                <span className={clsx("transition-transform", details ? "-rotate-90" : "rotate-90")}><Chevron /></span>
              </button>
              {details && (
                <ul className="mt-1.5 space-y-1 text-[12px] text-label-2 leading-4 list-disc pl-4">
                  {o.hypotheses.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-3 min-w-0 space-y-4">
          {o.disponible && o.passages.length > 0 ? (
            <>
              <div>
                <p className="text-[12px] font-medium text-label-2 mb-1">Profil · {o.parcours.nom}</p>
                <Profil o={o} />
              </div>
              <Passages o={o} coef={coef} />
              <p className="text-[12px] text-label-2 leading-4 -mt-2">
                Estimation {NIVEAUX.find((n) => n[0] === niveau)[1].toLowerCase()} : arrivée en {duree(o.temps[niveau].sec)}. Les allures tiennent compte de la pente de chaque tronçon.
              </p>
              <Repartition classes={o.classes} coef={coef} />
            </>
          ) : (
            <div className="tuile p-4 h-full flex flex-col justify-center gap-1.5">
              <p className="text-[15px] font-semibold">Pas encore de tableau de passage</p>
              <p className="text-[13px] text-label-2 leading-[18px]">
                Lie le tracé de la course pour obtenir l'allure à tenir tronçon par tronçon, montée par montée. Trace-le ou importe son GPX dans
                {" "}<Link to="/itineraires/creer" className="text-brand">Créer un parcours</Link>, enregistre-le, puis choisis-le ici.
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
