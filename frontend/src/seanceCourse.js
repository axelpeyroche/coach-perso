// Séance d'endurance guidée : le contenu lu par `analyserDescription` (phases
// « Échauffement : 15' … », « Corps de séance : 3 × 10' au seuil (…), récup 2' … »)
// est déplié en étapes minutées, une par effort et par récupération.

const DUREE = String.raw`(\d+)\s*(?:['′]\s*(\d{2})?|\s*(min|s|sec)\b)`;
const RE_REPETITION = new RegExp(String.raw`^(?:(\d+)\s*[×x]\s*)?${DUREE}\s*(?:de\s+|d['’]\s*)?`, "i");
const RE_RECUP = new RegExp(String.raw`,?\s*r[ée]cup(?:[ée]ration)?\s*(?:de\s+)?${DUREE}([^,.;]*)`, "i");

// (minutes, secondes collées, unité) → secondes
function enSecondes(n, sec, unite) {
  if (unite && /^s/i.test(unite)) return Number(n);
  return Number(n) * 60 + Number(sec || 0);
}

const majuscule = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

// « Au seuil (Z4, 168–176 bpm) » → { nom: « Au seuil », cible: « Z4, 168–176 bpm » }
function separerCible(texte) {
  const cibles = [];
  const nom = texte.replace(/\s*\(([^()]*)\)/g, (_, c) => { cibles.push(c.trim()); return ""; })
    .replace(/\s+,/g, ",").replace(/[\s,.;]+$/, "").trim();
  return { nom: majuscule(nom), cible: cibles.join(" · ") || null };
}

function typePhase(label) {
  const l = label.toLowerCase();
  if (l.startsWith("échauffement")) return "echauffement";
  if (l.startsWith("retour")) return "retour";
  if (l.startsWith("récup")) return "recup";
  return "effort";
}

// Étapes : { type: echauffement|effort|recup|retour, label, nom, cible, duree_s (null = à la main), rep, reps }
export function construireCourse(contenu) {
  if (contenu?.type !== "endurance") return [];
  const etapes = [];
  for (const p of contenu.phases ?? []) {
    const type = typePhase(p.label);
    // la durée a pu être retirée du texte par la lecture de la phase : on la remet devant
    const brut = `${p.duree ? `${p.duree.replace(/(\d+) min/g, "$1'")} ` : ""}${p.texte ?? ""}`.trim();
    const m = RE_REPETITION.exec(brut);
    let reste = m ? brut.slice(m[0].length) : brut;
    const n = m?.[1] ? Math.min(60, Number(m[1])) : 1;
    const duree = m ? enSecondes(m[2], m[3], m[4]) : null;

    let recup = null;
    const r = RE_RECUP.exec(reste);
    if (r && n > 1) {
      recup = { duree_s: enSecondes(r[1], r[2], r[3]), nom: majuscule(r[4].trim().replace(/^(en|de)\s+/i, "")) || "Récupération" };
      reste = (reste.slice(0, r.index) + reste.slice(r.index + r[0].length)).trim();
    }
    const { nom, cible } = separerCible(reste);

    if (n > 1 && duree) {
      for (let i = 1; i <= n; i += 1) {
        etapes.push({ type: "effort", label: p.label, nom: nom || "Effort", cible, duree_s: duree, rep: i, reps: n });
        if (recup && i < n) {
          etapes.push({ type: "recup", label: "Récupération", nom: recup.nom, cible: null, duree_s: recup.duree_s, rep: i, reps: n });
        }
      }
    } else {
      etapes.push({ type, label: p.label, nom: nom || p.label, cible, duree_s: duree || null, rep: null, reps: null });
    }
  }
  return etapes;
}

// Guidable s'il y a au moins deux étapes dont une minutée
export function courseGuidable(contenu) {
  const e = construireCourse(contenu);
  return e.length >= 2 && e.some((x) => x.duree_s);
}

export const dureeCourse = (etapes) => etapes.reduce((t, e) => t + (e.duree_s || 0), 0);

export const LIBELLES_ETAPE = { echauffement: "Échauffement", effort: "Effort", recup: "Récupération", retour: "Retour au calme" };
