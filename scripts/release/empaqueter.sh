#!/bin/bash
# Archive portable d'un build de Core, depuis la racine de Gecko. Il n'y a
# pas encore de mach package : on copie dist/bin en suivant les liens.
#   core/scripts/release/empaqueter.sh linux|win64|macos-aarch64|macos-x86_64 true|false(pgo) <version> <dossier-sortie>
# Produit core-<version>-linux-x86_64.tar.xz, core-<version>-win64.zip ou
# core-<version>-macos-arm64.dmg / core-<version>-macos-x86_64.dmg.
set -euo pipefail
cible=$1
pgo=$2
version=$3
sortie=$4

case "$cible:$pgo" in
  linux:true) objdir=obj-core-pgo ;;
  linux:false) objdir=obj-core-release ;;
  win64:true) objdir=obj-core-win64-pgo ;;
  win64:false) objdir=obj-core-win64-release ;;
  # Jamais de PGO pour macOS (voir construire.sh).
  macos-aarch64:*|macos-x86_64:*) objdir=obj-core-$cible-release ;;
  *) echo "Cible inconnue : $cible" >&2; exit 1 ;;
esac

mkdir -p "$sortie"
sortie=$(cd "$sortie" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

case "$cible" in
macos-*)
  # Bundle dist/Core.app (core/app/Makefile.in), liens suivis.
  mkdir "$tmp/dmg"
  cp -RL "$objdir/dist/Core.app" "$tmp/dmg/Core.app"

  # Signature ad hoc (sans certificat) de tout le bundle, sous-bundles
  # compris : sans elle, macOS déclare l'app « endommagée » une fois
  # téléchargée. Elle ne remplace pas une signature Developer ID notarisée :
  # au premier lancement, il faut l'autoriser dans Réglages Système >
  # Confidentialité et sécurité. rcodesign (apple-codesign) signe depuis
  # Linux ; on le compile une fois dans ~/.mozbuild.
  rcodesign=$HOME/.mozbuild/rcodesign/bin/rcodesign
  if [ ! -x "$rcodesign" ]; then
    rustup run 1.92.0 cargo install --locked --no-default-features \
      --root "$HOME/.mozbuild/rcodesign" apple-codesign@0.29.0
  fi
  "$rcodesign" sign "$tmp/dmg/Core.app"

  case "$cible" in
    macos-aarch64) arch=arm64 ;;
    *) arch=x86_64 ;;
  esac
  # Même outil que mach package pour Firefox : image HFS+ compressée avec un
  # lien vers /Applications. Les outils dmg et hfsplus viennent de bootstrap.
  MOZCONFIG=$PWD/core/mozconfigs/$cible-release ./mach python --virtualenv build \
    -m mozbuild.action.make_dmg --volume-name Core --icon core/branding/core.icns \
    "$tmp/dmg" "$sortie/core-$version-macos-$arch.dmg"
  ls -l "$sortie"
  exit 0
  ;;
esac

cp -rL "$objdir/dist/bin" "$tmp/core"

if [ "$cible" = linux ]; then
  XZ_OPT="-9 -T0" tar -C "$tmp" -cJf "$sortie/core-$version-linux-x86_64.tar.xz" core
else
  # Runtime MSVC que core.exe attend à côté de lui.
  for dll in msvcp140.dll vcruntime140.dll vcruntime140_1.dll; do
    chemin=$(find -L "$HOME/.mozbuild/vs/VC/Redist/MSVC" -path '*/x64/*' -iname "$dll" | head -1)
    if [ -z "$chemin" ]; then
      echo "$dll introuvable dans ~/.mozbuild/vs" >&2
      exit 1
    fi
    cp "$chemin" "$tmp/core/"
  done
  (cd "$tmp" && zip -q -9 -r "$sortie/core-$version-win64.zip" core)
fi
ls -l "$sortie"
