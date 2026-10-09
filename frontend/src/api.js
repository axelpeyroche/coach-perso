import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: { "Content-Type": "application/json" },
});

// Déclenché sur un 401 renvoyé par l'API (token expiré/invalide) — l'AuthContext
// s'y abonne pour effacer la session et rediriger vers /login.
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && error?.config?.url !== "/auth/login") {
      onUnauthorized?.();
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
export const getTrace = (id) => api.get(`/activites/${id}/trace`).then((r) => r.data);
export const getFlux = (id) => api.get(`/activites/${id}/flux`).then((r) => r.data);
export const getCarteTraces = () => api.get("/traces/carte", { timeout: 90000 }).then((r) => r.data);

// --- Intervals.icu (séances de la montre avec tracé GPS) ---
export const getIntervals = () => api.get("/intervals").then((r) => r.data);
export const connecterIntervals = (cle, athlete_id) => api.put("/intervals", { cle, athlete_id }).then((r) => r.data);
export const deconnecterIntervals = () => api.delete("/intervals").then((r) => r.data);
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

export const getAnalyses = () => api.get("/analyses", { timeout: 90000 }).then((r) => r.data);

// --- Plan (séances prévues) ---
export const getPlan = (depuis, jusqu_a) => api.get("/plan", { params: { depuis, jusqu_a } }).then((r) => r.data);
export const creerPrevue = (payload) => api.post("/plan", payload).then((r) => r.data);
export const importerPlan = (payload) => api.post("/plan/import", payload).then((r) => r.data);
export const modifierPrevue = (id, payload) => api.patch(`/plan/${id}`, payload).then((r) => r.data);
export const supprimerPrevue = (id) => api.delete(`/plan/${id}`).then((r) => r.data);
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
export const getPush = () => api.get("/push").then((r) => r.data);
export const abonnerPush = (abo) => api.post("/push/abonnement", abo).then((r) => r.data);
export const desabonnerPush = (endpoint) => api.post("/push/desabonnement", { endpoint }).then((r) => r.data);
export const testerPush = () => api.post("/push/test").then((r) => r.data);
export const changerHeurePush = (heure) => api.put("/push/heure", { heure }).then((r) => r.data);
export const garderSeulPush = (endpoint) => api.post("/push/garder-seul", { endpoint }).then((r) => r.data);
