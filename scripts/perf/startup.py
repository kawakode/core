#!/usr/bin/env python3
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Mesure du démarrage de Core via Marionette (Linux, sous X ou Xvfb).

  core/scripts/perf/startup.py [--runs N] [--mode warm|cold] [--out fichier.csv]
      [--tmpdir dossier] NOM=chemin/core [NOM=chemin/core ...]
  ex. : DISPLAY=:92 core/scripts/perf/startup.py --runs 20 --mode warm A=obj-a/dist/bin/core B=obj-b/dist/bin/core

Pour chaque build, prépare un profil gabarit (deux lancements complets pour
remplir startupCache et le cache de scripts), puis enchaîne N lancements par
build en alternant l'ordre (A,B puis B,A...). Chaque lancement part d'une copie
neuve du gabarit. Le premier lancement de chaque build est jeté (chauffe).

Relevé par lancement : Services.startup.getStartupInfo() (main, firstPaint,
sessionRestored, en ms depuis le début du processus) et le temps réel entre
l'exec et le premier affichage (firstPaint, horloge murale).

--mode cold vide le cache de pages du noyau avant chaque lancement
(sync; echo 3 > /proc/sys/vm/drop_caches) : il faut être root. À froid,
comparer des copies fraîches des builds (cp -rL) : l'emplacement des fichiers
sur le disque fait varier le résultat d'environ 7 %.

Le client Marionette vient de scripts/pgo/marionette.py (ou $CORE_MARIONETTE_DIR).
"""
import argparse, csv, os, shutil, statistics, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.environ.get("CORE_MARIONETTE_DIR", os.path.join(HERE, "..", "pgo")))
from marionette import Marionette

PORT = 2852
PREFS = [
    ("marionette.port", PORT),
    ("browser.shell.checkDefaultBrowser", False),
    ("datareporting.policy.dataSubmissionEnabled", False),
    ("toolkit.telemetry.reportingpolicy.firstRun", False),
    ("app.update.disabledForTesting", True),
]
KEYS = ("main", "firstPaint", "sessionRestored")
INFO = """
const i = Services.startup.getStartupInfo();
const o = {};
for (const k of ["process", "main", "firstPaint", "sessionRestored"])
  if (i[k]) o[k] = i[k].getTime();
return o;
"""


def drop_caches():
    subprocess.run(["sync"], check=True)
    with open("/proc/sys/vm/drop_caches", "w") as f:
        f.write("3\n")


def start(binary, prof):
    env = dict(os.environ, MOZ_CRASHREPORTER_DISABLE="1")
    env.pop("XAUTHORITY", None)  # Core refuse de tourner en root avec le xauth d'un autre utilisateur
    return subprocess.Popen([binary, "-no-remote", "-profile", prof, "--marionette",
                             "--remote-allow-system-access", "about:blank"],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def stop(p, m, flags=("eForceQuit",)):
    try:
        m.cmd("Marionette:Quit", {"flags": list(flags)})
    except Exception:
        pass
    try:
        return p.wait(30)
    except subprocess.TimeoutExpired:
        p.kill()
        return p.wait()


def startup_info(m, limit=30):
    """Attend firstPaint (et sessionRestored s'il arrive) puis rend les dates."""
    m.cmd("Marionette:SetContext", {"value": "chrome"})
    t = time.time()
    info, painted = {}, None
    while time.time() - t < limit:
        info = m.js(INFO) or {}
        if "firstPaint" in info:
            # Core n'a pas de restauration de session : sessionRestored peut
            # ne jamais venir, on ne l'attend que 3 s après le premier affichage.
            painted = painted or time.time()
            if "sessionRestored" in info or time.time() - painted > 3:
                break
        time.sleep(0.25)
    return info


def template(binary, root):
    prof = os.path.join(root, "template")
    os.makedirs(prof)
    with open(prof + "/user.js", "w") as f:
        for k, v in PREFS:
            v = ("true" if v else "false") if isinstance(v, bool) else v
            f.write(f'user_pref("{k}", {v});\n')
    for _ in range(2):
        p = start(binary, prof)
        m = Marionette(port=PORT, timeout=120)
        time.sleep(20)  # laisser écrire startupCache et le cache de scripts
        stop(p, m, ("eAttemptQuit",))
    return prof


def launch(binary, tpl, root, cold):
    prof = tempfile.mkdtemp(dir=root)
    shutil.rmtree(prof)
    shutil.copytree(tpl, prof, ignore=shutil.ignore_patterns("lock", ".parentlock"))
    if cold:
        drop_caches()
    t0 = time.time()
    p = start(binary, prof)
    try:
        m = Marionette(port=PORT, timeout=120)
        info = startup_info(m)
    except Exception:
        p.kill(); p.wait()
        raise
    code = stop(p, m)
    shutil.rmtree(prof, ignore_errors=True)
    proc = info.get("process")
    r = {k: (info[k] - proc if k in info and proc else float("nan")) for k in KEYS}
    r["wall_firstPaint"] = info["firstPaint"] - t0 * 1000 if "firstPaint" in info else float("nan")
    r["exit"] = code  # 0 attendu ; autre chose = plantage ou arrêt forcé
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=20)
    ap.add_argument("--mode", choices=("warm", "cold"), default="warm")
    ap.add_argument("--out", default="startup.csv")
    ap.add_argument("--tmpdir", default=None, help="dossier des profils (défaut : dossier temporaire du système)")
    ap.add_argument("builds", nargs="+", help="NOM=chemin/vers/core")
    a = ap.parse_args()
    builds = dict(b.split("=", 1) for b in a.builds)
    root = tempfile.mkdtemp(prefix="core-startup-", dir=a.tmpdir)
    os.chmod(root, 0o755)
    tpl = {n: template(b, os.path.join(root, n)) for n, b in builds.items()}
    cols = ("main", "firstPaint", "sessionRestored", "wall_firstPaint")
    new = not os.path.exists(a.out)
    f = open(a.out, "a", newline="")
    w = csv.writer(f)
    if new:
        w.writerow(["time", "mode", "build", "run", *cols, "exit"])
    res = {n: [] for n in builds}
    names = list(builds)
    try:
        for n in names:  # chauffe, jetée
            launch(builds[n], tpl[n], os.path.join(root, n), a.mode == "cold")
        for i in range(a.runs):
            for n in (names if i % 2 == 0 else names[::-1]):
                r = launch(builds[n], tpl[n], os.path.join(root, n), a.mode == "cold")
                res[n].append(r)
                w.writerow([time.strftime("%Y-%m-%dT%H:%M:%S"), a.mode, n, i + 1, *(round(r[c], 1) for c in cols), r["exit"]])
                f.flush()
                print(f"{a.mode} {n} {i + 1}: " + " ".join(f"{c} {r[c]:.0f}" for c in cols) + f" exit {r['exit']}", flush=True)
    finally:
        shutil.rmtree(root, ignore_errors=True)
    for n in names:
        bad = sum(1 for r in res[n] if r["exit"] != 0)
        print(f"{n} ({a.mode}, {len(res[n])} lancements, {bad} sorties anormales), médiane (min-max) en ms :")
        for c in cols:
            v = [r[c] for r in res[n] if r[c] == r[c]]
            if v:
                print(f"  {c:16} {statistics.median(v):7.0f} ({min(v):.0f}-{max(v):.0f})")


if __name__ == "__main__":
    main()
