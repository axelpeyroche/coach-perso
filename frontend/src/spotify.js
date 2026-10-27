// Télécommande Spotify (Web API, partie « Player ») : c'est l'appli Spotify qui
// joue la musique, Carnet la pilote. Connexion PKCE sans secret ; les jetons
// restent dans ce navigateur. Compte Premium obligatoire pour les commandes.

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const COMPTES = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";
const PORTEES = [
  "user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing",
  "playlist-read-private", "playlist-read-collaborative", "user-library-read",
].join(" ");
const CLE = "spotify";
const CLE_VERIF = "spotify-verificateur";

export const spotifyDisponible = !!CLIENT_ID;
const retour = () => `${window.location.origin}/spotify`;

function lireJetons() {
  try { return JSON.parse(localStorage.getItem(CLE)); } catch { return null; }
}
function ecrireJetons(j) {
  try { localStorage.setItem(CLE, JSON.stringify(j)); } catch { /* stockage indisponible */ }
}
export function spotifyConnecte() { return !!lireJetons()?.refresh; }
export function deconnecterSpotify() {
  try { localStorage.removeItem(CLE); } catch { /* idem */ }
}

const base64url = (octets) => btoa(String.fromCharCode(...new Uint8Array(octets)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Départ vers la page de connexion Spotify
export async function connecterSpotify() {
  const verif = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const defi = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verif)));
  const etat = base64url(crypto.getRandomValues(new Uint8Array(12)));
  localStorage.setItem(CLE_VERIF, JSON.stringify({ verif, etat }));
  const p = new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", redirect_uri: retour(), scope: PORTEES,
    code_challenge_method: "S256", code_challenge: defi, state: etat,
  });
  window.location.assign(`${COMPTES}/authorize?${p}`);
}

async function demanderJeton(corps) {
  const r = await fetch(`${COMPTES}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...corps }),
  });
  if (!r.ok) throw new Error(`Spotify ${r.status}`);
  const d = await r.json();
  const j = {
    access: d.access_token,
    refresh: d.refresh_token ?? lireJetons()?.refresh,
    expire: Date.now() + (d.expires_in - 60) * 1000,
  };
  ecrireJetons(j);
  return j;
}

// Retour de Spotify sur /spotify : échange du code contre les jetons
export async function terminerConnexion(params) {
  let attendu = null;
  try { attendu = JSON.parse(localStorage.getItem(CLE_VERIF)); } catch { /* rien */ }
  localStorage.removeItem(CLE_VERIF);
  if (params.get("error")) throw new Error(params.get("error"));
  if (!attendu || params.get("state") !== attendu.etat || !params.get("code")) throw new Error("état invalide");
  await demanderJeton({ grant_type: "authorization_code", code: params.get("code"), redirect_uri: retour(), code_verifier: attendu.verif });
}

let renouvellement = null;
async function jeton() {
  const j = lireJetons();
  if (!j?.refresh) throw new Error("non connecté");
  if (j.access && Date.now() < j.expire) return j.access;
  // Un seul renouvellement à la fois : le jeton de renouvellement change à chaque usage
  renouvellement ??= demanderJeton({ grant_type: "refresh_token", refresh_token: j.refresh })
    .catch((e) => { if (/ 400$/.test(e.message)) deconnecterSpotify(); throw e; })
    .finally(() => { renouvellement = null; });
  return (await renouvellement).access;
}

// Appel à l'API ; renvoie null pour les réponses sans contenu (204)
async function appel(methode, chemin, corps) {
  const r = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${await jeton()}`, ...(corps ? { "Content-Type": "application/json" } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  if (r.status === 204 || r.status === 202) return null;
  // Certaines commandes répondent 200 avec un corps vide ou non JSON : ce n'est pas une erreur
  const texte = await r.text().catch(() => "");
  let d = null;
  try { d = texte ? JSON.parse(texte) : null; } catch { /* corps non JSON */ }
  if (!r.ok) {
    const e = new Error(d?.error?.message || d?.error_description || `HTTP ${r.status}`);
    e.status = r.status;
    e.raison = d?.error?.reason;
    throw e;
  }
  return d;
}

export const etatLecteur = () => appel("GET", "/me/player?additional_types=episode");
export const appareils = async () => (await appel("GET", "/me/player/devices"))?.devices ?? [];
export const pause = () => appel("PUT", "/me/player/pause");
export const suivant = () => appel("POST", "/me/player/next");
export const precedent = () => appel("POST", "/me/player/previous");

export async function mesPlaylists() {
  const d = await appel("GET", "/me/playlists?limit=50");
  return (d?.items ?? []).filter(Boolean).map((p) => ({ uri: p.uri, nom: p.name, image: p.images?.at(-1)?.url ?? p.images?.[0]?.url }));
}

// Lecture : reprend, ou lance une playlist (`uri`), ou les titres likés (`uri` = "likes").
// Sans appareil actif, on vise le premier appareil disponible (l'appli Spotify ouverte).
export async function lire(uri) {
  let corps;
  if (uri === "likes") {
    // Sans identifiant (profil refusé), le repli sur la liste des titres prend le relais
    const moi = await appel("GET", "/me").catch(() => null);
    corps = { context_uri: `spotify:user:${moi?.id ?? "me"}:collection` };
  } else if (uri) corps = { context_uri: uri };
  const essayer = async (device) => {
    const chemin = `/me/player/play${device ? `?device_id=${device}` : ""}`;
    try {
      return await appel("PUT", chemin, corps);
    } catch (e) {
      // Contexte « titres likés » refusé : on envoie la liste des 50 derniers titres likés
      if (uri !== "likes" || e.status === 404 || e.status === 401) throw e;
      try {
        const likes = await appel("GET", "/me/tracks?limit=50");
        corps = { uris: (likes?.items ?? []).map((x) => x.track?.uri ?? x.item?.uri).filter(Boolean) };
        return await appel("PUT", chemin, corps);
      } catch (e2) {
        if (e2.status === 404) throw e2;
        console.warn("Spotify, titres likés :", e.message, "/", e2.message);
        throw e;
      }
    }
  };
  try {
    return await essayer();
  } catch (e) {
    if (e.status !== 404) throw e;
    const liste = await appareils();
    const cible = liste.find((a) => a.is_active) ?? liste.find((a) => a.type === "Smartphone") ?? liste[0];
    if (!cible) { const err = new Error("aucun appareil"); err.endormi = true; throw err; }
    return essayer(cible.id);
  }
}
