#!/bin/bash
# Build Linux optimisé par profil (PGO) et LTO, comme Firefox officiel.
# À lancer depuis la racine de Gecko, avec un serveur X (Xvfb) sur $DISPLAY.
#   core/scripts/pgo/build.sh
set -e
RUST_TOOLCHAIN=1.92.0  # LLVM 21, comme le clang de ~/.mozbuild
rustup toolchain install $RUST_TOOLCHAIN --profile minimal
export RUSTC=$(rustup which --toolchain $RUST_TOOLCHAIN rustc)
export CARGO=$(rustup which --toolchain $RUST_TOOLCHAIN cargo)

MOZCONFIG=$PWD/core/mozconfigs/linux-pgo-generate ./mach build

cd obj-core-instr
rm -f *.profraw
mkdir -p jarlog
LLVM_PROFDATA=$HOME/.mozbuild/clang/bin/llvm-profdata JARLOG_FILE=$PWD/jarlog/en-US.log \
  ../mach python ../core/scripts/pgo/profileserver.py --binary $PWD/dist/bin/core
cd ..

MOZCONFIG=$PWD/core/mozconfigs/linux-pgo-use ./mach build
