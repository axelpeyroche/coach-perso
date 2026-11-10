// Capacités : « Mon profil d'athlète » (chaque repère avec sa tendance, ce sur quoi il repose et sa fraîcheur),
// radar forces / faiblesses comparé à soi-même il y a un an, et la musculation suivie comme une discipline.
import { useState } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import clsx from "clsx";
import Card from "./Card";
import Aide from "./Aide";
import { Chevron } from "./ui";
import { axeX, axeY, grille, curseur, InfoBulle, Legende, GRIS } from "./graphiques";
import { fmtDate, nombre } from "../carnet";

export const VIOLET = "#AF52DE";
export const INDIGO = "#5856D6";
export const VERT = "#34C759";
export const ORANGE = "#FF9500";
export const ROUGE = "#FF3B30";
export const CYAN = "#32ADE6";
export const BLEU = "#007AFF";

const court = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const nb = (v) => (v == null ? "—" : nombre(v, Number.isInteger(v) ? 0 : 1));

export function Entete({ titre, couleur, sousTitre, aide, action }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold flex items-center gap-1" style={{ color: couleur }}>
          <span>{titre}</span><Aide sujet={aide} />
        </p>
        {sousTitre && <p className="text-[13px] text-label-2">{sousTitre}</p>}
      </div>
      {action}
    </div>
  );
}

export function Tuile({ label, value, sub }) {
  return (
    <div className="tuile px-3 py-2.5 min-w-0">
      <p className="text-[12px] text-label-2 leading-4">{label}</p>
      <p className="font-rounded text-[17px] font-bold chiffres">{value}</p>
      {sub && <p className="text-[11px] text-label-2 leading-[14px]">{sub}</p>}
    </div>
  );
}

export const Vide = ({ children }) => <p className="text-[15px] text-label-2">{children}</p>;
export const Message = ({ children, ton }) => (
  <p className={clsx("rounded-xl px-3 py-2 text-[13px] leading-[18px]",
    ton === "alerte" ? "bg-ios-orange/[0.12] text-ios-orange" : ton === "bien" ? "bg-ios-green/[0.12] text-ios-green" : "bg-remplissage text-label-2")}>
    {children}
  </p>
);

// ── 2.1 / 2.2 Profil d'athlète ────────────────────────────────────────────
const CONFIANCES = {
  haute: { label: "Fiable", couleur: VERT },
  moyenne: { label: "Moyenne", couleur: ORANGE },
  faible: { label: "Fragile", couleur: ROUGE },
};

function Confiance({ f }) {
  if (f.texte == null) return <span className="text-[11px] font-medium text-label-3 shrink-0">À mesurer</span>;
  const c = f.frais ? CONFIANCES[f.confiance] : { label: "Ancienne", couleur: GRIS };
  return (
    <span className="flex items-center gap-1 text-[11px] font-medium shrink-0" style={{ color: c.couleur }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.couleur }} />{c.label}
    </span>
  );
}

function Tendance({ t }) {
  if (!t) return null;
  const fleche = t.sens === "hausse" ? "↗" : t.sens === "baisse" ? "↘" : "→";
  return (
    <span className={clsx("text-[12px] font-semibold chiffres whitespace-nowrap",
      t.bon === true ? "text-ios-green" : t.bon === false ? "text-ios-orange" : "text-label-2")}
      title="Évolution sur 3 mois">
      {fleche} {t.sens === "stable" ? "stable" : t.texte}
    </span>
  );
}

function Fiche({ f }) {
  const connue = f.texte != null;
  const contenu = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-label-2">{f.label}</p>
        <Confiance f={f} />
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2 flex-wrap">
        <p className={clsx("font-rounded font-bold chiffres leading-7", !connue ? "text-[22px] text-label-3" : f.frais ? "text-[24px]" : "text-[24px] text-label-2 opacity-70")}>
          {connue ? f.texte : "—"}
          {connue && <span className="text-[13px] font-semibold text-label-2 ml-1">{f.unite}</span>}
        </p>
        <Tendance t={f.tendance} />
      </div>
      {f.detail && <p className="text-[12px] text-label leading-4 mt-0.5">{f.detail}</p>}
      <p className="text-[11px] text-label-2 leading-[15px] mt-1">{connue ? `Repose sur ${f.base}.` : f.raison}</p>
    </>
  );
  const cls = "tuile block px-3 py-2.5 min-w-0 text-left";
  return f.ancre
    ? <Link to={`/analyses#${f.ancre}`} className={clsx(cls, "transition-opacity active:opacity-60 hover:opacity-80")}>{contenu}</Link>
    : <div className={cls}>{contenu}</div>;
}

export function ProfilAthlete({ p }) {
  if (!p) return null;
  const b = p.bilan;
  return (
    <Card>
      <Entete titre="Mon profil d'athlète" couleur={INDIGO} aide="profil_athlete"
        sousTitre={`${b.connues} repères sur ${b.total} · ${pluriel(b.fiables, "fiable")}${b.a_rafraichir ? ` · ${b.a_rafraichir} à rafraîchir` : ""}`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
        {p.fiches.map((f) => <Fiche key={f.cle} f={f} />)}
      </div>
      {p.tests.length > 0 && (
        <div className="mt-3">
          <p className="text-[13px] font-semibold flex items-center gap-1">Tests conseillés<Aide sujet="confiance" /></p>
          <ul className="mt-1.5 grid grid-cols-1 md:grid-cols-2 gap-2">
            {p.tests.map((t) => (
              <li key={t.cle} className="rounded-xl bg-ios-orange/[0.10] px-3 py-2">
                <p className="text-[14px] font-semibold">{t.label}</p>
                <p className="text-[12px] text-label-2 leading-4">{t.raison}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ── Radar forces / faiblesses ─────────────────────────────────────────────
const PLANCHER = 25;       // le centre du radar vaut 25 % du record
const RAYON = 84;
const CX = 160, CY = 128;

function point(i, n, pct) {
  const a = (-90 + (360 / n) * i) * (Math.PI / 180);
  const r = (Math.max(0, Math.min(100, pct) - PLANCHER) / (100 - PLANCHER)) * RAYON;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function RadarSvg({ axes, compare }) {
  const n = axes.length;
  const anneau = (pct) => axes.map((_, i) => point(i, n, pct).join(",")).join(" ");
  const trace = (cle) => axes.map((x, i) => (x[cle] == null ? null : point(i, n, x[cle]).join(","))).filter(Boolean).join(" ");
  const nbAn = axes.filter((x) => x.an != null).length;
  return (
    <svg viewBox="0 0 320 256" className="w-full h-auto max-w-[380px] mx-auto select-none" role="img"
      aria-label={`Radar des qualités, en pourcentage du record personnel : ${axes.map((x) => `${x.label} ${x.actuel ?? "non mesuré"}`).join(", ")}`}>
      {[50, 75, 100].map((pct) => (
        <polygon key={pct} points={anneau(pct)} fill="none" stroke={GRIS} strokeOpacity={pct === 100 ? 0.45 : 0.22} strokeWidth={1} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, n, 100);
        return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke={GRIS} strokeOpacity={0.18} strokeWidth={1} />;
      })}
      {[50, 75].map((pct) => {
        const [x, y] = point(0, n, pct);
        return <text key={pct} x={x + 3} y={y + 3} fontSize={8} fill={GRIS}>{pct} %</text>;
      })}
      {compare && nbAn >= 3 && (
        <polygon points={trace("an")} fill={GRIS} fillOpacity={0.1} stroke={GRIS} strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />
      )}
      <polygon points={trace("actuel")} fill={INDIGO} fillOpacity={0.2} stroke={INDIGO} strokeWidth={2} strokeLinejoin="round" />
      {axes.map((x, i) => {
        if (x.actuel == null) return null;
        const [px, py] = point(i, n, x.actuel);
        return <circle key={x.cle} cx={px} cy={py} r={3} fill={INDIGO} />;
      })}
      {axes.map((x, i) => {
        const a = (-90 + (360 / n) * i) * (Math.PI / 180);
        const lx = CX + (RAYON + 12) * Math.cos(a), ly = CY + (RAYON + 12) * Math.sin(a);
        const ancre = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
        const dy = Math.sin(a) < -0.5 ? -12 : Math.sin(a) > 0.5 ? 8 : -2;
        return (
          <g key={x.cle} textAnchor={ancre}>
            <text x={lx} y={ly + dy} fontSize={11} className="fill-label-2">{x.label}</text>
            <text x={lx} y={ly + dy + 13} fontSize={12} fontWeight={700} className="fill-label">{x.actuel != null ? `${x.actuel} %` : "—"}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function RadarProfil({ r }) {
  if (!r) return null;
  const mesures = r.axes.filter((x) => x.actuel != null);
  const nom = (cle) => r.axes.find((x) => x.cle === cle)?.label.toLowerCase();
  if (mesures.length < 3) {
    return (
      <Card>
        <Entete titre="Forces et faiblesses" couleur={INDIGO} aide="radar_profil" />
        <Vide>Il faut des sorties avec tracé GPS sur les 3 derniers mois pour dessiner ton radar.</Vide>
      </Card>
    );
  }
  const fort = r.axes.find((x) => x.cle === r.fort), faible = r.axes.find((x) => x.cle === r.faible);
  return (
    <Card>
      <Entete titre="Forces et faiblesses" couleur={INDIGO} aide="radar_profil"
        sousTitre="Tes 3 derniers mois, en % de tes records" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 items-center">
        <div>
          <RadarSvg axes={r.axes} compare={r.compare} />
          <Legende items={[{ label: "3 derniers mois", couleur: INDIGO }, ...(r.compare ? [{ label: "Il y a un an", couleur: GRIS }] : [])]} />
        </div>
        <div className="min-w-0">
          <ul className="divide-y divide-separateur">
            {r.axes.map((x) => {
              const ecart = x.actuel != null && x.an != null ? x.actuel - x.an : null;
              return (
                <li key={x.cle} className="py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium">{x.label}</p>
                    <p className="text-[12px] text-label-2 leading-4">{x.detail ?? "pas d'effort récent"}</p>
                  </div>
                  <div className="w-16 sm:w-24 h-1.5 rounded-full bg-remplissage overflow-hidden shrink-0" aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${x.actuel ?? 0}%`, background: INDIGO }} />
                  </div>
                  <div className="w-[68px] text-right shrink-0">
                    <p className="text-[14px] font-semibold chiffres">{x.actuel != null ? `${x.actuel} %` : "—"}</p>
                    {ecart != null && (
                      <p className={clsx("text-[11px] chiffres", ecart >= 2 ? "text-ios-green" : ecart <= -2 ? "text-ios-orange" : "text-label-2")}>
                        {ecart > 0 ? "+" : ecart < 0 ? "−" : ""}{Math.abs(ecart)} pt / 1 an
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {fort && (
          <Message>
            Point fort : <strong className="text-label">{fort.label.toLowerCase()}</strong> ({fort.actuel} % de ton record)
            {faible && <> · à travailler : <strong className="text-label">{faible.label.toLowerCase()}</strong> ({faible.actuel} %)</>}.
          </Message>
        )}
        {r.compare && (r.mieux.length > 0 || r.moins.length > 0) && (
          <Message ton={r.moins.length > r.mieux.length ? "alerte" : "bien"}>
            Par rapport à l'an dernier à la même époque
            {r.mieux.length > 0 && <> : mieux en {r.mieux.map(nom).join(", ")}</>}
            {r.moins.length > 0 && <>{r.mieux.length > 0 ? " ;" : " :"} en retrait en {r.moins.map(nom).join(", ")}</>}.
          </Message>
        )}
      </div>
    </Card>
  );
}

// ── 2.7 Musculation ───────────────────────────────────────────────────────
// Mannequin : formes dessinées sur la moitié gauche (x < 60) et reflétées.
const R = (x, y, w, h, rx = 5) => ({ t: "rect", x, y, w, h, rx });
const E = (cx, cy, rx, ry) => ({ t: "ellipse", cx, cy, rx, ry });
const NEUTRES = [E(60, 18, 13, 14), R(54, 32, 12, 9, 3), E(28.5, 89, 6, 5.5), R(20.5, 95, 11, 25, 5.5), E(25, 128, 5.5, 7.5),
  E(49, 172, 8, 7), R(41.5, 237, 14, 13, 6)];
const MUSCLES = {
  face: {
    epaules: [E(35, 49, 10, 7.5)], pectoraux: [R(46, 43, 13.5, 21, 6)], biceps: [R(24, 57, 11.5, 26, 5.5)],
    abdos: [R(47, 66, 13, 36, 5)], quadriceps: [R(40.5, 106, 19, 58, 8)],
  },
  dos: {
    epaules: [E(35, 49, 10, 7.5)], dos: [R(46, 43, 13.5, 31, 6)], triceps: [R(24, 57, 11.5, 26, 5.5)],
    lombaires: [R(47, 76, 13, 22, 5)], fessiers: [R(42, 100, 17.5, 22, 8)], ischios: [R(41, 124, 17, 40, 7)],
    mollets: [R(42.5, 181, 13.5, 42, 6.5)],
  },
};
const NEUTRES_VUE = { face: [R(43, 181, 12.5, 50, 6)], dos: [R(46, 224.5, 7, 11, 3)] };
const TEINTES = [null, 0.3, 0.6, 0.95];
const NIVEAUX = ["repos", "un peu", "bien travaillé", "beaucoup"];

function Forme({ f, miroir, ...props }) {
  if (f.t === "ellipse") return <ellipse cx={miroir ? 120 - f.cx : f.cx} cy={f.cy} rx={f.rx} ry={f.ry} {...props} />;
  return <rect x={miroir ? 120 - f.x - f.w : f.x} y={f.y} width={f.w} height={f.h} rx={f.rx} {...props} />;
}

function Silhouette({ vue, parGroupe, actif, onActif }) {
  const neutre = { fill: GRIS, fillOpacity: 0.16 };
  return (
    <figure className="flex-1 min-w-0 max-w-[132px]">
      <svg viewBox="0 0 120 256" className="w-full h-auto select-none" role="img"
        aria-label={`Muscles travaillés sur 7 jours, vue de ${vue}`}>
        {[...NEUTRES, ...NEUTRES_VUE[vue]].flatMap((f, i) => [<Forme key={i} f={f} {...neutre} />, <Forme key={`m${i}`} f={f} miroir {...neutre} />])}
        {Object.entries(MUSCLES[vue]).flatMap(([g, formes]) => {
          const d = parGroupe[g];
          const t = TEINTES[d?.niveau ?? 0];
          const props = {
            fill: t ? VIOLET : GRIS, fillOpacity: t ?? 0.16, stroke: actif === g ? VIOLET : "transparent", strokeWidth: 1.5,
            onMouseEnter: () => onActif(g), onMouseLeave: () => onActif(null), onClick: () => onActif(actif === g ? null : g),
            className: "cursor-pointer transition-opacity",
          };
          return formes.flatMap((f, i) => [
            <Forme key={`${g}${i}`} f={f} {...props}><title>{`${d?.label ?? g} : ${nb(d?.series_7j ?? 0)} séries sur 7 jours`}</title></Forme>,
            <Forme key={`${g}${i}m`} f={f} miroir {...props} />,
          ]);
        })}
      </svg>
      <figcaption className="text-center text-[12px] text-label-2 mt-1">{vue === "face" ? "De face" : "De dos"}</figcaption>
    </figure>
  );
}

function CarteCorps({ m }) {
  const [actif, setActif] = useState(null);
  const parGroupe = Object.fromEntries(m.carte.map((x) => [x.groupe, x]));
  const max = Math.max(1, ...m.carte.map((x) => Math.max(x.series_7j, x.habituel)));
  const oublies = m.carte.filter((x) => x.habituel >= 2 && x.series_7j === 0);
  return (
    <Card>
      <Entete titre="Carte du corps" couleur={VIOLET} aide="muscu_volume"
        sousTitre={`${nb(m.series_7j)} séries sur 7 jours`} />
      <div className="flex justify-center gap-4 sm:gap-8">
        <Silhouette vue="face" parGroupe={parGroupe} actif={actif} onActif={setActif} />
        <Silhouette vue="dos" parGroupe={parGroupe} actif={actif} onActif={setActif} />
      </div>
      <div className="flex items-center justify-center gap-3 mt-2 text-[11px] text-label-2">
        {NIVEAUX.map((l, i) => (
          <span key={l} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: i ? VIOLET : GRIS, opacity: TEINTES[i] ?? 0.25 }} />{l}
          </span>
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2">
        {m.carte.map((x) => (
          <li key={x.groupe} onMouseEnter={() => setActif(x.groupe)} onMouseLeave={() => setActif(null)}
            className={clsx("min-w-0 rounded-md transition-colors", actif === x.groupe && "bg-remplissage")}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium">{x.label}</span>
              <span className="text-[12px] chiffres text-label-2 whitespace-nowrap">
                <strong className="text-label font-semibold">{nb(x.series_7j)}</strong> / {nb(x.habituel)}
              </span>
            </div>
            <div className="relative h-1.5 mt-1 rounded-full bg-remplissage" aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${(x.series_7j / max) * 100}%`, background: VIOLET }} />
              {x.habituel > 0 && (
                <span className="absolute -top-[3px] w-[2px] h-3 rounded-full bg-label" style={{ left: `calc(${(x.habituel / max) * 100}% - 1px)` }} />
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-label-2 mt-2">Séries des 7 derniers jours / habitude par semaine (le trait, moyenne des 4 semaines d'avant). Un muscle secondaire compte pour une demi-série.</p>
      {oublies.length > 0 && (
        <div className="mt-2"><Message ton="alerte">Pas travaillé cette semaine alors que c'est ton habitude : {oublies.map((x) => x.label.toLowerCase()).join(", ")}.</Message></div>
      )}
      {m.inconnus.length > 0 && (
        <p className="text-[11px] text-label-3 mt-2">Exercices non rattachés à un muscle : {m.inconnus.join(", ")}.</p>
      )}
    </Card>
  );
}

const REGIONS = [["tirage", "Tirage", BLEU], ["poussee", "Poussée", ORANGE], ["tronc", "Tronc", VERT], ["jambes", "Jambes", VIOLET]];

function VolumeHebdo({ m }) {
  const data = m.hebdo.map((s) => ({ ...s, label: court(s.semaine) }));
  const pleines = m.hebdo.slice(0, -1).filter((s) => s.total > 0);
  const moyenne = pleines.length ? pleines.reduce((t, s) => t + s.total, 0) / pleines.length : null;
  return (
    <Card>
      <Entete titre="Volume par semaine" couleur={VIOLET} aide="muscu_volume" sousTitre="Séries par famille de mouvements, 12 semaines" />
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Tuile label="Séances" value={m.nb_seances_4s} sub="sur 4 semaines" />
        <Tuile label="Séries" value={nb(m.hebdo[m.hebdo.length - 1].total)} sub="cette semaine" />
        <Tuile label="Moyenne" value={moyenne != null ? nb(Math.round(moyenne)) : "—"} sub="par semaine active" />
      </div>
      <div className="h-[190px] -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...grille} />
            <XAxis dataKey="label" {...axeX} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...axeY} width={34} allowDecimals={false} />
            <Tooltip cursor={curseur} content={<InfoBulle format={(v) => `${nb(v)} séries`} />} />
            {REGIONS.map(([cle, label, couleur], i) => (
              <Bar key={cle} dataKey={cle} name={label} stackId="v" fill={couleur} maxBarSize={22}
                radius={i === REGIONS.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legende items={REGIONS.map(([, label, couleur]) => ({ label, couleur }))} />
    </Card>
  );
}

const MESURES = {
  rm: { label: "1RM estimé", unite: "kg", fmt: (v) => `${nombre(v, 1)} kg` },
  reps: { label: "Meilleure série", unite: "reps", fmt: (v) => `${nb(v)} reps` },
  tenue_s: { label: "Tenue", unite: "s", fmt: (v) => `${nb(v)} s` },
};
const DIFFICULTES = [["facile", "Facile", VERT], ["correct", "Correct", BLEU], ["dur", "Dur", ORANGE], ["echec", "Échec", ROUGE]];

function Progression({ m }) {
  const [nom, setNom] = useState(null);
  const ex = m.exercices.find((e) => e.nom === nom) ?? m.exercices[0];
  if (!ex) return null;
  const mes = MESURES[ex.mesure];
  const data = ex.historique.filter((h) => h[ex.mesure] != null).map((h) => ({ ...h, label: court(h.date), valeur: h[ex.mesure] }));
  const gain = ex.actuel - ex.debut;
  const dernieres = [...ex.historique].reverse().slice(0, 4);
  return (
    <Card>
      <Entete titre="Progression par exercice" couleur={VIOLET} aide="muscu_progression"
        sousTitre={`${pluriel(ex.nb, "séance")} · dernière le ${court(ex.derniere)}`} />
      <label className="block mb-3">
        <span className="sr-only">Exercice</span>
        <select className="champ w-full" value={ex.nom} onChange={(e) => setNom(e.target.value)}>
          {m.exercices.map((e) => <option key={e.nom} value={e.nom}>{e.nom} ({e.nb})</option>)}
        </select>
      </label>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Tuile label={mes.label} value={mes.fmt(ex.actuel)} sub={ex.par_main ? "charge par main" : "dernière séance"} />
        <Tuile label="Record" value={mes.fmt(ex.meilleur.valeur)} sub={court(ex.meilleur.date)} />
        <Tuile label="Depuis le début" value={`${gain > 0 ? "+" : gain < 0 ? "−" : ""}${nombre(Math.abs(gain), ex.mesure === "rm" ? 1 : 0)}`}
          sub={ex.lest_kg ? `≈ +${nb(Math.round(ex.lest_kg))} kg de lest sur 1 rep` : mes.unite} />
      </div>
      {data.length >= 2 ? (
        <div className="h-[170px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid {...grille} />
              <XAxis dataKey="label" {...axeX} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...axeY} width={34} domain={[(min) => Math.floor(min * 0.9), (max) => Math.ceil(max * 1.05)]} allowDecimals={false} />
              <Tooltip content={<InfoBulle format={(v) => mes.fmt(v)} />} />
              <ReferenceLine y={ex.meilleur.valeur} stroke={GRIS} strokeDasharray="4 4" strokeOpacity={0.6} />
              <Line dataKey="valeur" name={mes.label} stroke={VIOLET} strokeWidth={2.5} dot={{ r: 3.5, fill: VIOLET, strokeWidth: 0 }}
                activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <Message>Une seule séance pour l'instant : la courbe apparaîtra à la prochaine.</Message>}
      <ul className="mt-2 divide-y divide-separateur">
        {dernieres.map((h) => {
          const d = DIFFICULTES.find(([c]) => c === h.difficulte);
          return (
            <li key={h.date} className="py-1.5 flex items-center justify-between gap-3 text-[13px]">
              <span className="text-label-2 w-16 shrink-0">{court(h.date)}</span>
              <span className="flex-1 min-w-0 chiffres">
                {h.test ? "Test · " : ""}{h.series ? `${h.series} × ` : ""}{h.reps != null ? `${nb(h.reps)} reps` : h.tenue_s != null ? `${h.tenue_s} s` : "—"}
                {h.kg ? ` · ${nb(h.kg)} kg` : ""}
              </span>
              {d && <span className="text-[12px] font-medium shrink-0" style={{ color: d[2] }}>{d[1]}</span>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ProchesEchec({ m }) {
  const e = m.echec;
  if (!e.semaines.length) {
    return (
      <Card>
        <Entete titre="Séries proches de l'échec" couleur={VIOLET} aide="muscu_echec" />
        <Vide>Lance tes séances en mode guidé (bouton ▶︎ du Plan) et note le ressenti de chaque exercice : la part de séries dures s'affichera ici.</Vide>
      </Card>
    );
  }
  const data = e.semaines.map((s) => ({ ...s, label: court(s.semaine) }));
  const p = e.part_pct;
  const lecture = p == null ? null
    : p < 15 ? ["", `${p} % de séries dures : tu gardes beaucoup de marge. Pour progresser en force, termine quelques séries plus près de la limite.`]
      : p <= 45 ? ["bien", `${p} % de séries dures : bon dosage, assez près de la limite pour progresser sans t'épuiser.`]
        : ["alerte", `${p} % de séries dures : c'est beaucoup. Garde une ou deux répétitions en réserve sur la plupart des séries.`];
  return (
    <Card>
      <Entete titre="Séries proches de l'échec" couleur={VIOLET} aide="muscu_echec"
        sousTitre={p != null ? `${e.proches_4s} séries dures sur ${e.series_4s} en 4 semaines` : "Ressenti noté en séance guidée"} />
      <div className="h-[170px] -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...grille} />
            <XAxis dataKey="label" {...axeX} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...axeY} width={34} allowDecimals={false} />
            <Tooltip cursor={curseur} content={<InfoBulle format={(v) => `${v} séries`} />} />
            {DIFFICULTES.map(([cle, label, couleur], i) => (
              <Bar key={cle} dataKey={cle} name={label} stackId="d" fill={couleur} maxBarSize={22}
                radius={i === DIFFICULTES.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legende items={DIFFICULTES.map(([, label, couleur]) => ({ label, couleur }))} />
      {lecture && <div className="mt-3"><Message ton={lecture[0]}>{lecture[1]}</Message></div>}
    </Card>
  );
}

export function Musculation({ m }) {
  if (!m) return null;
  if (!m.nb_lignes) {
    return (
      <Card>
        <Entete titre="Musculation" couleur={VIOLET} aide="muscu_volume" />
        <Vide>
          {m.nb_seances
            ? "Tes séances de musculation n'ont pas de détail lisible. Lance-les en mode guidé depuis le Plan, ou note-les dans la séance (« Dips 4x8, tractions 5x4 »)."
            : "Aucune séance de musculation pour l'instant."}
        </Vide>
        <Link to="/plan" className="mt-2 inline-flex items-center gap-1 text-[15px] text-brand">Ouvrir le Plan<Chevron /></Link>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 items-start">
      <CarteCorps m={m} />
      <div className="space-y-2.5 min-w-0">
        <VolumeHebdo m={m} />
        <ProchesEchec m={m} />
      </div>
      <div className="lg:col-span-2 min-w-0"><Progression m={m} /></div>
    </div>
  );
}
