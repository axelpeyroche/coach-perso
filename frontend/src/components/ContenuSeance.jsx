import { analyserDescription } from "../seance";

// Contenu d'une séance prévue, mis en forme : tableau d'exercices (muscu),
// déroulé par phases (endurance) ou texte brut.

const titreSection = "px-1 text-[13px] uppercase tracking-[0.02em] font-medium text-label-2";

// Met en valeur les repères d'intensité : FC, RPE, zones, allures
const RE_REPERE = /(FC\s*(?:sous|<|>|au-dessus de|entre)?\s*\d+(?:\s*[-–]\s*\d+)?|RPE\s*\d+(?:\s*[-–]\s*\d+)?|\bZ[1-5]\b|\d+:\d{2}(?:\s*[-–]\s*\d+:\d{2})?\s*\/\s*km)/g;
function Reperes({ texte }) {
  return texte.split(RE_REPERE).map((p, i) => (i % 2 ? <span key={i} className="font-semibold text-label">{p}</span> : p));
}

function Info({ lignes }) {
  if (!lignes.length) return null;
  return (
    <div className="card px-4 py-3 flex gap-3">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
        className="w-[18px] h-[18px] shrink-0 mt-[3px] text-brand" aria-hidden>
        <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.4" />
      </svg>
      <div className="space-y-1.5 text-[14px] leading-5 text-label-2">
        {lignes.map((l, i) => <p key={i}>{l}</p>)}
      </div>
    </div>
  );
}

function Pastille({ children, className = "" }) {
  return <span className={`inline-flex items-center h-5 px-1.5 rounded-md text-[11px] font-semibold ${className}`}>{children}</span>;
}

// ── Muscu : tableau d'exercices ─────────────────────────────────────────────
const COLONNES = "md:grid md:grid-cols-[minmax(0,1fr)_64px_84px_64px_150px] md:gap-x-4";

function LigneExercice({ e, couleur }) {
  const notes = (
    <>
      {e.notes.length > 0 && <p className="mt-0.5 text-[13px] leading-[18px] text-label-2">{e.notes.join(" · ")}</p>}
      {e.historique && (
        <p className="mt-1 flex items-start gap-1 text-[12px] leading-4 text-label-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
            className="w-3 h-3 shrink-0 mt-[2px]" aria-hidden><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
          <span>Dernière fois : {e.historique}</span>
        </p>
      )}
    </>
  );
  const nom = (
    <p className="text-[15px] font-semibold leading-5">
      {e.nom}
      {e.emom && <Pastille className="ml-1.5 align-[2px] bg-ios-indigo/15 text-ios-indigo">EMOM</Pastille>}
    </p>
  );
  const numero = (
    <span className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[12px] font-semibold chiffres"
      style={{ backgroundColor: `${couleur}26`, color: couleur }}>{e.numero}</span>
  );

  return (
    <div className={`px-4 py-3 ${COLONNES} md:items-center`}>
      {/* Téléphone : nom à gauche, « séries × reps » et récup à droite */}
      <div className="flex gap-3 md:hidden">
        {numero}
        <div className="flex-1 min-w-0">
          {nom}
          {e.charge && <Pastille className="mt-1 bg-remplissage text-label">{e.charge}</Pastille>}
          {notes}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-rounded text-[17px] font-bold leading-5 chiffres whitespace-nowrap">
            {e.series ? `${e.emom ? e.series.replace(" min", "′") : e.series} × ${e.reps}` : e.reps}
          </p>
          {e.unite && <p className="text-[12px] text-label-2">{e.unite}</p>}
          {e.recup && <p className="text-[12px] text-label-2 whitespace-nowrap">récup {e.recup}</p>}
        </div>
      </div>

      {/* Ordinateur : colonnes */}
      <div className="hidden md:flex gap-3 min-w-0">
        {numero}
        <div className="min-w-0">{nom}{notes}</div>
      </div>
      <p className="hidden md:block font-rounded text-[17px] font-bold chiffres">{e.series ?? "—"}</p>
      <div className="hidden md:block">
        <p className="font-rounded text-[17px] font-bold leading-5 chiffres">{e.reps ?? "—"}</p>
        {e.unite && <p className="text-[12px] text-label-2">{e.unite}</p>}
      </div>
      <p className="hidden md:block text-[15px] text-label-2 chiffres">{e.recup ?? "—"}</p>
      <p className="hidden md:block text-[14px] leading-5">{e.charge ?? <span className="text-label-2">—</span>}</p>
    </div>
  );
}

function Muscu({ r, couleur }) {
  return (
    <>
      {r.intro.length > 0 && <p className="px-1 text-[15px] leading-6 text-label-2">{r.intro.join(" ")}</p>}
      {r.sections.map((s, i) => (
        <section key={i} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className={titreSection}>{s.titre ?? "Exercices"}</h4>
            <span className="px-1 text-[13px] text-label-2 chiffres">
              {s.exercices.length} exercice{s.exercices.length > 1 ? "s" : ""}{s.duree ? ` · ${s.duree}` : ""}
            </span>
          </div>
          <div className="card divide-y-[0.5px] divide-separateur overflow-hidden">
            <div className={`hidden ${COLONNES} px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.02em] text-label-2`}>
              <span className="pl-9">Exercice</span><span>Séries</span><span>Reps</span><span>Récup</span><span>Charge</span>
            </div>
            {s.exercices.map((e) => <LigneExercice key={e.numero} e={e} couleur={couleur} />)}
          </div>
        </section>
      ))}
      <Info lignes={r.fin} />
    </>
  );
}

// ── Endurance : déroulé par phases ─────────────────────────────────────────
const TEINTES = {
  "échauffement": "bg-ios-green text-ios-green",
  "retour au calme": "bg-ios-teal text-ios-teal",
  "récupération": "bg-ios-teal text-ios-teal",
  "récup": "bg-ios-teal text-ios-teal",
};
const teinte = (label) => TEINTES[label.toLowerCase()] ?? "bg-ios-orange text-ios-orange";

function Endurance({ r }) {
  return (
    <>
      {r.intro.length > 0 && <p className="px-1 text-[15px] leading-6 text-label-2">{r.intro.join(" ")}</p>}
      <section className="space-y-1.5">
        <h4 className={titreSection}>Déroulé</h4>
        <ol className="card px-4 py-1">
          {r.phases.map((p, i) => {
            const [fond, texte] = teinte(p.label).split(" ");
            const derniere = i === r.phases.length - 1;
            return (
              <li key={i} className="relative flex gap-3 py-3">
                <span className="relative w-2.5 shrink-0 flex justify-center" aria-hidden>
                  <span className={`mt-[6px] w-2.5 h-2.5 rounded-full ${fond}`} />
                  {!derniere && <span className="absolute top-[22px] -bottom-[18px] w-[1.5px] bg-separateur" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={`text-[15px] font-semibold ${texte}`}>{p.label}</p>
                    {p.duree && <span className="font-rounded text-[17px] font-bold chiffres whitespace-nowrap">{p.duree}</span>}
                  </div>
                  {p.texte && <p className="mt-0.5 text-[15px] leading-[22px] text-label-2"><Reperes texte={p.texte} /></p>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      <Info lignes={r.consignes} />
    </>
  );
}

export default function ContenuSeance({ description, couleur }) {
  const r = analyserDescription(description);
  if (!r) return null;
  if (r.type === "muscu") return <Muscu r={r} couleur={couleur} />;
  if (r.type === "endurance") return <Endurance r={r} />;
  return (
    <section className="space-y-1.5">
      <h4 className={titreSection}>Contenu</h4>
      <div className="card px-4 py-3 text-[15px] leading-6 whitespace-pre-line">{r.texte}</div>
    </section>
  );
}
