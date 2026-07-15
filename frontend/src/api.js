import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: { "Content-Type": "application/json" },
});

export default api;

// --- Profil FC ---
export const getProfilFC = () =>
  api.get("/utilisateur/profil-fc").then((r) => r.data);

export const patchProfilFC = (payload) =>
  api.patch("/utilisateur/profil-fc", payload).then((r) => r.data);

// --- Objectif course ---
export const getObjectifCourse = () =>
  api.get("/objectif-course")
    .then((r) => r.data)
    .catch((e) => e?.response?.status === 404 ? null : Promise.reject(e));

export const setObjectifCourse = (payload) =>
  api.post("/objectif-course", payload).then((r) => r.data);

// --- Programme ---
export const getStatutProgramme = () =>
  api.get("/programme/statut").then((r) => r.data);

export const getToutesSemaines = () =>
  api.get("/programme/toutes-semaines").then((r) => r.data);

export const initialiserProgramme = (date_debut) =>
  api.post("/programme/initialiser", { date_debut }, { timeout: 120000 }).then((r) => r.data);

export const supprimerProgramme = () =>
  api.delete("/programme").then((r) => r.data);

export const resetOnboarding = () =>
  api.post("/auth/reset-onboarding").then((r) => r.data);

export const getAnalyseObjectif = () =>
  api.get("/programme/analyse-objectif").then((r) => r.data);

export const recalibrerProgramme = () =>
  api.post("/programme/recalibrer").then((r) => r.data);

export const getAlerteFatigue = () =>
  api.get("/programme/alerte-fatigue").then((r) => r.data);

export const signalerBlessure = (duree_jours, description) =>
  api.post("/programme/blessure", { duree_jours, description }).then((r) => r.data);

export const getPreferences = () =>
  api.get("/utilisateur/preferences").then((r) => r.data);

export const patchPreferences = (payload) =>
  api.patch("/utilisateur/preferences", payload).then((r) => r.data);

// --- Semaine courante ---
export const getSemaineCourante = () =>
  api.get("/semaine-courante").then((r) => r.data);

// --- Macrocycles ---
export const getMacrocycles = () =>
  api.get("/macrocycles").then((r) => r.data);

export const getSemainesMacrocycle = (macrocycle_id) =>
  api.get(`/macrocycles/${macrocycle_id}/semaines`).then((r) => r.data);

// --- Séances ---
export const journaliserSeance = (seance_id, payload) =>
  api.post(`/seances/${seance_id}/journal`, payload).then((r) => r.data);

export const prefillSeance = (seance_id, metriques) =>
  api.post(`/seances/${seance_id}/journal/prefill`, metriques).then((r) => r.data);

export const validerRPE = (seance_id, rpe, notes) =>
  api.patch(`/seances/${seance_id}/journal/valider`, { rpe, notes }).then((r) => r.data);

export const supprimerJournal = (seance_id) =>
  api.delete(`/seances/${seance_id}/journal`).then((r) => r.data);

export const modifierJournal = (seance_id, payload) =>
  api.patch(`/seances/${seance_id}/journal`, payload).then((r) => r.data);

export const planifierSeance = (seance_id, date_planifiee, heure_planifiee) =>
  api.patch(`/seances/${seance_id}/planifier`, { date_planifiee, heure_planifiee }).then((r) => r.data);

// --- Évaluations ---
export const getHistoriqueEvaluations = () =>
  api.get("/evaluations/historique").then((r) => r.data);

export const supprimerEvaluationsIncompletes = () =>
  api.delete("/evaluations/incompletes").then((r) => r.data);

export const modifierEvaluation = (evaluation_id, payload) =>
  api.patch(`/evaluations/${evaluation_id}`, payload).then((r) => r.data);

export const creerEvaluation = (payload) =>
  api.post("/evaluations/", payload).then((r) => r.data);

export const enregistrerDemiCooper = (evaluation_id, payload) =>
  api.post(`/evaluations/${evaluation_id}/demi-cooper`, payload).then((r) => r.data);

export const enregistrerMax1Min = (evaluation_id, payload) =>
  api.post(`/evaluations/${evaluation_id}/max-1min`, payload).then((r) => r.data);

export const enregistrerAmrapBenchmark = (evaluation_id, payload) =>
  api.post(`/evaluations/${evaluation_id}/amrap-benchmark`, payload).then((r) => r.data);

export const getExercicesEvaluation = () =>
  api.get("/exercices/evaluation").then((r) => r.data);

// --- Analytics ---
export const getTendancesPhysiologiques = () =>
  api.get("/analytics/tendances-physiologiques").then((r) => r.data);

export const getDistributionVolume = (macrocycle_id) =>
  api.get("/analytics/distribution-volume", { params: macrocycle_id ? { macrocycle_id } : {} }).then((r) => r.data);

export const getBiometrieRecuperation = (macrocycle_id) =>
  api.get("/analytics/biometrie-recuperation", { params: macrocycle_id ? { macrocycle_id } : {} }).then((r) => r.data);
