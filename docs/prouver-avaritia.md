# Prouver Avaritia

Recette du serveur v1, à la main. Aucune donnée réelle : tout ce qui suit utilise des données inventées.

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
- `POST /lun/v1/pause` puis `GET /lun/v1/health` : l’état passe à `paused` ; `POST /lun/v1/resume` le ramène à `ok`. La démo n’a pas de fournisseur : ses lots restent retenus (`no-provider`) quoi qu’il arrive, la reprise du traitement se vérifie avec le core local (partie 2).

## 2. Avec le core local

Sur sa propre machine, avec une vraie clé de fournisseur (Réglages, ou `.env`) et un modèle choisi pour le tri et pour
l’agent.

1. Démarrer le satellite : `npm run dev`. Il écoute sur `127.0.0.1:8789`.
2. Appairer : `npm run pair-code` affiche un code à usage unique. Dans le core, ajouter le satellite avec son adresse
   et ce code (`connect`).
3. Depuis le core, appeler l’action `brain.ingest` avec quelques observations inventées. La réponse est immédiate
   (`queued`) ; le lot est traité ensuite et ses brouillons arrivent dans `GET /lun/v1/cards`.
4. Accepter une carte, puis appeler `brain.read` sur la fiche créée : le fait y figure avec sa source.

## 3. Coût d’un vrai lot

Coût mesuré d’un lot réel : _à renseigner après la passe avec le core local (`GET /lun/v1/costs`)._

## 4. Limites connues

- Un lot retenu par le plafond de coût n’est repris qu’au prochain envoi ou au redémarrage, pas sur minuterie.
- L’export écrit un dossier sur le volume du serveur ; il n’y a pas d’archive à télécharger.
