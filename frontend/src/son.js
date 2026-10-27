// Bips de la séance guidée, sans fichier son : de petits WAV générés à la volée
// et joués par des éléments <audio>. Sur iPhone, c'est la voie la plus fiable
// (catégorie « lecture » comme une vidéo, non coupée par le bouton silencieux) ;
// Web Audio reste en secours.
// iOS n'autorise un son qu'après un geste : `debloquerSon()` est appelé dans le
// clic qui lance la séance, puis à chaque toucher de l'écran de séance. Chaque
// élément <audio> joué une fois pendant un geste peut ensuite rejouer seul.

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

async function preparerVoix() {
  if (morceaux || typeof Audio === "undefined") return;
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

function lireVoix(url, depart = 0) {
  if (!lecteur || !lecteurDebloque || !url) return false;
  try {
    lecteur.pause();
    lecteur.muted = false;
    if (lecteur.src !== url) lecteur.src = url;
    lecteur.currentTime = depart;
    const p = lecteur.play();
    if (p?.catch) p.catch(() => {});
    return true;
  } catch { return false; }
}

// Arrête le décompte en cours (temps ajouté, minuteur relancé…)
export function couperSon() {
  sequenceFin = 0;
  try { lecteur?.pause(); } catch { /* rien */ }
}

const SONS = { court: [880, 0.18], long: [1320, 0.65] };
let elements = null; // { court: <audio>, long: <audio> }
const debloques = new Set();
let ctx = null;

function preparer() {
  preparerVoix();
  if (elements || typeof Audio === "undefined") return;
  try {
    elements = {};
    for (const [nom, [f, d]] of Object.entries(SONS)) {
      const a = new Audio(wav(f, d));
      a.preload = "auto";
      a.setAttribute("playsinline", "");
      elements[nom] = a;
    }
    lecteur = new Audio(elements.court.src);
    lecteur.preload = "auto";
    lecteur.setAttribute("playsinline", "");
  } catch { elements = null; }
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
  if (elements) {
    for (const [nom, a] of Object.entries(elements)) {
      if (debloques.has(nom)) continue;
      // lecture muette pendant le geste : l'élément est ensuite autorisé à jouer seul
      a.muted = true;
      const p = a.play();
      // (si un bip a déjà démarré entre-temps, l'élément n'est plus muet : on le laisse jouer)
      const fin = () => { if (a.muted) { a.pause(); a.currentTime = 0; a.muted = false; } };
      if (p?.then) p.then(() => { debloques.add(nom); fin(); }).catch(fin);
      else { debloques.add(nom); fin(); }
    }
  }
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

function jouer(nom, secours = nom) {
  const a = elements?.[nom];
  if (a && debloques.has(nom)) {
    try {
      a.muted = false;
      a.currentTime = 0;
      const p = a.play();
      if (p?.catch) p.catch(() => bipWebAudio(...SONS[secours]));
      return;
    } catch { /* secours ci-dessous */ }
  }
  bipWebAudio(...SONS[secours]);
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
