#!/usr/bin/env python3
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Mémoire A/B : même binaire, B ajoute des préférences (user.js). Sous Xvfb.

  core/scripts/perf/mem.py --bin chemin/core --sp3 chemin/Speedometer3
      [--pref nom=valeur ...] [--tmpdir dossier] <runs> <out.csv>
  ex. : DISPLAY=:92 core/scripts/perf/mem.py --bin obj-core-pgo/dist/bin/core \\
          --sp3 third_party/webkit/PerformanceTests/Speedometer3 \\
          --pref javascript.options.mem.gc_balanced_heap_limits=true 6 mem.csv

Session scriptée par passe (profil neuf) : 12 navigations sur des sites réels
dans un onglet, Element (app.element.io) dans un deuxième, une passe complète
de Speedometer 3 laissée ouverte dans un troisième. Relève ensuite la somme
PSS/RSS de tous les processus Core (parent + descendants) toutes les 2 s
pendant 60 s (moyenne et pic), puis une dernière fois au repos. Ordre alterné
A,B / B,A.
"""
import argparse, csv, os, shutil, subprocess, sys, tempfile, time

sys.path.insert(0, os.environ.get("CORE_MARIONETTE_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pgo")))
from marionette import Marionette

BIN = SP3_DIR = TMPDIR = None  # fixés par main()
SP3_PORT = 8010
PORT = 2851
DISPLAY = os.environ.get("DISPLAY", ":92")
EXTRA = {"A": [], "B": []}  # B rempli par --pref
PREFS = [
    ("marionette.port", PORT),
    ("browser.shell.checkDefaultBrowser", False),
    ("datareporting.policy.dataSubmissionEnabled", False),
    ("toolkit.telemetry.reportingpolicy.firstRun", False),
    ("app.update.disabledForTesting", True),
    # Core n'a pas BrowserCommands : nouveaux onglets via window.open.
    ("dom.disable_open_during_load", False),
]
SITES = [
    "https://en.wikipedia.org/wiki/Firefox",
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
    "https://github.com/mozilla-firefox/firefox",
    "https://news.ycombinator.com/",
    "https://www.bbc.com/news",
    "https://www.lemonde.fr/",
    "https://stackoverflow.com/questions",
    "https://www.reddit.com/r/firefox/",
    "https://www.youtube.com/",
    "https://www.theguardian.com/international",
    "https://docs.python.org/3/library/",
    "https://www.openstreetmap.org/",
]
SPA = "https://app.element.io/"


def tree(pid):
    """pid et tous ses descendants."""
    kids = {}
    for d in os.listdir("/proc"):
        if d.isdigit():
            try:
                with open(f"/proc/{d}/stat") as f:
                    ppid = int(f.read().rsplit(")", 1)[1].split()[1])
                kids.setdefault(ppid, []).append(int(d))
            except (OSError, IndexError, ValueError):
                pass
    out, todo = [], [pid]
    while todo:
        p = todo.pop()
        out.append(p)
        todo += kids.get(p, [])
    return out


def memory(pid):
    pss = rss = 0
    exe = os.path.realpath(BIN)
    pids = []
    for p in tree(pid):  # seuls les processus Core (pas les chargeurs glycin de GTK)
        try:
            if os.readlink(f"/proc/{p}/exe") == exe:
                pids.append(p)
        except OSError:
            pass
    for p in pids:
        try:
            with open(f"/proc/{p}/smaps_rollup") as f:
                for line in f:
                    if line.startswith("Pss:"):
                        pss += int(line.split()[1])
                    elif line.startswith("Rss:"):
                        rss += int(line.split()[1])
        except OSError:
            pass
    return pss // 1024, rss // 1024, len(pids)


def pref_value(v):
    if v in ("true", "false"):
        return v == "true"
    try:
        return int(v)
    except ValueError:
        return f'"{v}"'


def launch(t):
    prof = tempfile.mkdtemp(prefix=f"mem-{t}-", dir=TMPDIR)
    with open(prof + "/user.js", "w") as f:
        for k, v in PREFS + EXTRA[t]:
            v = ("true" if v else "false") if isinstance(v, bool) else v
            f.write(f'user_pref("{k}", {v});\n')
    env = dict(os.environ, DISPLAY=DISPLAY, MOZ_CRASHREPORTER_DISABLE="1")
    env.pop("XAUTHORITY", None)
    p = subprocess.Popen([BIN, "-no-remote", "-profile", prof, "--marionette", "about:blank"],
                         env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    m = Marionette(port=PORT, timeout=120)
    time.sleep(5)
    m.cmd("WebDriver:SetWindowRect", {"x": 0, "y": 0, "width": 1600, "height": 1000})
    return p, m, prof


def stop(p, m, prof):
    m.quit()
    try:
        p.wait(30)
    except subprocess.TimeoutExpired:
        p.kill(); p.wait()
    shutil.rmtree(prof, ignore_errors=True)


def go(m, url):
    try:
        m.go(url)
    except RuntimeError as e:  # délai de chargement dépassé : on continue
        print(f"  {url}: {str(e)[:80]}", flush=True)


def new_tab(m):
    before = handles(m)
    m.js("window.open('about:blank', '_blank')")
    for _ in range(40):
        h = handles(m)
        if len(h) > len(before):
            break
        time.sleep(0.25)
    m.cmd("WebDriver:SwitchToWindow", {"handle": [x for x in h if x not in before][0]})


def handles(m):
    h = m.cmd("WebDriver:GetWindowHandles")
    return h.get("value", h) if isinstance(h, dict) else h


def session(m):
    for url in SITES:
        go(m, url)
        time.sleep(4)
    new_tab(m)
    go(m, SPA)
    time.sleep(15)
    new_tab(m)
    go(m, f"http://127.0.0.1:{SP3_PORT}/index.html?startAutomatically")
    t = time.time()
    while time.time() - t < 1800:
        time.sleep(5)
        r = m.js('return document.getElementById("result-number").textContent')
        if r:
            return float(r)
    return float("nan")


def main():
    global BIN, SP3_DIR, TMPDIR
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", required=True, help="chemin/vers/core")
    ap.add_argument("--sp3", required=True, help="dossier Speedometer3 (third_party/webkit/PerformanceTests/Speedometer3)")
    ap.add_argument("--pref", action="append", default=[], help="nom=valeur, ajoutée au profil de B (répétable)")
    ap.add_argument("--tmpdir", default=None, help="dossier des profils (défaut : dossier temporaire du système)")
    ap.add_argument("runs", type=int)
    ap.add_argument("out")
    a = ap.parse_args()
    BIN, SP3_DIR, TMPDIR = os.path.abspath(a.bin), os.path.abspath(a.sp3), a.tmpdir
    EXTRA["B"] = [(k, pref_value(v)) for k, v in (p.split("=", 1) for p in a.pref)]
    runs, out = a.runs, a.out
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(SP3_PORT), "--bind", "127.0.0.1"],
                           cwd=SP3_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    new = not os.path.exists(out)
    f = open(out, "a", newline="")
    w = csv.writer(f)
    if new:
        w.writerow(["time", "build", "round", "sp3", "pss_mean_mb", "rss_mean_mb", "procs", "pss_peak_mb", "pss_idle_mb", "rss_idle_mb", "procs_idle"])
    try:
        for i in range(runs):
            for t in ("AB" if i % 2 == 0 else "BA"):
                p, m, prof = launch(t)
                try:
                    s = session(m)
                    # Série : un relevé toutes les 2 s pendant 60 s (le GC rend
                    # un relevé unique bimodal) ; m1 = moyenne, pic = maximum.
                    serie = []
                    t1 = time.time()
                    while time.time() - t1 < 60:
                        serie.append(memory(p.pid))
                        time.sleep(2)
                    m1 = (sum(x[0] for x in serie) // len(serie), sum(x[1] for x in serie) // len(serie), serie[-1][2])
                    pic = max(x[0] for x in serie)
                    m2 = memory(p.pid)
                except Exception as e:
                    print(f"{t} round {i+1}: erreur {e}", flush=True)
                    s, m1, m2, pic = float("nan"), (0, 0, 0), (0, 0, 0), 0
                finally:
                    stop(p, m, prof)
                w.writerow([time.strftime("%Y-%m-%dT%H:%M:%S"), t, i + 1, s, *m1, pic, *m2])
                f.flush()
                print(f"{t} round {i+1}: sp3 {s} pss moy {m1[0]} pic {pic} rss moy {m1[1]} ({m1[2]} proc) | idle pss {m2[0]} rss {m2[1]} ({m2[2]} proc)", flush=True)
    finally:
        srv.kill()


if __name__ == "__main__":
    main()
