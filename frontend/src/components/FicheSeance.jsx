// Lecture d'une séance : bilan en trois phrases, type de séance (corrigeable),
// répétitions détectées et comparaison avec la séance prévue au plan.
import { Selecteur } from "./Menu";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { getBilanActivite, setConsigneSuivie, setTypeSeance } from "../api";
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
      <Selecteur aria-label="Type de séance" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        value={type && !type.auto ? type.cle : ""} disabled={maj.isPending}
        onChange={(e) => maj.mutate(e.target.value)}>
        <option value="">Type reconnu automatiquement</option>
        {bilan.types.map((t) => <option key={t.cle} value={t.cle}>{t.label}</option>)}
      </Selecteur>
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

const ROLES = { echauffement: "Échauffement", effort: "Effort", recup: "Récup", retour: "Retour au calme" };
const COLS_PLAN = "grid-cols-[minmax(0,1fr)_3rem_3.3rem_3.3rem_2.2rem] sm:grid-cols-[minmax(0,1.5fr)_3.6rem_3.8rem_4.4rem_3.6rem_minmax(0,1fr)_2.6rem]";
const metres = (m) => (m >= 1000 ? `${nombre(m / 1000, 2)} km` : `${Math.round(m)} m`);
const TON = { ok: "text-ios-green", plus: "text-ios-orange", moins: "text-ios-orange", rapide: "text-ios-orange", lent: "text-ios-orange", haut: "text-ios-orange", bas: "text-ios-orange" };

// Ce que la consigne visait pour une étape : une allure, sinon une FC
function visee(p) {
  if (p.allure) return p.allure[0] === p.allure[1] ? `${mmss(p.allure[0])}/km` : `${mmss(p.allure[0])}–${mmss(p.allure[1])}/km`;
  if (p.fc_min && p.fc_max) return `FC ${p.fc_min}–${p.fc_max}`;
  if (p.fc_max) return `FC < ${p.fc_max}`;
  return p.zone ? `Z${p.zone}` : "";
}

// La séance faite a suivi une autre consigne que celle du plan : on la saisit ici, pour cette activité seulement.
// La séance du plan n'est pas modifiée ; les étapes sont recomparées à la consigne saisie.
function ConsigneSuivie({ id, consigne }) {
  const qc = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [texte, setTexte] = useState("");
  const maj = useMutation({
    mutationFn: (t) => setConsigneSuivie(id, t),
    onSuccess: (bilan) => {
      qc.setQueryData(["bilan", id], bilan);
      ["activites", "analyses"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setOuvert(false);
    },
  });
  if (!consigne) return null;
  const suivie = consigne.suivie;
  const ouvrir = () => { maj.reset(); setTexte(suivie || consigne.plan || ""); setOuvert(true); };

  if (!ouvert) {
    return (
      <p className="text-[13px] text-label-2 leading-snug">
        {suivie && "Comparée à la consigne suivie ce jour-là, différente de celle du plan. "}
        <button type="button" className="text-brand font-semibold" onClick={ouvrir}>
          {suivie ? "Modifier" : "Consigne différente ce jour-là ?"}
        </button>
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-label-2 leading-snug">
        Écris la consigne réellement suivie, une ligne par phase, comme dans le plan. Elle ne vaut que pour cette
        séance : le plan n'est pas modifié.
      </p>
      <textarea className="champ w-full min-h-[120px] text-[14px]" value={texte} maxLength={4000}
        onChange={(ev) => setTexte(ev.target.value)} />
      {maj.isError && (
        <p className="text-[13px] text-ios-red">
          {maj.error?.response?.data?.detail ?? "Enregistrement impossible. Réessaie."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-teinte btn-sm" disabled={maj.isPending || !texte.trim()}
          onClick={() => maj.mutate(texte)}>Enregistrer</button>
        <button type="button" className="btn-gris btn-sm" disabled={maj.isPending} onClick={() => setOuvert(false)}>Annuler</button>
        {suivie && (
          <button type="button" className="btn-gris btn-sm" disabled={maj.isPending} onClick={() => maj.mutate(null)}>
            Revenir au plan
          </button>
        )}
      </div>
    </div>
  );
}

// Séance d'intensité liée au plan : chaque étape prévue retrouvée dans l'enregistrement et comparée
export function RespectPlan({ id, total, onPosition }) {
  const { data: bilan } = useBilan(id);
  const e = bilan?.execution;
  if (!e?.etapes?.length) return null;
  const r = e.resume ?? {};
  const introuvable = e.mode === "theorique";
  const montrer = (x) => x.fait && total && onPosition?.(((x.fait.debut_km + x.fait.fin_km) / 2) / total);
  const ecartAllure = r.efforts_vises > 0 && r.efforts_allure_ok < r.efforts_vises;
  const suite = (e.phrases ?? []).slice(2);

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        {r.note != null && <Note note={r.note} />}
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold flex items-center gap-1.5">Étapes du plan <Aide sujet="respect_plan" /></h3>
          <p className="text-[13px] text-label-2 leading-snug">
            {r.verdict}{e.type_label && <> · {e.type_label}</>}{e.titre && <> · « {e.titre} »</>}
          </p>
        </div>
      </div>

      {introuvable ? (
        <p className="text-[14px] leading-snug">
          Les étapes prévues n'ont pas été retrouvées dans l'enregistrement : l'allure est restée trop régulière,
          ou la séance faite est très différente de celle du plan.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Chiffre label="Efforts faits" valeur={`${r.efforts_faits}/${r.efforts_prevus}`}
              ton={r.efforts_faits === r.efforts_prevus ? "text-ios-green" : "text-ios-orange"} />
            <Chiffre label="À la bonne mesure" valeur={`${r.efforts_mesure_ok}/${r.efforts_prevus}`}
              ton={r.efforts_mesure_ok === r.efforts_prevus ? "text-ios-green" : "text-ios-orange"} />
            <Chiffre label="Allure des efforts" valeur={mmss(r.effort_allure_sec_km)} unite="/km"
              ton={r.efforts_vises > 0 ? (ecartAllure ? "text-ios-orange" : "text-ios-green") : undefined} />
            {r.recup_duree_sec != null
              ? <Chiffre label="Récupération moyenne" valeur={court(r.recup_duree_sec)} />
              : <Chiffre label="FC des efforts" valeur={r.effort_fc ?? "—"} />}
          </div>

          <div className="text-[13px]" onMouseLeave={() => onPosition?.(null)}>
            <div className={clsx("grid gap-2 px-1 pb-1.5 text-[11px] text-label-2 uppercase tracking-[0.02em]", COLS_PLAN)}>
              <span>Étape</span>
              <span className="text-right">Prévu</span>
              <span className="text-right">Fait</span>
              <span className="text-right hidden sm:block">Écart</span>
              <span className="text-right">Allure</span>
              <span className="hidden sm:block">Visé</span>
              <span className="text-right">FC</span>
            </div>
            {e.etapes.map((x, i) => {
              const f = x.fait;
              const libre = x.prevu.libre;
              const enDuree = x.prevu.duree_sec != null || libre;
              const ecart = enDuree ? x.ecart_sec : x.ecart_m;
              const effort = x.role === "effort";
              // Deux étapes du même nom (trot puis marche au retour au calme) : sur petit écran, la consigne les distingue
              const jumelle = !!x.libelle && x.sur === 1 && e.etapes.filter((y) => y.role === x.role && y.sur === 1).length > 1;
              return (
                <button type="button" key={i} onMouseEnter={() => montrer(x)} onClick={() => montrer(x)}
                  className={clsx("grid gap-2 items-center w-full text-left px-1 py-[5px] rounded-lg hover:bg-remplissage chiffres",
                    COLS_PLAN, !effort && "text-label-2")}>
                  <span className="min-w-0 truncate">
                    <span className={clsx(effort && "font-semibold", jumelle && "hidden sm:inline")}>{ROLES[x.role]}{x.sur > 1 && ` ${x.rep}`}</span>
                    {x.libelle && x.sur === 1 && <span className={clsx("text-label-2", !jumelle && "hidden sm:inline")}><span className="hidden sm:inline"> · </span>{x.libelle}</span>}
                  </span>
                  <span className="text-right text-label-2">{libre ? "libre" : enDuree ? court(x.prevu.duree_sec) : metres(x.prevu.distance_m)}</span>
                  <span className={clsx("text-right font-semibold", f ? TON[x.etat] : "text-ios-red")}>
                    {f ? (enDuree ? court(f.duree_sec) : metres(f.distance_m)) : "non faite"}
                  </span>
                  <span className={clsx("text-right hidden sm:block", f && x.etat !== "ok" ? "text-ios-orange" : "text-label-2")}>
                    {!f || ecart == null ? "—" : Math.round(ecart) === 0 ? "0"
                      : `${ecart > 0 ? "+" : "−"}${enDuree ? court(Math.abs(ecart)) : metres(Math.abs(ecart))}`}
                  </span>
                  <span className={clsx("text-right", effort && "font-semibold", TON[x.etat_allure])}>{f ? mmss(f.allure_sec_km) : "—"}</span>
                  <span className="hidden sm:block text-label-2 truncate">{visee(x.prevu)}</span>
                  <span className={clsx("text-right", TON[x.etat_fc])}>{f?.fc ?? "—"}</span>
                </button>
              );
            })}
          </div>

          {suite.length > 0 && (
            <ul className="space-y-1 text-[13px] text-label-2 leading-snug">
              {suite.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
        </>
      )}
      <ConsigneSuivie id={id} consigne={bilan.consigne} />
      <p className="text-[12px] text-label-2">
        {introuvable ? "Comparaison impossible étape par étape."
          : e.mode === "tours" ? "Étapes lues d'après les tours enregistrés par la montre."
          : "Étapes découpées au chrono de l'activité, pauses retirées, dans l'ordre et aux durées du plan."}
        {e.source === "trace" && " Calcul fait sur le tracé GPS seul : moins précis qu'avec l'enregistrement complet."}
        {!introuvable && " Vert : conforme au plan ; orange : écart."}
      </p>
    </section>
  );
}
