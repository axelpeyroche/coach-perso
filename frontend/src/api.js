import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: { "Content-Type": "application/json" },
});

// Déclenché sur un 401 renvoyé par l'API (token expiré/invalide) — l'AuthContext
// s'y abonne pour effacer la session et rediriger vers /login.
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// --- Hors ligne ---
// Lecture : chaque réponse GET est gardée sur l'appareil (Cache API) et resservie quand il n'y a plus de réseau.
// Saisie : les écritures simples (ressenti, marqueurs, poids, séance prévue, nouvelle séance) partent
// dans une file d'attente, rejouée au retour du réseau. Tout est effacé à la déconnexion.
const CACHE_API = "carnet-api";
const CLE_FILE = "file-hors-ligne";
const SECRET = /token|^\/intervals$|^\/push/;
const EN_FILE = /^\/(corps\/(ressenti|marqueurs|mensurations)|corps\/douleurs\/\d+\/releve|plan\/\d+|utilisateur\/profil-fc|activites)$/;
const sansReseau = () => typeof navigator !== "undefined" && navigator.onLine === false;
const cacheDispo = () => typeof caches !== "undefined";
const cleCache = (c) => "https://carnet.cache/" + encodeURIComponent(`${c.url}?${JSON.stringify(c.params ?? {})}`);
const signaler = (nom, detail) => { try { window.dispatchEvent(new CustomEvent(nom, { detail })); } catch { /* hors navigateur */ } };

export function fileHorsLigne() {
  try { const f = JSON.parse(localStorage.getItem(CLE_FILE) || "[]"); return Array.isArray(f) ? f : []; } catch { return []; }
}
function ecrireFile(f) {
  try { f.length ? localStorage.setItem(CLE_FILE, JSON.stringify(f)) : localStorage.removeItem(CLE_FILE); } catch { /* stockage indisponible */ }
  signaler("carnet:file", { attente: f.length });
}

// Renvoie les saisies en attente, dans l'ordre. S'arrête si le réseau retombe ; une saisie refusée
// par le serveur (4xx) est retirée de la file et comptée dans `refusees`.
let rejeu = null;
export function rejouerFile() {
  if (rejeu) return rejeu;
  rejeu = (async () => {
    let envoyees = 0, refusees = 0;
    for (;;) {
      const file = fileHorsLigne();
      if (!file.length || sansReseau()) break;
      const r = file[0];
      try { await api.request({ method: r.method, url: r.url, data: r.data, rejeu: true }); envoyees += 1; }
      catch (e) {
        if (!e?.response || e.response.status >= 500 || e.response.status === 401) break;
        refusees += 1;
      }
      ecrireFile(fileHorsLigne().slice(1));
    }
    return { envoyees, refusees };
  })().finally(() => { rejeu = null; });
  return rejeu;
}

export function viderHorsLigne() {
  try { localStorage.removeItem(CLE_FILE); } catch { /* stockage indisponible */ }
  if (cacheDispo()) caches.delete(CACHE_API).catch(() => {});
}

api.interceptors.response.use(
  (response) => {
    const c = response.config;
    if (c?.method === "get" && !c.responseType && cacheDispo() && !SECRET.test(c.url) && response.data != null) {
      const corps = new Response(JSON.stringify(response.data), { headers: { "Content-Type": "application/json", "X-Le": String(Date.now()) } });
      caches.open(CACHE_API).then((k) => k.put(cleCache(c), corps)).catch(() => {});
    }
    return response;
  },
  async (error) => {
    const c = error?.config;
    if (error?.response?.status === 401 && c?.url !== "/auth/login") {
      onUnauthorized?.();
    }
    if (c && !error.response && sansReseau()) {
      // Lecture : la dernière réponse connue
      if (c.method === "get" && cacheDispo()) {
        try {
          const r = await (await caches.open(CACHE_API)).match(cleCache(c));
          if (r) {
            signaler("carnet:cache", { le: Number(r.headers.get("X-Le")) || null });
            return { data: await r.json(), status: 200, statusText: "hors ligne", headers: {}, config: c, horsLigne: true };
          }
        } catch { /* cache illisible */ }
      }
      // Saisie : mise en attente
      if (["put", "patch", "post"].includes(c.method) && !c.rejeu && EN_FILE.test(c.url)) {
        let data = c.data;
        try { if (typeof data === "string") data = JSON.parse(data); } catch { /* corps non JSON */ }
        ecrireFile([...fileHorsLigne(), { method: c.method, url: c.url, data, le: Date.now() }]);
        return { data: data && typeof data === "object" ? { ...data, en_attente: true } : { en_attente: true }, status: 202, statusText: "en attente", headers: {}, config: c, enAttente: true };
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// --- Réveil du serveur ---
// L'hébergement gratuit (Render) endort l'API après 15 min d'inactivité : la première
// requête peut alors attendre ~1 min, voire échouer (502/503, coupure réseau sur mobile).
const URL_SANTE = (() => {
  try {
    const base = api.defaults.baseURL;
    return /^https?:/.test(base) ? new URL(base).origin + "/health" : null;
  } catch { return null; }
})();

// Erreur due au serveur endormi ou au réseau (et non à une vraie réponse de l'API)
export const erreurTransitoire = (e) =>
  !e?.response || [502, 503, 504].includes(e.response.status);

// Résout quand le serveur répond (ou au bout de `maxMs`, sans lever d'erreur).
let reveil = null;
export function reveillerServeur(maxMs = 90_000) {
  if (!URL_SANTE) return Promise.resolve();
  if (reveil) return reveil;
  const fin = Date.now() + maxMs;
  reveil = (async () => {
    while (Date.now() < fin) {
      const ctrl = new AbortController();
      const minuteur = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const r = await fetch(URL_SANTE, { cache: "no-store", signal: ctrl.signal });
        if (r.ok) return;
      } catch { /* serveur encore endormi */ } finally { clearTimeout(minuteur); }
      await new Promise((ok) => setTimeout(ok, 2_000));
    }
  })().finally(() => { reveil = null; });
  return reveil;
}

// Exécute `appel` en réessayant tant que le serveur se réveille (erreurs réseau, 502-504, délai dépassé).
export async function avecReveil(appel, maxMs = 120_000) {
  const fin = Date.now() + maxMs;
  for (;;) {
    try {
      return await appel();
    } catch (e) {
      if (!erreurTransitoire(e) || Date.now() >= fin) throw e;
      await reveillerServeur(Math.max(fin - Date.now(), 1_000));
    }
  }
}

// --- Profil FC ---
export const getProfilFC = () =>
  api.get("/utilisateur/profil-fc").then((r) => r.data);

export const patchProfilFC = (payload) =>
  api.patch("/utilisateur/profil-fc", payload).then((r) => r.data);

export const getHistoriquePoids = () =>
  api.get("/utilisateur/poids/historique").then((r) => r.data);

// --- Import iOS Shortcuts ---
export const getImportToken      = () => api.get("/auth/import-token").then((r) => r.data);
export const regenererImportToken = () => api.post("/auth/import-token/regenerer").then((r) => r.data);

// --- Fuseau horaire / export / suppression de compte ---
export const patchFuseauHoraire = (fuseau_horaire) =>
  api.patch("/utilisateur/fuseau-horaire", { fuseau_horaire }).then((r) => r.data);

export const exporterDonnees = () =>
  api.get("/utilisateur/export").then((r) => r.data);

export const supprimerCompte = (mot_de_passe) =>
  api.delete("/utilisateur", { data: { mot_de_passe } }).then((r) => r.data);

// --- Carnet : activités ---
export const getActivites = (params = {}) =>
  api.get("/activites", { params }).then((r) => r.data);

export const creerActivite = (payload) =>
  api.post("/activites", payload).then((r) => r.data);

export const modifierActivite = (id, payload) =>
  api.put(`/activites/${id}`, payload).then((r) => r.data);

export const supprimerActivite = (id) =>
  api.delete(`/activites/${id}`).then((r) => r.data);

export const importerFichierActivites = (fichier) => {
  const fd = new FormData();
  fd.append("fichier", fichier);
  return api.post("/activites/import-fichier", fd, {
    headers: { "Content-Type": "multipart/form-data" }, timeout: 120000,
  }).then((r) => r.data);
};

// Tracés GPS : [{ debut, points: [[lat, lon, altitude|null, secondes depuis le début], …] }]
export const importerTraces = (traces) =>
  api.post("/activites/traces", { traces }, { timeout: 120000 }).then((r) => r.data);
export const getActivite = (id) => api.get(`/activites/${id}`).then((r) => r.data);
export const getTrace = (id) => api.get(`/activites/${id}/trace`).then((r) => r.data);
export const getTerrains = (id) => api.get(`/activites/${id}/terrains`).then((r) => r.data);
export const getBilanActivite = (id) => api.get(`/activites/${id}/bilan`).then((r) => r.data);
export const setTypeSeance = (id, cle) => api.put(`/activites/${id}/type`, { cle }).then((r) => r.data);
export const getFiltresCarnet = () => api.get("/carnet/filtres").then((r) => r.data);
export const setFiltresCarnet = (filtres) => api.put("/carnet/filtres", { filtres }).then((r) => r.data);
export const getComparables = (id) => api.get(`/activites/${id}/comparables`).then((r) => r.data);
export const getFlux = (id) => api.get(`/activites/${id}/flux`).then((r) => r.data);
export const getCarteTraces = () => api.get("/traces/carte", { timeout: 60000 }).then((r) => r.data);
export const getMeteo = (id) => api.get(`/activites/${id}/meteo`).then((r) => r.data);
export const enregistrerMeteo = (id, meteo) => api.put(`/activites/${id}/meteo`, meteo).then((r) => r.data);
export const getMemeParcours = (id) => api.get(`/activites/${id}/meme-parcours`, { timeout: 45000 }).then((r) => r.data);


// --- Segments ---
export const getSegments = () => api.get("/segments", { timeout: 90000 }).then((r) => r.data);
export const getSegment = (id) => api.get(`/segments/${id}`, { timeout: 90000 }).then((r) => r.data);
export const creerSegment = (d) => api.post("/segments", d).then((r) => r.data);
export const renommerSegment = (id, nom) => api.put(`/segments/${id}`, { nom }).then((r) => r.data);
export const supprimerSegment = (id) => api.delete(`/segments/${id}`).then((r) => r.data);
export const getSegmentsActivite = (id) => api.get(`/activites/${id}/segments`, { timeout: 90000 }).then((r) => r.data);

// --- Intervals.icu (séances de la montre avec tracé GPS) ---
export const getItineraires = () => api.get("/itineraires").then((r) => r.data);
export const proposerItineraires = (d) => api.post("/itineraires", d, { timeout: 60000 }).then((r) => r.data);
export const tracerItineraire = (d) => api.post("/itineraires/trace", d, { timeout: 45000 }).then((r) => r.data);
export const ligneDroiteItineraire = (d) => api.post("/itineraires/droite", d, { timeout: 20000 }).then((r) => r.data);
export const getSortiesItineraire = () => api.get("/itineraires/sorties").then((r) => r.data);
export const getAlluresItineraire = () => api.get("/itineraires/allures").then((r) => r.data);
export const getFavorisItineraire = () => api.get("/itineraires/favoris").then((r) => r.data);
export const getFavoriItineraire = (id) => api.get(`/itineraires/favoris/${id}`).then((r) => r.data);
export const creerFavoriItineraire = (d) => api.post("/itineraires/favoris", d).then((r) => r.data);
export const modifierFavoriItineraire = (id, d) => api.put(`/itineraires/favoris/${id}`, d).then((r) => r.data);
export const renommerFavoriItineraire = (id, nom) => api.patch(`/itineraires/favoris/${id}`, { nom }).then((r) => r.data);
export const supprimerFavoriItineraire = (id) => api.delete(`/itineraires/favoris/${id}`).then((r) => r.data);
export const getIntervals = () => api.get("/intervals").then((r) => r.data);
export const connecterIntervals = (cle, athlete_id) => api.put("/intervals", { cle, athlete_id }).then((r) => r.data);
// Nuits importées par l'ancien raccourci Sommeil / l'export Santé : à effacer pour revenir à Intervals.icu
export const getNuitsImportees = () => api.get("/sommeil/nuits-importees").then((r) => r.data);
export const effacerNuitsImportees = () => api.delete("/sommeil/nuits-importees", { timeout: 120000 }).then((r) => r.data);
export const deconnecterIntervals = () => api.delete("/intervals").then((r) => r.data);
export const historiqueIntervals = () =>
  api.post("/intervals/historique", null, { timeout: 300000 }).then((r) => r.data);
export const synchroIntervals = (force = false) =>
  api.post("/intervals/synchro", null, { params: { force }, timeout: 180000 }).then((r) => r.data);

// --- Carnet : objectifs ---
export const getObjectifs = () => api.get("/objectifs").then((r) => r.data);
export const creerObjectif = (payload) => api.post("/objectifs", payload).then((r) => r.data);
export const modifierObjectif = (id, payload) => api.put(`/objectifs/${id}`, payload).then((r) => r.data);
export const supprimerObjectif = (id) => api.delete(`/objectifs/${id}`).then((r) => r.data);

// --- Carnet : stats & export ---
export const getStatsCarnet = (sport) =>
  api.get("/stats", { params: sport ? { sport } : {} }).then((r) => r.data);

export const getMesures = (jours = 365) => api.get("/mesures", { params: { jours } }).then((r) => r.data);

export const getZones = () => api.get("/utilisateur/zones").then((r) => r.data);
export const getAnalyses = () => api.get("/analyses", { timeout: 60000 }).then((r) => r.data);

// --- Plan (séances prévues) ---
export const getPlan = (depuis, jusqu_a) => api.get("/plan", { params: { depuis, jusqu_a } }).then((r) => r.data);
export const creerPrevue = (payload) => api.post("/plan", payload).then((r) => r.data);
export const importerPlan = (payload) => api.post("/plan/import", payload).then((r) => r.data);
export const modifierPrevue = (id, payload) => api.patch(`/plan/${id}`, payload).then((r) => r.data);
export const getPictogrammes = () => api.get("/pictogrammes").then((r) => r.data);
export const getAnimations = () => api.get("/animations").then((r) => r.data);
export const supprimerPrevue = (id) => api.delete(`/plan/${id}`).then((r) => r.data);
export const planifierTest = (payload) => api.post("/plan/tests", payload).then((r) => r.data);
export const lierParcoursObjectif = (id, itineraire_id) => api.put(`/objectifs/${id}/parcours`, { itineraire_id }).then((r) => r.data);
export const getActivitesProches = (id) => api.get(`/plan/${id}/activites`).then((r) => r.data);
export const getClaudeToken = () => api.get("/claude/token").then((r) => r.data);
export const regenererClaudeToken = () => api.post("/claude/token/regenerer").then((r) => r.data);

export const getAnalyseToken = () => api.get("/analyse/token").then((r) => r.data);
export const regenererAnalyseToken = () => api.post("/analyse/token/regenerer").then((r) => r.data);

export const exporterCarnet = (format = "md") =>
  api.get("/export/carnet", { params: { format }, responseType: format === "json" ? "json" : "text" })
    .then((r) => r.data);

// URL absolue de l'API (pour les liens à partager : lien d'analyse, raccourci iOS)
export const urlApiAbsolue = () => {
  const base = api.defaults.baseURL || "/api";
  return base.startsWith("http") ? base.replace(/\/$/, "") : `${window.location.origin}${base}`;
};

// --- Suivi : forme du matin, records, notifications ---
export const getFormeJour = () => api.get("/forme/jour").then((r) => r.data);
export const getRecords = () => api.get("/records").then((r) => r.data);
export const getBilan = (annee) => api.get("/bilan", { params: { annee }, timeout: 90000 }).then((r) => r.data);
export const getPush = () => api.get("/push").then((r) => r.data);
export const abonnerPush = (abo) => api.post("/push/abonnement", abo).then((r) => r.data);
export const desabonnerPush = (endpoint) => api.post("/push/desabonnement", { endpoint }).then((r) => r.data);
export const testerPush = () => api.post("/push/test").then((r) => r.data);
export const changerHeurePush = (heure) => api.put("/push/heure", { heure }).then((r) => r.data);
export const changerRappelPoids = (jour) => api.put("/push/rappel-poids", { jour }).then((r) => r.data);
export const garderSeulPush = (endpoint) => api.post("/push/garder-seul", { endpoint }).then((r) => r.data);

// --- Corps : marqueurs de journée, ressenti du matin, douleurs, adaptation du plan ---
export const getMarqueurs = () => api.get("/corps/marqueurs").then((r) => r.data);
export const basculerMarqueur = (type, actif, jour) => api.put("/corps/marqueurs", { type, actif, jour }).then((r) => r.data);
export const noterRessenti = (valeurs) => api.put("/corps/ressenti", valeurs).then((r) => r.data);
export const getDouleurs = () => api.get("/corps/douleurs").then((r) => r.data);
export const creerDouleur = (payload) => api.post("/corps/douleurs", payload).then((r) => r.data);
export const modifierDouleur = (id, payload) => api.patch(`/corps/douleurs/${id}`, payload).then((r) => r.data);
export const releverDouleur = (id, payload) => api.put(`/corps/douleurs/${id}/releve`, payload).then((r) => r.data);
export const supprimerDouleur = (id) => api.delete(`/corps/douleurs/${id}`).then((r) => r.data);
export const getMensurations = () => api.get("/corps/mensurations").then((r) => r.data);
export const putMensurations = (payload) => api.put("/corps/mensurations", payload).then((r) => r.data);
export const completerMeteo = () => api.post("/corps/meteo/completer", null, { timeout: 60000 }).then((r) => r.data);
export const adapterPrevue =(id, action) => api.post(`/plan/${id}/adapter`, { action }).then((r) => r.data);
export const getBilanPeriode = (type, ref) => api.get("/bilan/periode", { params: { type, ref } }).then((r) => r.data);
export const getCalendrier = (mois, premierJour = 1) => api.get("/calendrier", { params: { mois, premier_jour: premierJour } }).then((r) => r.data);
export const getJalons = () => api.get("/jalons").then((r) => r.data);
export const getExploration = () => api.get("/exploration").then((r) => r.data);
export const getSaison = () => api.get("/saison").then((r) => r.data);
export const getAlertes = () => api.get("/alertes").then((r) => r.data);
export const getSeancesTypes = () => api.get("/seances-types").then((r) => r.data);
export const getPreparation = (id) => api.get(`/objectifs/${id}/preparation`).then((r) => r.data);
export const putPreparation = (id, payload) => api.put(`/objectifs/${id}/preparation`, payload).then((r) => r.data);
export const putReglageNotif = (cle, actif) => api.put("/push/reglages", { cle, actif }).then((r) => r.data);
