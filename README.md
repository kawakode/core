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

## Organisation

| Chemin | Rôle |
|---|---|
| `moz.configure`, `confvars.sh`, `app.mozbuild` | Déclaration du projet auprès du build Gecko |
| `app/` | Lanceur natif (`nsCoreApp.cpp`, dérivé de celui de Firefox) et préférences par défaut |
| `base/content/` | Interface : fenêtre, barre d'adresse, onglets |
| `branding/` | Nom et icônes |
| `GECKO_TAG` | Version de Gecko utilisée (ESR) |

## État

Linux d'abord. Windows (launcher) et macOS (bundle `.app`) sont à compléter.
Feuille de route et choix d'architecture : voir l'étude
`architecture/coquille-gecko.md` du projet.

## Licence

MPL 2.0, comme Gecko. `app/nsCoreApp.cpp`, `app/ApplicationData.*` et
`app/BrowserDefines.h` sont dérivés de `browser/app/` de Firefox.
