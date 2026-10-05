# Raccourci iOS « Carnet » — construction pas à pas

Le raccourci envoie au carnet, chaque jour :
- les minutes d'exercice, distances et calories des 3 derniers jours, à partir desquelles le carnet reconstitue tes séances ;
- les mesures de forme des 7 derniers jours (FC au repos, VFC, VO2max) ;
- les échantillons des 3 derniers jours (FC, puissance, vitesse, foulée, oscillation, temps de contact, pas, effort), que le carnet rattache à chaque séance.

Renvoyer plusieurs fois les mêmes données ne crée aucun doublon.

Compte environ 15 minutes. Sur l'iPhone : app **Raccourcis** → onglet **Raccourcis** → **+**. Nomme-le **Carnet**.

> **Ajouter une action** : touche la barre « Rechercher des actions » en bas et tape son nom.
> **Insérer une variable** : touche un champ, puis choisis la variable dans la barre au-dessus du clavier (ou « Sélectionner une variable »).
> **Choisir une propriété** : touche la variable insérée (bulle bleue) et choisis la propriété dans la liste (Valeur, Date de début…).

---

## Partie A — le token

**1. Texte**
Colle ton token d'import. Il se trouve sur le carnet, page **Sources** → « Configurer le raccourci » → Copier.

**2. Définir la variable**
Nom : `Token` · Entrée : *Texte*.

---

## Partie B — les séances (rien à construire)

Raccourcis ne donne pas accès aux entraînements sur ton iPhone : le carnet **reconstitue les séances** à partir des minutes d'exercice de la montre (au moins 15 minutes d'affilée, pauses de 5 min tolérées).

- Métriques de course pendant le créneau (vitesse, puissance, foulée) → **Course**.
- Distance à vélo → **Vélo**.
- Marche rapide → ignorée.
- Sinon → **Séance à préciser** : ouvre-la dans le carnet et choisis le type (muscu, yoga…). Si ce n'était pas une séance, supprime-la : elle ne sera pas recréée.

Si tu fais un jour un export Santé complet, ses séances remplacent celles reconstituées (type exact, D+, météo) en gardant ce que tu as corrigé à la main.

---

## Partie C — forme et détail des séances

Pour **chaque ligne** du tableau ci-dessous, ajoute deux actions à la suite de la Partie A :

1. **Rechercher des échantillons de santé** : type indiqué, filtre **Date de début est dans les derniers N jours**, limite **désactivée** ;
2. **Définir la variable** : nom indiqué, entrée *Échantillons de santé*.

> Astuce : construis la première paire, puis appuie longuement dessus → **Dupliquer**, et change seulement le type et le nom.

| # | Type (dans la liste iOS) | Jours | Nom de la variable |
|---|---|---|---|
| 3 | Fréquence cardiaque au repos | 7 | `FCRepos` |
| 4 | Variabilité de la fréquence cardiaque | 7 | `VFC` |
| 5 | VO2 max | 7 | `VO2` |
| 6 | Minutes d'exercice | 3 | `Exercice` |
| 7 | Distance (marche et course) | 3 | `Distance` |
| 8 | Distance à vélo | 3 | `DistanceVelo` |
| 9 | Énergie active | 3 | `Energie` |
| 10 | Fréquence cardiaque | 3 | `FC` |
| 11 | Puissance de course | 3 | `Puissance` |
| 12 | Vitesse de course | 3 | `Vitesse` |
| 13 | Longueur de foulée de course | 3 | `Foulee` |
| 14 | Oscillation verticale de course | 3 | `Oscillation` |
| 15 | Temps de contact au sol de course | 3 | `Contact` |
| 16 | Nombre de pas | 3 | `Pas` |
| 17 | Effort de l'entraînement *(si proposé)* | 3 | `Effort` |
| 18 | Effort estimé de l'entraînement *(si proposé)* | 3 | `EffortEstime` |

Si un type n'existe pas dans la liste de ton iPhone, saute-le : le carnet fonctionne sans. Seule exception : **Minutes d'exercice** est indispensable, c'est elle qui permet de reconstituer les séances.

**19. Obtenir le contenu de l'URL**
- URL : `https://coach-perso.onrender.com/api/activites/import`
- Touche **Afficher plus** → Méthode : **POST** · Corps de la requête : **JSON**

Pour chaque variable de la partie C, ajoute **deux** champs de type **Texte** :
- `…_valeurs` : la variable → propriété **Valeur** ;
- `…_dates` : la variable → propriété **Date de début** → Format **ISO 8601** (si l'option de format n'apparaît pas, laisse tel quel : le carnet comprend aussi les dates écrites en français).

| Clé `_valeurs` | Clé `_dates` | Variable |
|---|---|---|
| `token` | — | *Token* (un seul champ) |
| `fc_repos_valeurs` | `fc_repos_dates` | FCRepos |
| `vfc_valeurs` | `vfc_dates` | VFC |
| `vo2max_valeurs` | `vo2max_dates` | VO2 |
| `exercice_valeurs` | `exercice_dates` | Exercice |
| `distance_valeurs` | `distance_dates` | Distance |
| `distance_velo_valeurs` | `distance_velo_dates` | DistanceVelo |
| `energie_valeurs` | `energie_dates` | Energie |
| `fc_valeurs` | `fc_dates` | FC |
| `puissance_valeurs` | `puissance_dates` | Puissance |
| `vitesse_valeurs` | `vitesse_dates` | Vitesse |
| `foulee_valeurs` | `foulee_dates` | Foulee |
| `oscillation_valeurs` | `oscillation_dates` | Oscillation |
| `contact_sol_valeurs` | `contact_sol_dates` | Contact |
| `pas_valeurs` | `pas_dates` | Pas |
| `effort_valeurs` | `effort_dates` | Effort |
| `effort_estime_valeurs` | `effort_estime_dates` | EffortEstime |

Les clés doivent être écrites **exactement** ainsi : minuscules, sans accent, avec les tirets bas.

**20. Afficher une notification** (facultatif)
Corps : variable *Contenu de l'URL*. Le carnet répond par exemple :
`5 mesure(s) de forme · 1 séance(s) détectée(s) · 1 séance(s) complétée(s) (FC, puissance, effort…)`

---

## Partie D — premier lancement

1. Touche ▶︎ en bas du raccourci.
2. iOS demande l'accès à Santé : **Tout activer** puis **Autoriser**. Il peut aussi demander l'autorisation d'envoyer des données à `coach-perso.onrender.com` : choisis **Toujours autoriser**.
3. Le premier appel peut prendre jusqu'à une minute : le serveur gratuit Render se met en veille et doit se réveiller.
4. Envoie-moi le message affiché par la notification, je vérifierai les données reçues.

---

## Partie E — automatisation quotidienne

Onglet **Automatisation** → **+** :

- **Après chaque séance** : **App** → choisir **Forme** → cocher **Est fermée** uniquement → **Exécuter immédiatement** → raccourci **Carnet**.
- **Filet de sécurité chaque matin** : **Heure de la journée** → 7:30, Quotidien → **Exécuter immédiatement** → raccourci **Carnet**.

iOS bloque l'accès à Santé quand l'iPhone est verrouillé : si l'automatisation du matin se lance écran verrouillé, elle peut ne rien envoyer. Pas grave : celle de la fermeture de Forme, ou celle du lendemain, rattrapera, puisque le raccourci renvoie 3 jours à chaque fois.

---

## En cas de problème

| Message | Cause probable |
|---|---|
| `Token invalide` | Token mal collé à l'étape 1, ou régénéré depuis sur la page Sources. |
| `Aucune activité ni mesure fournie` | Aucune séance ni mesure sur la période, ou clés mal orthographiées. |
| Aucune séance détectée | Vérifie les champs `exercice_valeurs` / `exercice_dates` et le filtre « 3 jours » de « Minutes d'exercice ». |
| `0 séance(s) complétée(s)` | Aucun échantillon de FC ne tombe pendant une séance : vérifie le filtre « 3 jours » des étapes 6 à 18. |
| Rien ne se passe à l'automatisation | Ouvre Raccourcis → Automatisation et vérifie « Exécuter immédiatement ». |

⚠️ Le raccourci contient ton token : ne le partage pas par lien iCloud tel quel. Si tu veux le partager, vide d'abord l'étape 1.
