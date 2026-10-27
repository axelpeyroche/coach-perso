import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { melangerSon } from "../son";
import { spotifyDisponible, spotifyConnecte, etatLecteur, lire, pause, suivant, precedent, mesPlaylists, titresPlaylist, aleatoire } from "../spotify";

// Bandeau Spotify de la séance guidée : titre en cours, précédent, pause et suivant ;
// touché, il se déplie en lecteur avec la liste des playlists (toucher une playlist
// la lance, son chevron ouvre ses titres) et l'aléatoire. Les « titres
// likés » se lancent au début de la séance si rien ne joue déjà.

const VIOLET = "#BF5AF2";
const VERT = "#30D158";
const LIKES = { uri: "likes", nom: "Titres likés" };

const svg = { viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true };
const IcoPause = ({ c = "w-5 h-5" }) => <svg className={c} {...svg}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>;
const IcoLecture = ({ c = "w-5 h-5" }) => <svg className={c} {...svg}><path d="M7 4.5v15a1 1 0 001.5.86l12-7.5a1 1 0 000-1.72l-12-7.5A1 1 0 007 4.5z" /></svg>;
const IcoSuivant = ({ c = "w-[18px] h-[18px]" }) => <svg className={c} {...svg}><path d="M5 5.5v13a1 1 0 001.5.85L16 13.5V18a1 1 0 002 0V6a1 1 0 00-2 0v4.5L6.5 4.65A1 1 0 005 5.5z" /></svg>;
const IcoPrecedent = ({ c }) => <span className="block -scale-x-100"><IcoSuivant c={c} /></span>;
const trait = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const IcoAleatoire = ({ c = "w-[22px] h-[22px]" }) => <svg className={c} {...trait}><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>;
const IcoChevron = ({ c = "w-[18px] h-[18px]", gauche }) => <svg className={c} {...trait}><path d={gauche ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} /></svg>;
const IcoSon = () => <svg className="w-4 h-4 shrink-0" {...trait}><path d="M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" /></svg>;
const IcoNote = () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></svg>;

function Pochette({ src, taille, rayon = 7 }) {
  return src
    ? <img src={src} alt="" loading="lazy" decoding="async" className="shrink-0 object-cover" style={{ width: taille, height: taille, borderRadius: rayon }} />
    : <span className="shrink-0 flex items-center justify-center bg-[#2c2c2e] text-white/30" style={{ width: taille, height: taille, borderRadius: rayon }}><IcoNote /></span>;
}

const IconeLikes = ({ taille }) => (
  <span className="shrink-0 rounded-[6px] flex items-center justify-center" style={{ width: taille, height: taille, background: "linear-gradient(135deg,#450af5,#c4efd9)" }}>
    <svg style={{ width: taille * 0.45, height: taille * 0.45 }} {...svg}><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.4 3.2 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5 18.8 5 21 8.4 19.5 11.8 17.5 16.4 12 21 12 21z" /></svg>
  </span>
);

// Message lisible, avec la réponse de Spotify pour comprendre un refus
function message(e) {
  console.warn("Spotify :", e.status, e.raison, e.message);
  if (!e.status) return "Spotify injoignable (réseau)";
  if (e.status === 401) return "Reconnecte Spotify depuis Profil";
  if (e.status === 403 && e.raison === "PREMIUM_REQUIRED") return "Compte Premium requis";
  if (e.status === 429) return "Trop de commandes, réessaie dans un instant";
  return `Spotify a refusé (${e.status}) : ${e.message}`;
}

const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// État du lecteur, gardé par l'écran de séance (le bandeau, lui, est redessiné à chaque étape).
// Les commandes s'affichent tout de suite ; Spotify confirme ensuite.
export function useSpotify({ autoLancer = true } = {}) {
  const actif = spotifyDisponible && spotifyConnecte();
  const [lecteur, setLecteur] = useState(null);   // état renvoyé par Spotify (null : rien ne joue)
  const [endormi, setEndormi] = useState(false);   // aucun appareil Spotify disponible
  const [erreur, setErreur] = useState(null);
  const [deplie, setDeplie] = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [change, setChange] = useState(false);     // morceau en train de changer
  const enAttente = useRef(null);                  // lecture à lancer dès que Spotify se réveille
  const recu = useRef(0);
  const calme = useRef(0);                         // pas de suivi tant qu'une commande s'applique
  const finMorceau = useRef(null);
  const dernier = useRef(null);
  const [vue, setVue] = useState(null);            // playlist ouverte dans le lecteur
  const [titres, setTitres] = useState(null);      // { uri, liste, total, suite, charge, erreur }
  const cacheTitres = useRef(new Map());

  function appliquer(d) {
    recu.current = Date.now();
    dernier.current = d?.item ? d : null;
    setLecteur(dernier.current);
    if (d?.item) setEndormi(false);
    // Le morceau suivant s'affiche dès que celui-ci se termine
    clearTimeout(finMorceau.current);
    if (d?.is_playing && d.item?.duration_ms) {
      finMorceau.current = setTimeout(() => rafraichir(), Math.max(500, d.item.duration_ms - (d.progress_ms ?? 0) + 400));
    }
  }

  // « Restriction violated » : la commande ne s'applique pas à l'état réel (lecture
  // déjà en cours, déjà en pause…). L'état relu remet l'écran d'accord, sans alerte.
  const effacer = useRef(null);
  function signaler(e) {
    if (e.status === 403 && /restriction/i.test(e.message)) return;
    setErreur(message(e));
    clearTimeout(effacer.current);
    effacer.current = setTimeout(() => setErreur(null), 6000);
  }

  async function rafraichir() {
    try {
      const d = await etatLecteur();
      appliquer(d);
      return d;
    } catch (e) {
      if (e.status === 401) setErreur("Reconnecte Spotify depuis Profil");
      return null;
    }
  }

  // Après une commande, relit l'état jusqu'à ce qu'il reflète le changement attendu
  async function confirmer(attendu) {
    for (const delai of [250, 500, 900, 1500]) {
      await new Promise((r) => setTimeout(r, delai));
      const d = await rafraichir();
      if (attendu(d)) break;
    }
    setChange(false);
  }

  function optimiste(maj) {
    const l = dernier.current;
    if (!l) return;
    const n = { ...l, progress_ms: progressionDe(l, recu.current), actions: undefined, ...maj };
    recu.current = Date.now();
    dernier.current = n;
    setLecteur(n);
  }

  // `titre` : morceau de départ ; `melange` : aléatoire activé ou non avant de lancer
  async function lancer(uri, opts = {}) {
    const { titre, melange } = opts;
    setErreur(null);
    calme.current = Date.now() + 4000;
    const avant = dernier.current;
    if (uri) setChange(true);
    else optimiste({ is_playing: true });
    try {
      // Sans appareil actif, l'aléatoire est refusé : il est réglé une fois la lecture lancée
      let plusTard = false;
      if (melange != null) {
        await aleatoire(melange).catch(() => { plusTard = true; });
        optimiste({ shuffle_state: melange });
      }
      await lire(uri, titre);
      if (plusTard) aleatoire(melange).catch(() => {});
      enAttente.current = null;
      setEndormi(false);
      confirmer((d) => d?.is_playing && (!uri || (titre ? d.item?.uri === titre : d.item?.id !== avant?.item?.id || d.context?.uri !== avant?.context?.uri)));
    } catch (e) {
      setChange(false);
      rafraichir();
      if (e.endormi) { enAttente.current = { uri, opts }; setEndormi(true); }
      else signaler(e);
    }
  }

  async function basculerAleatoire() {
    const oui = !dernier.current?.shuffle_state;
    setErreur(null);
    calme.current = Date.now() + 3000;
    optimiste({ shuffle_state: oui });
    try {
      await aleatoire(oui);
      confirmer((d) => d?.shuffle_state === oui);
    } catch (e) {
      rafraichir();
      if (e.status === 404) setEndormi(true); else signaler(e);
    }
  }

  // Titres d'une playlist, gardés en mémoire pendant la séance ; `suite` : page suivante
  async function chargerTitres(p, suite = false) {
    const deja = cacheTitres.current.get(p.uri);
    if (!suite && deja && !deja.erreur) { setTitres(deja); return; }
    if (suite && (!deja?.suite || deja.charge)) return;
    const base = suite ? deja : { uri: p.uri, liste: [], total: 0, suite: false };
    const pret = (n) => { cacheTitres.current.set(p.uri, n); setTitres((t) => (!t || t.uri === p.uri ? n : t)); };
    pret({ ...base, charge: true });
    try {
      const r = await titresPlaylist(p.uri, base.liste.length);
      pret({ uri: p.uri, liste: [...base.liste, ...r.titres], total: r.total, suite: r.suite, charge: false });
    } catch (e) {
      console.warn("Spotify, titres :", e.status, e.message);
      pret({ ...base, suite: false, charge: false, erreur: !suite });
    }
  }
  function ouvrir(p) {
    setVue(p);
    if (p) { setTitres(null); chargerTitres(p); }
  }

  async function commande(fn) {
    setErreur(null);
    calme.current = Date.now() + 3000;
    const id = dernier.current?.item?.id;
    const saut = fn !== pause;
    if (saut) setChange(true);
    else optimiste({ is_playing: false });
    try {
      await fn();
      confirmer(saut ? (d) => d?.item?.id !== id : (d) => !d?.is_playing);
    } catch (e) {
      setChange(false);
      rafraichir();
      if (e.status === 404) setEndormi(true); else signaler(e);
    }
  }

  // Démarrage : état du lecteur, playlists, titres likés si rien ne joue
  useEffect(() => {
    if (!actif) return;
    melangerSon(true);
    (async () => {
      const d = await rafraichir();
      if (autoLancer && !d?.is_playing) lancer(LIKES.uri);
    })();
    mesPlaylists().then(setPlaylists).catch(() => {});
  }, [actif]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suivi : toutes les 5 s, et au retour sur la page (après un passage dans l'appli Spotify)
  useEffect(() => {
    if (!actif) return;
    const t = setInterval(() => { if (!document.hidden && Date.now() > calme.current) rafraichir(); }, 5000);
    const retour = () => {
      if (document.hidden) return;
      if (enAttente.current) lancer(enAttente.current.uri, enAttente.current.opts);
      else rafraichir();
    };
    document.addEventListener("visibilitychange", retour);
    return () => { clearInterval(t); clearTimeout(finMorceau.current); document.removeEventListener("visibilitychange", retour); melangerSon(false); };
  }, [actif]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    actif, lecteur, endormi, erreur, deplie, setDeplie, playlists, change, recu, lancer, commande,
    basculerAleatoire, vue, ouvrir, titres, plusDeTitres: () => vue && chargerTitres(vue, true),
  };
}

const progressionDe = (l, depuis) => Math.min(l.item?.duration_ms ?? 0, (l.progress_ms ?? 0) + (l.is_playing ? Date.now() - depuis : 0));

// Barre de progression : seule à se redessiner chaque seconde
function Progression({ lecteur, recu }) {
  const [, tic] = useState(0);
  useEffect(() => {
    if (!lecteur?.is_playing) return;
    const t = setInterval(() => tic((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [lecteur]);
  const duree = lecteur.item.duration_ms;
  const p = progressionDe(lecteur, recu.current);
  return (
    <>
      <div className="mt-3.5 h-1 rounded-full bg-[#3a3a3c] overflow-hidden">
        <i className="block h-full bg-white rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${(p / duree) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-white/60 chiffres"><span>{mmss(p)}</span><span>{mmss(duree)}</span></div>
    </>
  );
}

export default function BandeauSpotify({ sp }) {
  const [sortie, setSortie] = useState(false);   // feuille en train de se refermer
  const { actif, lecteur, endormi, erreur, deplie, setDeplie, playlists, change, recu, lancer, commande,
    basculerAleatoire, vue, ouvrir, titres, plusDeTitres } = sp;
  if (!actif) return null;
  const fermer = () => {
    if (sortie) return;
    setSortie(true);
    setTimeout(() => { setDeplie(false); setSortie(false); ouvrir(null); }, 220);
  };
  const melange = !!lecteur?.shuffle_state;

  const piste = lecteur?.item;
  const enLecture = !!lecteur?.is_playing;
  const image = piste?.album?.images?.at(-1)?.url ?? piste?.images?.at(-1)?.url;
  const grande = piste?.album?.images?.[0]?.url ?? piste?.images?.[0]?.url;
  const artiste = piste?.artists?.map((a) => a.name).join(", ") ?? piste?.show?.name;
  const ctx = lecteur?.context?.uri;
  const nomContexte = ctx?.endsWith(":collection") ? LIKES.nom : playlists.find((p) => p.uri === ctx)?.nom;
  // Spotify indique ce qui est permis : si reprendre est interdit, c'est que ça joue déjà
  const joue = enLecture || !!lecteur?.actions?.disallows?.resuming;
  const basculer = () => (joue ? commande(pause) : lancer(null));

  const boutonRond = "w-10 h-10 shrink-0 rounded-full flex items-center justify-center active:bg-white/10";

  let bandeau;
  if (endormi) {
    bandeau = (
      <div className="flex items-center gap-2.5 rounded-[14px] bg-[#1c1c1e] px-3 py-2.5">
        <span style={{ color: VERT }}><IcoNote /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold">Spotify est endormi</p>
          <p className="text-[12px] text-white/60">Ouvre l'appli une seconde, puis reviens</p>
        </div>
        <a href="spotify:" className="px-2 text-[15px] font-semibold" style={{ color: VERT }}>Ouvrir</a>
      </div>
    );
  } else {
    bandeau = (
      <div className="flex items-center gap-2.5 rounded-[14px] bg-[#1c1c1e] pl-2 pr-1 py-1.5">
        <button type="button" onClick={() => setDeplie(true)} className={`flex-1 min-w-0 flex items-center gap-2.5 text-left transition-opacity ${change ? "opacity-40" : ""}`} aria-label="Ouvrir le lecteur Spotify">
          <Pochette src={image} taille={38} />
          <span className="min-w-0">
            <span className={`block text-[14px] font-semibold ${piste ? "truncate" : "line-clamp-2"}`}>{piste?.name ?? (erreur || "Spotify")}</span>
            <span className="block text-[12px] text-white/60 truncate">
              {piste ? [artiste, nomContexte].filter(Boolean).join(" · ") : erreur ? "Touche pour les playlists" : "Rien en lecture · touche pour choisir"}
            </span>
          </span>
        </button>
        <button type="button" onClick={() => commande(precedent)} className={boutonRond} aria-label="Morceau précédent"><IcoPrecedent c="w-[18px] h-[18px]" /></button>
        <button type="button" onClick={basculer} className={boutonRond} aria-label={joue ? "Pause" : "Lecture"}>
          {joue ? <IcoPause /> : <IcoLecture />}
        </button>
        <button type="button" onClick={() => commande(suivant)} className={boutonRond} aria-label="Morceau suivant"><IcoSuivant /></button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3" data-spotify>{bandeau}</div>
      {deplie && createPortal(
        <div data-spotify className={`fixed inset-0 z-[70] text-white font-sans antialiased select-none flex items-end lg:items-center justify-center bg-black/60 ${sortie ? "animate-[fonduSortie_0.22s_ease-in_forwards]" : "animate-[fondu_0.2s_ease-out]"}`} onClick={fermer}>
          <div className={`w-full max-w-[480px] max-h-[85vh] flex flex-col rounded-t-[20px] lg:rounded-[20px] bg-[#1c1c1e] px-4 pt-2.5 will-change-transform ${sortie ? "animate-[descend_0.22s_ease-in_forwards]" : "animate-[monte_0.32s_cubic-bezier(0.32,0.72,0,1)]"}`}
            style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
            onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Lecteur Spotify">
            <button type="button" onClick={fermer} aria-label="Refermer le lecteur" className="mx-auto mb-3 block w-10 h-[5px] rounded-full bg-[#3a3a3c]" />
            <div className={`flex items-center gap-3 transition-opacity ${change ? "opacity-40" : ""}`}>
              <Pochette src={grande} taille={64} rayon={10} />
              <div className="min-w-0">
                <p className="text-[16px] font-semibold truncate">{piste?.name ?? "Rien en lecture"}</p>
                <p className="text-[13px] text-white/60 truncate">{piste ? [artiste, nomContexte].filter(Boolean).join(" · ") : "Choisis une playlist"}</p>
              </div>
            </div>
            {piste && <Progression lecteur={lecteur} recu={recu} />}
            <div className="flex items-center justify-center gap-5 my-2">
              <button type="button" onClick={basculerAleatoire} disabled={!piste} aria-pressed={melange}
                className="relative w-11 h-11 rounded-full flex items-center justify-center active:bg-white/10 disabled:opacity-30"
                style={{ color: melange ? VERT : "rgba(255,255,255,0.6)" }} aria-label={melange ? "Désactiver la lecture aléatoire" : "Activer la lecture aléatoire"}>
                <IcoAleatoire />
                {melange && <i className="absolute bottom-0.5 w-1 h-1 rounded-full" style={{ background: VERT }} />}
              </button>
              <button type="button" onClick={() => commande(precedent)} className="w-12 h-12 rounded-full flex items-center justify-center active:bg-white/10" aria-label="Morceau précédent"><IcoPrecedent c="w-6 h-6" /></button>
              <button type="button" onClick={basculer} className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center" aria-label={joue ? "Pause" : "Lecture"}>
                {joue ? <IcoPause c="w-7 h-7" /> : <IcoLecture c="w-7 h-7" />}
              </button>
              <button type="button" onClick={() => commande(suivant)} className="w-12 h-12 rounded-full flex items-center justify-center active:bg-white/10" aria-label="Morceau suivant"><IcoSuivant c="w-6 h-6" /></button>
              <span className="w-11 h-11" aria-hidden />
            </div>
            {erreur && <p className="mb-2 text-center text-[13px] text-[#FF453A]">{erreur}</p>}
            {vue ? (
              <>
                <button type="button" onClick={() => ouvrir(null)} className="mt-1 -ml-1 self-start flex items-center gap-0.5 py-1 text-[15px]" style={{ color: VIOLET }}>
                  <IcoChevron gauche /> Playlists
                </button>
                <div className="mt-1.5 flex items-center gap-3">
                  {vue.uri === "likes" ? <IconeLikes taille={52} /> : <Pochette src={vue.image} taille={52} rayon={8} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] font-semibold truncate">{vue.nom}</p>
                    <p className="text-[13px] text-white/60">{titres?.uri === vue.uri && titres.total ? `${titres.total} titres` : " "}</p>
                  </div>
                </div>
                <div className="mt-2.5 mb-1.5 flex gap-2">
                  <button type="button" onClick={() => lancer(vue.uri, { melange: false })} className="flex-1 h-9 rounded-full flex items-center justify-center gap-1.5 text-[14px] font-semibold text-black" style={{ background: VERT }}>
                    <IcoLecture c="w-4 h-4" /> Lire
                  </button>
                  <button type="button" onClick={() => lancer(vue.uri, { melange: true })} className="flex-1 h-9 rounded-full flex items-center justify-center gap-1.5 text-[14px] font-semibold bg-[#2c2c2e]">
                    <IcoAleatoire c="w-4 h-4" /> Aléatoire
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide -mx-1"
                  onScroll={(ev) => { const el = ev.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) plusDeTitres(); }}>
                  {titres?.uri === vue.uri && titres.liste.map((t) => {
                    const courant = piste?.uri === t.uri;
                    return (
                      <button key={t.uri} type="button" onClick={() => lancer(vue.uri, { titre: t.uri })}
                        className="w-full flex items-center gap-2.5 rounded-[10px] px-1 py-1.5 text-left active:bg-white/10">
                        <Pochette src={t.image} taille={36} rayon={5} />
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-[15px]" style={courant ? { color: VIOLET } : undefined}>{t.nom}</span>
                          <span className="block truncate text-[12px] text-white/60">{t.artiste} · {mmss(t.duree)}</span>
                        </span>
                        {courant && <span style={{ color: VIOLET }}><IcoSon /></span>}
                      </button>
                    );
                  })}
                  {(!titres || titres.uri !== vue.uri || titres.charge) && <p className="py-3 text-center text-[13px] text-white/40">Chargement…</p>}
                  {titres?.uri === vue.uri && titres.erreur && <p className="py-3 text-center text-[13px] text-white/40">Titres indisponibles pour cette playlist</p>}
                  {titres?.uri === vue.uri && !titres.charge && !titres.erreur && !titres.liste.length && <p className="py-3 text-center text-[13px] text-white/40">Aucun titre</p>}
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-white/30">Tes playlists</p>
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide -mx-1">
                  {[LIKES, ...playlists].map((p) => {
                    const enCours = p.uri === "likes" ? ctx?.endsWith(":collection") : p.uri === ctx;
                    return (
                      <div key={p.uri} className="flex items-center rounded-[10px] active:bg-white/10">
                        <button type="button" onClick={() => lancer(p.uri)} className="flex-1 min-w-0 flex items-center gap-2.5 px-1 py-1.5 text-left">
                          {p.uri === "likes" ? <IconeLikes taille={36} /> : <Pochette src={p.image} taille={36} rayon={6} />}
                          <span className="flex-1 min-w-0 truncate text-[15px]">{p.nom}</span>
                          {enCours && <span className="text-[12px] font-semibold" style={{ color: VIOLET }}>{enLecture ? "En cours" : "En pause"}</span>}
                        </button>
                        <button type="button" onClick={() => ouvrir(p)} aria-label={`Voir les titres de ${p.nom}`}
                          className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white/40 active:bg-white/10">
                          <IcoChevron />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
