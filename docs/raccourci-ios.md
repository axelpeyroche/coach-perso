# Raccourcis iOS « Carnet » — construction pas à pas

Le carnet reçoit chaque jour les données Santé de l'iPhone et de la montre :
- les mesures de forme (FC au repos, VFC, VO2max) ;
- les minutes d'exercice, à partir desquelles il reconstitue les séances ;
- la FC, l'énergie, les distances et les métriques de course, qu'il rattache à chaque séance.

**Pourquoi cinq raccourcis.** Un raccourci unique plante (« Un problème est survenu ») dès que le volume total d'échantillons devient trop grand. Chaque raccourci envoie donc une partie des données, et un raccourci **Master** les lance à la suite. Le carnet garde les échantillons reçus pendant 21 jours : une séance est détectée puis complétée avec l'ensemble, quel que soit l'ordre d'arrivée. Renvoyer les mêmes données ne crée aucun doublon.

| Raccourci | Contenu | Période | Groupage |
|---|---|---|---|
| **Carnet – FC** | Fréquence cardiaque | 1 jour | **aucun** |
| **Carnet – Énergie** | Énergie active | 1 jour | par minute |
| **Carnet – Distances** | Distance (marche et course), Distance à vélo | 1 jour | par minute |
| **Carnet – Base** | Minutes d'exercice, métriques de course ; FC au repos, VFC, VO2max | 1 jour ; 7 jours pour les mesures | aucun |
| **Carnet – Master** | Lance les quatre autres, Base en dernier | — | — |

> **Ajouter une action** : touche la barre « Rechercher des actions » en bas et tape son nom.
> **Insérer une variable** : touche un champ, puis choisis la variable dans la barre au-dessus du clavier (ou « Sélectionner une variable »).
> **Choisir une propriété** : touche la variable insérée (bulle bleue) et choisis la propriété dans la liste (Valeur, Date de début…).

Avant de commencer : **Réglages → Raccourcis → Avancé → Autoriser le partage de grandes quantités de données** doit être activé.

---

## Structure commune aux quatre raccourcis d'envoi

Chaque raccourci d'envoi suit le même modèle :

**1. Texte** — ton token d'import, seul, sans « CARNET_TOKEN= » ni espace. Il se trouve sur le carnet, page **Sources** → « Configurer le raccourci » → Copier.

**2. Définir la variable** — nom `Token`, entrée *Texte*.

**3. Pour chaque type de données** du raccourci, deux actions :
1. **Rechercher des échantillons de santé** : type indiqué ; filtre **Date de début est dans le dernier jour** (ou les 7 derniers jours pour les mesures de forme) ; **Grouper par** selon le tableau ; limite **désactivée** ;
2. **Définir la variable** : nom indiqué, entrée *Échantillons de santé*.

**4. Obtenir le contenu de l'URL**
- URL : `https://coach-perso.onrender.com/api/activites/import`
- **Afficher plus** → Méthode : **POST** · Corps de la requête : **JSON**
- Champ `token` (Texte) : variable *Token*.
- Pour chaque variable, deux champs **Texte** :
  - `…_valeurs` : la variable → propriété **Valeur** ;
  - `…_dates` : la variable → propriété **Date de début** → format **ISO 8601** si proposé (sinon laisse tel quel, le carnet comprend aussi les dates en français).

Les clés s'écrivent **exactement** comme ci-dessous : minuscules, sans accent, avec les tirets bas.

**5. Afficher une notification** — corps : variable *Contenu de l'URL*. Le carnet répond par exemple
`2610 échantillon(s) reçu(s) · 1 séance(s) complétée(s) (FC, puissance, effort…)`.

> Astuce : construis **Carnet – FC** en entier, puis appuie longuement dessus → **Dupliquer** pour créer les autres, et change seulement les types, noms et clés.

---

## Carnet – FC

| Type (liste iOS) | Grouper par | Variable | Clés |
|---|---|---|---|
| Fréquence cardiaque | **aucun** | `FC` | `fc_valeurs`, `fc_dates` |

⚠️ **Ne groupe pas la FC.** Raccourcis additionne les mesures de chaque minute au lieu d'en faire la moyenne (on obtient 1 300 « bpm »). Le carnet ignore toute FC au-dessus de 250.

## Carnet – Énergie

| Type (liste iOS) | Grouper par | Variable | Clés |
|---|---|---|---|
| Énergie active | Minute | `Energie` | `energie_valeurs`, `energie_dates` |

## Carnet – Distances

| Type (liste iOS) | Grouper par | Variable | Clés |
|---|---|---|---|
| Distance (marche et course) | Minute | `Distance` | `distance_valeurs`, `distance_dates` |
| Distance à vélo | Minute | `DistanceVelo` | `distance_velo_valeurs`, `distance_velo_dates` |

Pour l'énergie et les distances, l'addition par minute est justement correcte. Les minutes vides (valeur 0) sont ignorées par le carnet.

## Carnet – Base

| Type (liste iOS) | Période | Variable | Clés |
|---|---|---|---|
| Minutes d'exercice | 1 jour | `Exercice` | `exercice_valeurs`, `exercice_dates` |
| Longueur de foulée de course | 1 jour | `Foulee` | `foulee_valeurs`, `foulee_dates` |
| Oscillation verticale de course | 1 jour | `Oscillation` | `oscillation_valeurs`, `oscillation_dates` |
| Temps de contact au sol de course | 1 jour | `Contact` | `contact_sol_valeurs`, `contact_sol_dates` |
| Fréquence cardiaque au repos | 7 jours | `FCRepos` | `fc_repos_valeurs`, `fc_repos_dates` |
| Variabilité de la fréquence cardiaque | 7 jours | `VFC` | `vfc_valeurs`, `vfc_dates` |
| VO2 max | 7 jours | `VO2` | `vo2max_valeurs`, `vo2max_dates` |

Facultatifs, à ajouter un par un en vérifiant que le raccourci passe toujours : Puissance de course (`puissance`), Vitesse de course (`vitesse`), Nombre de pas (`pas`), Effort de l'entraînement (`effort`), Effort estimé (`effort_estime`).

**Minutes d'exercice** est indispensable : c'est elle qui permet de reconstituer les séances.

### Entraînements de la montre (facultatif, recommandé)

Si l'action **Obtenir l'activité physique** renvoie les entraînements, ajoute-les à Carnet – Base, avant « Obtenir le contenu de l'URL » :
1. **Obtenir l'activité physique** : période des 2 derniers jours si l'action le propose ;
2. **Définir la variable** `Entrainements` ;
3. dans la requête, une ligne Texte par propriété disponible :

| Clé | Propriété | Obligatoire |
|---|---|---|
| `entrainement_debuts` | Date de début (ISO 8601 si proposé) | oui |
| `entrainement_types` | Type d'entraînement | conseillé |
| `entrainement_fins` | Date de fin | conseillé |
| `entrainement_durees` | Durée | non |
| `entrainement_distances` | Distance | non |
| `entrainement_energies` | Énergie active | non |

Un entraînement reçu prend la place de la séance reconstituée au même moment : le vrai sport (muscu, yoga…) remplace « Séance à préciser ». Il est ensuite complété avec la FC, les zones et les métriques de course. Une liste qui n'a pas une ligne par entraînement (distance absente pour la muscu, par exemple) est ignorée.

---

## Carnet – Master

1. Nouveau raccourci, nommé **Carnet – Master**.
2. Quatre actions **Exécuter le raccourci**, dans cet ordre :
   ```
   Exécuter Carnet – FC
   Exécuter Carnet – Énergie
   Exécuter Carnet – Distances
   Exécuter Carnet – Base
   ```
   Pour chacune : flèche **›** → désactiver **Afficher pendant l'exécution**, entrée vide.

**Base en dernier** : c'est lui qui détecte les séances, une fois la FC, l'énergie et les distances arrivées. Sinon, une marche rapide serait prise pour du vélo au lieu d'être ignorée.

---

## Comment les séances sont reconstituées

Raccourcis ne donne pas accès aux entraînements : le carnet part des **minutes d'exercice** de la montre (pauses de 5 min tolérées).

- Foulée, oscillation, temps de contact, puissance ou vitesse pendant le créneau → **Course** (dès 6 min).
- Au moins 1 km de distance à vélo → **Vélo** (dès 6 min, pour les vélotafs).
- Marche rapide (distance à pied, ≥ 3 km/h) → ignorée.
- Sinon, à partir de 15 min → **Séance à préciser** : ouvre-la dans le carnet et choisis le type. Si ce n'était pas une séance, supprime-la : elle ne sera pas recréée.
- Si aucune distance n'a été reçue, un bloc sans métrique de course devient **Vélo** (corrigeable dans le carnet).

La séance est ensuite complétée : FC moyenne / max / min, zones, calories, distance, métriques de course. Une séance déjà présente (import de fichier, saisie) n'est jamais dupliquée, et ce que tu as saisi à la main n'est pas écrasé.

---

## Premier lancement

1. Lance **chaque** raccourci d'envoi une fois à la main (▶︎).
2. iOS demande l'accès à Santé : **Tout activer** puis **Autoriser**.
3. iOS demande l'autorisation d'envoyer N échantillons à `coach-perso.onrender.com` : choisis **Toujours autoriser**. Cette autorisation se donne raccourci par raccourci ; la refuser fait échouer le raccourci avec un message générique.
4. Le premier appel peut prendre jusqu'à une minute : le serveur gratuit Render se réveille.
5. Lance ensuite **Carnet – Master** : les 4 notifications doivent s'afficher.

---

## Automatisation quotidienne

Onglet **Automatisation** → **+** → **Heure de la journée** → 22:00, Quotidiennement → **Exécuter immédiatement** → action **Exécuter le raccourci** → **Carnet – Master**.

iOS bloque l'accès à Santé quand l'iPhone est verrouillé : si l'automatisation échoue, lance le Master à la main. Une soirée manquée n'est pas grave, la période « dernier jour » remonte jusqu'à la veille à 0 h. Pour plus de marge, passe les filtres à 2 jours, si les raccourcis passent toujours.

---

## En cas de problème

| Symptôme | Cause probable |
|---|---|
| « Un problème est survenu lors de l'exécution du raccourci » | Trop d'échantillons dans un même raccourci (réduis la période ou sépare les types), ou autorisation d'envoi refusée (relance et choisis « Toujours autoriser »). |
| `Token invalide (reçu N caractères…)` | Token mal collé : il doit être seul, sans préfixe ni espace. Recopie-le depuis la page Sources. |
| `Requête refusée : …` | Champ mal construit : le message indique lequel. |
| `Aucune activité ni mesure exploitable. Champs reçus : …` | Aucune donnée sur la période, clés mal orthographiées, ou FC groupée par minute (rejetée). |
| Aucune séance détectée | Vérifie `exercice_valeurs` / `exercice_dates` dans **Carnet – Base**, et que Base passe bien en dernier. |
| FC absente d'une séance | Vérifie que **Carnet – FC** n'a pas de « Grouper par ». |
| Rien ne se passe à l'automatisation | Raccourcis → Automatisation : vérifie « Exécuter immédiatement ». |

⚠️ Les raccourcis contiennent ton token : ne les partage pas par lien iCloud tels quels. Vide d'abord l'action Texte du token.
