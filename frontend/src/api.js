import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: { "Content-Type": "application/json" },
});

// --- Analytique ---
export const getTendancesPhysiologiques = (utilisateur_id) =>
  api.get("/analytics/tendances-physiologiques", { params: { utilisateur_id } }).then((r) => r.data);

export const getDistributionVolume = (utilisateur_id, macrocycle_id) =>
  api.get("/analytics/distribution-volume", { params: { utilisateur_id, macrocycle_id } }).then((r) => r.data);

export const getBiometrieRecuperation = (utilisateur_id, macrocycle_id) =>
  api.get("/analytics/biometrie-recuperation", { params: { utilisateur_id, macrocycle_id } }).then((r) => r.data);

// --- Objectif course ---
export const getObjectifCourse = (utilisateur_id = 1) =>
  api.get("/objectif-course", { params: { utilisateur_id } })
    .then((r) => r.data)
    .catch((e) => e?.response?.status === 404 ? null : Promise.reject(e));

export const setObjectifCourse = (payload, utilisateur_id = 1) =>
  api.post("/objectif-course", payload, { params: { utilisateur_id } }).then((r) => r.data);

// --- Programme ---
export const getStatutProgramme = (utilisateur_id = 1) =>
  api.get("/programme/statut", { params: { utilisateur_id } }).then((r) => r.data);

export const getToutesSemaines = (utilisateur_id = 1) =>
  api.get("/programme/toutes-semaines", { params: { utilisateur_id } }).then((r) => r.data);

export const initialiserProgramme = (date_debut, utilisateur_id = 1) =>
  api.post("/programme/initialiser", { date_debut, utilisateur_id }, { timeout: 120000 }).then((r) => r.data);

export const supprimerProgramme = (utilisateur_id = 1) =>
  api.delete("/programme", { params: { utilisateur_id } }).then((r) => r.data);

// --- Semaine courante ---
export const getSemaineCourante = (utilisateur_id = 1) =>
  api.get("/semaine-courante", { params: { utilisateur_id } }).then((r) => r.data);

// --- Macrocycles ---
export const getMacrocycles = (utilisateur_id = 1) =>
  api.get("/macrocycles", { params: { utilisateur_id } }).then((r) => r.data);

export const getSemainesMacrocycle = (macrocycle_id) =>
  api.get(`/macrocycles/${macrocycle_id}/semaines`).then((r) => r.data);

// --- Séances ---
export const journaliserSeance = (seance_id, payload) =>
  api.post(`/seances/${seance_id}/journal`, payload).then((r) => r.data);

export const prefillSeance = (seance_id, metriques) =>
  api.post(`/seances/${seance_id}/journal/prefill`, metriques).then((r) => r.data);

export const analyserScreenshot = (seance_id, file, utilisateur_id = 1) => {
  const form = new FormData();
  form.append("file", file);
  return api.post(`/seances/${seance_id}/journal/analyse-screenshot?utilisateur_id=${utilisateur_id}`, form, {
    timeout: 30000,
  }).then((r) => r.data);
};

export const validerRPE = (seance_id, rpe, notes) =>
  api.patch(`/seances/${seance_id}/journal/valider`, { rpe, notes }).then((r) => r.data);

// --- Évaluations ---
export const getHistoriqueEvaluations = (utilisateur_id = 1) =>
  api.get("/evaluations/historique", { params: { utilisateur_id } }).then((r) => r.data);

export const supprimerEvaluationsIncompletes = (utilisateur_id = 1) =>
  api.delete("/evaluations/incompletes", { params: { utilisateur_id } }).then((r) => r.data);

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

export default api;
