// Séance de muscu guidée : transforme le contenu lu par `analyserDescription`
// en une suite d'étapes affichées une à une en plein écran.
//   echauffement → (repos avant EMOM) → emom | serie, repos, serie… → ressenti → … → fin

// « 1'30 » → 90 ; « 2 min » → 120 ; « 45 s » → 45 ; sinon null
export function secondes(t) {
  if (!t) return null;
  const s = String(t).trim();
  let m = /^(\d+)\s*['′]\s*(\d{1,2})?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
  m = /^(\d+)\s*min$/i.exec(s);
  if (m) return Number(m[1]) * 60;
  m = /^(\d+)\s*s(?:ec)?$/i.exec(s);
  if (m) return Number(m[1]);
  return null;
}

// « Pas d'échauffement ici : ta routine habituelle. » → « Ta routine habituelle »
function echauffement(intro, sectionEchauffement) {
  if (sectionEchauffement) return sectionEchauffement.exercices.map((e) => e.nom).join(" · ");
  for (const ligne of intro) {
    const m = /échauffement[^:]*:\s*([^.]+)/i.exec(ligne);
    if (m) return m[1].trim().replace(/^./, (c) => c.toUpperCase());
  }
  return "Ta routine habituelle";
}

// « Après 2' de pause » (consigne d'un EMOM) → 120
function pauseAvant(notes) {
  for (const n of notes) {
    const m = /après\s+(\d+\s*['′]\s*\d{0,2}|\d+\s*min|\d+\s*s)\s+de\s+(?:pause|repos|récup)/i.exec(n);
    if (m) return secondes(m[1].replace(/\s+/g, ""));
  }
  return null;
}

const RE_HISTO = /^dernière fois\s*:?\s*/i;

// Exercice prêt à afficher
function preparer(e, section) {
  const duree = secondes(e.reps);
  const notes = e.notes.filter((n) => !RE_HISTO.test(n) && !/^après\s+\d/i.test(n));
  const histoNote = e.notes.find((n) => RE_HISTO.test(n));
  return {
    numero: e.numero,
    nom: e.nom,
    section: section?.titre ?? null,
    emom: e.emom,
    series: Math.max(1, parseInt(e.series, 10) || 1),
    reps: e.reps,
    duree, // exercice en durée (planche 45 s…)
    unite: e.unite, // « par bras », « par côté »…
    charge: e.charge,
    recup: secondes(e.recup),
    pause: e.emom ? pauseAvant(e.notes) : null,
    historique: e.historique || (histoNote ? histoNote.replace(RE_HISTO, "") : null),
    consigne: notes[0] ?? null,
  };
}

export function construireSeance(r) {
  const sections = r.sections.slice();
  const sectionEchauffement = sections[0] && /échauff/i.test(sections[0].titre ?? "") ? sections.shift() : null;
  const exercices = sections.flatMap((s) => s.exercices.map((e) => preparer(e, s)));

  const etapes = [{ type: "echauffement", texte: echauffement(r.intro, sectionEchauffement) }];
  exercices.forEach((e, k) => {
    if (e.emom) {
      if (e.pause) etapes.push({ type: "repos", k, duree: e.pause, avantEmom: true });
      etapes.push({ type: "emom", k });
    } else {
      for (let i = 1; i <= e.series; i += 1) {
        etapes.push({ type: "serie", k, i });
        if (i < e.series && e.recup) etapes.push({ type: "repos", k, duree: e.recup, apres: i });
      }
    }
    etapes.push({ type: "ressenti", k });
  });
  etapes.push({ type: "fin" });
  return { exercices, etapes };
}

// Prescription courte d'un exercice : « 3 × 12 », « EMOM 10 min », « 3 × 45 s »
export function prescription(e) {
  if (e.emom) return `EMOM ${e.series} min`;
  return `${e.series} × ${e.reps ?? "?"}`;
}

export const DIFFICULTES = [
  ["facile", "Facile"],
  ["correct", "Correct"],
  ["dur", "Dur"],
  ["echec", "Échec"],
];

// « 92 » → « 1:32 » ; « 3725 » → « 1:02:05 »
export function fmtChrono(s) {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
