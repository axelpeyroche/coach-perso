import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

// Page publique (accessible sans compte) : ce que Mon Carnet enregistre et pourquoi
const MISE_A_JOUR = "13 novembre 2026";

function Bloc({ titre, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[20px] font-semibold">{titre}</h2>
      <div className="space-y-2 text-[16px] leading-[23px] text-label">{children}</div>
    </section>
  );
}

export default function Confidentialite() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const retour = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate(user ? "/profil" : "/login"));

  return (
    <div className="min-h-[100dvh] bg-fond px-4 pt-safe">
      <main className="max-w-[640px] mx-auto py-10 space-y-7">
        <button type="button" onClick={retour} className="text-[17px] text-brand transition active:opacity-50">
          ‹ Retour
        </button>
        <header className="space-y-2">
          <h1 className="large-title">Confidentialité</h1>
          <p className="text-[15px] text-label-2">Mon Carnet · mise à jour le {MISE_A_JOUR}</p>
        </header>

        <p className="text-[16px] leading-[23px]">
          Mon Carnet est un carnet d'entraînement personnel, en bêta fermée et gratuite. Ce n'est pas un dispositif
          médical : les indicateurs affichés (forme, fatigue, sommeil…) sont des repères, pas des diagnostics.
          En cas de doute sur ta santé, parles-en à un professionnel de santé.
        </p>

        <Bloc titre="Ce qui est enregistré">
          <ul className="list-disc pl-5 space-y-1">
            <li>Ton compte : prénom, nom, adresse e-mail, mot de passe (chiffré, jamais lisible), et si tu les donnes : date de naissance, sexe, taille, poids, adresse de départ de tes parcours.</li>
            <li>Tes séances : sport, durée, distance, fréquence cardiaque, tracé GPS, ressentis et notes.</li>
            <li>Tes mesures de santé : FC de repos, VFC, sommeil, poids, douleurs que tu notes.</li>
            <li>Tes plans, objectifs et parcours enregistrés.</li>
            <li>Tes réponses à l'assistant « Mon IA crée mon plan » : objectif, disponibilités, contraintes et blessures que tu y écris. Elles sont recopiées dans la consigne que tu donnes toi-même à ton IA ; le carnet ne les envoie à personne.</li>
          </ul>
          <p>Ces données de santé ne sont enregistrées qu'avec ton accord, donné à la création du compte.</p>
        </Bloc>

        <Bloc titre="Pourquoi">
          <p>
            Uniquement pour te les afficher et calculer tes analyses (charge, zones, records, tendances).
            Pas de publicité, pas de revente, pas de profilage. Personne d'autre n'a accès à ton carnet,
            sauf les IA à qui tu donnes toi-même ton lien ou ton jeton : l'administration de la bêta ne voit que la
            liste des comptes invités, jamais leur contenu.
          </p>
        </Bloc>

        <Bloc titre="Si tu utilises une IA">
          <p>
            Le carnet n'envoie rien à aucune IA de sa propre initiative. Si tu colles la consigne de l'assistant dans une IA,
            tu lui donnes un lien en lecture seule (ou, au niveau automatique avec Claude, un jeton d'envoi). Cette IA et
            son éditeur peuvent alors lire tout ton carnet, données de santé comprises, tant que tu ne changes pas ce lien
            ou ce jeton dans Sources. Le jeton d'envoi permet en plus d'ajouter, de modifier et de retirer des séances
            prévues ; il ne retire ni tes séances réalisées ni celles que tu as ajoutées toi-même.
          </p>
        </Bloc>

        <Bloc titre="Où sont stockées les données">
          <p>Sur les serveurs de Render (hébergement de l'application et de la base de données), avec une connexion chiffrée.</p>
        </Bloc>

        <Bloc titre="Services tiers">
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Intervals.icu</b> : si tu le relies, Mon Carnet y récupère tes séances et mesures avec la clé que tu fournis.</li>
            <li><b>OpenFreeMap</b> : fonds de carte (seule la zone affichée est demandée).</li>
            <li><b>BRouter</b>, <b>OpenRouteService</b> et <b>Photon</b> : calcul d'itinéraires et recherche d'adresses, à partir des points que tu choisis.</li>
            <li><b>Open-Meteo</b> : météo d'une séance, à partir de son lieu et de son heure.</li>
          </ul>
          <p>Ces services ne reçoivent ni ton nom ni ton adresse e-mail.</p>
        </Bloc>

        <Bloc titre="Durée de conservation">
          <p>Tant que ton compte existe. Quand tu le supprimes, toutes tes données sont effacées immédiatement et définitivement.</p>
        </Bloc>

        <Bloc titre="Tes droits">
          <p>
            Dans <b>Profil › Données du compte</b>, tu peux à tout moment télécharger une sauvegarde complète (JSON),
            exporter tes séances (CSV) ou supprimer ton compte. Tu peux aussi corriger tes informations dans Profil.
          </p>
          <p>
            Pour toute question, ou pour retirer ton accord, contacte la personne qui t'a envoyé ton invitation.
            Tu peux aussi saisir la CNIL (cnil.fr).
          </p>
        </Bloc>

        {!user && (
          <p className="text-center text-[15px]">
            <Link to="/login" className="text-brand">Revenir à la connexion</Link>
          </p>
        )}
      </main>
    </div>
  );
}
