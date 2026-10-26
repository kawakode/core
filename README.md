# Core 
[![Release](https://github.com/kawakode/core/actions/workflows/release.yml/badge.svg?branch=main&event=workflow_run)](https://github.com/kawakode/core/actions/workflows/release.yml)

Un navigateur minimal et très optimisé autour de Gecko, le moteur de Firefox.
Objectif : n'utiliser que les ressources strictement nécessaires (mémoire,
démarrage, taille), sans rien céder sur la sécurité.

**Documentation complète : [le wiki](docs/wiki/Home.md)** (architecture,
développement, build, performances, sécurité, choix du projet).

## Différences avec Firefox

- **Pas un fork** : Core est un projet Gecko à part (`--enable-project=core`),
  comme Thunderbird. Il réutilise le moteur et `toolkit/`, et n'embarque rien
  de l'interface ni des services de Firefox (`browser/`). Base actuelle :
  Gecko ESR 153.5.1.
- **Plus léger, aussi rapide** : à build égal (PGO + LTO), moteur à parité
  avec Firefox officiel, premier affichage 32 % plus rapide et mémoire
  presque divisée par deux (mesures du 20/10/2026, voir
  [Performances](docs/wiki/Performances.md)).
- **Aucun service tiers** : ni Sync, ni compte Mozilla, ni Pocket, ni
  télémétrie, ni Safe Browsing. Les listes de sécurité sont embarquées dans
  chaque release.
- **Aucune IA** : ni ONNX Runtime ni llama.cpp dans le binaire.
- **Aucun moteur de recherche par défaut** : vous choisissez le vôtre, ou
  aucun.
- **Extensions Firefox** : installées depuis addons.mozilla.org, comme dans
  Firefox. Ce qu'une extension fait bien (mots de passe, traduction…) n'est
  pas intégré.
- **Même sécurité** : sandbox, un processus par site (Fission), processus
  séparés.
- **H.265/HEVC** lu partout, sans extension payante ni codec du système.

Détail et raisons : [Choix du projet](docs/wiki/Choix.md).

## Installer

Les versions sont publiées sur la page
[Releases](https://github.com/kawakode/core/releases), avec un fichier
`SHA256SUMS` pour vérifier les archives.

**Linux (x86_64)**

```sh
sha256sum -c --ignore-missing SHA256SUMS
tar -xJf core-<version>-linux-x86_64.tar.xz
./core/core
```

**Windows (x86_64)** : décompresser `core-<version>-win64.zip` et lancer
`core\core.exe`. Il n'y a pas encore d'installeur, et l'exécutable n'est pas
signé : Windows SmartScreen peut demander une confirmation.

**macOS** : pas encore disponible.

Core ne se met pas à jour tout seul : chaque nouvelle version de Gecko donne
une nouvelle release. Pour construire Core vous-même, voir
[Construire](docs/wiki/Construire.md).

## Licence

MPL 2.0, comme Gecko. `app/nsCoreApp.cpp`, `app/ApplicationData.*` et
`app/BrowserDefines.h` sont dérivés de `browser/app/` de Firefox.
