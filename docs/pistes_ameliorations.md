# Pistes d'amélioration du carnet

Audit du 2026-11-10, fait sur le code (backend ≈ 10 900 lignes, frontend ≈ 15 500 lignes), pas sur un test d'usage complet de chaque écran. Les pistes liées à la future montre sont dans `pistes_coros.md` et ne sont pas répétées ici.

Repères : **effort** S (quelques heures), M (un à deux jours), L (plus). **★** = fort intérêt pour « connaître mon corps, mes capacités, suivre clairement ».

## Ce que le carnet fait déjà

- **Charge** : forme / fatigue (CTL, ATL, TSB), rampe, ACWR, monotonie et contrainte, répartition 80/20.
- **Capacités** : VMA, allure critique et réserve D′, courbe des meilleurs efforts, prédictions, efficacité aérobie, dérive cardiaque, durabilité, foulée, VAM et km-effort, zones automatiques avec historique.
- **Corps** : VFC, FC de repos, forme du matin, sommeil (phases, dette, régularité, FC de nuit, alertes), pas, poids, asymétrie de marche, récupération FC.
- **Suivi** : fiche d'activité (découpage, allure ajustée, météo, même parcours, segments, terrain), records, bilan de l'année, statistiques, objectifs, plan hebdo avec séance guidée, itinéraires.

Le socle est donc au niveau des outils spécialisés. Ce qui manque le plus : **la synthèse** (dire quoi retenir), **la fiabilité affichée** des estimations, **la musculation et les blessures comme données à part entière**, et **la lisibilité** d'une page Analyses devenue très longue.

---

## 1. Connaître mon corps

| # | Piste | Détail | Effort |
|---|---|---|---|
| 1.1 ★ | **Détection de maladie / état anormal** | Aujourd'hui la carte dit « Fatigue » quand VFC basse + FC repos haute. Ajouter un état distinct « Signes de maladie possible » quand FC repos > +2 écarts-types deux matins de suite **avec charge faible** (ACWR < 0,8), plus FC de nuit, respiration et SpO2 si disponibles. Conseil adapté (repos, pas de séance dure) au lieu d'un simple « fatigue ». | M |
| 1.2 ★ | **Marqueurs de journée** | Bouton « Malade », « Voyage / décalage », « Alcool », « Stress fort », « Courbatures ». Les jours marqués sont exclus de la référence 60 jours (sinon une semaine de grippe fausse la moyenne) et apparaissent en bandes sur les graphiques. | M |
| 1.3 ★ | **Journal des douleurs et blessures** | Zone du corps sur un mannequin, intensité 0–10, début, fin, notes kiné. Courbe par zone, lien avec la charge des 2 semaines précédentes, envoi au plan hebdo (qui relit déjà l'historique). Les ressentis de la séance guidée y seraient versés automatiquement. | L |
| 1.4 | **Ressenti du matin en 10 secondes** | Énergie, jambes, humeur, motivation (1–5) dans la carte Forme. Croisé avec VFC et sommeil : le subjectif prédit souvent mieux que la VFC seule. | S |
| 1.5 ★ | **Score de préparation expliqué** | Garder le calcul actuel mais montrer sa composition : « VFC −1,3 σ, FC repos +1,8 σ, sommeil 9 h 10, charge faible ». Bouton « Pourquoi ? » qui évite de devoir demander. | S |
| 1.6 | **Tendance VFC sur 7 jours + coefficient de variation** | La moyenne glissante 7 j et sa variabilité sont plus fiables que la valeur du jour. Bandeau « plage normale » sur la courbe. | S |
| 1.7 | **Composition corporelle** | Masse grasse, tour de taille, mensurations (saisie manuelle ou balance connectée via Intervals). Poids lissé (moyenne mobile exponentielle) et rythme de variation par semaine. | M |
| 1.8 | **Chronotype et fenêtre de sommeil** | Heures habituelles de coucher et de lever, décalage semaine / week-end (« jet-lag social »), heure de coucher conseillée pour combler la dette avant une séance clé. | M |
| 1.9 | **Effet réel de chaque séance sur la nuit** | Pour chaque type de séance (intensité, heure de fin) : variation moyenne de VFC, FC de nuit et sommeil profond la nuit suivante. « Tes fractionnés après 19 h coûtent 8 ms de VFC. » | M |
| 1.10 | **Temps de récupération personnel** | Nombre de jours pour que VFC et FC repos reviennent dans la plage après une séance dure, une sortie longue, une course. Appris sur l'historique. | M |
| 1.11 | **Adaptation à la chaleur et à l'altitude** | La météo est déjà stockée : FC à allure égale selon la température, « coût » personnel par degré au-dessus de 15 °C, correction des comparaisons. | M |
| 1.12 | **Tendances longues** | FC de repos, VFC, VO2max, poids : moyenne par saison sur plusieurs années, avec la tendance annuelle. | S |

## 2. Connaître mes capacités

| # | Piste | Détail | Effort |
|---|---|---|---|
| 2.1 ★ | **Fiche « Mon profil d'athlète »** | Une page unique : VMA, VO2max, seuil (FC et allure), allure critique, D′, endurance (durabilité), force (1RM estimés), poids de forme. Chaque valeur avec sa date, sa tendance sur 3 mois et son **niveau de confiance**. Radar forces / faiblesses comparé à soi-même il y a un an. | M |
| 2.2 ★ | **Confiance et fraîcheur des estimations** | Chaque estimation (seuil, VMA, allure critique, prédictions) affiche sur quoi elle repose (« 9 efforts, le dernier il y a 38 jours ») et se grise quand elle date. Suggestion automatique : « ton seuil repose sur un effort de février : un test de 30 min le rafraîchirait ». | S |
| 2.3 ★ | **Protocoles de test intégrés** | Tests guidés (demi-Cooper, 30 min seuil, 5 min + 12 min pour l'allure critique, test de traction max, test de dérive aérobie). Planifiables, reconnus automatiquement à la synchro, résultats comparés au test précédent. | L |
| 2.4 ★ | **Prédictions de course tenant compte du terrain** | Pour un objectif avec GPX : temps estimé à partir de l'allure ajustée à la pente, de la durabilité et du D+, avec fourchette prudente / visée / optimiste et tableau de passage par tronçon. | L |
| 2.5 | **Courbe allure–durée complète** | Courbe des meilleurs efforts de 10 s à 3 h, cette saison contre la précédente et contre le record absolu, modèle allure critique superposé. Zones « jamais testées récemment » mises en évidence. | M |
| 2.6 | **Profil de vitesse** | Réserve de vitesse anaérobie (vitesse max sur 10–20 s contre VMA) : profil plutôt endurant ou plutôt rapide, et ce que cela implique pour les séances. | S |
| 2.7 ★ | **Musculation comme vraie discipline** | Volume par groupe musculaire et par semaine, 1RM estimé par exercice dans le temps, progression des tractions et dips (répétitions max, lest), séries proches de l'échec. Carte du corps colorée selon le volume des 7 derniers jours. Aujourd'hui les records existent, pas le suivi. | L |
| 2.8 | **Équilibre des charges** | Charge par discipline (course, muscu, autre) et charge mécanique des jambes (D− et km) séparée de la charge cardiaque. La muscu compte peu en charge FC alors qu'elle fatigue. | M |
| 2.9 | **Aptitude en montée et en descente** | VAM selon la pente et la durée, allure en descente selon la pente et le terrain, comparaison montée / descente / plat par rapport à la moyenne personnelle. Utile en trail. | M |
| 2.10 | **Seuil aérobie (première bascule)** | Estimation par la dérive cardiaque sur sorties longues stables : FC à laquelle la dérive reste < 5 %. Complète le seuil déjà calculé pour caler la Z2. | M |
| 2.11 | **Âge de forme et repères** | Situer VO2max, FC de repos et temps sur 10 km par rapport aux tables par âge. À présenter comme repère, pas comme note. | S |
| 2.12 | **Simulateur « et si »** | Courbe de forme projetée selon le plan des prochaines semaines : forme et fraîcheur le jour de l'objectif, avec scénarios (affûtage 1 ou 2 semaines). | M |

## 3. Suivre clairement mes activités

| # | Piste | Détail | Effort |
|---|---|---|---|
| 3.1 ★ | **Bilan automatique après chaque séance** | Trois phrases en haut de la fiche : ce qui a été fait (type reconnu), comment par rapport au prévu, ce qui est notable (record, dérive, FC anormalement haute). Calculé par règles, sans IA payante. | M |
| 3.2 ★ | **Reconnaissance du type de séance** | Classer automatiquement : footing, sortie longue, seuil, fractionné court / long, côtes, récupération, course. Sert aux filtres, aux statistiques et à la comparaison « mêmes séances ». | M |
| 3.3 ★ | **Détection des intervalles** | Repérer les répétitions (par exemple 8 × 400 m) : tableau par répétition (temps, allure, FC, récupération), régularité, baisse entre la première et la dernière. | M |
| 3.4 ★ | **Prévu contre réalisé, en détail** | Pour une séance rattachée : durée, distance, zones et allures visées contre réalisées, note d'exécution. Aujourd'hui le respect du plan est global. | M |
| 3.5 | **Comparer deux séances** | Superposer deux sorties (courbes FC, allure, profil), au-delà du « même parcours » : même type de séance à des mois d'écart. | M |
| 3.6 | **Bilan de la semaine et du mois** | Page ou carte récapitulative : volume, intensité, charge, sommeil moyen, faits marquants, comparaison à la semaine précédente et à la moyenne sur 4 semaines. Partageable en image comme les fiches. | M |
| 3.7 | **Vue calendrier** | Mois entier avec séances faites et prévues, charge du jour en couleur, marqueurs (malade, course). Glisser-déposer pour déplacer une séance prévue. | M |
| 3.8 | **Recherche et filtres avancés** | Recherche plein texte (titre, notes), filtres par type reconnu, distance, D+, FC, météo, lieu ; filtres enregistrables. | M |
| 3.9 | **Fiche d'activité : curseur synchronisé** | Survol d'une courbe = point sur la carte et sur le profil, et inversement. Sélection d'une portion pour obtenir ses moyennes et en faire un segment. | M |
| 3.10 | **Temps en zones d'allure et de pente** | En plus des zones FC : temps par zone d'allure, par classe de pente, par type de terrain (déjà connu). | S |
| 3.11 | **Séries et jalons** | Série de semaines actives, cumul annuel contre objectif annuel (courbe « en avance / en retard »), jalons (1 000 km, 50 000 m D+). Sobre, sans gamification envahissante. | S |
| 3.12 | **Carte : lieux et exploration** | Carte de chaleur des passages, nouveaux kilomètres découverts par mois, communes ou sommets atteints. | M |
| 3.13 | **Export PDF** | Bilan annuel, bilan mensuel et fiche de course imprimables (utile pour kiné ou médecin du sport). | M |

## 4. Coaching et plan

| # | Piste | Détail | Effort |
|---|---|---|---|
| 4.1 ★ | **Adaptation du plan au jour le jour** | Quand la forme du matin est rouge ou qu'un jour est marqué « malade » : proposition concrète en un geste (alléger, décaler, remplacer), puis reprise progressive après maladie. Par règles, la tâche du dimanche reste la référence. | M |
| 4.2 ★ | **Vue saison** | Frise des semaines jusqu'à l'objectif : blocs (base, spécifique, affûtage), charge prévue contre réalisée, semaines de décharge. | M |
| 4.3 | **Alertes intelligentes regroupées** | Un seul centre d'alertes : rampe trop forte, monotonie élevée, dette de sommeil, trop d'intensité, estimation périmée, aucune sortie longue depuis 3 semaines. Chaque alerte dit quoi faire. | M |
| 4.4 | **Préparation de course** | Pour l'objectif : compte à rebours, plan d'allure par tronçon, météo prévue, liste de matériel, plan de ravitaillement (glucides et eau par heure selon la durée et la chaleur). | L |
| 4.5 | **Notifications utiles** | En plus du matin : rappel de séance du jour avec les zones, bilan du dimanche, alerte si la FC de repos décroche. Réglables une par une. | S |
| 4.6 | **Séance guidée pour la course** | Étendre le mode plein écran aux fractionnés : minuteur, bips, allure cible, enchaînement des blocs. | M |
| 4.7 | **Bibliothèque de séances** | Séances types réutilisables (avec zones recalculées automatiquement), à glisser dans le plan. | M |

## 5. Visuel et ergonomie

| # | Piste | Détail | Effort |
|---|---|---|---|
| 5.1 ★ | **Découper la page Analyses** | Environ vingt sections sur une seule page de 1 500 lignes. Passer à des onglets ou sous-pages : *Forme*, *Capacités*, *Corps*, *Sommeil*, *Technique*, *Bilan*, avec un sommaire fixe et une période commune (6 sem. / 3 mois / 1 an / tout) appliquée à tous les graphiques. | M |
| 5.2 ★ | **« L'essentiel » en tête de chaque page** | Trois à cinq constats rédigés avant les graphiques (« Ton efficacité aérobie progresse de 4 % sur 3 mois »), chacun menant au graphique concerné. | M |
| 5.3 ★ | **Résumé recentré sur aujourd'hui** | Un bloc « Aujourd'hui » : état du corps, séance prévue, conseil. Puis la semaine, puis les tendances. Tuiles réorganisables ou masquables. | M |
| 5.4 | **Graphiques harmonisés** | Mêmes couleurs par notion partout (FC, allure, charge, sommeil), bandes de référence personnelles, annotations d'événements (course, maladie, changement de montre), zoom et sélection de plage, courbes miniatures dans les tuiles. | M |
| 5.5 | **Aide intégrée** | Petit « i » sur chaque indicateur : ce que c'est, comment il est calculé, ce qui est bon pour toi. Glossaire. Indispensable avec autant de mesures. | S |
| 5.6 | **États vides et chargements** | Squelettes de chargement partout, messages « pas assez de données : il manque X » avec le moyen de les obtenir. | S |
| 5.7 | **Mobile** | Graphiques pleine largeur en mode paysage, gestes (balayer entre séances, tirer pour synchroniser), barre d'onglets revue si les pages se multiplient. | M |
| 5.8 | **Accessibilité** | Palette lisible pour les daltoniens (ne pas coder l'état par la seule couleur vert / orange / rouge), contrastes en mode sombre, navigation clavier, libellés pour lecteurs d'écran sur les graphiques. | M |
| 5.9 | **Mode hors ligne** | Dernières données consultables sans réseau, saisie mise en attente puis envoyée. | M |
| 5.10 | **Widgets et écran verrouillé** | Forme du matin et séance du jour en notification riche ; raccourci d'application vers « Nouvelle séance » et « Séance guidée ». | S |
| 5.11 | **Personnalisation** | Couleur d'accent, densité (compact / aéré), unités, premier jour de la semaine, indicateurs favoris épinglés sur le Résumé. | S |

## 6. Fiabilité des données et technique

| # | Piste | Détail | Effort |
|---|---|---|---|
| 6.1 ★ | **Tests automatiques des calculs** | Aucun test dans le dépôt. Les calculs (zones, charge, allure critique, forme du matin) méritent des jeux d'essai figés : une régression fausserait toutes les analyses sans bruit. | M |
| 6.2 ★ | **Qualité des données** | Détecter et signaler : pics de FC aberrants, GPS dérivant, pauses mal gérées, nuits tronquées, doublons. Possibilité d'exclure une séance ou un jour des calculs sans le supprimer. | M |
| 6.3 | **Historique 2023–2025 sans flux FC** | Ces séances (import Strava) n'ont que la FC moyenne : l'indiquer sur les graphiques (zone grisée « données partielles ») et permettre un import des fichiers d'origine si un export complet existe. | M |
| 6.4 | **Journal des recalculs** | Quand un seuil ou une zone change, garder la raison (déjà partiellement fait pour les zones) et l'étendre à la VMA et à l'allure critique. | S |
| 6.5 | **État des synchros** | Page « santé du carnet » : dernière synchro, données reçues par type, trous sur 30 jours (jours sans VFC, nuits manquantes). | S |
| 6.6 | **Performance** | `/api/analyses` recalcule beaucoup à chaque appel : cache par jour invalidé à l'arrivée d'une activité, chargement différé des sections et des graphiques. | M |
| 6.7 | **Sauvegarde automatique** | Export complet hebdomadaire vers un stockage personnel (l'export RGPD existe déjà, il suffit de le planifier). | S |
| 6.8 | **Découpage du code** | `carnet_service.py` (1 950 lignes), `analyses_service.py` (1 280) et `Analyses.jsx` (1 500) gagneraient à être scindés par domaine avant d'ajouter d'autres analyses. | M |

---

## Par où commencer

1. **Lisibilité** : 5.1 (Analyses en onglets), 5.2 (l'essentiel), 5.5 (aide), 1.5 (score expliqué).
2. **Corps** : 1.1 + 1.2 (maladie et marqueurs), 1.3 (douleurs), 4.1 (plan adapté).
3. **Capacités** : 2.1 + 2.2 (profil d'athlète avec confiance), 2.7 (musculation).
4. **Activités** : 3.2 + 3.3 + 3.1 (type, intervalles, bilan de séance), 3.4 (prévu / réalisé).
5. **Socle** : 6.1 (tests) et 6.2 (qualité des données) avant d'empiler de nouvelles analyses.
