#!/bin/sh
# Vérifie la source de Gecko :
#  1. le tag GECKO_TAG pointe toujours sur GECKO_COMMIT : un tag déplacé sur le
#     dépôt de Mozilla signalerait une source compromise ;
#  2. aucune version ESR plus récente de la même branche n'est sortie : chaque
#     version ESR corrige des failles de Gecko (bulletins MFSA), il faut monter.
# Une nouvelle branche ESR est seulement signalée.
#
#   securite/verifier-gecko.sh
set -eu

CORE_DIR=$(cd "$(dirname "$0")/.." && pwd)
GECKO_TAG=$(cat "$CORE_DIR/GECKO_TAG")
GECKO_COMMIT=$(cat "$CORE_DIR/GECKO_COMMIT")
GECKO_REPO=https://github.com/mozilla-firefox/firefox.git
RESUME=${GITHUB_STEP_SUMMARY:-/dev/null}
echec=0

note() { echo "$1"; echo "$1" >> "$RESUME"; }

# FIREFOX_153_5_0esr_RELEASE -> 153.5.0
version() { echo "$1" | sed -E 's/^FIREFOX_([0-9_]+)esr_RELEASE$/\1/; s/_/./g'; }

tags=$(git ls-remote --tags "$GECKO_REPO" 'refs/tags/FIREFOX_*esr_RELEASE*')

# Pour un tag annoté, le commit est sur la ligne ^{}.
commit=$(echo "$tags" | awk -v t="refs/tags/$GECKO_TAG" '$2 == t || $2 == t "^{}" { c = $1 } END { print c }')
note "## Gecko"
if [ "$commit" = "$GECKO_COMMIT" ]; then
  note "- \`$GECKO_TAG\` pointe bien sur \`$GECKO_COMMIT\`."
else
  note "- :x: \`$GECKO_TAG\` pointe sur \`${commit:-rien}\` au lieu de \`$GECKO_COMMIT\` (GECKO_COMMIT). Ne pas construire avant d'avoir compris pourquoi."
  echec=1
fi

actuelle=$(version "$GECKO_TAG")
branche=${actuelle%%.*}
versions=$(echo "$tags" | awk '{ sub("refs/tags/", "", $2); sub("\\^\\{\\}$", "", $2); print $2 }' \
  | grep -E '^FIREFOX_[0-9_]+esr_RELEASE$' | sort -u \
  | while read -r t; do version "$t"; done | sort -V)

derniere=$(echo "$versions" | grep -E "^$branche\." | tail -n 1)
if [ "$derniere" = "$actuelle" ]; then
  note "- ESR $actuelle est la dernière version de la branche $branche."
else
  note "- :x: ESR $derniere est sortie (Core utilise $actuelle) : elle corrige des failles, voir https://www.mozilla.org/security/known-vulnerabilities/firefox-esr/. Mettre à jour GECKO_TAG et GECKO_COMMIT."
  echec=1
fi

nouvelle=$(echo "$versions" | awk -F. -v b="$branche" '$1 > b' | tail -n 1)
if [ -n "$nouvelle" ]; then
  note "- Une branche ESR plus récente existe ($nouvelle). La branche $branche reste maintenue un temps, mais la migration est à prévoir."
fi

exit $echec
