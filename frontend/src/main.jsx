import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider } from "./AuthContext";
import { reveillerServeur } from "./api";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// Réveille l'API dès l'ouverture, en parallèle du chargement de l'interface
reveillerServeur();

// Pas de zoom au pincement dans l'appli (Safari ignore user-scalable=no) : seules les cartes se zooment
const surCarte = (e) => e.target instanceof Element && e.target.closest(".maplibregl-map");
for (const type of ["gesturestart", "gesturechange"]) {
  document.addEventListener(type, (e) => { if (!surCarte(e)) e.preventDefault(); }, { passive: false });
}
document.addEventListener("touchmove", (e) => {
  if (e.touches.length > 1 && !surCarte(e)) e.preventDefault();
}, { passive: false });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
