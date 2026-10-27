#!/usr/bin/env python3
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Résumé A/B d'un ou plusieurs CSV de bench.py : médiane, min-max, écart des
médianes, et test de Mann-Whitney (bilatéral, approximation normale).

  core/scripts/perf/summarize.py res-*.csv
"""
import csv, math, statistics, sys


def mannwhitney(a, b):
    allv = sorted((v, i) for i, v in enumerate(a + b))
    ranks = [0.0] * len(allv)
    i = 0
    while i < len(allv):
        j = i
        while j + 1 < len(allv) and allv[j + 1][0] == allv[i][0]:
            j += 1
        for k in range(i, j + 1):
            ranks[allv[k][1]] = (i + j) / 2 + 1
        i = j + 1
    n1, n2 = len(a), len(b)
    u = sum(ranks[:n1]) - n1 * (n1 + 1) / 2
    mu, sd = n1 * n2 / 2, math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12)
    z = (u - mu) / sd if sd else 0
    return 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))


def fr(x, d=1):
    return f"{x:.{d}f}".replace(".", ",")


def main():
    for path in sys.argv[1:]:
        rows = [r for r in csv.DictReader(open(path)) if r["score"] != "nan"]
        labels = {r["config"]: r["prefs"] for r in rows}
        print(f"## {path} : B = {labels.get('B', '?')}")
        print("| Test | A médiane (min-max) | B médiane (min-max) | Écart | p (MW) | n |")
        print("|---|---|---|---|---|---|")
        for b in dict.fromkeys(r["bench"] for r in rows):
            a = [float(r["score"]) for r in rows if r["bench"] == b and r["config"] == "A"]
            bb = [float(r["score"]) for r in rows if r["bench"] == b and r["config"] == "B"]
            if not a or not bb:
                continue
            ma, mb = statistics.median(a), statistics.median(bb)
            print(f"| {b} | {fr(ma)} ({fr(min(a))}-{fr(max(a))}) | {fr(mb)} ({fr(min(bb))}-{fr(max(bb))}) | "
                  f"{'+' if mb >= ma else ''}{fr(100 * (mb - ma) / ma)} % | {fr(mannwhitney(a, bb), 3)} | {len(a)}/{len(bb)} |")
        print()


if __name__ == "__main__":
    main()
