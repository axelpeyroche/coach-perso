// Bips de la séance guidée, sans fichier son : de petits WAV générés à la volée
// et joués par des éléments <audio>. Sur iPhone, c'est la voie la plus fiable
// (catégorie « lecture » comme une vidéo, non coupée par le bouton silencieux) ;
// Web Audio reste en secours.
// iOS n'autorise un son qu'après un geste : `debloquerSon()` est appelé dans le
// clic qui lance la séance, puis à chaque toucher de l'écran de séance. Chaque
// élément <audio> joué une fois pendant un geste peut ensuite rejouer seul.

const TAUX = 44100;

// WAV mono 16 bits : sinus avec attaque et extinction douces
function wav(frequence, duree, volume = 0.9) {
  const n = Math.round(TAUX * duree);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); txt(8, "WAVE");
  txt(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, TAUX, true); v.setUint32(28, TAUX * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, "data"); v.setUint32(40, n * 2, true);
  const attaque = TAUX * 0.005;
  for (let i = 0; i < n; i += 1) {
    const env = Math.min(1, i / attaque) * (frequence ? Math.pow(1 - i / n, 1.5) : 0);
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * frequence * i) / TAUX) * env * volume * 32767), true);
  }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

const SONS = { court: [880, 0.18], long: [1320, 0.65] };
let elements = null; // { court: <audio>, long: <audio> }
const debloques = new Set();
let ctx = null;

function preparer() {
  if (elements || typeof Audio === "undefined") return;
  try {
    elements = {};
    for (const [nom, [f, d]] of Object.entries(SONS)) {
      const a = new Audio(wav(f, d));
      a.preload = "auto";
      a.setAttribute("playsinline", "");
      elements[nom] = a;
    }
  } catch { elements = null; }
}

export function debloquerSon() {
  // Safari 17+ : la page se comporte comme un lecteur, le bouton silencieux ne coupe plus les bips
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch { /* non pris en charge */ }

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

function jouer(nom) {
  const a = elements?.[nom];
  if (a && debloques.has(nom)) {
    try {
      a.muted = false;
      a.currentTime = 0;
      const p = a.play();
      if (p?.catch) p.catch(() => bipWebAudio(...SONS[nom]));
      return;
    } catch { /* secours ci-dessous */ }
  }
  bipWebAudio(...SONS[nom]);
}

// 3, 2, 1 : bip court ; GO (ou fin du repos) : bip long plus aigu
export const bipCourt = () => jouer("court");
export const bipLong = () => jouer("long");
