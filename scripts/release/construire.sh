#!/bin/bash
# Build de distribution de Core, depuis la racine de Gecko.
#   core/scripts/release/construire.sh linux|win64 true|false(pgo)
# Sans PGO : mozconfigs/<cible>-release (LTO). Avec : les recettes de
# scripts/pgo/, qui demandent un serveur X sur $DISPLAY.
set -euo pipefail
cible=$1
pgo=$2

# mach compte 1 Go par tâche ; le build Windows (clang-cl, rustc et
# l'édition de liens de xul.dll, instrumentés pour le PGO) en prend bien
# plus et a épuisé 32 Go à -j12. On vise 5 Go par tâche, sauf si
# MOZ_PARALLEL_BUILD est déjà fixé.
if [ "$cible" = win64 ] && [ -z "${MOZ_PARALLEL_BUILD:-}" ]; then
  memoire_go=$(awk '/^MemTotal:/ { print int($2 / 1048576) }' /proc/meminfo)
  taches=$((memoire_go / 5))
  [ "$taches" -gt "$(nproc)" ] && taches=$(nproc)
  [ "$taches" -lt 1 ] && taches=1
  export MOZ_PARALLEL_BUILD=$taches
  echo "Build Windows limité à $taches tâches ($memoire_go Go de mémoire)"
fi

case "$cible:$pgo" in
  linux:true) exec core/scripts/pgo/build.sh ;;
  win64:true) exec core/scripts/pgo/build-win64.sh ;;
esac

# Même Rust que les builds PGO, dont le LLVM (21) est celui du clang de
# ~/.mozbuild, au cas où le LTO mêle C++ et Rust.
RUST_TOOLCHAIN=1.92.0
rustup toolchain install $RUST_TOOLCHAIN --profile minimal
[ "$cible" = win64 ] && rustup target add --toolchain $RUST_TOOLCHAIN x86_64-pc-windows-msvc
RUSTC=$(rustup which --toolchain $RUST_TOOLCHAIN rustc)
CARGO=$(rustup which --toolchain $RUST_TOOLCHAIN cargo)
export RUSTC CARGO

MOZCONFIG=$PWD/core/mozconfigs/$cible-release ./mach build
