#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
# Télécharge les benchs de scripts/perf/bench.py dans $PERF_DL (révisions des
# mesures du 26/10/2026).
set -e
DL=${PERF_DL:-/var/tmp/core-perf}
mkdir -p $DL && cd $DL
[ -d JetStream ] || { git clone -q https://github.com/WebKit/JetStream && git -C JetStream -c advice.detachedHead=false checkout -q c603c04; }
[ -d MotionMark ] || git -c advice.detachedHead=false clone -q --depth 1 -b release/MotionMark1.3.1 https://github.com/WebKit/MotionMark
if [ ! -d wgs ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/WebGLSamples/WebGLSamples.github.io wgs
  git -C wgs sparse-checkout set aquarium tdl jquery-ui-1.8.2.custom khronos
fi
if [ ! -d three ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/mrdoob/three.js three
  git -C three sparse-checkout set --no-cone /build/ /examples/jsm/ /examples/webgl_instancing_performance.html /examples/models/json/ /examples/main.css
fi
# Variante de l'exemple three.js qui lit la méthode et le nombre d'objets dans l'URL.
python3 - three/examples/webgl_instancing_performance.html three/examples/bench_instancing.html <<'PY'
import sys
s = open(sys.argv[1]).read()
old = """		const api = {
			method: Method.INSTANCED,
			count: 1000
		};"""
assert old in s
s = s.replace(old, """		const q = new URLSearchParams( location.search );
		const api = {
			method: q.get( 'method' ) || Method.INSTANCED,
			count: parseInt( q.get( 'count' ) || '1000' )
		};""")
open(sys.argv[2], "w").write(s)
PY
mkdir -p xdg && chmod 700 xdg
