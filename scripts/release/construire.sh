#!/bin/bash
# Build de distribution de Core, depuis la racine de Gecko.
#   core/scripts/release/construire.sh linux|win64 true|false(pgo)
# Sans PGO : mozconfigs/<cible>-release (LTO). Avec : les recettes de
# scripts/pgo/, qui demandent un serveur X sur $DISPLAY.
set -euo pipefail
cible=$1
pgo=$2

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
