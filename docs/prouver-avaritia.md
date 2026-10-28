# Prouver Avaritia

Recette du serveur v1 et de son front, à la main. Aucune donnée réelle : tout ce qui suit utilise des données inventées.

## 1. La démo, sans clé

```
npm run demo
```

La démo démarre sur `http://127.0.0.1:8798` avec une base en mémoire (rien n’est écrit sur le disque, sauf les exports
dans un dossier temporaire) et sans réseau. Elle contient des fiches liées et sourcées (Studio Exemple, Jean Martin,
Refonte du site), un lot déjà traité en brouillons, une contradiction (deux adresses pour le studio) et un doublon
(« Studio Exemple SAS »). L’appareil est déjà appairé : la commande affichée porte son jeton.

À vérifier avec ce jeton :

- `GET /api/dashboard` : une dernière passe, 3 brouillons dont 1 contradiction et 1 doublon, aucun lot retenu.
- `GET /lun/v1/cards` : les trois cartes, la contradiction d’abord.
- `PATCH /api/fiches/1` avec `{"synthesis":"..."}` : appliqué tout de suite, une version est créée
  (`GET /api/fiches/1`).
- `PUT /api/settings` avec `{"drafts.cap":0}` : refusé (400) ; avec `{"drafts.cap":20}` : accepté.
- `POST /api/export` : un fichier `.md` par fiche dans `export/<date>/` ; le fait démenti n’y apparaît barré et daté qu’après avoir accepté la carte de contradiction (`POST /lun/v1/cards/<id>/accept`).
- `POST /lun/v1/pause` puis `GET /lun/v1/health` : l’état passe à `paused` ; `POST /lun/v1/resume` le ramène à `ok`. La démo n’a pas de fournisseur : ses lots restent retenus (`no-provider`) quoi qu’il arrive, la reprise du traitement se vérifie avec le core local (partie 3).

## 2. Dans le navigateur

```
npm run build && DEMO_FICHES=3000 npm run demo
```

Ouvrir `http://127.0.0.1:8798` en 1440 px, puis refaire le parcours en 390 px (outils de développement, mode
appareil). Sous 760 px, le rail laisse place à la barre du bas.

1. **Appairer** : saisir le code à 6 chiffres affiché par la commande. Le tableau de bord s’ouvre ; un jeton refusé
   plus tard ramène à cet écran.
2. **Tableau de bord** : l’en-tête de la dernière nuit, les cartes de compte (brouillons, contradictions, doublons),
   l’activité récente. Chaque carte mène à « À valider », filtrée au besoin.
3. **À valider** : les quatre sortes de brouillons (fiche nouvelle, fiche enrichie, contradiction, doublon), la
   contradiction d’abord. `V` valide et `R` refuse la carte active ; « Modifier » ouvre l’édition d’une fiche avant
   de la valider ; « Garder l’autre » inverse un choix. Un `[[Titre]]` connu de la synthèse ouvre la fiche.
4. **Mémoire, arborescence** : les fiches par type, la recherche, la fiche ouverte à droite (`?fiche=<id>` dans
   l’adresse) avec sa synthèse, ses faits sourcés, ses liens et son historique ; l’édition crée une version.
5. **Mémoire, graphe** : le mode graphe charge la base de démo (plus de 3000 fiches) ; un nœud ouvre son panneau,
   les fiches signalées (contradiction, doublon) se distinguent. Sans WebGL, le mode reste proposé et affiche « Le graphe demande WebGL. ».
6. **Dépôts** : déposer un fichier texte inventé, il apparaît dans la liste ; plusieurs fichiers déposés ensemble
   sont tous signalés. L’import Obsidian se fait ici aussi.
7. **Réglages** : fournisseurs et modèles, types de fiches, lots, appareils, données (export ; l’import Obsidian renvoie vers Dépôts),
   pause et reprise. Dans « Agent », changer le nom (« Archiviste ») et l’icône (Plume) : la bulle et le titre du
   panneau les reprennent aussitôt.
8. **Agent** : la bulle en bas à droite, sur chaque écran (au-dessus de la barre du bas sur un téléphone). Elle
   ouvre un panneau de 400 px, plein écran sous 760 px, titré du nom réglé ; `Échap` le ferme et rend le focus à la
   bulle. Sans modèle choisi, l’agent répond qu’il faut en choisir un dans Réglages. Avec un modèle (partie 3),
   « note que Client X préfère le mardi » donne une réponse et le lien « Voir dans À valider ». Sur une fiche
   ouverte, le panneau l’indique comme contexte. Une base vide propose « Écrire une note », qui ouvre le panneau sur
   « note que ».

## 3. Avec le core local

Sur sa propre machine, avec une vraie clé de fournisseur (Réglages, ou `.env`) et un modèle choisi pour le tri et pour
l’agent.

1. Démarrer le satellite : `npm run dev`. Il écoute sur `127.0.0.1:8789`.
2. Appairer : `npm run pair-code` affiche un code à usage unique. Dans le core, ajouter le satellite avec son adresse
   et ce code (`connect`).
3. Depuis le core, appeler l’action `brain.ingest` avec quelques observations inventées. La réponse est immédiate
   (`queued`) ; le lot est traité ensuite et ses brouillons arrivent dans `GET /lun/v1/cards`.
4. Accepter une carte, puis appeler `brain.read` sur la fiche créée : le fait y figure avec sa source.

## 4. Coût d’un vrai lot

Coût mesuré d’un lot réel : _à renseigner après la passe avec le core local (`GET /lun/v1/costs`)._

## 5. Limites connues

- Un lot retenu par le plafond de coût n’est repris qu’au prochain envoi ou au redémarrage, pas sur minuterie.
- L’export écrit un dossier sur le volume du serveur ; il n’y a pas d’archive à télécharger.
