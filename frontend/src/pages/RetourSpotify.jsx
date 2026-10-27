import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { terminerConnexion } from "../spotify";
import Page from "../components/Page";

// Page de retour après la connexion à Spotify : échange du code puis retour au Profil
export default function RetourSpotify() {
  const navigate = useNavigate();
  const [erreur, setErreur] = useState(null);
  const fait = useRef(false);
  useEffect(() => {
    if (fait.current) return;  // le code ne sert qu'une fois (double appel en développement)
    fait.current = true;
    terminerConnexion(new URLSearchParams(window.location.search))
      .then(() => navigate("/profil?spotify=ok", { replace: true }))
      .catch((e) => setErreur(e.message === "access_denied" ? "Connexion annulée." : "La connexion à Spotify a échoué."));
  }, [navigate]);
  return (
    <Page titre="Spotify">
      <p className="text-[15px] text-label-2">{erreur ?? "Connexion à Spotify…"}</p>
      {erreur && <Link to="/profil" className="mt-3 inline-block text-[17px] text-brand">Retour au Profil</Link>}
    </Page>
  );
}
