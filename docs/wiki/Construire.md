# Construire

Toutes les commandes se lancent depuis la racine de Gecko, après
`core/scripts/bootstrap.sh` et `./mach bootstrap` (voir
[Développement](Developpement.md)).

## Les mozconfigs

| Fichier | Usage | Dossier de sortie |
|---|---|---|
| `linux-dev` | Développement Linux, optimisé sans LTO | `obj-core-dev` |
| `linux-release` | Distribution Linux : LTO, symboles retirés, relocations compactes | `obj-core-release` |
| `linux-pgo-generate` / `linux-pgo-use` | Deux passes du build PGO Linux | `obj-core-instr` / `obj-core-pgo` |
| `win64-cross` | Windows x86_64 depuis Linux, sans LTO | `obj-core-win64` |
| `win64-release` | Distribution Windows : LTO | `obj-core-win64-release` |
| `win64-pgo-generate` / `win64-pgo-use` | Deux passes du build PGO Windows | `obj-core-win64-instr` / `obj-core-win64-pgo` |
| `common` | Inclus par tous : composants retirés ou gardés | — |

`common` retire le crash reporter, l'updater de Mozilla, le contrôle
parental, la détection Wi-Fi, la synthèse vocale, le profileur, ONNX Runtime ;
il garde EME (Widevine), WebRTC, l'accessibilité, la sandbox, jemalloc et
WebDriver (les pages d'erreur de `toolkit/` en dépendent).

## Linux

```sh
MOZCONFIG=$PWD/core/mozconfigs/linux-release ./mach build
```

### PGO + LTO (recommandé pour une release)

Comme Firefox officiel : un build instrumenté, une exécution de profilage
(Speedometer 3, SunSpider et tests de mise en page de `build/pgo`) sous Xvfb,
puis le build final avec LTO croisé C++/Rust. Environ 30 % de plus sur
Speedometer 3 qu'un build seulement optimisé.

```sh
Xvfb :99 & DISPLAY=:99 core/scripts/pgo/build.sh
```

Résultat dans `obj-core-pgo/dist/bin`. Rust doit partager la version majeure
de LLVM du clang de Mozilla (21) : le script installe et utilise Rust 1.92.
La passe finale repart d'un dossier vide (un build incrémental mélangerait
deux profils).

## Windows (depuis Linux)

Compilation croisée x86_64 avec clang-cl et lld-link, comme la CI de Mozilla.
Le configure télécharge lui-même le SDK Windows et les en-têtes MSVC
(`--enable-bootstrap`). Il faut `msiextract` (paquet `msitools`) et la
bibliothèque standard Rust de la cible
(`rustup target add x86_64-pc-windows-msvc`).

```sh
MOZCONFIG=$PWD/core/mozconfigs/win64-cross ./mach build     # ou win64-release
```

### PGO + LTO Windows

Même recette, toujours depuis Linux : le `core.exe` instrumenté est profilé
sous **Wine** (Speedometer 3 et `build/pgo`) avec le rendu WebRender
logiciel, puis le build final est compilé avec LTO croisé. Il faut `wine` en
plus de `msitools`.

```sh
Xvfb :99 & DISPLAY=:99 core/scripts/pgo/build-win64.sh
```

Résultat dans `obj-core-win64-pgo/dist/bin`. Détails :

- le profilage utilise un préfixe Wine dédié (`obj-core-win64-instr/wineprefix`) ;
- `CRYPTBASE.dll`, absente de Wine, est remplacée par un substitut
  (`scripts/pgo/wine/`) ;
- un jeu de polices réduit évite un plantage de DirectWrite sous Wine ;
- si un autre Core tourne déjà avec Marionette sur le port 2828, fixer
  `CORE_MARIONETTE_PORT`.

Limite : le profil ne couvre pas le rendu matériel D3D11 du processus GPU,
et le gain reste à confirmer sur une vraie machine Windows.

Le build Windows prend beaucoup de mémoire (clang-cl, rustc et l'édition de
liens de `xul.dll`) : compter environ 5 Go par tâche, et fixer
`MOZ_PARALLEL_BUILD` en conséquence.

## Empaqueter

Il n'y a pas encore de `mach package` ni d'installeur : l'archive portable
copie `dist/bin` en suivant les liens.

```sh
core/scripts/release/empaqueter.sh linux|win64 true|false <version> <dossier>
```

Elle produit `core-<version>-linux-x86_64.tar.xz` ou `core-<version>-win64.zip`.
Pour Windows, le script ajoute `msvcp140.dll`, `vcruntime140.dll` et
`vcruntime140_1.dll` depuis `~/.mozbuild/vs/VC/Redist/MSVC/*/x64/`.

## Releases GitHub

`.github/workflows/release.yml` construit Linux et Windows et publie une
release quand un tag `v*` est poussé :

```sh
git tag v153.5.0 && git push origin v153.5.0
```

La release contient les deux archives et `SHA256SUMS`. Un suffixe avec des
lettres (`v153.6.0-beta1`) donne une pré-version ; `v153.5.0-2` une nouvelle
release de la même version de Gecko.

Le workflow se lance aussi à la main (onglet Actions, « Run workflow ») :
choix des plateformes et du PGO, archives téléchargeables depuis le run. En
choisissant un tag comme ref et en cochant « publier », il (re)publie la
release de ce tag.

Par défaut le build tourne sur les runners de GitHub (4 cœurs, 16 Go, 6 h au
plus par job) : build LTO sans PGO. Le PGO dépasse ces 6 h et demande un
runner auto-hébergé, déclaré dans les variables du dépôt :

| Variable | Rôle |
|---|---|
| `CORE_RUNNER` | Labels du runner en JSON, par exemple `["self-hosted","linux","core"]` |
| `CORE_PGO` | `true` pour construire les tags avec PGO |

Sur un runner auto-hébergé, `mach bootstrap`, Xvfb, `msitools`, `wine` et
`libc6:i386` doivent déjà être installés.

Sous systemd, un processus tué par l'OOM killer arrête tout le service du
runner (`OOMPolicy=stop` par défaut), et le job est perdu sans journal. Avec
`OOMPolicy=continue`, seul le build échoue :

```sh
d=/etc/systemd/system/actions.runner.<dépôt>.<runner>.service.d
mkdir -p $d && printf '[Service]\nOOMPolicy=continue\n' > $d/oom.conf
systemctl daemon-reload && systemctl restart actions.runner.<dépôt>.<runner>.service
```

## macOS

Pas encore fait. Mozilla compile macOS par compilation croisée depuis Linux ;
la distribution demandera un compte Apple Developer (signature et
notarisation).
