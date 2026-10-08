import { createContext, useContext, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import api, { setUnauthorizedHandler, patchFuseauHoraire, avecReveil } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser]   = useState(null);
  const [loading, setLoading] = useState(true);

  // Injecter le token dans tous les appels axios
  useEffect(() => {
    if (token) {
      api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    } else {
      delete api.defaults.headers.common["Authorization"];
    }
  }, [token]);

  // Charger le profil au démarrage si token existant
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    // Ne déconnecter que si l'API refuse le token (401) : un serveur endormi ou une coupure
    // réseau ne doit pas effacer la session. Dans ce cas on garde le token et on réessaie.
    avecReveil(() => api.get("/auth/me", { timeout: 20_000 }))
      .then(r => setUser(r.data))
      .catch((e) => { if (e?.response?.status === 401) logout(); })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Les données en cache appartiennent au compte précédent : on les jette à chaque
  // changement de session pour ne jamais afficher celles d'un autre utilisateur.
  function viderCache() {
    queryClient.cancelQueries();
    queryClient.clear();
  }

  function login(tokenStr, userData) {
    if (userData?.id !== user?.id) viderCache();  // pas pour un simple renouvellement du token
    localStorage.setItem("token", tokenStr);
    setToken(tokenStr);
    api.defaults.headers.common["Authorization"] = `Bearer ${tokenStr}`;
    setUser(userData);
  }

  function logout() {
    viderCache();
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    delete api.defaults.headers.common["Authorization"];
  }

  // Déconnexion automatique quand l'API répond 401 (token expiré/invalide)
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Détecte le fuseau horaire du navigateur et le synchronise silencieusement
  // côté serveur (conversion des dates UTC de l'export Strava).
  useEffect(() => {
    if (!user) return;
    const detecte = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detecte && detecte !== user.fuseau_horaire) {
      patchFuseauHoraire(detecte).catch(() => {});
    }
  }, [user?.fuseau_horaire]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{ token, user, setUser, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
