// Bips de la séance guidée (Web Audio, sans fichier son).
// Safari n'autorise le son qu'après un geste : `debloquerSon()` est appelé
// dans le gestionnaire du clic qui lance la séance, puis à chaque bouton.

let ctx = null;

export function debloquerSon() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      // tampon muet : déverrouille la sortie audio sur iOS
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    }
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    ctx = null;
  }
}

function bip(frequence, duree) {
  if (!ctx) return;
  try {
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = frequence;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + duree + 0.02);
  } catch { /* son indisponible : la séance continue sans */ }
}

// 3, 2, 1 : bip court ; GO (ou fin du repos) : bip long plus aigu
export const bipCourt = () => bip(880, 0.15);
export const bipLong = () => bip(1320, 0.6);
