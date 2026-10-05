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

// --- Carnet : objectifs ---
export const getObjectifs = () => api.get("/objectifs").then((r) => r.data);
export const creerObjectif = (payload) => api.post("/objectifs", payload).then((r) => r.data);
export const modifierObjectif = (id, payload) => api.put(`/objectifs/${id}`, payload).then((r) => r.data);
export const supprimerObjectif = (id) => api.delete(`/objectifs/${id}`).then((r) => r.data);

// --- Carnet : stats & export ---
export const getStatsCarnet = (sport) =>
  api.get("/stats", { params: sport ? { sport } : {} }).then((r) => r.data);

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
