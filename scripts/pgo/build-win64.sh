#!/bin/bash
# Build Windows x86_64 optimisé par profil (PGO) et LTO, compilé depuis Linux.
# Mozilla profile ses builds Windows sur des machines Windows ; ici le build
# instrumenté tourne sous Wine, ce qui garde toute la chaîne sous Linux.
# À lancer depuis la racine de Gecko, avec un serveur X (Xvfb) sur $DISPLAY :
#   Xvfb :99 & DISPLAY=:99 core/scripts/pgo/build-win64.sh
set -e
RUST_TOOLCHAIN=1.92.0  # LLVM 21, comme le clang de ~/.mozbuild
rustup toolchain install $RUST_TOOLCHAIN --profile minimal
rustup target add --toolchain $RUST_TOOLCHAIN x86_64-pc-windows-msvc
export RUSTC=$(rustup which --toolchain $RUST_TOOLCHAIN rustc)
export CARGO=$(rustup which --toolchain $RUST_TOOLCHAIN cargo)

MOZCONFIG=$PWD/core/mozconfigs/win64-pgo-generate ./mach build

# Préfixe Wine dédié, pour ne pas toucher à celui de l'utilisateur.
export WINEPREFIX=${WINEPREFIX:-$PWD/obj-core-win64-instr/wineprefix}
export WINEDEBUG=-all
# Jeu de polices réduit, à fixer avant la création du préfixe (Wine y
# enregistre les polices du système).
export FONTCONFIG_FILE=$PWD/core/scripts/pgo/wine/fonts.conf
[ -d "$WINEPREFIX" ] || wineboot -i
# mozglue.dll importe CRYPTBASE.dll, absente de Wine : substitut qui renvoie
# vers advapi32 (voir wine/cryptbase.def).
CLANG_BIN=$HOME/.mozbuild/clang/bin
WINE_TMP=$(mktemp -d)
echo 'int _fltused;' > $WINE_TMP/vide.c
$CLANG_BIN/clang-cl --target=x86_64-pc-windows-msvc -c $WINE_TMP/vide.c -Fo$WINE_TMP/vide.obj
$CLANG_BIN/lld-link /dll /noentry /nodefaultlib /machine:x64 \
  /def:core/scripts/pgo/wine/cryptbase.def $WINE_TMP/vide.obj \
  /out:"$WINEPREFIX/drive_c/windows/system32/cryptbase.dll"
rm -rf $WINE_TMP

wineserver -k 2>/dev/null || true  # aucun Core resté ouvert dans le préfixe
cd obj-core-win64-instr
rm -f *.profraw
export CORE_EXE=$PWD/dist/bin/core.exe
LLVM_PROFDATA=$HOME/.mozbuild/clang/bin/llvm-profdata \
  ../mach python ../core/scripts/pgo/profileserver.py --binary $CORE_EXE
wineserver -w
cd ..

# Un build incrémental mélangerait l'ancien et le nouveau profil.
rm -rf obj-core-win64-pgo
MOZCONFIG=$PWD/core/mozconfigs/win64-pgo-use ./mach build
