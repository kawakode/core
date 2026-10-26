# Développement

## Machine

Un build de Gecko est lourd : 16 Go de RAM au minimum (32 Go confortables),
environ 40 Go de disque, et une à deux heures pour un premier build complet
sur 8 cœurs. Linux est la plateforme de développement : Windows se construit
depuis Linux (voir [Construire](Construire.md)).

## Préparer l'arbre

```sh
git clone https://github.com/kawakode/core
core/scripts/bootstrap.sh ../gecko   # clone Gecko au tag de GECKO_TAG, applique patches/ et vendor/, lie core/
cd ../gecko
./mach bootstrap                     # une fois : toolchains Mozilla (clang, rust, cbindgen…) dans ~/.mozbuild
```

Choisir « Firefox for Desktop » quand `mach bootstrap` demande l'application :
Core utilise les mêmes outils.

`bootstrap.sh` se relance sans risque : il remet Gecko au bon tag, saute les
correctifs déjà appliqués et échoue si l'un d'eux ne s'applique plus.

## Build de développement

```sh
MOZCONFIG=$PWD/core/mozconfigs/linux-dev ./mach build
MOZCONFIG=$PWD/core/mozconfigs/linux-dev ./mach run
```

`linux-dev` compile optimisé, sans LTO, PGO ni tests. Le résultat est dans
`obj-core-dev/dist/bin/` : le binaire `core` et les fichiers de l'application
dans `dist/bin/app/`.

Si `rustc` manque de mémoire, limiter le parallélisme et retirer les symboles
de débogage dans un mozconfig local qui inclut `linux-dev` :

```sh
. "$topsrcdir/core/mozconfigs/linux-dev"
ac_add_options --disable-debug-symbols
mk_add_options MOZ_PARALLEL_BUILD=3
```

## Boucle d'édition

- **JS, CSS, XHTML** (`base/content/`, `modules/`, `extensions/`,
  `app/profile/core.js`…) : dans un build de développement, ces fichiers sont
  liés symboliquement dans `dist/bin`. Il suffit de redémarrer Core, sans
  rebuild.
- **Nouveau fichier** : l'ajouter au `jar.mn` ou `moz.build` du dossier, puis
  `./mach build faster`.
- **`components.conf`, C++** : `./mach build` (relie libxul).
- **`moz.configure`, mozconfigs** : `./mach configure` puis `./mach build`.

Profil neuf pour tester : `./mach run --temp-profile`. Pour retester une page
d'erreur de certificat, vider le cache du profil (`cache2`, `~/.cache/core`)
et `cert_override.txt`, sinon la page en cache s'affiche sans l'erreur.

## Outils utiles

- `about:support` : versions, niveau effectif de la sandbox, préférences
  modifiées.
- `about:memory` : mémoire par processus.
- `about:config` : préférences.
- Console du navigateur : `./mach run --jsconsole`.
- WebDriver : Core se pilote par Marionette (lancer `core --marionette`), ce
  qui sert au profilage PGO et aux mesures de performance.
- `scripts/perf/startup.py` : temps de démarrage A/B, à chaud ou à froid.
  `scripts/perf/mem.py` : mémoire A/B avec ou sans une préférence. Usage en
  tête de chaque script, résultats dans [Performances](Performances.md).

## Préférences

Les valeurs par défaut sont dans `app/profile/core.js`. Core n'hérite pas de
`firefox.js` : toute préférence que Firefox règle dans `browser/` et dont Core
a besoin doit y être recopiée, avec un commentaire qui dit pourquoi. Les
préférences propres à Core commencent par `core.`.

Règle d'optimisation : une préférence de performance n'est gardée que si elle
paie sur la mesure (avant/après dans la pull request). La sécurité passe
avant (sandbox, Fission, processus séparés ne se négocient pas).

## Conventions

- Code, commentaires, messages de commit et documentation en **français**.
- En-tête MPL 2.0 en haut de chaque fichier source.
- Petites pull requests, une chose à la fois, avec un « avant / après » dans
  la description.
- Pas de nouveau correctif de Gecko si le projet peut faire autrement ; sinon
  un fichier `patches/NNNN-<sujet>-core.patch` minimal, conditionné à
  `MOZ_BUILD_APP == "core"` quand c'est possible.
- Pas de dépendance à un service tiers ni de fonction d'IA (voir
  [Choix du projet](Choix.md)).

## Monter de version de Gecko

1. Mettre le nouveau tag dans `GECKO_TAG` et son commit dans `GECKO_COMMIT`.
2. `scripts/bootstrap.sh` : corriger les correctifs de `patches/` qui ne
   s'appliquent plus.
3. Si la révision de FFmpeg de `media/ffvpx/README_MOZILLA` a changé,
   recopier les sources HEVC de `vendor/ffvpx/` depuis cette révision (voir
   `vendor/README.md`).
4. Construire, vérifier les API de `toolkit/` que Core utilise (pages
   d'erreur, extensions, WebDriver), et `about:support` (sandbox).
5. Dans `securite/vulns-connues.txt`, retirer les failles corrigées.
