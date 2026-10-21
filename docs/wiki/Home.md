# Wiki de Core

Core est un navigateur minimal autour de Gecko, le moteur de Firefox. Ce
n'est pas un fork de Firefox : c'est un projet Gecko à part
(`--enable-project=core`), construit comme Thunderbird, qui réutilise
`toolkit/` et n'embarque rien de `browser/`.

Objectif : n'utiliser que les ressources strictement nécessaires (mémoire,
démarrage, taille), sans rien sacrifier de la sécurité du moteur (sandbox,
Fission, processus séparés).

## Pages

| Page | Contenu |
|---|---|
| [Architecture](Architecture.md) | Pourquoi un projet Gecko et pas un fork, organisation du dépôt, démarrage, interface, extensions, correctifs de Gecko |
| [Développement](Developpement.md) | Préparer l'arbre, build de développement, boucle d'édition, conventions, contribuer |
| [Construire](Construire.md) | Builds de distribution Linux et Windows, PGO + LTO, releases GitHub |
| [Performances](Performances.md) | Mesures face à Firefox officiel, avec leurs dates et conditions |
| [Sécurité](Securite.md) | Sandbox, surveillance des dépendances, mises à jour de Gecko |
| [Choix du projet](Choix.md) | Ce que Core garde, retire ou laisse aux extensions, et pourquoi |

## Version actuelle

- Gecko **ESR 153.5.0** (`FIREFOX_153_5_0esr_RELEASE`, fichier `GECKO_TAG`).
- Linux : se construit et tourne. Windows : se construit (compilation croisée
  depuis Linux, zip portable sans installeur). macOS : à faire.

> Ces pages vivent dans `docs/wiki/` du dépôt, pour être relues et
> versionnées avec le code par pull request.
