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

## Construire (Windows, depuis Linux)

Cross-compilation x86_64 avec clang-cl, comme la CI de Mozilla. Le configure
télécharge lui-même le SDK Windows et les en-têtes MSVC (`--enable-bootstrap`).
Il faut `msiextract` (paquet `msitools`) et la std Rust de la cible
(`rustup target add x86_64-pc-windows-msvc`).

```sh
MOZCONFIG=$PWD/core/mozconfigs/win64-cross ./mach build
```

Il n'y a pas encore d'installeur ni de `mach package` : le zip portable se
fait à partir de `obj-core-win64/dist/bin` (copié avec `cp -rL`), en y
ajoutant `msvcp140.dll`, `vcruntime140.dll` et `vcruntime140_1.dll` de
`~/.mozbuild/vs/VC/Redist/MSVC/*/x64/`.

## Organisation

| Chemin | Rôle |
|---|---|
| `moz.configure`, `confvars.sh`, `app.mozbuild` | Déclaration du projet auprès du build Gecko |
| `app/` | Lanceur natif (`nsCoreApp.cpp`, dérivé de celui de Firefox) et préférences par défaut |
| `base/content/` | Interface : fenêtre, barre d'adresse, onglets |
| `branding/` | Nom et icônes |
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
