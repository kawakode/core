#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
# Compositeur Wayland sans écran (KWin, moteur virtuel) qui compose sur le GPU
# via le render node : WebRender matériel et WebGL sur le vrai GPU, sans rien
# ouvrir sur la session graphique de l'utilisateur. Socket « corebench » dans
# $PERF_DL/xdg, celui qu'attend bench.py.
DL=${PERF_DL:-/var/tmp/core-perf}
mkdir -p $DL/xdg && chmod 700 $DL/xdg
cd /var/tmp
exec env -i PATH=/usr/bin HOME=$HOME XDG_RUNTIME_DIR=$DL/xdg KWIN_COMPOSE=O2 \
  kwin_wayland --virtual --no-lockscreen --socket corebench --width 1920 --height 1080
