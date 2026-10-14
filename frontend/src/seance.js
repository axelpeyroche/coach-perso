// Lecture du contenu texte d'une séance prévue (description rédigée par le plan
// hebdomadaire) pour l'afficher de façon structurée :
//  - muscu : sections en MAJUSCULES et exercices numérotés
//    « 1. Nom : séries × reps · récup — charge (notes) » ;
//  - endurance : phases « Échauffement : … », « Corps de séance : … », « Puis … » ;
//  - sinon : texte brut.

const RE_EXERCICE = /^\s*(\d+)[.)]\s+(.+?)\s+:\s+(.+)$/;
const RE_PHASE = /^(échauffement|corps de séance|retour au calme|récupération|récup|puis|ensuite|bloc \d+)\b\s*:?\s*(.*)$/i;
const RE_DUREE = /^\d+\s*(?:'\s*\d{0,2}|′\s*\d{0,2}|\s*s|\s*sec|\s*min)$/i;
const EMOM_PARENTHESE = /^1 série au début de chaque minute/i;

const majuscule = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const sansPoint = (t) => t.trim().replace(/[.;,\s]+$/, "");

// « 2' » → « 2 min » ; « 1'30 », « 45 s » inchangés
export function fmtRecup(t) {
  const m = /^(\d+)\s*['′]$/.exec(t.trim());
  return m ? `${m[1]} min` : t.trim().replace(/\s*sec$/i, " s");
}

function estEntete(ligne) {
  const lettres = ligne.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  return lettres.length >= 3 && lettres === lettres.toUpperCase() && ligne.length <= 60 && !RE_EXERCICE.test(ligne);
}

function lireEntete(ligne) {
  let titre = ligne.trim();
  let duree = null;
  const m = /\(\s*(\d+)\s*(?:'|′|min)\s*\)\s*$/i.exec(titre);
  if (m) { duree = `${m[1]} min`; titre = titre.slice(0, m.index).trim(); }
  return { titre: majuscule(titre.toLowerCase()), duree };
}

// Partage « a. b » à la première fin de phrase (point suivi d'une espace)
function couperPhrase(t) {
  const i = t.search(/\.\s/);
  return i < 0 ? [t, ""] : [t.slice(0, i), t.slice(i + 1).trim()];
}

function lireExercice(numero, nomBrut, reste) {
  const emom = /\bEMOM\b/i.test(nomBrut) || /^EMOM\b/i.test(reste);
  const nom = nomBrut.replace(/\s+en\s+EMOM\b/i, "").replace(/\s*\bEMOM\b\s*/i, " ").trim();

  // Les parenthèses deviennent des notes
  const parentheses = [];
  const sans = reste.replace(/\s*\(([^()]*)\)/g, (_, c) => { parentheses.push(c.trim()); return ""; }).replace(/\s+,/g, ",");

  const [prescriptionBrute, apresTiret = ""] = sans.split(/\s+[—–]\s+/, 2);
  const [prescription, phraseSuite] = couperPhrase(prescriptionBrute.trim());
  const notes = [];

  // « 3 × 12 par bras · 10 s de maintien · 1' »
  const segments = sansPoint(prescription).split(/\s*·\s*/).filter(Boolean);
  let series = null, reps = null, unite = null, recup = null;
  const m = /^(\d+)\s*[×x]\s*(.+)$/.exec(segments[0] ?? "");
  if (m) {
    series = m[1];
    const r = /^(\d+(?:[,.]\d+)?(?:\s*(?:s|sec|min|m|'|′)\b|['′])?)\s*(.*)$/.exec(m[2].trim());
    reps = r ? r[1].replace(/\s*sec$/, " s") : m[2].trim();
    unite = r?.[2] || null;
  } else if (segments[0]) {
    reps = segments[0];
  }
  segments.slice(1).forEach((seg, i, tab) => {
    if (i === tab.length - 1 && RE_DUREE.test(seg)) recup = fmtRecup(seg);
    else notes.push(seg);
  });
  if (phraseSuite) notes.push(phraseSuite);

  // « — 10 kg par main, descente 3 s. Consigne… »
  let charge = null;
  if (apresTiret) {
    const [chargeBrute, suite] = couperPhrase(apresTiret.trim());
    const [c, ...modif] = sansPoint(chargeBrute).split(/,\s*/);
    charge = c || null;
    if (modif.length) notes.push(modif.join(", "));
    if (suite) notes.push(suite);
  }

  let historique = null;
  parentheses.forEach((p) => {
    if (emom && EMOM_PARENTHESE.test(p)) return;
    const h = /^dernière fois\s*:?\s*(.*)$/i.exec(p);
    if (h && !historique) historique = sansPoint(h[1]);
    else notes.push(p);
  });

  return {
    numero, nom, emom, charge, recup, unite,
    series: series && emom ? `${series} min` : series,
    reps,
    notes: notes.map(sansPoint).filter(Boolean).map(majuscule),
    historique,
  };
}

function lireMuscu(lignes) {
  const intro = [];
  const fin = [];
  const sections = [];
  for (const brute of lignes) {
    const ligne = brute.trim();
    if (!ligne) continue;
    const ex = RE_EXERCICE.exec(ligne);
    if (ex) {
      if (!sections.length) sections.push({ titre: null, duree: null, exercices: [] });
      sections[sections.length - 1].exercices.push(lireExercice(ex[1], ex[2], ex[3]));
    } else if (estEntete(ligne)) {
      sections.push({ ...lireEntete(ligne), exercices: [] });
    } else if (!sections.length) {
      intro.push(ligne);
    } else {
      fin.push(ligne);
    }
  }
  // La consigne de format est évidente une fois le tableau affiché
  const introUtile = intro.map((t) => t.replace(/\s*Format\s*:\s*séries[^.]*\.\s*/i, " ").trim()).filter(Boolean);
  return { type: "muscu", intro: introUtile, sections: sections.filter((s) => s.exercices.length), fin };
}

// « 10' de trot » → durée « 10 min », texte « Trot » ; « 3 × 8' en tempo » → « 3 × 8 min »
function lirePhase(label, texte) {
  let duree = null;
  let t = texte.trim();
  const m = /^(?:(\d+)\s*[×x]\s*)?(\d+)\s*(?:['′](\d{2})?|\s*min\b)\s*(?:de\s+|d['’]\s*)?/i.exec(t);
  if (m) {
    const base = m[3] ? `${m[2]}'${m[3]}` : `${m[2]} min`;
    duree = m[1] ? `${m[1]} × ${base}` : base;
    t = t.slice(m[0].length);
  }
  return { label: majuscule(label.toLowerCase()), duree, texte: majuscule(t.trim()) };
}

function lireEndurance(lignes) {
  const intro = [];
  const phases = [];
  const consignes = [];
  for (const brute of lignes) {
    const ligne = brute.trim();
    if (!ligne) continue;
    const m = RE_PHASE.exec(ligne);
    if (m && m[2]) phases.push(lirePhase(m[1], m[2]));
    else if (!phases.length) intro.push(ligne);
    else consignes.push(ligne);
  }
  return { type: "endurance", intro, phases, consignes };
}

export function analyserDescription(texte) {
  if (!texte?.trim()) return null;
  const lignes = texte.split(/\r?\n/);
  const exercices = lignes.filter((l) => RE_EXERCICE.test(l.trim())).length;
  if (exercices >= 2) {
    const r = lireMuscu(lignes);
    if (r.sections.length) return r;
  }
  const phases = lignes.filter((l) => { const m = RE_PHASE.exec(l.trim()); return m && m[2]; }).length;
  if (phases >= 2) return lireEndurance(lignes);
  return { type: "texte", texte: texte.trim() };
}
