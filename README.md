# Lun'Avaritia

Le satellite « mémoire » de l'écosystème Lun' : un wiki de fiches liées, tenu par l'utilisateur et enrichi
par un agent. Chaque fiche (personne, lieu, projet, idée...) garde ses faits, ses liens et son historique. L'agent
trie les observations et propose des brouillons, mais rien n'entre dans une fiche sans validation ; un
fait démenti est barré et daté, jamais effacé.

**Rôle dans l'écosystème** : satellite, le cerveau. Il possède le wiki neutre, ses brouillons, le traitement du
lot quotidien, l'import Obsidian et l'export Markdown. Lun'Anima s'y branche par le
[contrat satellite](https://github.com/Lun-Ecosystem/lun-docs/blob/main/standards/contrat-satellite.md) (v1.4),
lui envoie un lot par jour et garde pour lui la mémoire de la relation.

## Démarrer en local

```bash
cp .env.example .env
npm install
npm run dev          # écoute sur 127.0.0.1:8789
npm run pair-code    # code d'appairage pour un appareil
```

Node `^22.13.0 || >=24`. Barrières : `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`.

## Le front

L'interface (`app/`, Svelte 5, installable en PWA) est servie par le serveur lui-même, à la racine, une fois
construite :

```bash
npm run build        # construit app/dist
npm run dev          # http://127.0.0.1:8789, puis saisir le code de npm run pair-code
```

En développement, `npm run dev -w @lun-avaritia/app` lance Vite, qui relaie `/api` et `/lun` vers le serveur
sur le port 8789 (à démarrer à côté).

Démo dans le navigateur, sans clé ni donnée réelle, avec une base assez grande pour le graphe :

```bash
npm run build && DEMO_FICHES=3000 npm run demo   # http://127.0.0.1:8798
```

Le parcours complet est décrit dans [docs/prouver-avaritia.md](docs/prouver-avaritia.md).
