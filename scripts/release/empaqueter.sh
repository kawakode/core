#!/bin/bash
# Archive portable d'un build de Core, depuis la racine de Gecko. Il n'y a
# pas encore de mach package : on copie dist/bin en suivant les liens.
#   core/scripts/release/empaqueter.sh linux|win64 true|false(pgo) <version> <dossier-sortie>
# Produit core-<version>-linux-x86_64.tar.xz ou core-<version>-win64.zip.
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
  *) echo "Cible inconnue : $cible" >&2; exit 1 ;;
esac

mkdir -p "$sortie"
sortie=$(cd "$sortie" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
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
