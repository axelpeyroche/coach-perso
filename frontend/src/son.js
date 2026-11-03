// Sons de la séance guidée : voix du décompte et bips (petits WAV générés à la volée),
// tous joués par UN SEUL élément <audio>. Sur iPhone, c'est la voie la plus fiable
// (catégorie « lecture » comme une vidéo, non coupée par le bouton silencieux) ;
// plusieurs éléments joués en même temps s'interrompaient (mots coupés, bips mêlés à la voix).
// Web Audio reste en secours.
// iOS n'autorise un son qu'après un geste : `debloquerSon()` est appelé dans le
// clic qui lance la séance, puis à chaque toucher de l'écran de séance ; le décompte
// lancé au doigt part directement dans le geste (`lancerDecompteSon`).

const TAUX = 44100;

// WAV mono 16 bits à partir d'échantillons entre -1 et 1
function encoderWav(ech, taux = TAUX) {
  const n = ech.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); txt(8, "WAVE");
  txt(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, taux, true); v.setUint32(28, taux * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i += 1) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, ech[i])) * 32767), true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

// Bip : sinus avec attaque et extinction douces
function wav(frequence, duree, volume = 0.9) {
  const n = Math.round(TAUX * duree);
  const ech = new Float32Array(n);
  const attaque = TAUX * 0.005;
  for (let i = 0; i < n; i += 1) {
    const env = Math.min(1, i / attaque) * Math.pow(1 - i / n, 1.5);
    ech[i] = Math.sin((2 * Math.PI * frequence * i) / TAUX) * env * volume;
  }
  return encoderWav(ech);
}

// Voix du décompte (fichiers de public/voix : trois, deux, un, go, repos ; voix d'homme « Henri » générée une fois
// par synthèse neuronale) : silence de tête et de queue coupé, volume poussé au maximum
// pour que le mot tombe pile sur la seconde.
// Toutes les voix passent par UN SEUL lecteur : deux mots ne peuvent jamais se chevaucher. Le décompte
// « trois, deux, un » + mot final est assemblé en un seul enregistrement, un mot par seconde, joué d'un bloc :
// sur iPhone, des lectures lancées séparément chaque seconde peuvent partir en retard et s'entremêler.
const VOIX = { 3: "trois", 2: "deux", 1: "un", go: "go", repos: "repos" };
let morceaux = null; // { trois: { d: Float32Array, taux }, ... }
let urls = {};       // mot ou décompte → URL du WAV
let lecteur = null;  // l'unique <audio> des voix
let lecteurDebloque = false;
let sequenceFin = 0; // instant de fin du décompte en cours : les mots suivants sont déjà dedans
let chargement = null;

function preparerVoix() {
  if (!chargement) chargement = chargerVoix();
  return chargement;
}

async function chargerVoix() {
  if (typeof Audio === "undefined") return;
  morceaux = {};
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return;
  await Promise.all(Object.values(VOIX).map(async (nom) => {
    try {
      const brut = await (await fetch(`/voix/${nom}.mp3`)).arrayBuffer();
      const tampon = await new Promise((ok, ko) => {
        const p = new OAC(1, 1, TAUX).decodeAudioData(brut, ok, ko);
        if (p?.catch) p.catch(ko);
      });
      const d = tampon.getChannelData(0);
      let debut = 0; while (debut < d.length && Math.abs(d[debut]) < 0.01) debut += 1;
      let fin = d.length - 1; while (fin > debut && Math.abs(d[fin]) < 0.01) fin -= 1;
      debut = Math.max(0, debut - Math.round(tampon.sampleRate * 0.01));
      fin = Math.min(d.length, fin + Math.round(tampon.sampleRate * 0.12));
      const morceau = d.slice(debut, fin);
      let crete = 0; for (const x of morceau) crete = Math.max(crete, Math.abs(x));
      const gain = crete > 0 ? 0.98 / crete : 1;
      for (let i = 0; i < morceau.length; i += 1) morceau[i] *= gain;
      morceaux[nom] = { d: morceau, taux: tampon.sampleRate };
      urls[nom] = encoderWav(morceau, tampon.sampleRate);
    } catch { /* fichier absent : le bip prendra le relais */ }
  }));
}

// « trois » à 0 s, « deux » à 1 s, « un » à 2 s, puis `final` à 3 s (sans voix : décompte seul)
function urlDecompte(final) {
  const cle = `decompte-${final}`;
  if (urls[cle]) return urls[cle];
  const mots = ["trois", "deux", "un", VOIX[final]];
  if (!mots.slice(0, 3).every((m) => morceaux?.[m])) return null;
  const taux = morceaux.trois.taux;
  const dernier = morceaux[mots[3]];
  const ech = new Float32Array(Math.round(taux * 3) + (dernier ? dernier.d.length : 0));
  mots.forEach((m, i) => {
    const x = morceaux[m];
    if (!x) return;
    // un mot ne déborde jamais sur la seconde suivante
    const n = i < 3 ? Math.min(x.d.length, Math.round(taux * 0.95)) : x.d.length;
    ech.set(x.d.subarray(0, n), Math.round(taux * i));
  });
  urls[cle] = encoderWav(ech, taux);
  return urls[cle];
}

function lireVoix(url, depart = 0, geste = false) {
  if (!lecteur || !url || (!lecteurDebloque && !geste)) return false;
  try {
    lecteur.pause();
    lecteur.muted = false;
    if (lecteur.src !== url) {
      lecteur.src = url;
      // avant le chargement, iOS ignore la position demandée
      if (depart > 0) lecteur.addEventListener("loadedmetadata", () => { lecteur.currentTime = depart; }, { once: true });
    } else lecteur.currentTime = depart;
    const p = lecteur.play();
    if (p?.then) p.then(() => { lecteurDebloque = true; }).catch(() => {});
    else lecteurDebloque = true;
    return true;
  } catch { return false; }
}

// Arrête le décompte en cours (temps ajouté, minuteur relancé…)
export function couperSon() {
  sequenceFin = 0;
  try { lecteur?.pause(); } catch { /* rien */ }
}

const SONS = { court: [880, 0.18], long: [1320, 0.65] };
let ctx = null;

function preparer() {
  const voix = preparerVoix();
  if (lecteur || typeof Audio === "undefined") return voix;
  try {
    for (const [nom, [f, d]] of Object.entries(SONS)) urls[`bip-${nom}`] = wav(f, d);
    lecteur = new Audio(urls["bip-court"]);
    lecteur.preload = "auto";
    lecteur.setAttribute("playsinline", "");
  } catch { lecteur = null; }
  return voix;
}

// À l'ouverture de la séance : voix chargées et décomptes assemblés avant le premier « trois »
export function prechargerSon() {
  Promise.resolve(preparer()).then(() => { urlDecompte("go"); urlDecompte("repos"); urlDecompte("bip"); }).catch(() => {});
}

// Avec Spotify, la session « ambient » mêle les bips à la musique ; « playback »
// prendrait la main sur le son du téléphone et mettrait Spotify en pause.
let melange = false;
const typeSession = () => {
  try { if (navigator.audioSession) navigator.audioSession.type = melange ? "ambient" : "playback"; } catch { /* non pris en charge */ }
};
export function melangerSon(oui) { melange = oui; typeSession(); }

export function debloquerSon() {
  // Safari 17+ : la page se comporte comme un lecteur, le bouton silencieux ne coupe plus les bips
  // (sauf en mode mélangé avec Spotify, où le bouton silencieux coupe les bips)
  typeSession();

  preparer();
  // lecture muette pendant le geste : le lecteur est ensuite autorisé à jouer seul
  // (si un son a démarré entre-temps, il n'est plus muet : on le laisse jouer)
  if (lecteur && !lecteurDebloque && lecteur.paused) {
    lecteur.muted = true;
    const p = lecteur.play();
    const fin = () => { if (lecteur.muted) { lecteur.pause(); lecteur.muted = false; } };
    if (p?.then) p.then(() => { lecteurDebloque = true; fin(); }).catch(fin);
    else { lecteurDebloque = true; fin(); }
  }

  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    }
    // « suspended » au départ, « interrupted » sur iPhone après un appel ou un retour d'arrière-plan
    if (ctx.state !== "running") ctx.resume().catch(() => {});
  } catch { ctx = null; }
}

// Décompte « trois, deux, un, go » lancé au doigt : joué tout de suite, dans le geste, d'un seul bloc.
// Les appels de `bipCourt` pendant ce décompte sont ensuite ignorés.
export function lancerDecompteSon(final = "go") {
  preparer();
  typeSession();
  const lance = lireVoix(urlDecompte(final), 0, true);
  if (lance) sequenceFin = Date.now() + 3000 + (VOIX[final] ? 600 : -150);
  debloquerSon(); // Web Audio en secours (le lecteur, déjà en train de jouer, n'est pas touché)
  return lance;
}

function bipWebAudio(frequence, duree) {
  if (!ctx || ctx.state !== "running") return false;
  try {
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = frequence;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + duree + 0.02);
    return true;
  } catch { return false; }
}

function jouer(nom) {
  if (!lireVoix(urls[`bip-${nom}`])) bipWebAudio(...SONS[nom]);
}

// 3, 2, 1 : « trois », « deux », « un » ; puis « go » au début d'un effort, « repos » à la fin.
// `bipCourt(3, final, resteMs)` lance tout le décompte d'un bloc (mot `final` compris) : les appels
// suivants (2, 1, puis le mot final) sont alors ignorés jusqu'à sa fin.
// Tant que la voix n'est pas prête (ou introuvable) : bip court, puis bip long plus aigu.
export function bipCourt(reste, final, resteMs) {
  if (Date.now() < sequenceFin) return;
  if (reste === 3 && final) {
    const depart = resteMs != null ? Math.max(0, Math.min(1, 3 - resteMs / 1000)) : 0;
    if (lireVoix(urlDecompte(final), depart)) {
      // le mot final (ou le bip long, sans voix) reste à jouer à la fin si le décompte n'a pas de voix pour lui
      sequenceFin = Date.now() + (3 - depart) * 1000 + (VOIX[final] ? 600 : -150);
      return;
    }
  }
  if (!lireVoix(urls[VOIX[reste]])) jouer("court");
}

export function bipLong(mot = "go") {
  if (Date.now() < sequenceFin) return;
  if (!lireVoix(urls[VOIX[mot]])) jouer("long");
}
