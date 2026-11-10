// Lecture d'une séance : bilan en trois phrases, type de séance (corrigeable),
// répétitions détectées et comparaison avec la séance prévue au plan.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { getBilanActivite, setTypeSeance } from "../api";
import { fmtDuree, nombre } from "../carnet";
import Aide from "./Aide";
import { mmss } from "./FicheExtras";

export const useBilan = (id) => useQuery({
  queryKey: ["bilan", id], queryFn: () => getBilanActivite(id), staleTime: 10 * 60_000,
});

// Durée courte : 45 s, 1:30, 12:05
const court = (s) => (s == null ? "—" : s < 60 ? `${Math.round(s)} s` : mmss(s));

// Pastille du type de séance : une liste native (roue sur téléphone, menu sur ordinateur)
function TypeSeance({ a, bilan, onChange }) {
  const qc = useQueryClient();
  const maj = useMutation({
    mutationFn: (cle) => setTypeSeance(a.id, cle || null),
    onSuccess: (act) => {
      onChange?.(act);
      ["bilan", "activites", "analyses"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
  const type = bilan.type;
  if (!bilan.types?.length) return null;
  return (
    <label className={clsx("relative inline-flex items-center gap-1 rounded-full bg-brand/15 text-brand pl-3 pr-2 py-[5px] text-[13px] font-semibold whitespace-nowrap shrink-0",
      maj.isPending && "opacity-50")}>
      <span>{type?.label ?? "Type de séance"}</span>
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
      <select aria-label="Type de séance" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        value={type && !type.auto ? type.cle : ""} disabled={maj.isPending}
        onChange={(e) => maj.mutate(e.target.value)}>
        <option value="">Type reconnu automatiquement</option>
        {bilan.types.map((t) => <option key={t.cle} value={t.cle}>{t.label}</option>)}
      </select>
    </label>
  );
}

// Encart du haut de la fiche : le type et trois phrases, écrites par règles (sans IA)
export function BilanSeance({ a, onChange }) {
  const { data: bilan, isLoading } = useBilan(a.id);
  if (isLoading) return <div className="card h-[104px] animate-pulse" />;
  if (!bilan || (!bilan.phrases?.length && !bilan.types?.length)) return null;
  const type = bilan.type;
  return (
    <section className="card p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold flex items-center gap-1.5">Bilan <Aide sujet="bilan_seance" /></h3>
        <TypeSeance a={a} bilan={bilan} onChange={onChange} />
      </div>
      {bilan.phrases?.length > 0 && (
        <ul className="space-y-1.5">
          {bilan.phrases.map((p, i) => (
            <li key={i} className="flex gap-2.5 text-[15px] leading-[21px]">
              <span className="mt-[8px] w-[5px] h-[5px] rounded-full bg-brand shrink-0" />
              <span className="min-w-0">{p}</span>
            </li>
          ))}
        </ul>
      )}
      {type && (
        <p className="text-[12px] text-label-2">
          {type.auto
            ? "Type reconnu d'après l'allure, le cœur et le titre. Touche-le pour le corriger."
            : "Type choisi à la main. Rechoisis « Type reconnu automatiquement » pour revenir à la détection."}
        </p>
      )}
    </section>
  );
}

function Chiffre({ label, valeur, unite, ton }) {
  return (
    <div className="rounded-xl bg-remplissage px-3 py-2 min-w-0">
      <p className="text-[11px] text-label-2 leading-tight">{label}</p>
      <p className={clsx("text-[17px] font-semibold chiffres leading-snug", ton)}>
        {valeur}{unite && <span className="text-[12px] font-medium text-label-2 ml-0.5">{unite}</span>}
      </p>
    </div>
  );
}

const COLS = "grid-cols-[1.4rem_2.9rem_3.1rem_minmax(0,1fr)_2.3rem_2.9rem] sm:grid-cols-[1.6rem_3.2rem_3.6rem_3.3rem_minmax(0,1fr)_3.3rem_2.6rem_3.2rem]";

// Répétitions reconnues dans la séance : une ligne par effort, la récupération qui suit
export function Intervalles({ intervalles, total, onPosition }) {
  const reps = intervalles?.reps;
  if (!reps?.length) return null;
  const r = intervalles.resume;
  const vit = reps.map((x) => (x.allure_sec_km ? 1 / x.allure_sec_km : 0));
  const [vmin, vmax] = [Math.min(...vit), Math.max(...vit)];
  const meilleure = reps[vit.indexOf(vmax)];
  const montrer = (x) => total && onPosition?.(((x.debut_km + x.fin_km) / 2) / total);
  const regulier = r.regularite_pct <= 3 ? "text-ios-green" : r.regularite_pct > 6 ? "text-ios-orange" : undefined;
  const tenue = r.baisse_pct <= 2 ? "text-ios-green" : r.baisse_pct > 5 ? "text-ios-orange" : undefined;

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold flex items-center gap-1.5">
          {r.cotes ? "Côtes" : "Répétitions"} <Aide sujet="intervalles" />
        </h3>
        <p className="text-[13px] text-label-2 chiffres text-right">
          {r.n} × {court(r.duree_sec)}{r.recup_sec != null && ` · récup ${court(r.recup_sec)}`}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Chiffre label="Allure moyenne" valeur={mmss(r.allure_sec_km)} unite="/km" />
        {r.cotes
          ? <Chiffre label="Pente" valeur={nombre(r.pente_pct, 1)} unite="%" />
          : <Chiffre label="Meilleure" valeur={mmss(r.meilleure_sec_km)} unite="/km" />}
        <Chiffre label="Écart entre répétitions" valeur={`± ${nombre(r.regularite_pct, 1)}`} unite="%" ton={regulier} />
        <Chiffre label="Fin contre début" ton={tenue}
          valeur={r.baisse_pct > 0.5 ? `${nombre(r.baisse_pct, 1)}` : r.baisse_pct < -0.5 ? `${nombre(-r.baisse_pct, 1)}` : "égale"}
          unite={r.baisse_pct > 0.5 ? "% plus lent" : r.baisse_pct < -0.5 ? "% plus vite" : null} />
      </div>

      <div className="text-[13px]" onMouseLeave={() => onPosition?.(null)}>
        <div className={clsx("grid gap-2 px-1 pb-1.5 text-[11px] text-label-2 uppercase tracking-[0.02em]", COLS)}>
          <span>N°</span>
          <span className="text-right">Durée</span>
          <span className="text-right hidden sm:block">Dist.</span>
          <span className="text-right">Allure</span>
          <span />
          <span className="text-right hidden sm:block">{r.cotes ? "D+" : "Ajustée"}</span>
          <span className="text-right">FC</span>
          <span className="text-right">Récup</span>
        </div>
        {reps.map((x, i) => {
          const part = vmax > vmin ? (vit[i] - vmin) / (vmax - vmin) : 1;
          return (
            <button type="button" key={x.numero} onMouseEnter={() => montrer(x)} onClick={() => montrer(x)}
              className={clsx("grid gap-2 items-center w-full text-left px-1 py-[5px] rounded-lg hover:bg-remplissage chiffres", COLS)}>
              <span className="text-label-2">{x.numero}</span>
              <span className="text-right">{court(x.duree_sec)}</span>
              <span className="text-right text-label-2 hidden sm:block">
                {x.distance_m >= 1000 ? `${nombre(x.distance_m / 1000, 2)} km` : `${Math.round(x.distance_m)} m`}
              </span>
              <span className={clsx("text-right font-semibold", x === meilleure && reps.length > 1 && "text-brand")}>{mmss(x.allure_sec_km)}</span>
              <span className="h-2.5 rounded-full bg-remplissage overflow-hidden">
                <span className="block h-full rounded-full"
                  style={{ width: `${30 + 70 * part}%`, background: x === meilleure ? "rgb(var(--blue))" : "rgb(var(--orange))" }} />
              </span>
              <span className="text-right text-label-2 hidden sm:block">
                {r.cotes ? (x.dplus_m != null ? `${Math.round(x.dplus_m)} m` : "—") : mmss(x.gap_sec_km)}
              </span>
              <span className="text-right" style={{ color: x.fc ? "rgb(var(--pink))" : undefined }}>{x.fc ?? "—"}</span>
              <span className="text-right text-label-2">{x.recup_sec != null ? court(x.recup_sec) : "—"}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[12px] text-label-2">
        Efforts repérés d'après les changements d'allure{r.cotes ? " ramenée au plat" : ""}. Temps d'effort : {fmtDuree(r.travail_sec)}.
      </p>
    </section>
  );
}

const ETATS = {
  ok: ["Conforme", "text-ios-green bg-ios-green/15"],
  plus: ["Plus", "text-ios-orange bg-ios-orange/15"],
  moins: ["Moins", "text-ios-orange bg-ios-orange/15"],
  rapide: ["Plus vite", "text-ios-orange bg-ios-orange/15"],
  lent: ["Plus lent", "text-ios-orange bg-ios-orange/15"],
  autre: ["Différent", "text-ios-red bg-ios-red/15"],
};

// Anneau de la note d'exécution (sur 100)
function Note({ note }) {
  const c = 2 * Math.PI * 19;
  const couleur = note >= 85 ? "rgb(var(--green))" : note >= 65 ? "rgb(var(--orange))" : "rgb(var(--red))";
  return (
    <span className="relative w-[52px] h-[52px] shrink-0 grid place-items-center">
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r="19" fill="none" strokeWidth="4.5" className="stroke-remplissage" />
        <circle cx="22" cy="22" r="19" fill="none" strokeWidth="4.5" strokeLinecap="round" stroke={couleur}
          strokeDasharray={`${(c * Math.max(2, note)) / 100} ${c}`} />
      </svg>
      <span className="text-[16px] font-bold chiffres font-rounded">{note}</span>
    </span>
  );
}

// Séance du plan liée à cette activité : ce qui était prévu, ce qui a été fait
export function PrevuRealise({ id }) {
  const { data: bilan } = useBilan(id);
  const p = bilan?.prevu;
  if (!p?.lignes?.length) return null;
  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        {p.note != null && <Note note={p.note} />}
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold flex items-center gap-1.5">Prévu contre réalisé <Aide sujet="note_execution" /></h3>
          <p className="text-[13px] text-label-2 leading-snug">
            {p.verdict}{p.prevue?.titre && <> · « {p.prevue.titre} »</>}
          </p>
        </div>
      </div>

      <div>
        <div className="hidden sm:grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_6rem] gap-3 px-1 pb-1.5 text-[11px] text-label-2 uppercase tracking-[0.02em]">
          <span /><span>Prévu</span><span>Réalisé</span><span className="text-right">Écart</span>
        </div>
        <div className="divide-y divide-separateur border-t border-separateur sm:border-t-0">
          {p.lignes.map((l) => {
            const [mot, ton] = ETATS[l.etat] ?? ETATS.ok;
            const ecart = l.ecart_pct != null && l.etat !== "ok" ? `${l.ecart_pct > 0 ? "+" : "−"}${nombre(Math.abs(l.ecart_pct), 0)} %` : mot;
            return (
              <div key={l.cle} className="py-2 px-1 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_6rem] gap-x-3 gap-y-0.5 items-center">
                <span className="text-[13px] text-label-2 sm:text-[14px] sm:text-label">{l.label}</span>
                <span className="sm:hidden row-span-2 self-center">
                  <span className={clsx("badge chiffres", ton)}>{ecart}</span>
                </span>
                <span className="hidden sm:block text-[14px] text-label-2 chiffres">{l.prevu}</span>
                <span className="hidden sm:block text-[14px] font-semibold chiffres">{l.realise}</span>
                <span className="hidden sm:block text-right"><span className={clsx("badge chiffres", ton)}>{ecart}</span></span>
                <span className="sm:hidden text-[15px] chiffres">
                  <span className="font-semibold">{l.realise}</span>
                  <span className="text-label-2"> · prévu {l.prevu}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {p.prevue?.description && (
        <p className="text-[13px] text-label-2 whitespace-pre-line line-clamp-4">{p.prevue.description}</p>
      )}
    </section>
  );
}
