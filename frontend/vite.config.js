import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Politique de sécurité du contenu (build uniquement : le serveur de dev a besoin de scripts en ligne).
// Bloque l'exécution de scripts injectés et l'envoi de données vers un domaine non prévu.
function csp(apiUrl) {
  let api = "https://coach-perso.onrender.com";
  try { if (apiUrl) api = new URL(apiUrl).origin; } catch { /* URL relative : même origine */ }
  const tuiles = "https://tile.openstreetmap.org https://server.arcgisonline.com https://s3.amazonaws.com";
  const regles = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${tuiles}`,
    `connect-src 'self' ${api} ${tuiles} https://photon.komoot.io`,
    "worker-src 'self' blob:",
    "child-src blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  return {
    name: "csp",
    apply: "build",
    transformIndexHtml: (html) => html.replace("<head>",
      `<head>
    <meta http-equiv="Content-Security-Policy" content="${regles.join("; ")}" />`),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), csp(loadEnv(mode, process.cwd(), "").VITE_API_URL)],
  build: {
    rollupOptions: {
      output: {
        // Bibliothèques lourdes isolées : mises en cache par le navigateur entre deux déploiements
        manualChunks: {
          recharts: ["recharts"],
          vendor: ["react", "react-dom", "react-router-dom", "@tanstack/react-query", "axios"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
}));
