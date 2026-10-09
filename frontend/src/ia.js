// Assistants IA compatibles : le carnet ne dépend d'aucun d'eux. On copie une
// consigne (+ le carnet), on la colle dans l'IA de son choix, et pour le plan on
// recolle sa réponse dans l'onglet Plan. Aucune clé ni abonnement nécessaire.

export const IAS = [
  { id: "chatgpt", nom: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "gemini", nom: "Gemini", url: "https://gemini.google.com/app" },
  { id: "claude", nom: "Claude", url: "https://claude.ai/new" },
  { id: "lechat", nom: "Le Chat", url: "https://chat.mistral.ai/chat" },
  { id: "copilot", nom: "Copilot", url: "https://copilot.microsoft.com/" },
];

export const SPORTS_PLAN = "course, trail, velo, marche, randonnee, natation, muscu, hiit, yoga, autre";

const fmtJour = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// `source` : le lien secret, ou « (contenu ci-dessous) » quand le carnet est collé à la suite
export const promptAnalyse = (source) => `Tu es mon coach sportif. Voici l'export complet de mon carnet d'entraînement (profil, objectifs, statistiques et toutes mes séances) : ${source}

Analyse-le en profondeur :
1. Mon volume, ma régularité et l'évolution de ma charge (ACWR) — y a-t-il des risques ?
2. Mes progrès (allures, efficacité cardiaque, records) et mes points faibles.
3. Pour chaque objectif actif : suis-je dans les temps ? La prédiction est-elle réaliste ?
4. Des recommandations concrètes pour les 4 prochaines semaines.`;

export const promptPlan = (source, lundi) => `Tu es mon coach sportif. Voici l'export complet de mon carnet d'entraînement (profil, objectifs, charge, historique des séances et plan déjà prévu) : ${source}

Prépare mon plan pour la semaine du ${fmtJour(lundi)}, en tenant compte de mes objectifs, de ma charge récente, de ma forme et des remarques de mes dernières séances.

Explique d'abord brièvement tes choix, puis termine OBLIGATOIREMENT par un unique bloc de code JSON (je le collerai dans mon appli), exactement dans ce format :

\`\`\`json
{
  "seances": [
    {
      "jour": "${lundi}",
      "sport": "course",
      "titre": "Footing endurance",
      "description": "Échauffement 10 min, 30 min en endurance fondamentale, 5 min retour au calme",
      "duree_min": 45,
      "distance_km": 8,
      "dplus_m": 0,
      "rpe_cible": 4
    }
  ]
}
\`\`\`

Règles du JSON :
- une entrée par séance ; "jour" au format AAAA-MM-JJ, n'importe quel jour de cette semaine (il sert seulement à rattacher la séance à la semaine) ;
- "sport" parmi : ${SPORTS_PLAN} ;
- "titre" court (il deviendra le nom de la séance dans mon carnet) ; "description" détaillée (échauffement, blocs, allures ou FC, récupérations, exercices et répétitions) ;
- "duree_min", "distance_km", "dplus_m", "rpe_cible" (1 à 10) sont facultatifs : mets null si non pertinent ;
- pas de commentaire dans le JSON.`;

// ── Lecture de la réponse collée ────────────────────────────────────────────

const CHAMPS = {
  jour: ["jour", "date", "day"],
  sport: ["sport", "type", "activite", "activity"],
  titre: ["titre", "title", "nom", "name"],
  description: ["description", "contenu", "details", "detail", "content"],
  duree_min: ["duree_min", "duree", "durée", "duration_min", "duration"],
  distance_km: ["distance_km", "distance"],
  dplus_m: ["dplus_m", "dplus", "d+", "denivele", "elevation"],
  rpe_cible: ["rpe_cible", "rpe", "intensite"],
};

function nombre(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extraireJson(texte) {
  const blocs = [...texte.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const candidats = [...blocs.reverse(), texte];
  for (const c of candidats) {
    const debut = c.search(/[[{]/);
    if (debut < 0) continue;
    const fin = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]"));
    if (fin <= debut) continue;
    try { return JSON.parse(c.slice(debut, fin + 1)); } catch { /* candidat suivant */ }
  }
  return null;
}

// Renvoie { seances, erreurs } ; tolère les variantes de noms de champs des différentes IA
export function lirePlanColle(texte) {
  const brut = extraireJson(texte || "");
  if (!brut) return { seances: [], erreurs: ["Aucun bloc JSON lisible dans le texte collé. Copie bien toute la réponse de l'IA, bloc de code compris."] };
  const liste = Array.isArray(brut) ? brut : brut.seances ?? brut.sessions ?? brut.plan ?? brut.workouts;
  if (!Array.isArray(liste) || !liste.length) return { seances: [], erreurs: ["Le JSON ne contient aucune séance (liste « seances » attendue)."] };
  const erreurs = [];
  const seances = [];
  liste.forEach((s, i) => {
    if (!s || typeof s !== "object") { erreurs.push(`Séance ${i + 1} : format illisible.`); return; }
    const lc = Object.fromEntries(Object.entries(s).map(([k, v]) => [k.toLowerCase(), v]));
    const val = (champ) => CHAMPS[champ].map((k) => lc[k]).find((v) => v !== undefined && v !== null && v !== "");
    const titre = String(val("titre") ?? "").trim().slice(0, 200);
    if (!titre) { erreurs.push(`Séance ${i + 1} : titre manquant, ignorée.`); return; }
    const jour = String(val("jour") ?? "").slice(0, 10);
    const rpe = nombre(val("rpe_cible"));
    seances.push({
      jour: /^\d{4}-\d{2}-\d{2}$/.test(jour) ? jour : null,
      sport: String(val("sport") ?? "autre").trim().toLowerCase(),
      titre,
      description: val("description") != null ? String(val("description")).trim() : null,
      duree_min: nombre(val("duree_min")) != null ? Math.round(nombre(val("duree_min"))) : null,
      distance_km: nombre(val("distance_km")),
      dplus_m: nombre(val("dplus_m")) != null ? Math.round(nombre(val("dplus_m"))) : null,
      rpe_cible: rpe != null && rpe >= 1 && rpe <= 10 ? rpe : null,
    });
  });
  return { seances, erreurs };
}
