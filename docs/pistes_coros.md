# Pistes COROS : à faire quand la montre sera là

Fiche rédigée le 2026-11-04, avant l'achat. Le compte COROS est connecté par la CLI `coros-mcp` (serveur européen), mais **aucune montre n'est encore associée**. Aucune piste n'a donc pu être testée sur de vraies données. Les champs exacts restent à vérifier à la première synchro.

## Comment les données arriveraient

- **Par Intervals (sans rien faire)** : séances avec GPS, FC, cadence et puissance. Pour la santé, seulement la durée du sommeil et la FC de repos : ni VFC, ni phases.
- **Par l'outil COROS** : il tourne sur le PC (connexion stockée dans `~/.coros-mcp-skill-gateway-ts`), pas sur Render.
  - La synchro du matin GitHub/Render ne peut pas l'appeler directement.
  - Deux façons de l'utiliser :
    1. **une tâche planifiée sur le PC** (comme le plan hebdo) qui lit COROS et envoie au carnet via `carnet.py envoyer` (nouveaux types de mesures à accepter côté API). Elle ne tourne que si le PC est allumé ;
    2. plus tard, l'**API officielle COROS** (programme partenaires, sur dossier) pour une synchro serveur vraiment automatique.
- Les nuits sont datées au **jour du réveil**, comme dans le carnet.

## Ce qui serait nouveau par rapport à l'Apple Watch

Aujourd'hui, via Intervals Companion, le carnet reçoit de l'Apple Watch :
- les durées des phases, le score, le temps éveillé, la FC et la respiration pendant le sommeil, la SpO2 ;
- les pas, la FC de repos, la VFC (SDNN et rMSSD), la VO2max et la récupération FC.

Ce que COROS apporterait en plus :

| Donnée | Outil COROS | Intérêt |
|---|---|---|
| **VFC nocturne officielle** : moyenne, **plage normale, ligne de base**, évaluation, **courbe de la nuit** | `querySleepHrv` | mesure continue la nuit, plus fiable que les mesures ponctuelles de l'Apple Watch ; seuils personnels fournis |
| **Récupération** : % actuel, niveau, heure estimée de récupération complète | `queryRecoveryStatus` | donnée inexistante côté Apple |
| **Charge d'entraînement** : charge courte et longue, ratio, commentaire du jour | `queryTrainingLoadAssessment` | à comparer avec la charge calculée par le carnet |
| **Forme** : VO2max, niveau de course, **allure seuil**, **prédictions 5 km / 10 km / semi / marathon** | `queryFitnessAssessmentOverview` | allure seuil et prédictions absentes côté Apple |
| **Stress** : moyenne du jour et **courbe sur 24 h** (avec la VFC et la FC associées) | `queryStressLevel`, `queryStressTimeSeries` | inexistant côté Apple |
| **Bilan santé ponctuel** : FC, VFC, stress, respiration et SpO2 bruts d'une mesure lancée depuis la montre | `queryHealthCheckTimeSeries` | contrôle à la demande |
| **Siestes** séparées de la nuit principale | `querySleepOverview` | l'Apple Watch les mélange ou les ignore |
| **Détail muscu enregistré par la montre** : exercices reconnus, séries, répétitions | `queryActivityLapData` (noms en anglais) | à croiser avec la séance guidée |
| **Tours et fenêtres de temps précises** d'une activité | `queryActivityLapData`, `queryCustomActivityLapData` | « les 10 dernières minutes », allure par tour |
| **Fichiers FIT d'origine** (tous les champs, puissance de course comprise) | `downloadActivityFitFiles` | analyses fines sans dépendre de ce qu'Intervals garde |
| **Autonomie** | — | sommeil mesuré toutes les nuits (pas de recharge nocturne), donc moins de trous |

## Graphique des phases du sommeil (hypnogramme)

- **Ce qui est sûr** : `querySleepOverview` donne le score, la durée, la **part de profond, léger et paradoxal**, le temps et le nombre d'éveils, l'**heure de coucher et de lever** et les siestes. Le carnet affiche déjà la répartition (anneau + barre dans `SommeilNuit.jsx`).
- **Ce qui n'est pas sûr** : la description de l'outil ne parle pas d'une **chronologie phase par phase**. Il faudra vérifier sur une vraie nuit si la réponse contient la suite des phases avec leurs heures.
- **Si la chronologie est disponible** : un vrai hypnogramme sous la nuit. Paliers éveillé / paradoxal / léger / profond, axe des heures du coucher au lever, mêmes couleurs que l'anneau, cycles numérotés, siestes à part.
- **Sinon**, deux options :
  1. **Courbe de la nuit** (FC + VFC, depuis la série brute de `querySleepHrv`) sur l'axe des heures, avec en dessous la barre des phases à l'échelle du temps passé au lit. On ne fabrique pas de faux paliers.
  2. Demander l'hypnogramme à Intervals si COROS le lui envoie un jour.

## Pistes d'amélioration du carnet

### Sommeil et récupération
1. **Hypnogramme** de chaque nuit (voir ci-dessus).
2. **VFC nocturne COROS** dans « Forme » : courbe avec la **plage normale en bandeau** et la ligne de base ; points hors plage en orange. Elle remplacerait la VFC de l'Apple Watch dans les analyses (dette de sommeil, alertes de nuit).
3. **Courbe VFC + FC pendant la nuit**, sous la fiche de la nuit.
4. **Tuile « Récupération »** sur l'Accueil : %, niveau, « récupéré vers 18 h ». Le **Plan** afficherait un avertissement si une séance dure tombe avant cette heure.
5. **Siestes** listées sous la nuit et comptées dans la dette de sommeil.
6. **Adapter la lecture du sommeil** (`intervals_service.py`, `SommeilNuit.jsx`) : prendre les phases et le score COROS à la place des champs Companion, et garder l'historique Apple tel quel.

### Stress
7. **Stress du jour** : tuile sur l'Accueil et courbe sur 24 h, avec les séances superposées.
8. **Tendance du stress** dans les analyses, croisée avec le sommeil et la charge (semaine chargée + stress haut = alerte).

### Forme et course
9. **Allure seuil COROS** pour régler les zones d'allure et l'allure critique, comparée à celle calculée par le carnet.
10. **Prédictions de course** (5 km → marathon) avec leur évolution dans le temps, sur la page Forme et dans le Bilan de l'année.
11. **VO2max et niveau de course COROS** en courbe ; garder l'historique Apple en pointillé pour la continuité.
12. **Charge COROS** (courte, longue, ratio) à côté de la monotonie et de la charge du carnet ; signaler quand les deux divergent.
13. **Fiche d'activité enrichie par le FIT** : puissance de course, longueur de foulée et autres champs propres à la montre, analyses de durabilité plus précises.
14. **Découpage par tours COROS** (tours manuels faits à la montre) en plus du découpage automatique.

### Muscu
15. **Séance guidée ↔ montre** : récupérer les séries et répétitions détectées par la montre et les comparer à ce qui était prévu et noté dans `deroule`. Écarts mis en avant dans l'export lu par le plan hebdo.
16. **Dictionnaire d'exercices** : traduire les noms anglais de COROS vers ceux du carnet, pour relier les pictogrammes et les animations.

### Envoi vers la montre (écriture, toujours avec accord)
17. **Plan hebdo → calendrier COROS** : la tâche du dimanche crée aussi les séances course, vélo et trail de la semaine (`createScheduledWorkout`). Fractionnés en étapes avec les allures cibles, affichés au poignet.
    - **Limite** : l'outil ne sait créer ni la muscu, ni la natation.
18. **Modifier une séance déjà envoyée** quand le plan change (`updateScheduledWorkout`).
    - **Limite** : impossible de la déplacer ou de la supprimer, il faut passer par l'app COROS.
19. **Parcours → montre** : bouton « Envoyer à la montre » sur les parcours créés ou enregistrés dans Itinéraires (`uploadRouteFile`, type à pied ou vélo).
    - Navigation sur la montre.
    - **Limite** : un même fichier ne peut pas être renvoyé tant que l'ancien parcours existe dans l'app.
20. **Plan d'objectif** (préparation d'une course) poussé comme plan COROS complet (`createTrainingPlan`), mis à jour chaque semaine (`updateTrainingPlan`).

### Divers
21. **Profil** : taille, poids et date de naissance lus depuis COROS (`queryUserInfo`) pour vérifier ceux du carnet.
22. **Page Sources** : ajouter COROS (montre associée, dernière synchro, données reçues) à côté d'Intervals.
23. **Contrôle de cohérence** : signaler une séance présente chez COROS mais absente d'Intervals (synchro ratée).

## À vérifier dès l'achat

- [ ] `queryDevices` voit la montre.
- [ ] Ce qu'Intervals reçoit vraiment (champs wellness) : en déduire ce qui reste à prendre chez COROS.
- [ ] Contenu réel de `querySleepOverview` : la chronologie des phases est-elle présente ?
- [ ] Format de la série brute de `querySleepHrv` (pas de temps, unités).
- [ ] Champs du FIT COROS (puissance, foulée…).
- [ ] Muscu : les exercices sont-ils reconnus automatiquement, ou faut-il les saisir à la montre ?
- [ ] Ordre de priorité à choisir avec l'utilisateur.
