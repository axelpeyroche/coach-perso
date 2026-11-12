// Éditeur de séance par blocs (Plan → ajouter ou modifier une séance).
// Endurance : étapes (échauffement, corps de séance, blocs répétés, retour au calme)
// avec durée ou distance, cible (zone, allure, RPE) et récupération entre répétitions.
// Muscu : échauffement, sections (séries, AMRAP, test) et exercices.
// Le composant ne fait que modifier la structure ; la description lisible est écrite
// par `descriptionDepuis` (blocs.js) au moment d'enregistrer.
import { useEffect, useState } from "react";
import { Segmente, Interrupteur } from "./ui";
import {
  GENRES, MODES_SECTION, etapeVide, exerciceVide, sectionVide, fmtDureeCourte, lireDuree,
} from "../blocs";

export const SPORTS_ALLURE = new Set(["course", "trail", "marche", "randonnee"]);
const RE_ALLURE = /^\d{1,2}:[0-5]\d$/;
const allureFausse = (v) => !!v && !RE_ALLURE.test(v);

// ── Petits éléments ────────────────────────────────────────────────────────
function Champ({ label, className = "", children }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="block text-[12px] text-label-2 mb-1 px-0.5">{label}</span>
      {children}
    </label>
  );
}

const champ = "champ !py-2 !text-[15px]";

// Durée saisie librement (« 10 », « 1'30 », « 45 s ») ; enregistrée en secondes
function ChampDuree({ valeur, onChange, label, uniteParDefaut = "min", placeholder = "10'" }) {
  const [texte, setTexte] = useState(valeur ? fmtDureeCourte(valeur) : "");
  const [faux, setFaux] = useState(false);
  useEffect(() => {
    // valeur changée de l'extérieur (déplacement d'étape, modèle chargé)
    if (valeur === undefined) return;  // saisie en cours, illisible
    const lu = lireDuree(texte, uniteParDefaut);
    if ((lu ?? null) !== (valeur ?? null)) { setTexte(valeur ? fmtDureeCourte(valeur) : ""); setFaux(false); }
  }, [valeur]); // eslint-disable-line react-hooks/exhaustive-deps
  const changer = (t) => {
    setTexte(t);
    const s = lireDuree(t, uniteParDefaut);
    const illisible = !!t.trim() && s == null;
    setFaux(illisible);
    onChange(illisible ? undefined : s);
  };
  return (
    <input className={`${champ} ${faux ? "!ring-1 !ring-ios-red" : ""}`} value={texte} placeholder={placeholder}
      aria-label={label} aria-invalid={faux} inputMode="text" onChange={(e) => changer(e.target.value)}
      onBlur={() => { const s = lireDuree(texte, uniteParDefaut); if (s != null) setTexte(fmtDureeCourte(s)); }} />
  );
}

function Nombre({ valeur, onChange, min = 1, max = 60, label }) {
  return (
    <input className={champ} inputMode="numeric" aria-label={label} value={valeur ?? ""}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "");
        onChange(v === "" ? null : Math.min(max, Number(v)));
      }}
      onBlur={() => { if (valeur == null || valeur < min) onChange(min); }} />
  );
}

function Outils({ index, total, onMonter, onDescendre, onSupprimer, nom }) {
  const b = "w-8 h-8 rounded-full flex items-center justify-center text-label-2 active:bg-remplissage disabled:opacity-30";
  return (
    <span className="flex items-center gap-0.5 shrink-0">
      <button type="button" className={b} disabled={index === 0} onClick={onMonter} aria-label={`Monter ${nom}`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 15l6-6 6 6" /></svg>
      </button>
      <button type="button" className={b} disabled={index === total - 1} onClick={onDescendre} aria-label={`Descendre ${nom}`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <button type="button" className={`${b} !text-ios-red`} disabled={total <= 1} onClick={onSupprimer} aria-label={`Supprimer ${nom}`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </span>
  );
}

const deplacer = (liste, i, d) => {
  const j = i + d;
  if (j < 0 || j >= liste.length) return liste;
  const r = liste.slice();
  [r[i], r[j]] = [r[j], r[i]];
  return r;
};
const remplacer = (liste, i, v) => liste.map((x, k) => (k === i ? v : x));
const retirer = (liste, i) => liste.filter((_, k) => k !== i);

// ── Endurance ──────────────────────────────────────────────────────────────
function Etape({ e, i, total, sport, onChange, outils }) {
  const set = (k) => (v) => onChange({ ...e, [k]: v });
  const travail = e.genre === "corps" || e.genre === "bloc";
  const enDistance = e.duree_s == null && e.distance_m != null;
  const allure = SPORTS_ALLURE.has(sport);
  const n = e.repetitions ?? 1;

  return (
    <div className="rounded-2xl border border-separateur p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <select className={`${champ} !w-auto flex-1 font-semibold`} value={e.genre} aria-label={`Type de l'étape ${i + 1}`}
          onChange={(ev) => onChange({ ...e, genre: ev.target.value })}>
          {GENRES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {outils}
      </div>

      <div className="grid grid-cols-[4.5rem_1fr] gap-2">
        <Champ label="Fois">
          <Nombre valeur={n} onChange={set("repetitions")} label={`Répétitions de l'étape ${i + 1}`} />
        </Champ>
        <div className="min-w-0">
          <span className="flex items-center justify-between gap-2 text-[12px] text-label-2 mb-1 px-0.5">
            {enDistance ? "Distance (m)" : "Durée"}
            <button type="button" className="text-brand font-medium"
              onClick={() => onChange(enDistance
                ? { ...e, distance_m: null, duree_s: 600 }
                : { ...e, duree_s: null, distance_m: 1000 })}>
              {enDistance ? "Passer en durée" : "Passer en distance"}
            </button>
          </span>
          {enDistance ? (
            <Nombre valeur={e.distance_m} onChange={set("distance_m")} min={50} max={300000} label={`Distance de l'étape ${i + 1}`} />
          ) : (
            <ChampDuree valeur={e.duree_s} onChange={set("duree_s")} label={`Durée de l'étape ${i + 1}`} />
          )}
        </div>
      </div>

      <Champ label="Consigne">
        <input className={champ} value={e.texte} maxLength={200} onChange={(ev) => set("texte")(ev.target.value)}
          placeholder={travail ? "au seuil, en côte, allure 10 km…" : "footing, trot…"} />
      </Champ>

      {(
        <div className={`grid gap-2 ${allure ? "grid-cols-[4.5rem_1fr_1fr_4.5rem]" : "grid-cols-2"}`}>
          <Champ label="Zone">
            <select className={champ} value={e.zone ?? ""} onChange={(ev) => set("zone")(ev.target.value ? Number(ev.target.value) : null)}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((z) => <option key={z} value={z}>Z{z}</option>)}
            </select>
          </Champ>
          {allure && (
            <>
              <Champ label="Allure de">
                <input className={`${champ} ${allureFausse(e.allure_min) ? "!ring-1 !ring-ios-red" : ""}`} aria-invalid={allureFausse(e.allure_min)}
                  inputMode="numeric" placeholder="4:35" value={e.allure_min ?? ""}
                  onChange={(ev) => set("allure_min")(ev.target.value.replace(/[^\d:]/g, "").slice(0, 5) || null)} />
              </Champ>
              <Champ label="à (/km)">
                <input className={`${champ} ${allureFausse(e.allure_max) ? "!ring-1 !ring-ios-red" : ""}`} aria-invalid={allureFausse(e.allure_max)}
                  inputMode="numeric" placeholder="4:45" value={e.allure_max ?? ""}
                  onChange={(ev) => set("allure_max")(ev.target.value.replace(/[^\d:]/g, "").slice(0, 5) || null)} />
              </Champ>
            </>
          )}
          <Champ label="RPE">
            <select className={champ} value={e.rpe ?? ""} onChange={(ev) => set("rpe")(ev.target.value ? Number(ev.target.value) : null)}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Champ>
        </div>
      )}

      {n > 1 && (
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <Champ label="Récup">
            <ChampDuree valeur={e.recup_s} onChange={set("recup_s")} uniteParDefaut="auto" label={`Récupération de l'étape ${i + 1}`} placeholder="2'" />
          </Champ>
          <Champ label="Récup : comment">
            <input className={champ} value={e.recup_texte} maxLength={100} placeholder="en trottinant"
              onChange={(ev) => set("recup_texte")(ev.target.value)} />
          </Champ>
        </div>
      )}
    </div>
  );
}

function EditeurEndurance({ s, sport, onChange }) {
  const etapes = s.etapes;
  const maj = (liste) => onChange({ ...s, etapes: liste });
  return (
    <div className="space-y-2.5">
      {etapes.map((e, i) => (
        <Etape key={i} e={e} i={i} total={etapes.length} sport={sport} onChange={(v) => maj(remplacer(etapes, i, v))}
          outils={<Outils index={i} total={etapes.length} nom={`l'étape ${i + 1}`}
            onMonter={() => maj(deplacer(etapes, i, -1))} onDescendre={() => maj(deplacer(etapes, i, 1))}
            onSupprimer={() => maj(retirer(etapes, i))} />} />
      ))}
      {etapes.length < 30 && (
        <div className="flex gap-2">
          <button type="button" className="btn-gris btn-sm flex-1" onClick={() => {
            // nouvelle étape avant le retour au calme s'il est en dernier
            const fin = etapes.length && etapes[etapes.length - 1].genre === "retour" ? etapes.length - 1 : etapes.length;
            maj([...etapes.slice(0, fin), etapeVide("corps"), ...etapes.slice(fin)]);
          }}>+ Étape</button>
          <button type="button" className="btn-gris btn-sm flex-1" onClick={() => {
            const fin = etapes.length && etapes[etapes.length - 1].genre === "retour" ? etapes.length - 1 : etapes.length;
            maj([...etapes.slice(0, fin), { ...etapeVide("bloc"), repetitions: 5, duree_s: 60, recup_s: 60 }, ...etapes.slice(fin)]);
          }}>+ Bloc répété</button>
        </div>
      )}
      <Champ label="Consignes (facultatif)">
        <textarea rows={2} className={champ} value={s.consignes} maxLength={2000}
          onChange={(ev) => onChange({ ...s, consignes: ev.target.value })} placeholder="Terrain, matériel, ravitaillement…" />
      </Champ>
    </div>
  );
}

// ── Muscu ──────────────────────────────────────────────────────────────────
function Exercice({ x, i, mode, onChange, outils }) {
  const set = (k) => (v) => onChange({ ...x, [k]: v });
  const test = mode === "test";
  const amrap = mode === "amrap";
  return (
    <div className="rounded-xl border border-separateur p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <input className={`${champ} flex-1 font-semibold`} value={x.nom} maxLength={80} placeholder="Nom de l'exercice"
          aria-label={`Nom de l'exercice ${i + 1}`} onChange={(ev) => set("nom")(ev.target.value)} />
        {outils}
      </div>
      <div className={`grid gap-2 ${amrap ? "grid-cols-2" : "grid-cols-[4rem_1fr_1fr]"}`}>
        {!amrap && (
          <Champ label={x.emom ? "Minutes" : "Séries"}>
            <Nombre valeur={x.series} onChange={set("series")} label={`Séries de l'exercice ${i + 1}`} />
          </Champ>
        )}
        <Champ label={test ? "Durée du test" : "Répétitions"}>
          <input className={champ} value={x.reps} maxLength={30} placeholder={test ? "1'" : "10, 30 s, max…"}
            onChange={(ev) => set("reps")(ev.target.value)} />
        </Champ>
        {test ? (
          <Champ label="Charge">
            <input className={champ} value={x.charge} maxLength={40} placeholder="poids du corps"
              onChange={(ev) => set("charge")(ev.target.value)} />
          </Champ>
        ) : (
          <Champ label="Précision">
            <input className={champ} value={x.unite} maxLength={30} placeholder="par bras, par côté…"
              onChange={(ev) => set("unite")(ev.target.value)} />
          </Champ>
        )}
      </div>
      {!test && (
        <div className={`grid gap-2 ${amrap || x.emom ? "grid-cols-1" : "grid-cols-[5.5rem_1fr]"}`}>
          {!amrap && !x.emom && (
            <Champ label="Repos">
              <ChampDuree valeur={x.recup_s} onChange={set("recup_s")} uniteParDefaut="auto" label={`Repos de l'exercice ${i + 1}`} placeholder="1'30" />
            </Champ>
          )}
          <Champ label="Charge">
            <input className={champ} value={x.charge} maxLength={40} placeholder="20 kg, élastique rouge…"
              onChange={(ev) => set("charge")(ev.target.value)} />
          </Champ>
        </div>
      )}
      <Champ label="Note (facultatif)">
        <input className={champ} value={x.notes} maxLength={150} placeholder="tempo, amplitude, consigne…"
          onChange={(ev) => set("notes")(ev.target.value)} />
      </Champ>
      {!test && !amrap && (
        <div className="flex items-center justify-between gap-3 px-0.5">
          <span className="text-[14px]">EMOM <span className="text-label-2 text-[12px]">(une série au début de chaque minute)</span></span>
          <Interrupteur actif={x.emom} onChange={set("emom")} label={`EMOM pour l'exercice ${i + 1}`} />
        </div>
      )}
    </div>
  );
}

function Section({ s, i, total, onChange, outils }) {
  const exos = s.exercices;
  const maj = (liste) => onChange({ ...s, exercices: liste });
  return (
    <div className="rounded-2xl border border-separateur p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <input className={`${champ} flex-1 font-semibold`} value={s.titre} maxLength={60}
          placeholder={`Bloc ${i + 1} (titre facultatif)`} aria-label={`Titre du bloc ${i + 1}`}
          onChange={(ev) => onChange({ ...s, titre: ev.target.value })} />
        {outils}
      </div>
      <div className="flex items-center gap-2">
        <Segmente className="flex-1" label={`Format du bloc ${i + 1}`} options={MODES_SECTION} valeur={s.mode}
          onChange={(mode) => onChange({ ...s, mode, duree_min: mode === "amrap" ? s.duree_min || 10 : s.duree_min })} />
        {s.mode !== "test" && (
          <label className="flex items-center gap-1.5 shrink-0">
            <input className={`${champ} !w-14 text-center`} inputMode="numeric" value={s.duree_min ?? ""}
              aria-label={`Durée du bloc ${i + 1} en minutes`} placeholder="—"
              onChange={(ev) => {
                const v = ev.target.value.replace(/\D/g, "");
                onChange({ ...s, duree_min: v ? Math.min(180, Math.max(1, Number(v))) : null });
              }} />
            <span className="text-[13px] text-label-2">min</span>
          </label>
        )}
      </div>
      {s.mode === "amrap" && (
        <p className="text-[12px] leading-4 text-label-2 px-0.5">Enchaîner les exercices en boucle, le plus de tours possible dans le temps.</p>
      )}
      {exos.map((x, k) => (
        <Exercice key={k} x={x} i={k} mode={s.mode} onChange={(v) => maj(remplacer(exos, k, v))}
          outils={<Outils index={k} total={exos.length} nom={`l'exercice ${k + 1}`}
            onMonter={() => maj(deplacer(exos, k, -1))} onDescendre={() => maj(deplacer(exos, k, 1))}
            onSupprimer={() => maj(retirer(exos, k))} />} />
      ))}
      {exos.length < 30 && (
        <button type="button" className="btn-gris btn-sm w-full" onClick={() => maj([...exos, exerciceVide()])}>+ Exercice</button>
      )}
      {total > 1 && <span className="sr-only">Bloc {i + 1} sur {total}</span>}
    </div>
  );
}

function EditeurMuscu({ s, onChange }) {
  const sections = s.sections;
  const maj = (liste) => onChange({ ...s, sections: liste });
  return (
    <div className="space-y-2.5">
      <Champ label="Échauffement (facultatif)">
        <input className={champ} value={s.echauffement} maxLength={300} placeholder="5' de rameur, mobilité épaules…"
          onChange={(ev) => onChange({ ...s, echauffement: ev.target.value })} />
      </Champ>
      {sections.map((sec, i) => (
        <Section key={i} s={sec} i={i} total={sections.length} onChange={(v) => maj(remplacer(sections, i, v))}
          outils={<Outils index={i} total={sections.length} nom={`le bloc ${i + 1}`}
            onMonter={() => maj(deplacer(sections, i, -1))} onDescendre={() => maj(deplacer(sections, i, 1))}
            onSupprimer={() => maj(retirer(sections, i))} />} />
      ))}
      {sections.length < 12 && (
        <button type="button" className="btn-gris btn-sm w-full" onClick={() => maj([...sections, sectionVide()])}>+ Bloc d'exercices</button>
      )}
      <Champ label="Consignes (facultatif)">
        <textarea rows={2} className={champ} value={s.consignes} maxLength={2000}
          onChange={(ev) => onChange({ ...s, consignes: ev.target.value })} placeholder="Matériel, étirements, remarque…" />
      </Champ>
    </div>
  );
}

export default function EditeurBlocs({ structure, sport, onChange }) {
  return structure.type === "muscu"
    ? <EditeurMuscu s={structure} onChange={onChange} />
    : <EditeurEndurance s={structure} sport={sport} onChange={onChange} />;
}

// Contrôles avant enregistrement (mêmes limites que le serveur) ; message lisible ou null
export function erreurStructure(s) {
  if (!s) return null;
  if (s.type === "muscu") {
    if (!s.sections.length) return "Ajoute au moins un bloc d'exercices.";
    for (const sec of s.sections) {
      if (!sec.exercices.length) return "Chaque bloc doit contenir au moins un exercice.";
      if (sec.exercices.some((x) => !x.nom.trim())) return "Donne un nom à chaque exercice.";
      if (sec.exercices.some((x) => x.recup_s === undefined)) return "Un repos est illisible : écris par exemple 90 s ou 1'30.";
      if (sec.exercices.some((x) => x.recup_s > 900)) return "Repos de 15 min au maximum.";
    }
    return null;
  }
  if (!s.etapes.length) return "Ajoute au moins une étape.";
  for (const e of s.etapes) {
    if (e.duree_s === undefined || e.recup_s === undefined) return "Une durée est illisible : écris par exemple 10', 1'30, 45 s ou 1h15.";
    if (e.recup_s > 3600) return "Récupération d'une heure au maximum.";
    if (e.duree_s > 36000) return "Étape de 10 h au maximum.";
    if (e.distance_m != null && e.duree_s == null && e.distance_m < 50) return "Distance de 50 m au minimum.";
    if (allureFausse(e.allure_min) || allureFausse(e.allure_max)) {
      return "Allure au format min:s, par exemple 4:35.";
    }
  }
  return null;
}
