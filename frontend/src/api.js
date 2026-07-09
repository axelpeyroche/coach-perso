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

// --- Évaluations ---
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
