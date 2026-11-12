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
  const max = /\bmax/i.test(`${e.reps ?? ""} ${e.nom} ${e.notes.join(" ")}`);
  // Test « max en 1 min » : chronométré comme un exercice en durée
  const dureeMax = max ? /(\d+)\s*(min|['′]|s\b|sec)/i.exec(e.reps ?? "") : null;
  const duree = secondes(e.reps) ?? (dureeMax ? secondes(`${dureeMax[1]}${/s/i.test(dureeMax[2]) ? " s" : " min"}`) : null);
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
    amrap: section?.amrap ?? null, // minutes du circuit AMRAP auquel l'exercice appartient
    max, // test : on note les reps faites
  };
}

export function construireSeance(r) {
  const sections = r.sections.slice();
  const sectionEchauffement = sections[0] && /échauff/i.test(sections[0].titre ?? "") ? sections.shift() : null;
  const exercices = sections.flatMap((s, j) => s.exercices.map((e) => ({ ...preparer(e, s), bloc: j })));

  const etapes = [{ type: "echauffement", texte: echauffement(r.intro, sectionEchauffement) }];
  exercices.forEach((e, k) => {
    if (e.amrap) {
      // Tout le circuit en une étape : seul le premier exercice du bloc la crée
      if (k > 0 && exercices[k - 1].amrap && exercices[k - 1].bloc === e.bloc) return;
      const ks = exercices.map((x, i) => (x.amrap && x.bloc === e.bloc ? i : -1)).filter((i) => i >= 0);
      etapes.push({ type: "amrap", k, ks, minutes: e.amrap });
      etapes.push({ type: "ressenti", k, ks, amrap: true });
      return;
    } else if (e.emom) {
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
  if (e.amrap) return `${e.reps ?? "?"}${e.unite ? ` ${e.unite}` : ""} / tour`;
  if (e.max && e.series <= 1) return e.reps ?? "Max";
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
