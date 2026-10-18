#!/bin/sh
# Récupère Gecko à la version figée dans GECKO_TAG et y branche Core.
#
#   scripts/bootstrap.sh [dossier-gecko]   (par défaut : ../gecko)
#
# Ensuite : cd <dossier-gecko> && MOZCONFIG=$PWD/core/mozconfigs/linux-dev ./mach build
set -eu

CORE_DIR=$(cd "$(dirname "$0")/.." && pwd)
GECKO_DIR=${1:-"$CORE_DIR/../gecko"}
GECKO_TAG=$(cat "$CORE_DIR/GECKO_TAG")
GECKO_REPO=https://github.com/mozilla-firefox/firefox.git

if [ ! -d "$GECKO_DIR/.git" ]; then
  git clone --depth 1 --branch "$GECKO_TAG" "$GECKO_REPO" "$GECKO_DIR"
else
  git -C "$GECKO_DIR" fetch --depth 1 origin "refs/tags/$GECKO_TAG:refs/tags/$GECKO_TAG"
  git -C "$GECKO_DIR" checkout --quiet "$GECKO_TAG"
fi

# Gecko attend le projet dans son arbre (--enable-project=core), comme
# Thunderbird avec comm/.
ln -sfn "$CORE_DIR" "$GECKO_DIR/core"
echo "Gecko $GECKO_TAG prêt dans $GECKO_DIR, Core branché dans $GECKO_DIR/core"
