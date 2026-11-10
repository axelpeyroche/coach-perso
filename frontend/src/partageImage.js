// Image carrée à partager (1080 px) : un grand chiffre, trois tuiles et des barres.
// Sert aux bilans de l'année, du mois et de la semaine.
const police = (px, poids = 600) => `${poids} ${px}px -apple-system, "SF Pro Display", "Segoe UI", Roboto, sans-serif`;

function largeur(g, texte, font) {
  const avant = g.font;
  g.font = font;
  const w = g.measureText(texte).width;
  g.font = avant;
  return w;
}

// carte = { surtitre, valeur, unite, comp, tuiles: [[valeur, libellé] × 3], barres: [{ v, label, fort }] }
export function dessinerCarte({ surtitre, valeur, unite, comp, tuiles = [], barres = [] }) {
  const N = 1080, c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  const fond = g.createLinearGradient(0, 0, N, N);
  fond.addColorStop(0, "#0a84ff");
  fond.addColorStop(1, "#5e5ce6");
  g.fillStyle = fond;
  g.fillRect(0, 0, N, N);
  g.fillStyle = "rgba(255,255,255,0.8)";
  g.font = police(34, 600);
  g.fillText(surtitre.toUpperCase(), 80, 130);
  g.fillStyle = "#fff";
  // Le grand chiffre rétrécit s'il est long (« 12 h 30 »)
  const taille = Math.min(220, Math.floor(220 * 700 / Math.max(700, largeur(g, valeur, police(220, 800)) + (unite ? 160 : 0))));
  g.font = police(taille, 800);
  g.fillText(valeur, 72, 350);
  if (unite) {
    g.font = police(Math.round(taille * 0.36), 600);
    g.fillText(unite, 72 + largeur(g, valeur, police(taille, 800)) + 20, 350);
  }
  if (comp) {
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.font = police(34, 500);
    g.fillText(comp, 80, 410);
  }
  const lt = (N - 160 - 2 * 28) / 3;
  tuiles.slice(0, 3).forEach(([v, l], i) => {
    const x = 80 + i * (lt + 28), y = 460;
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.beginPath();
    g.roundRect(x, y, lt, 150, 26);
    g.fill();
    g.fillStyle = "#fff";
    g.font = police(60, 700);
    g.fillText(String(v), x + 28, y + 80);
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.font = police(28, 500);
    g.fillText(l, x + 28, y + 122);
  });
  if (barres.length) {
    const max = Math.max(...barres.map((b) => b.v), 1);
    const esp = barres.length > 14 ? 6 : 14;
    const lb = (N - 160 - (barres.length - 1) * esp) / barres.length, base = 940, H = 230;
    barres.forEach((b, i) => {
      const h = Math.max(6, (b.v / max) * H), x = 80 + i * (lb + esp);
      g.fillStyle = b.fort ? "#fff" : "rgba(255,255,255,0.4)";
      g.beginPath();
      g.roundRect(x, base - h, lb, h, [Math.min(10, lb / 2), Math.min(10, lb / 2), 4, 4]);
      g.fill();
      if (b.label) {
        g.fillStyle = "rgba(255,255,255,0.75)";
        g.font = police(26, 600);
        g.textAlign = "center";
        g.fillText(b.label, x + lb / 2, base + 40);
        g.textAlign = "left";
      }
    });
  }
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.font = police(26, 500);
  g.textAlign = "right";
  g.fillText("Carnet", N - 80, N - 40);
  return new Promise((ok) => c.toBlob(ok, "image/png"));
}

// Feuille de partage du système si elle accepte les fichiers, sinon téléchargement
export async function partagerImage(blob, nom, titre) {
  const fichier = new File([blob], nom, { type: "image/png" });
  if (navigator.canShare?.({ files: [fichier] })) {
    await navigator.share({ files: [fichier], title: titre });
  } else {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: nom }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
