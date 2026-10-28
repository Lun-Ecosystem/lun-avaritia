# Lun'Avaritia

> Projet de l'écosystème Lun'. Les règles communes (méthode, git, qualité, design) viennent du plugin
> `lun` et de [lun-docs](https://github.com/Lun-Ecosystem/lun-docs), qui font foi. Ce fichier ne garde
> que ce qui est propre à ce projet. 100 lignes maximum.

## Ce projet

- **Rôle** : satellite « cerveau », inscrit dans `registry.yaml` de lun-docs. Dépôt **public**.
- **Possède** : le wiki neutre de l'écosystème (fiches normalisées, faits sourcés, liens nommés), les
  brouillons à valider, le traitement du lot quotidien, l'entrée manuelle, le dépôt de documents,
  l'import Obsidian, l'export Markdown, son agent.
- **Ne possède pas** : la mémoire affective et personnelle, la relation, le contexte chaud (Lun'Anima,
  le core, qui envoie un lot par jour et consomme Avaritia par le contrat satellite).

## Lancer en local

```bash
cp .env.example .env && npm install && npm run dev
```

Prérequis : Node `^22.13.0 || >=24`. `npm run demo` tourne sans clé.

## Le front

- Tout le front vit dans `app/` (Svelte 5, Vite, PWA) ; le serveur sert `app/dist` à la racine une fois construit.
- Le kit `app/src/lib/ui` est copié d'Acedia, jamais importé ; un composant manquant s'y ajoute dans le même style.
  Dialog, Select et Switch s'importent de leur fichier, hors du barrel, pour rester hors du premier chargement.
- Écrans Dépôts et Réglages, et le graphe, chargés à la demande : chaque morceau du build reste sous 500 kB.
- Jamais de `{@html}` : synthèses et réponses de l'agent passent par `Prose.svelte`.
- L'agent est une bulle flottante (`app/src/agent`), son échange vit dans la page seulement.

## Spécificités

- Rien n'entre dans une fiche sans validation : l'agent propose des brouillons (cartes du contrat).
- Un fait démenti est barré et daté, jamais effacé ; une fiche fusionnée redirige vers sa cible.
- Pas de savoir général (« le ketchup est rouge ») : seulement ce qui transite dans l'écosystème.
- Tout ce qui est automatique s'arrête en pause ; le plafond mensuel de coût est vérifié avant chaque appel.
- Les données vont dans un bloc utilisateur délimité, jamais dans le prompt système.
- Dépôt public : aucun secret, aucune donnée réelle, aucune adresse interne.
- Cahier des attendus : `docs/specs/2026-10-28-lun-avaritia-v1-design.md` dans lun-docs.
