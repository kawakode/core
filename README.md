# Core

Un navigateur minimal autour de Gecko, le moteur de Firefox : pas un fork de
Firefox, mais un projet Gecko à part (`--enable-project=core`), comme
Thunderbird. Il réutilise `toolkit/` et n'embarque rien de `browser/`.

Cibles : Linux, Windows, macOS. Objectif : n'utiliser que les ressources
strictement nécessaires (mémoire, démarrage, taille).

## Construire (Linux)

```sh
scripts/bootstrap.sh ../gecko          # clone Gecko à la version de GECKO_TAG et branche core/
cd ../gecko
./mach bootstrap                       # une fois : outils de build Mozilla
MOZCONFIG=$PWD/core/mozconfigs/linux-dev ./mach build
MOZCONFIG=$PWD/core/mozconfigs/linux-dev ./mach run
```

`mozconfigs/linux-release` active LTO et retire les symboles. Les options
communes (composants retirés ou gardés) sont dans `mozconfigs/common`.

### Build optimisé par profil (PGO + LTO)

Comme Firefox officiel : un build instrumenté, une exécution de profilage
(Speedometer, SunSpider, tests de mise en page de `build/pgo`) sous Xvfb, puis
le build final. Environ 30 % de plus sur Speedometer 3 qu'un build `--enable-optimize`.

```sh
Xvfb :99 & DISPLAY=:99 core/scripts/pgo/build.sh
```

Rust doit partager la version majeure de LLVM du clang de Mozilla (21) ; le
script installe et utilise Rust 1.92 pour ces deux builds.

## Construire (Windows, depuis Linux)

Cross-compilation x86_64 avec clang-cl, comme la CI de Mozilla. Le configure
télécharge lui-même le SDK Windows et les en-têtes MSVC (`--enable-bootstrap`).
Il faut `msiextract` (paquet `msitools`) et la std Rust de la cible
(`rustup target add x86_64-pc-windows-msvc`).

```sh
MOZCONFIG=$PWD/core/mozconfigs/win64-cross ./mach build
```

### Build Windows optimisé par profil (PGO + LTO)

Même recette que sous Linux, toujours depuis Linux : le build instrumenté
`core.exe` est profilé sous Wine (Speedometer 3 et tests de `build/pgo`), avec
le rendu WebRender logiciel, puis le build final est compilé avec LTO croisé.
Il faut `wine` en plus de `msitools`.

```sh
Xvfb :99 & DISPLAY=:99 core/scripts/pgo/build-win64.sh
```

Le résultat est dans `obj-core-win64-pgo/dist/bin`. Le profilage utilise un
préfixe Wine dédié (`obj-core-win64-instr/wineprefix`) ; si un autre Core
tourne déjà avec Marionette sur le port 2828, fixer `CORE_MARIONETTE_PORT`.

Il n'y a pas encore d'installeur ni de `mach package` : le zip portable se
fait à partir de `obj-core-win64/dist/bin` ou `obj-core-win64-pgo/dist/bin` (copié avec `cp -rL`), en y
ajoutant `msvcp140.dll`, `vcruntime140.dll` et `vcruntime140_1.dll` de
`~/.mozbuild/vs/VC/Redist/MSVC/*/x64/`.

## Releases

`.github/workflows/release.yml` construit Core pour Linux et Windows et publie
une release GitHub quand un tag `v*` est poussé :

```sh
git tag v153.5.0 && git push origin v153.5.0
```

La release contient `core-<version>-linux-x86_64.tar.xz`,
`core-<version>-win64.zip` et `SHA256SUMS`. Un suffixe avec des lettres
(`v153.6.0-beta1`) donne une pré-version ; `v153.5.0-2` une nouvelle release
de la même version de Gecko.

Le workflow se lance aussi à la main (onglet Actions, « Run workflow ») :
choix des plateformes et du PGO, archives téléchargeables depuis le run. En
choisissant un tag comme ref et en cochant « publier », il (re)publie la
release de ce tag.

Par défaut le build tourne sur les runners de GitHub (4 cœurs, 16 Go, 6 h au
plus par job) : build LTO sans PGO. Le PGO dépasse ces 6 h ; il
faut un runner auto-hébergé, déclaré dans les variables du dépôt :

| Variable | Rôle |
|---|---|
| `CORE_RUNNER` | Labels du runner en JSON, par exemple `["self-hosted","linux","core"]` |
| `CORE_PGO` | `true` pour construire les tags avec PGO |

Sur un runner auto-hébergé, `mach bootstrap`, Xvfb, `msitools` et `wine`
doivent déjà être installés.

## Organisation

| Chemin | Rôle |
|---|---|
| `moz.configure`, `confvars.sh`, `app.mozbuild` | Déclaration du projet auprès du build Gecko |
| `app/` | Lanceur natif (`nsCoreApp.cpp`, dérivé de celui de Firefox) et préférences par défaut |
| `base/content/` | Interface : fenêtre, barre d'adresse, onglets |
| `branding/` | Nom et icônes |
| `extensions/` | API d'extensions liées à l'interface (onglets, fenêtres, boutons d'extension), l'équivalent de `browser/components/extensions/` de Firefox |
| `GECKO_TAG`, `GECKO_COMMIT` | Version de Gecko utilisée (ESR) et son commit, vérifié par `bootstrap.sh` |
| `patches/`, `vendor/` | Correctifs de Gecko et sources tierces que `bootstrap.sh` y ajoute (dont le décodeur H.265/HEVC de FFmpeg, voir `vendor/README.md`) |
| `securite/` | Contrôles de sécurité des dépendances (voir plus bas) |

## État

Linux d'abord. Windows se construit (zip portable, sans installeur) ; macOS (bundle `.app`) est à compléter.
Feuille de route et choix d'architecture : voir l'étude
`architecture/coquille-gecko.md` du projet.

## Sécurité des dépendances

Deux workflows GitHub Actions surveillent ce dont Core dépend :

- `securite-dependances.yml`, chaque jour : le tag de Gecko pointe toujours
  sur `GECKO_COMMIT`, aucune version ESR plus récente (donc porteuse de
  correctifs) n'est sortie, et aucune nouvelle CVE ni aucun paquet malveillant
  n'apparaît dans les crates Rust, les paquets Python du build et les
  bibliothèques C/C++ de Gecko (base [OSV](https://osv.dev)). Les failles déjà
  vues sont listées dans `securite/vulns-connues.txt` ; le résumé du job donne
  les lignes à y ajouter après examen.
- `securite-workflows.yml` : audit des workflows par
  [zizmor](https://docs.zizmor.sh). Les actions sont figées par commit et
  Dependabot propose leurs mises à jour.

## Licence

MPL 2.0, comme Gecko. `app/nsCoreApp.cpp`, `app/ApplicationData.*` et
`app/BrowserDefines.h` sont dérivés de `browser/app/` de Firefox.
