# Migration de Mon Carnet vers Koyeb (100 %, Render abandonné)

Prévue début janvier 2027. Fiche préparée le 17/11/2026.

## Le principe : un seul service Koyeb, la base ne bouge pas

| Élément | Aujourd'hui | Après la migration |
|---|---|---|
| Base de données (séances, comptes, plans, réglages, jetons, abonnements aux notifications) | Neon, Francfort (`eu-central-1`) | **Inchangée** : même base, même adresse, rien n'est copié ni transformé |
| API (FastAPI) | Render, `coach-perso.onrender.com` | Koyeb, `https://<nom>.koyeb.app/api` |
| Interface (React) | Render, site statique `coach-perso-frontend.onrender.com` | **Le même service Koyeb**, `https://<nom>.koyeb.app` |
| Synchro du matin | GitHub Actions vers Render | GitHub Actions vers Koyeb (variable GitHub) |
| Code | GitHub `master` | Inchangé, Koyeb se redéploie à chaque push |

Koyeb n'offre qu'**une** instance gratuite par compte. L'API sert donc aussi l'interface, à la même adresse. Avantages : une seule adresse à donner, un seul service à garder éveillé, plus de règles d'accès entre deux domaines.

Seule l'**adresse** change ; toutes les données restent dans Neon. Render n'est supprimé qu'après un mois de bon fonctionnement, pour garder un retour arrière.

## Ce qu'il faut savoir sur Koyeb (docs lues le 17/11/2026)

- **Instance gratuite :** 512 Mo de RAM, 0,1 vCPU (comme Render gratuit). Une par organisation, à Francfort ou Washington. Aucun plafond d'heures, jamais facturée.
- **Mise en veille** après 1 h sans trafic (non réglable). UptimeRobot la garde éveillée ; ici, ça ne prend rien à tes autres outils.
- **Carte bancaire demandée à l'inscription**, contre la fraude : 29 $ bloqués puis débloqués aussitôt. Choisis bien l'offre gratuite (Hobby).
- **X-Forwarded-For :** Koyeb ajoute l'IP réelle en dernier, comme Render. La limite de tentatives de connexion (`deps.py`) fonctionne telle quelle.
- **Neon :** pas de liste d'IP autorisées sur l'offre gratuite, la connexion depuis Koyeb passe sans réglage.

## Étape 0 : le code (fait le 17/11/2026, sans effet sur Render)

- [x] **`Dockerfile`** en deux temps : construction de l'interface (Node), puis API Python qui l'embarque. Render ne le lit pas.
- [x] **`.dockerignore`** : ni `.env`, ni données personnelles (CSV, `programme_muscu/`, `exports/`), ni tests dans l'image.
- [x] **`main.py`** : si `DOSSIER_INTERFACE` est défini (seulement dans le Dockerfile), l'API sert aussi les pages de l'application et les fichiers construits (cache long pour `assets/`, aucun cache pour `index.html`, `sw.js`, `manifest.json`), avec des en-têtes de sécurité adaptés. Les fichiers du serveur restent inaccessibles (testé). Sans cette variable, comme sur Render, rien ne change.
- [x] **`/health`** accepte HEAD (moniteurs).
- [x] **Spotify :** l'identifiant de l'app est lu au démarrage (variable `SPOTIFY_CLIENT_ID`), pas besoin de reconstruire l'interface.
- [x] **Sécurité du navigateur (CSP) :** si l'API est à la même adresse, seul `'self'` est autorisé.
- [x] **Synchro du matin :** adresse lue dans la variable GitHub `CARNET_API_URL` (Render par défaut).
- [x] **Test en local :** interface et API sur un seul serveur, page de connexion sans erreur, appels `/api` acceptés. 89 tests OK.
- [ ] **Le jour J (Claude, un commit) :**
  - nouvelle adresse dans `outils/carnet.py` (`API_DEFAUT`) et `docs/raccourci-ios.md` ;
  - page Confidentialité : application hébergée chez Koyeb, base chez Neon (Francfort), date de mise à jour ;
  - synchro remise à deux passages par heure (`20,50`) : notification précise à 10 min près.
- [ ] **Un mois plus tard (Claude) :** suppression de `render.yaml` et des adresses Render du code (CORS, valeur par défaut de la synchro).

## Étape 1 : sauvegarde de sécurité (toi, la veille)

1. Mon Carnet, Profil : télécharge l'export de tes données (JSON complet).
2. Neon : vérifie la durée d'historique conservée (restauration à un instant donné).

La migration n'écrit rien dans la base. C'est seulement par prudence.

## Étape 2 : relever les variables (toi, sur Render)

**Service `coach-perso` (l'API), onglet Environment** — à recopier **à l'identique** :

| Variable | Rôle | Si elle change… |
|---|---|---|
| `DATABASE_URL` | Adresse de la base Neon | L'app ne trouve plus tes données |
| `JWT_SECRET` | Signature des connexions et des jetons (Mon IA, liens partagés) | Les jetons deviennent invalides |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` | Notifications push | Plus aucune notification |
| `ADMIN_EMAIL` | Compte administrateur | L'admin retombe sur « compte le plus actif » |
| `ORS_API_KEY` (si présente) | Itinéraires de secours | Seul le secours ORS ne marche plus |
| `INSCRIPTIONS_FERMEES` / `INSCRIPTIONS_LIBRES` (si présentes) | Règle d'inscription | Le comportement des invitations change |

**Site statique `coach-perso-frontend`, onglet Environment :** la valeur de `VITE_SPOTIFY_CLIENT_ID` devient chez Koyeb **`SPOTIFY_CLIENT_ID`**. `VITE_API_URL` et `PYTHON_VERSION` ne servent plus.

Copie les valeurs directement de Render vers Koyeb. Ne les colle jamais dans une conversation avec une IA.

## Étape 3 : créer le service Koyeb (toi, environ 15 min)

1. Compte sur koyeb.com, de préférence **avec ton compte GitHub**, offre gratuite.
2. **Create Web Service** > **GitHub**. Autorise Koyeb sur le dépôt de Mon Carnet seulement, branche `master`.
3. **Builder :** **Dockerfile** (à la racine). Ne remplis ni commande ni arguments.
4. **Instance :** *Free*. **Région :** *Frankfurt*, comme Neon.
5. **Environment variables :** celles de l'étape 2, en type *Secret* pour les valeurs sensibles.
6. **Ports :** 8000, HTTP, chemin `/`.
7. **Health checks :** passe de TCP à **HTTP**, chemin `/health`.
8. **Nom du service :** par exemple `mon-carnet` → `https://mon-carnet-<organisation>.koyeb.app`. Choisis-le bien : c'est l'adresse que toi et tes invités utiliserez.
9. Lance le déploiement (quelques minutes la première fois). Garde le redéploiement automatique à chaque push.

Render tourne toujours : rien n'a changé pour personne.

## Étape 4 : tester avant de basculer

- **Claude** (donne-moi l'adresse) : `/health` répond, la page d'accueil s'affiche, une route protégée répond 401 sans jeton, en-têtes de sécurité présents. Toi : journaux Koyeb propres (`[startup] Tables et migrations OK.`).
- **Toi, sur ordinateur :** connecte-toi sur la nouvelle adresse. Tu retrouves tout ton carnet (même base). Ouvre une fiche d'activité et un itinéraire.

## Étape 5 : la bascule (environ 15 min)

1. **GitHub > dépôt > Settings > Secrets and variables > Actions > onglet *Variables* :** crée `CARNET_API_URL` = `https://<adresse-koyeb>` (sans `/api`).
2. **Claude :** le commit du jour J (étape 0).
3. **UptimeRobot :** moniteur HTTP sur `https://<adresse-koyeb>/health`, toutes les 10 min.
4. **Render, site `coach-perso-frontend`, *Redirects/Rewrites* :** remplace la règle `/* → /index.html` (rewrite) par une **redirection** `/*` → `https://<adresse-koyeb>/*`. Anciens favoris et liens mènent à la nouvelle adresse. Un site statique ne consomme aucune heure.
5. **Render, service `coach-perso` :** *Settings > Suspend Web Service*. Ne le supprime pas encore.

## Étape 6 : sur chaque appareil (toi et tes invités)

Pour le navigateur, la nouvelle adresse est un nouveau site. Les données sont toutes là, mais ce qui est propre à l'appareil se refait **une fois** :

1. **Se reconnecter** sur la nouvelle adresse.
2. **iPhone :** supprimer l'ancienne icône Mon Carnet, ouvrir la nouvelle adresse dans Safari, *Partager > Sur l'écran d'accueil*.
3. **Notifications :** les réactiver dans Profil sur chaque appareil. Les anciens abonnements disparaissent seuls dès qu'Apple ou Google les déclare expirés (le serveur les retire au premier envoi refusé). Doublons éventuels : « Garder seulement cet appareil ».
4. **Spotify :** sur developer.spotify.com, réglages de l'app, ajoute l'adresse de retour `https://<adresse-koyeb>/spotify` (toi seulement), puis chacun reconnecte Spotify dans Profil.
5. **Préférences d'affichage** (filtres, onglets mémorisés) : reviennent aux valeurs par défaut. Ce ne sont pas des données du carnet.

**Toi seulement :**
- **Consignes IA (/mon-ia) :** recopie-les dans chaque IA qui les utilise (elles contiennent l'adresse de l'API).
- **Liens en lecture seule déjà partagés :** partage-les à nouveau (même jeton, nouvelle adresse).
- **Raccourcis iOS** encore utilisés : nouvelle adresse dans chaque action « Obtenir le contenu de l'URL ».
- **Invités :** envoie-leur la nouvelle adresse (la redirection les y amène de toute façon pendant un mois).

## Étape 7 : vérifications après bascule

- [ ] iPhone et ordinateur : connexion, carnet complet, fiche d'activité, itinéraire, séance guidée.
- [ ] GitHub, *Synchro du matin*, *Run workflow* : réponse 200 et notification reçue.
- [ ] Mon IA : un appel de lecture avec le jeton répond.
- [ ] Le lendemain : synchro automatique passée, notification à l'heure.
- [ ] Une semaine plus tard : UptimeRobot à 100 %, aucun redémarrage anormal dans les journaux Koyeb.

## Étape 8 : quitter Render pour de bon (un mois après)

1. **Claude :** suppression de `render.yaml` et des adresses Render dans le code.
2. **Toi, sur Render :** supprime le service `coach-perso`, puis le site `coach-perso-frontend` (la redirection) quand plus personne n'utilise l'ancienne adresse. Tes 3 autres outils gardent toutes les heures gratuites pour eux.

## Retour arrière (avant l'étape 8)

1. Render : *Resume* sur `coach-perso`, et remettre la règle `/* → /index.html` (rewrite) sur le site statique.
2. GitHub : supprimer la variable `CARNET_API_URL`.
3. UptimeRobot : mettre le moniteur en pause. Ne jamais pinguer Render.

Aucune donnée à restaurer : Render et Koyeb lisent la même base.

## Points d'attention

- **Une seule app active à la fois** pour la synchro, d'où la suspension de Render à l'étape 5. Les deux pourraient tourner ensemble sans abîmer la base (`startup.py` ne fait qu'ajouter ce qui manque).
- **Puissance identique** (0,1 vCPU) : les calculs lourds (bilan de l'année, analyses) ne changent pas de vitesse. Avec UptimeRobot, plus d'attente au premier chargement.
- **Disque éphémère** : l'app n'écrit aucun fichier local, tout est en base.
- **Si l'instance dort quand même** (UptimeRobot en panne), la page met quelques secondes à s'ouvrir, au lieu de s'afficher aussitôt comme le site statique Render.
- Koyeb présente son offre gratuite comme « non destinée à la production ». Pour un outil personnel et quelques proches, ça convient.
