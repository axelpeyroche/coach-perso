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

export const supprimerCompte = () =>
  api.delete("/utilisateur").then((r) => r.data);

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

// --- Plan (séances prévues) ---
export const getPlan = (depuis, jusqu_a) => api.get("/plan", { params: { depuis, jusqu_a } }).then((r) => r.data);
export const creerPrevue = (payload) => api.post("/plan", payload).then((r) => r.data);
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
