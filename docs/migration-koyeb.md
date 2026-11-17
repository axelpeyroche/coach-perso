# Migration de l'API Mon Carnet vers Koyeb

Prévue début janvier 2027. Fiche préparée le 17/11/2026.

## Le principe : seul l'hébergeur de l'API change

| Élément | Où aujourd'hui | Après la migration |
|---|---|---|
| Base de données (580+ séances, comptes, réglages, jetons) | Neon, Francfort (`eu-central-1`) | **Inchangée** : même base, même adresse, rien n'est copié |
| Interface (site `coach-perso-frontend.onrender.com`) | Render, site statique | **Inchangée** : même adresse, ne consomme pas d'heures |
| API (FastAPI, `coach-perso.onrender.com`) | Render, service web gratuit | **Koyeb**, instance gratuite, Francfort |
| Synchro du matin | GitHub Actions | Inchangée, pointe vers la nouvelle API |
| Code | GitHub `master` | Inchangé, Koyeb se déploie depuis le même dépôt |

Comme la base ne bouge pas, toutes les données restent en place : séances, plans, invités, abonnements aux notifications, jetons Intervals et d'envoi, réglages IA. Seule l'adresse de l'API change. Le service Render n'est pas supprimé : il sert de retour arrière pendant un mois.

## Ce qu'il faut savoir sur Koyeb (docs lues le 17/11/2026)

- **Instance gratuite :** 512 Mo de RAM et 0,1 vCPU, soit autant que Render gratuit. Une seule par organisation, à Francfort ou Washington. Aucun plafond d'heures.
- **Mise en veille** après 1 h sans trafic, et ce réglage ne peut pas être modifié. UptimeRobot la garde éveillée ; ici, ça ne prend rien à tes autres outils.
- **Carte bancaire demandée à l'inscription**, contre la fraude. Koyeb bloque 29 $ puis annule le blocage aussitôt. Rien n'est facturé sur l'instance gratuite. Choisis bien l'offre gratuite (Hobby), pas une offre payante.
- **Déploiement Python automatique** grâce à `requirements.txt`. La version est lue dans `.python-version` (3.12.7, déjà présent).
- **En-tête X-Forwarded-For :** Koyeb ajoute l'IP réelle en **dernier**, comme Render. La limite de tentatives de connexion (`deps.py`, dernière IP) fonctionne donc sans changement.
- **Accès à la base :** Neon n'a pas de liste d'IP autorisées sur l'offre gratuite, la connexion passe donc sans réglage.

## Étape 0 : préparation du code (Claude, avant le jour J, sans effet sur la prod)

- [x] `Procfile` avec la commande de démarrage. Koyeb le lit, Render l'ignore et garde sa propre commande.
- [x] Synchro du matin : l'adresse de l'API vient d'une **variable GitHub** `CARNET_API_URL`, avec l'adresse Render par défaut. Au jour J, il suffira de créer cette variable, sans modifier de code.
- [ ] Le jour J, avec la nouvelle adresse (commit) :
  - `outils/carnet.py` (`API_DEFAUT`) ;
  - `frontend/vite.config.js` (adresse par défaut de la sécurité du navigateur, utilisée seulement si `VITE_API_URL` est vide) ;
  - `docs/raccourci-ios.md` ;
  - commentaire « Render » dans `frontend/src/api.js` ;
  - page Confidentialité : nouvel hébergeur de l'API, date de mise à jour.
- Rien à changer dans `main.py` : les autorisations d'accès (CORS) portent sur l'adresse de l'**interface**, qui reste la même.
- Facultatif, après la bascule : remettre la synchro à **deux passages par heure** (`20,50`). Le serveur Koyeb ne s'endort plus, et la notification redevient précise à 10 min près.

## Étape 1 : sauvegarde de sécurité (toi, la veille)

1. Dans Mon Carnet, Profil : télécharge l'export de tes données (fichier JSON complet).
2. Dans Neon, vérifie la durée d'historique conservée (restauration à un instant donné), pour pouvoir revenir en arrière si besoin.

La migration n'écrit rien de nouveau dans la base. C'est seulement par prudence.

## Étape 2 : relever les variables d'environnement (toi, sur Render)

Ouvre Render, le service `coach-perso`, puis l'onglet **Environment**. Recopie **à l'identique** chaque variable présente (les valeurs restent lisibles même si le service est suspendu) :

| Variable | Rôle | Si elle change… |
|---|---|---|
| `DATABASE_URL` | Adresse de la base Neon | L'API ne trouve plus tes données |
| `JWT_SECRET` | Signature des connexions | Tout le monde est déconnecté |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` | Notifications push | Les notifications ne partent plus et il faut se réabonner sur chaque appareil |
| `ADMIN_EMAIL` | Compte administrateur | L'admin retombe sur « compte le plus actif » |
| `ORS_API_KEY` (si présente) | Itinéraires de secours | Seul le secours ORS ne fonctionne plus |
| `INSCRIPTIONS_FERMEES` / `INSCRIPTIONS_LIBRES` (si présentes) | Règle d'inscription | Le comportement des invitations change |

`PYTHON_VERSION` est inutile chez Koyeb, qui lit `.python-version`.

Copie les valeurs directement de Render vers Koyeb. Ne les colle jamais dans une conversation avec une IA.

## Étape 3 : créer le service Koyeb (toi, environ 15 min)

1. Crée un compte sur koyeb.com, de préférence **avec ton compte GitHub**, et choisis l'offre gratuite.
2. **Create Web Service**, puis **GitHub**. Autorise Koyeb sur le dépôt de Mon Carnet seulement, et choisis la branche `master`.
3. **Builder :** *Buildpack*. Laisse la commande de build vide. La commande de démarrage vient du `Procfile` ; sinon, saisis :
   `python startup.py && uvicorn main:app --host 0.0.0.0 --port $PORT`
4. **Instance :** *Free*. **Région :** *Frankfurt*, la même que Neon, pour des requêtes plus rapides.
5. **Environment variables :** ajoute celles de l'étape 2, en type *Secret* pour les valeurs sensibles.
6. **Ports :** 8000, en HTTP, sur le chemin `/`.
7. **Health checks :** passe de TCP à **HTTP**, avec le chemin `/health`.
8. **Nom du service :** par exemple `mon-carnet`. L'adresse sera du type `https://mon-carnet-<organisation>.koyeb.app`.
9. Lance le déploiement. Garde l'option qui redéploie à chaque push sur `master` : elle remplace le déploiement automatique de Render.

À ce stade, l'interface parle encore à Render. Rien n'a changé pour toi ni pour tes invités.

## Étape 4 : tester la nouvelle API avant de basculer (Claude)

Donne-moi l'adresse Koyeb. Je vérifie, en lecture seule :
- que `/health` répond (l'application tourne) ;
- que les journaux de Koyeb sont propres (démarrage, `[startup] Tables et migrations OK.`) ;
- qu'une route protégée répond 401 sans jeton (sécurité active) ;
- puis, après la bascule, que tes données s'affichent (connexion à la base).

## Étape 5 : la bascule (toi et Claude, environ 10 min)

1. **Render, site statique `coach-perso-frontend`, Environment :** remplace `VITE_API_URL` par `https://<adresse-koyeb>/api`, puis lance *Manual Deploy* (vider le cache n'est pas utile). La sécurité du navigateur suit automatiquement, puisque la CSP est calculée à partir de cette variable au build.
2. **GitHub, dépôt, Settings > Secrets and variables > Actions > onglet *Variables* :** crée `CARNET_API_URL` = `https://<adresse-koyeb>`, sans `/api`.
3. **Claude :** commit des fichiers listés à l'étape 0, puis push.
4. **UptimeRobot :** crée un moniteur HTTP sur `https://<adresse-koyeb>/health`, toutes les 10 min. N'importe quel intervalle sous 1 h suffit à garder l'instance éveillée.
5. **Render, service `coach-perso` (l'ancienne API) :** *Settings > Suspend Web Service*. Il ne consomme plus d'heures et reste disponible pour un retour arrière. Ne le supprime pas avant un mois.

## Étape 6 : ce qui change pour toi après la bascule

- **Consignes IA (/mon-ia) :** elles contiennent l'ancienne adresse de l'API. Recopie-les dans chaque IA qui les utilise : tâche planifiée Claude, projet, etc.
- **Liens en lecture seule déjà partagés :** même problème. Partage à nouveau le lien depuis Sources ou /mon-ia. Le jeton reste le même, seule l'adresse change.
- **Raccourcis iOS** encore utilisés : remplace l'adresse dans chaque action « Obtenir le contenu de l'URL ». iOS redemandera l'autorisation pour le nouveau domaine.
- **Rien à faire pour :** tes invités (ils passent par l'interface), Spotify (lié à l'adresse de l'interface), les notifications (mêmes clés VAPID, abonnements en base), Intervals.icu (la clé est en base) et tes sessions ouvertes (même `JWT_SECRET`).

## Étape 7 : vérifications après bascule (Claude, puis toi)

- [ ] Ouvrir Mon Carnet sur iPhone et sur ordinateur : la connexion tient et le carnet affiche toutes les séances.
- [ ] Ouvrir une fiche d'activité (carte, découpage, météo) et un itinéraire BRouter.
- [ ] GitHub, workflow *Synchro du matin*, *Run workflow* : réponse 200 et notification reçue sur le téléphone.
- [ ] Mon IA : un appel de lecture avec le jeton répond.
- [ ] Le lendemain matin : la synchro automatique est passée et la notification est arrivée à l'heure.
- [ ] Une semaine plus tard : UptimeRobot à 100 % et aucun redémarrage anormal dans les journaux Koyeb.

## Retour arrière (si quelque chose ne va pas)

1. Sur Render, reprendre le service `coach-perso` (*Resume*). Il faut des heures gratuites disponibles, ce qui est le cas en début de mois.
2. Remettre `VITE_API_URL` sur `https://coach-perso.onrender.com/api` et redéployer le site statique.
3. Supprimer la variable GitHub `CARNET_API_URL` : la synchro retombe sur Render.
4. Mettre UptimeRobot en pause. Ne jamais pinguer l'API sur Render.

Aucune donnée n'est à restaurer : les deux API lisent la même base.

## Points d'attention

- **Une seule API active à la fois.** Les deux pourraient tourner ensemble sans abîmer la base (`startup.py` ne fait qu'ajouter ce qui manque), mais la synchro ne doit viser que l'une des deux. D'où la suspension de Render à l'étape 5.
- **Puissance identique** (0,1 vCPU) : les calculs lourds (bilan de l'année, analyses) ne seront ni plus lents ni plus rapides qu'aujourd'hui. Une fois l'instance éveillée en permanence, il n'y aura plus d'attente au premier chargement.
- **Disque éphémère** chez Koyeb comme chez Render : l'API n'écrit aucun fichier local, tout est dans la base. Rien à prévoir.
- Koyeb présente son offre gratuite comme « non destinée à la production ». Pour un outil personnel et quelques proches, ça convient. Un ping toutes les 10 min vers ta propre app n'est visé par aucune règle de leurs conditions.
