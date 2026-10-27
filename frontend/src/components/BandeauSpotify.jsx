import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { spotifyDisponible, spotifyConnecte, etatLecteur, lire, pause, suivant, precedent, mesPlaylists } from "../spotify";

// Bandeau Spotify de la séance guidée : titre en cours, pause et suivant ;
// touché, il se déplie en lecteur avec la liste des playlists. Les « titres
// likés » se lancent au début de la séance si rien ne joue déjà.

const VIOLET = "#BF5AF2";
const VERT = "#30D158";
const LIKES = { uri: "likes", nom: "Titres likés" };

const svg = { viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true };
const IcoPause = ({ c = "w-5 h-5" }) => <svg className={c} {...svg}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>;
const IcoLecture = ({ c = "w-5 h-5" }) => <svg className={c} {...svg}><path d="M7 4.5v15a1 1 0 001.5.86l12-7.5a1 1 0 000-1.72l-12-7.5A1 1 0 007 4.5z" /></svg>;
const IcoSuivant = ({ c = "w-[18px] h-[18px]" }) => <svg className={c} {...svg}><path d="M5 5.5v13a1 1 0 001.5.85L16 13.5V18a1 1 0 002 0V6a1 1 0 00-2 0v4.5L6.5 4.65A1 1 0 005 5.5z" /></svg>;
const IcoPrecedent = ({ c }) => <span className="block -scale-x-100"><IcoSuivant c={c} /></span>;
const IcoNote = () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></svg>;

function Pochette({ src, taille, rayon = 7 }) {
  return src
    ? <img src={src} alt="" className="shrink-0 object-cover" style={{ width: taille, height: taille, borderRadius: rayon }} />
    : <span className="shrink-0 flex items-center justify-center bg-[#2c2c2e] text-white/30" style={{ width: taille, height: taille, borderRadius: rayon }}><IcoNote /></span>;
}

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

// État du lecteur, gardé par l'écran de séance (le bandeau, lui, est redessiné à chaque étape)
export function useSpotify({ autoLancer = true } = {}) {
  const actif = spotifyDisponible && spotifyConnecte();
  const [lecteur, setLecteur] = useState(null);   // état renvoyé par Spotify (null : rien ne joue)
  const [endormi, setEndormi] = useState(false);   // aucun appareil Spotify disponible
  const [erreur, setErreur] = useState(null);
  const [deplie, setDeplie] = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [maintenant, setMaintenant] = useState(Date.now());
  const enAttente = useRef(null);                  // lecture à lancer dès que Spotify se réveille
  const recu = useRef(0);

  async function rafraichir() {
    try {
      const d = await etatLecteur();
      recu.current = Date.now();
      setLecteur(d?.item ? d : null);
      if (d?.item) setEndormi(false);
      return d;
    } catch (e) {
      if (e.status === 401) setErreur("Reconnecte Spotify depuis Profil");
      return null;
    }
  }

  async function lancer(uri) {
    setErreur(null);
    try {
      await lire(uri);
      enAttente.current = null;
      setEndormi(false);
      setTimeout(rafraichir, 600);
    } catch (e) {
      if (e.endormi) { enAttente.current = { uri }; setEndormi(true); }
      else setErreur(message(e));
    }
  }

  async function commande(fn) {
    setErreur(null);
    try { await fn(); } catch (e) { if (e.status === 404) setEndormi(true); else setErreur(message(e)); }
    setTimeout(rafraichir, 500);
  }

  // Démarrage : état du lecteur, playlists, titres likés si rien ne joue
  useEffect(() => {
    if (!actif) return;
    (async () => {
      const d = await rafraichir();
      if (autoLancer && !d?.is_playing) lancer(LIKES.uri);
    })();
    mesPlaylists().then(setPlaylists).catch(() => {});
  }, [actif]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suivi : toutes les 5 s, et au retour sur la page (après un passage dans l'appli Spotify)
  useEffect(() => {
    if (!actif) return;
    const t = setInterval(() => { if (!document.hidden) rafraichir(); }, 5000);
    const s = setInterval(() => setMaintenant(Date.now()), 1000);
    const retour = () => {
      if (document.hidden) return;
      if (enAttente.current) lancer(enAttente.current.uri);
      else rafraichir();
    };
    document.addEventListener("visibilitychange", retour);
    return () => { clearInterval(t); clearInterval(s); document.removeEventListener("visibilitychange", retour); };
  }, [actif]); // eslint-disable-line react-hooks/exhaustive-deps

  return { actif, lecteur, endormi, erreur, deplie, setDeplie, playlists, maintenant, recu, lancer, commande };
}

export default function BandeauSpotify({ sp }) {
  const { actif, lecteur, endormi, erreur, deplie, setDeplie, playlists, maintenant, recu, lancer, commande } = sp;
  if (!actif) return null;

  const piste = lecteur?.item;
  const enLecture = !!lecteur?.is_playing;
  const image = piste?.album?.images?.at(-1)?.url ?? piste?.images?.at(-1)?.url;
  const grande = piste?.album?.images?.[0]?.url ?? piste?.images?.[0]?.url;
  const artiste = piste?.artists?.map((a) => a.name).join(", ") ?? piste?.show?.name;
  const ctx = lecteur?.context?.uri;
  const nomContexte = ctx?.endsWith(":collection") ? LIKES.nom : playlists.find((p) => p.uri === ctx)?.nom;
  const progression = piste ? Math.min(piste.duration_ms, (lecteur.progress_ms ?? 0) + (enLecture ? maintenant - recu.current : 0)) : 0;
  const basculer = () => (enLecture ? commande(pause) : lancer(null));

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
        <button type="button" onClick={() => setDeplie(true)} className="flex-1 min-w-0 flex items-center gap-2.5 text-left" aria-label="Ouvrir le lecteur Spotify">
          <Pochette src={image} taille={38} />
          <span className="min-w-0">
            <span className={`block text-[14px] font-semibold ${piste ? "truncate" : "line-clamp-2"}`}>{piste?.name ?? (erreur || "Spotify")}</span>
            <span className="block text-[12px] text-white/60 truncate">
              {piste ? [artiste, nomContexte].filter(Boolean).join(" · ") : erreur ? "Touche pour les playlists" : "Rien en lecture · touche pour choisir"}
            </span>
          </span>
        </button>
        <button type="button" onClick={basculer} className={boutonRond} aria-label={enLecture ? "Pause" : "Lecture"}>
          {enLecture ? <IcoPause /> : <IcoLecture />}
        </button>
        <button type="button" onClick={() => commande(suivant)} className={boutonRond} aria-label="Morceau suivant"><IcoSuivant /></button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3">{bandeau}</div>
      {deplie && createPortal(
        <div className="fixed inset-0 z-[70] text-white font-sans antialiased select-none flex items-end lg:items-center justify-center bg-black/60" onClick={() => setDeplie(false)}>
          <div className="w-full max-w-[480px] max-h-[85vh] flex flex-col rounded-t-[20px] lg:rounded-[20px] bg-[#1c1c1e] px-4 pt-2.5 animate-[fondu_0.2s_ease-out]"
            style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
            onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Lecteur Spotify">
            <button type="button" onClick={() => setDeplie(false)} aria-label="Refermer le lecteur" className="mx-auto mb-3 block w-10 h-[5px] rounded-full bg-[#3a3a3c]" />
            <div className="flex items-center gap-3">
              <Pochette src={grande} taille={64} rayon={10} />
              <div className="min-w-0">
                <p className="text-[16px] font-semibold truncate">{piste?.name ?? "Rien en lecture"}</p>
                <p className="text-[13px] text-white/60 truncate">{piste ? [artiste, nomContexte].filter(Boolean).join(" · ") : "Choisis une playlist"}</p>
              </div>
            </div>
            {piste && (
              <>
                <div className="mt-3.5 h-1 rounded-full bg-[#3a3a3c] overflow-hidden">
                  <i className="block h-full bg-white rounded-full" style={{ width: `${(progression / piste.duration_ms) * 100}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-white/60 chiffres"><span>{mmss(progression)}</span><span>{mmss(piste.duration_ms)}</span></div>
              </>
            )}
            <div className="flex items-center justify-center gap-6 my-2">
              <button type="button" onClick={() => commande(precedent)} className="w-12 h-12 rounded-full flex items-center justify-center active:bg-white/10" aria-label="Morceau précédent"><IcoPrecedent c="w-6 h-6" /></button>
              <button type="button" onClick={basculer} className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center" aria-label={enLecture ? "Pause" : "Lecture"}>
                {enLecture ? <IcoPause c="w-7 h-7" /> : <IcoLecture c="w-7 h-7" />}
              </button>
              <button type="button" onClick={() => commande(suivant)} className="w-12 h-12 rounded-full flex items-center justify-center active:bg-white/10" aria-label="Morceau suivant"><IcoSuivant c="w-6 h-6" /></button>
            </div>
            {erreur && <p className="mb-2 text-center text-[13px] text-[#FF453A]">{erreur}</p>}
            <p className="mt-1 mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-white/30">Tes playlists</p>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide -mx-1">
              {[LIKES, ...playlists].map((p) => {
                const enCours = p.uri === "likes" ? ctx?.endsWith(":collection") : p.uri === ctx;
                return (
                  <button key={p.uri} type="button" onClick={() => lancer(p.uri)}
                    className="w-full flex items-center gap-2.5 rounded-[10px] px-1 py-1.5 text-left active:bg-white/10">
                    {p.uri === "likes"
                      ? <span className="w-9 h-9 shrink-0 rounded-[6px] flex items-center justify-center" style={{ background: "linear-gradient(135deg,#450af5,#c4efd9)" }}>
                          <svg className="w-4 h-4" {...svg}><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.4 3.2 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5 18.8 5 21 8.4 19.5 11.8 17.5 16.4 12 21 12 21z" /></svg>
                        </span>
                      : <Pochette src={p.image} taille={36} rayon={6} />}
                    <span className="flex-1 min-w-0 truncate text-[15px]">{p.nom}</span>
                    {enCours && <span className="text-[12px] font-semibold" style={{ color: VIOLET }}>{enLecture ? "En cours" : "En pause"}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
