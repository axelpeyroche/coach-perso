import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
});
