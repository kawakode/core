#!/usr/bin/env python3
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Sous-tests JetStream : écart des médianes B/A par sous-test, les plus marqués.
  core/scripts/perf/subtests.py res.csv [n]"""
import csv, json, statistics, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from summarize import mannwhitney
rows = [r for r in csv.DictReader(open(sys.argv[1])) if r["bench"] == "js" and r["detail"]]
d = {"A": {}, "B": {}}
for r in rows:
    for k, v in json.loads(r["detail"]).items():
        d[r["config"]].setdefault(k, []).append(v)
out = []
for k in d["A"]:
    a, b = d["A"][k], d["B"].get(k, [])
    if len(a) > 2 and len(b) > 2:
        out.append((100 * (statistics.median(b) / statistics.median(a) - 1), mannwhitney(a, b), k))
out.sort()
n = int(sys.argv[2]) if len(sys.argv) > 2 else 6
for x in out[:n] + [None] + out[-n:]:
    print("..." if x is None else f"{x[2]:28s} {x[0]:+6.1f} %  p={x[1]:.3f}")
wasm = [x[0] for x in out if any(s in x[2].lower() for s in ("wasm", "dart", "kotlin", "sqlite", "godot", "tfjs", "argon", "zlib", "j2cl", "transformers", "8bit", "box2d"))]
print(f"sous-tests wasm ({len(wasm)}) : médiane {statistics.median(wasm):+.1f} %" if wasm else "")
