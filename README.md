# Lun'Avaritia

Le satellite « mémoire » de l'écosystème Lun' : un wiki de fiches liées, tenu par toi et enrichi par un
agent. Chaque fiche (personne, lieu, projet, idée...) garde ses faits, ses liens et son historique. L'agent
trie les observations et propose des brouillons, mais rien n'entre dans une fiche sans ta validation ; un
fait démenti est barré et daté, jamais effacé.

## Démarrer en local

```bash
cp .env.example .env
npm install
npm run dev          # écoute sur 127.0.0.1:8789
npm run pair-code    # code d'appairage pour un appareil
```

Node `^22.13.0 || >=24`. Barrières : `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`.
