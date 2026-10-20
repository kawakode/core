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
GECKO_COMMIT=$(cat "$CORE_DIR/GECKO_COMMIT")
GECKO_REPO=https://github.com/mozilla-firefox/firefox.git

if [ ! -d "$GECKO_DIR/.git" ]; then
  git clone --depth 1 --branch "$GECKO_TAG" "$GECKO_REPO" "$GECKO_DIR"
else
  git -C "$GECKO_DIR" fetch --depth 1 origin "refs/tags/$GECKO_TAG:refs/tags/$GECKO_TAG"
  git -C "$GECKO_DIR" checkout --quiet "$GECKO_TAG"
fi

# Un tag peut être déplacé ; le commit attendu est figé dans GECKO_COMMIT.
if [ "$(git -C "$GECKO_DIR" rev-parse HEAD)" != "$GECKO_COMMIT" ]; then
  echo "$GECKO_TAG ne pointe pas sur $GECKO_COMMIT (GECKO_COMMIT) : source de Gecko non fiable" >&2
  exit 1
fi

# Sources ajoutées à Gecko telles quelles (décodeur HEVC de FFmpeg pour ffvpx,
# en-tête VA-API HEVC). Voir vendor/README.md.
cp -R "$CORE_DIR/vendor/ffvpx/." "$GECKO_DIR/media/ffvpx/"
cp -R "$CORE_DIR/vendor/mozva/." "$GECKO_DIR/media/mozva/"

# Petits correctifs de Gecko pour qu'il reconnaisse le projet "core".
# On les garde au strict minimum : chacun est à reporter à chaque montée d'ESR.
for patch in "$CORE_DIR"/patches/*.patch; do
  [ -e "$patch" ] || continue
  if git -C "$GECKO_DIR" apply --check "$patch" 2>/dev/null; then
    git -C "$GECKO_DIR" apply "$patch"
  elif ! git -C "$GECKO_DIR" apply --reverse --check "$patch" 2>/dev/null; then
    echo "Le correctif $patch ne s'applique pas sur $GECKO_TAG" >&2
    exit 1
  fi
done

# Gecko attend le projet dans son arbre (--enable-project=core), comme
# Thunderbird avec comm/.
ln -sfn "$CORE_DIR" "$GECKO_DIR/core"
echo "Gecko $GECKO_TAG prêt dans $GECKO_DIR, Core branché dans $GECKO_DIR/core"
