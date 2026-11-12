// Séance construite par blocs (éditeur du Plan).
// La structure JSON est stockée telle quelle (envoi sur la montre) ; la description
// lisible est écrite ici, au format que lisent l'affichage (seance.js) et les
// séances guidées (seanceCourse.js, seanceGuidee.js) :
//  - endurance : « Échauffement : 15' footing », « Corps de séance : 3 × 10' au seuil (Z4), récup 2' en trottinant »… ;
//  - muscu : sections en MAJUSCULES et exercices « 1. Nom : 3 × 10 · 1'30 — 20 kg (note) ».
import { analyserDescription } from "./seance";

export const GENRES = [
  ["echauffement", "Échauffement"],
  ["corps", "Corps de séance"],
  ["bloc", "Bloc"],
  ["recup", "Récupération"],
  ["retour", "Retour au calme"],
];
export const MODES_SECTION = [["series", "Séries"], ["amrap", "AMRAP"], ["test", "Test"]];

const SPORTS_MUSCU = new Set(["muscu", "hiit", "yoga"]);
export const typePourSport = (sport) => (SPORTS_MUSCU.has(sport) ? "muscu" : "endurance");

export const etapeVide = (genre = "corps") => ({
  genre, repetitions: 1, duree_s: 600, distance_m: null,
  texte: "", zone: null, allure_min: null, allure_max: null, rpe: null, recup_s: null, recup_texte: "",
});
export const exerciceVide = () => ({ nom: "", series: 3, reps: "10", unite: "", recup_s: 90, charge: "", notes: "", emom: false });
export const sectionVide = (mode = "series") => ({ titre: "", mode, duree_min: mode === "amrap" ? 10 : null, exercices: [exerciceVide()] });

export function structureVide(type) {
  return type === "muscu"
    ? { type: "muscu", echauffement: "", sections: [sectionVide()], consignes: "" }
    : {
      type: "endurance", consignes: "",
      etapes: [{ ...etapeVide("echauffement"), duree_s: 900 }, etapeVide("corps"), { ...etapeVide("retour"), duree_s: 600 }],
    };
}

// ── Durées ─────────────────────────────────────────────────────────────────
// 900 → « 15' », 90 → « 1'30 », 45 → « 45 s »
export function fmtDureeCourte(s) {
  const t = Math.max(0, Math.round(Number(s) || 0));
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60), r = t % 60;
  return r ? `${m}'${String(r).padStart(2, "0")}` : `${m}'`;
}

// « 15 », « 15' », « 1'30 », « 1:30 », « 45 s », « 2 min », « 1h30 » → secondes (null si illisible).
// Unité d'un nombre seul : minutes, secondes, ou « auto » (repos : ≤ 10 → minutes, sinon secondes)
export function lireDuree(texte, uniteParDefaut = "min") {
  const t = String(texte ?? "").trim().replace(",", ".");
  if (!t) return null;
  let m = /^(\d+)\s*h\s*(?:(\d{1,2})\s*(?:min|['′])?)?$/i.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2] || 0) * 60;
  m = /^(\d+)\s*(?:['′:]|min(?:utes?)?\s*)\s*(\d{1,2})?\s*$/i.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
  m = /^(\d+)\s*(?:s|sec|secondes?)$/i.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    const enSecondes = uniteParDefaut === "s" || (uniteParDefaut === "auto" && n > 10);
    return Math.round(n * (enSecondes ? 1 : 60));
  }
  return null;
}

// Les caractères qui structurent le texte ne doivent pas venir des champs saisis
const propre = (t) => String(t ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const sansSeparateurs = (t) => propre(t).replace(/\s*[·—–]\s*/g, " - ").replace(/\s+:\s+/g, " - ");
const sansParentheses = (t) => propre(t).replace(/[()]/g, "");

// ── Endurance ──────────────────────────────────────────────────────────────
function libelle(genre, nBloc) {
  if (genre === "bloc") return `Bloc ${nBloc}`;
  return Object.fromEntries(GENRES)[genre] ?? "Corps de séance";
}

function cible(e) {
  const morceaux = [];
  if (e.zone) morceaux.push(`Z${e.zone}`);
  if (e.allure_min) morceaux.push(e.allure_max && e.allure_max !== e.allure_min ? `${e.allure_min}–${e.allure_max} /km` : `${e.allure_min} /km`);
  if (e.rpe) morceaux.push(`RPE ${e.rpe}`);
  return morceaux.join(", ");
}

function mesure(e) {
  if (e.duree_s) return fmtDureeCourte(e.duree_s);
  if (e.distance_m) return e.distance_m >= 1000 ? `${String(e.distance_m / 1000).replace(".", ",")} km` : `${e.distance_m} m`;
  return "";
}

function ligneEtape(e, nBloc) {
  const n = Math.max(1, Number(e.repetitions) || 1);
  const c = cible(e);
  let corps = [n > 1 ? `${n} ×` : "", mesure(e), sansParentheses(e.texte)].filter(Boolean).join(" ");
  if (c) corps += ` (${c})`;
  if (n > 1 && e.recup_s) corps += `, récup ${fmtDureeCourte(e.recup_s)}${e.recup_texte ? ` ${sansParentheses(e.recup_texte)}` : ""}`;
  return `${libelle(e.genre, nBloc)} : ${corps || "à l'envie"}`;
}

// ── Muscu ──────────────────────────────────────────────────────────────────
function enteteSection(s, i) {
  const brut = sansParentheses(s.titre).toUpperCase();
  if (s.mode === "amrap") return `${brut.replace(/\s*\bAMRAP\b.*$/, "")} AMRAP ${s.duree_min || 10} MIN`.trim();
  if (s.mode === "test") return /\bTEST\b/.test(brut) ? brut : `${brut} TEST`.trim();
  const titre = brut || `BLOC ${i + 1}`;
  return s.duree_min ? `${titre} (${s.duree_min}')` : titre;
}

function ligneExercice(x, n, mode) {
  const nom = sansSeparateurs(x.nom) || "Exercice";
  const series = Math.max(1, Number(x.series) || 1);
  const reps = sansSeparateurs(x.reps);
  const unite = sansSeparateurs(x.unite);
  let presc;
  if (mode === "test") {
    presc = `${series} × max en ${reps || "1'"}`;
  } else if (mode === "amrap") {
    presc = `${reps || "?"}${unite ? ` ${unite}` : ""}`;
  } else if (x.emom) {
    presc = `${series} × ${reps || "?"}${unite ? ` ${unite}` : ""} (1 série au début de chaque minute)`;
  } else {
    presc = `${series} × ${reps || "?"}${unite ? ` ${unite}` : ""}`;
    if (x.recup_s && mode !== "amrap") presc += ` · ${fmtDureeCourte(x.recup_s)}`;
  }
  const charge = sansSeparateurs(x.charge).replace(/,/g, " ");
  const notes = sansParentheses(x.notes);
  return `${n}. ${nom}${x.emom && mode !== "test" ? " EMOM" : ""} : ${presc}${charge ? ` — ${charge}` : ""}${notes ? ` (${notes})` : ""}`;
}

// ── Description lisible ────────────────────────────────────────────────────
export function descriptionDepuis(structure) {
  if (!structure) return "";
  const lignes = [];
  if (structure.type === "muscu") {
    if (propre(structure.echauffement)) lignes.push(`Échauffement : ${propre(structure.echauffement).replace(/\.?$/, ".")}`, "");
    let n = 0;
    structure.sections.forEach((s, i) => {
      lignes.push(enteteSection(s, i));
      s.exercices.forEach((x) => { n += 1; lignes.push(ligneExercice(x, n, s.mode)); });
      lignes.push("");
    });
  } else {
    let nBloc = 0;
    structure.etapes.forEach((e) => {
      if (e.genre === "bloc") nBloc += 1;
      lignes.push(ligneEtape(e, nBloc));
    });
    lignes.push("");
  }
  const consignes = String(structure.consignes ?? "").trim();
  if (consignes) lignes.push(consignes);
  return lignes.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Durée estimée (minutes), pour préremplir le champ Durée
export function dureeEstimee(structure) {
  if (!structure) return null;
  let s = 0;
  if (structure.type === "muscu") {
    if (propre(structure.echauffement)) s += 600;
    for (const sec of structure.sections) {
      if (sec.mode === "amrap") { s += (sec.duree_min || 10) * 60; continue; }
      if (sec.duree_min) { s += sec.duree_min * 60; continue; }
      for (const x of sec.exercices) {
        const n = Math.max(1, Number(x.series) || 1);
        if (x.emom) s += n * 60;
        else if (sec.mode === "test") s += n * ((lireDuree(x.reps) ?? 60) + 120);
        else s += n * 45 + (n - 1) * (x.recup_s ?? 60) + 60;
      }
    }
  } else {
    for (const e of structure.etapes) {
      const n = Math.max(1, Number(e.repetitions) || 1);
      if (!e.duree_s) return null;  // une étape en distance : durée inconnue
      s += n * e.duree_s + (n > 1 ? (n - 1) * (e.recup_s || 0) : 0);
    }
  }
  return s ? Math.round(s / 60) : null;
}

// ── Lecture d'une description existante (pour passer du texte aux blocs) ────
const RE_TETE = /^(?:(\d+)\s*[×x]\s*)?(?:(\d+)\s*(?:['′’](\d{2})?|min(?:utes?)?\b|(s|sec|secondes?)\b)|(\d+(?:[.,]\d+)?)\s*(km|m)\b)\s*(?:de\s+|d['’]\s*)?/i;
const RE_RECUP = /,?\s*r[ée]cup(?:[ée]ration)?\s*(?:de\s+)?(\d+)\s*(?:['′’]\s*(\d{2})?|\s*(min(?:utes?)?|s|sec(?:ondes?)?)\b)([^,.;]*)/i;
const RE_PHASE = /^(échauffement|corps de séance|retour au calme|récupération|récup|puis|ensuite|bloc \d+)\b\s*:?\s*(.*)$/i;

function genreDe(label) {
  const l = label.toLowerCase();
  if (l.startsWith("échauffement")) return "echauffement";
  if (l.startsWith("retour")) return "retour";
  if (l.startsWith("récup")) return "recup";
  return l.startsWith("bloc") ? "bloc" : "corps";
}

function enduranceDepuis(texte) {
  const etapes = [];
  const consignes = [];
  for (const brute of texte.split(/\r?\n/)) {
    const ligne = brute.trim();
    if (!ligne) continue;
    const m = RE_PHASE.exec(ligne);
    if (!m || !m[2].trim()) { consignes.push(ligne); continue; }  // intro et consignes gardées
    let reste = m[2].trim();
    const e = etapeVide(genreDe(m[1]));
    const t = RE_TETE.exec(reste);
    if (t) {
      e.repetitions = Math.min(60, Number(t[1] || 1));
      if (t[5]) {
        const d = Number(t[5].replace(",", "."));
        e.duree_s = null;
        e.distance_m = Math.min(300000, Math.max(1, Math.round(t[6].toLowerCase() === "km" ? d * 1000 : d)));
      } else {
        e.duree_s = t[4] ? Number(t[2]) : Number(t[2]) * 60 + Number(t[3] || 0);
      }
      reste = reste.slice(t[0].length);
    } else {
      e.duree_s = null;
    }
    const r = e.repetitions > 1 ? RE_RECUP.exec(reste) : null;
    if (r) {
      e.recup_s = /^s/i.test(r[3] || "") ? Number(r[1]) : Number(r[1]) * 60 + Number(r[2] || 0);
      e.recup_texte = r[4].trim().slice(0, 100);
      reste = reste.slice(0, r.index) + reste.slice(r.index + r[0].length);
    }
    const parentheses = [...reste.matchAll(/\(([^()]*)\)/g)].map((x) => x[1]).join(", ");
    const z = /\bZ([1-5])\b/.exec(parentheses);
    if (z) e.zone = Number(z[1]);
    const a = /(\d{1,2}):(\d{2})\s*(?:[-–—]|à)?\s*(?:(\d{1,2}):(\d{2}))?\s*\/\s*km/.exec(parentheses);
    if (a) { e.allure_min = `${a[1]}:${a[2]}`; e.allure_max = a[3] ? `${a[3]}:${a[4]}` : null; }
    const rpe = /RPE\s*(\d+(?:[.,]\d)?)/i.exec(parentheses);
    if (rpe) e.rpe = Number(rpe[1].replace(",", "."));
    // Morceaux de parenthèses non repris par la cible (bpm, « sur piste »…) : gardés dans la consigne
    const autres = parentheses.split(/\s*[,;]\s*/).filter((x) => x && !/^Z[1-5]$/.test(x) && !/\/\s*km/.test(x) && !/^RPE\b/i.test(x));
    e.texte = [reste.replace(/\s*\([^()]*\)/g, "").replace(/[\s,.;]+$/, "").trim(), ...autres].filter(Boolean).join(", ").slice(0, 200);
    etapes.push(e);
  }
  return etapes.length >= 1 ? { type: "endurance", etapes: etapes.slice(0, 30), consignes: consignes.join("\n").slice(0, 2000) } : null;
}

const RE_TEST = /^max en\s*\S/i;
const estTest = (s) => !s.amrap && (/\bTEST\b/i.test(s.titre ?? "") || s.exercices.every((e) => RE_TEST.test(e.reps ?? "")));

function muscuDepuis(r) {
  const sections = r.sections.slice(0, 12).map((s) => ({
    titre: (s.titre ?? "").replace(/\s*AMRAP.*$/i, "").replace(/^bloc \d+$/i, "").trim().slice(0, 60),
    mode: s.amrap ? "amrap" : estTest(s) ? "test" : "series",
    duree_min: s.amrap ?? (s.duree ? parseInt(s.duree, 10) || null : null),
    exercices: s.exercices.slice(0, 30).map((e) => ({
      nom: e.nom.slice(0, 80),
      series: Math.max(1, Math.min(60, parseInt(e.series, 10) || 1)),
      reps: (estTest(s) ? String(e.reps ?? "").replace(/^max en\s*/i, "") : String(e.reps ?? "")).slice(0, 30),
      unite: String(e.unite ?? "").slice(0, 30),
      recup_s: e.recup ? lireDuree(e.recup.replace(/\s*min$/, "'")) : null,
      charge: String(e.charge ?? "").slice(0, 40),
      notes: [e.historique ? `dernière fois : ${e.historique}` : null, ...e.notes].filter(Boolean).join(", ").slice(0, 150),
      emom: !!e.emom,
    })),
  }));
  const intro = r.intro.join(" ");
  const ech = /^échauffement\s*:\s*(.*)$/i.exec(intro);
  return {
    type: "muscu",
    echauffement: (ech ? ech[1] : intro).replace(/\.$/, "").slice(0, 300),
    sections,
    consignes: r.fin.join("\n").slice(0, 2000),
  };
}

// Structure retrouvée dans une description (null si rien d'exploitable)
export function structureDepuisDescription(texte, sport) {
  if (!texte?.trim()) return null;
  if (typePourSport(sport) === "muscu") {
    const r = analyserDescription(texte, { muscu: true });
    return r?.type === "muscu" && r.sections.length ? muscuDepuis(r) : null;
  }
  return enduranceDepuis(texte);
}
