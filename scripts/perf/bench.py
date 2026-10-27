#!/usr/bin/env python3
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""A/B JavaScript et WebGL via Marionette : JetStream, Speedometer 3, MotionMark,
WebGL Aquarium, three.js (instancing_performance).

  core/scripts/perf/bench.py <passes> <out.csv> [bench,...]
  ex. : CORE_B=../autre/obj-core-pgo/dist/bin/core core/scripts/perf/bench.py 6 js.csv js,sp3

Configurations A et B : binaire (CORE_A / CORE_B, obj-core-pgo de l'arbre par défaut) et
préférences en plus (PREFS_A / PREFS_B, "clé=valeur;clé=valeur").
Ordre alterné A,B / B,A ; profil neuf à chaque passe.
Benchs : js (JetStream), sp3, mm (MotionMark 1.3.1), aq<N> (Aquarium à N
poissons), three-naive<N> / three-inst<N> (N singes, un draw call chacun ou
instanciés). Les mesures en images/s tournent avec layout.frame_rate=0
(pas de limite vsync) pour mesurer le débit réel.

Préparer : core/scripts/perf/fetch.sh (benchs dans $PERF_DL), puis
core/scripts/perf/kwin-headless.sh (affichage GPU sans écran). Les binaires doivent
être hors d'un dossier en 0700 (processus de contenu sandboxés).
"""
import csv, json, os, shutil, subprocess, sys, tempfile, time

W = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.environ.get("CORE_MARIONETTE_DIR", os.path.join(W, "..", "pgo")))
from marionette import Marionette

# Benchs téléchargés par fetch.sh ; Speedometer 3 vient de l'arbre Gecko.
DL = os.environ.get("PERF_DL", "/var/tmp/core-perf")
GECKO = os.environ.get("GECKO", os.path.abspath(os.path.join(W, "..", "..", "..")))
BUILDS = {t: os.environ.get("CORE_" + t, f"{GECKO}/obj-core-pgo/dist/bin/core") for t in "AB"}
SERVERS = {
    "js": (f"{DL}/JetStream", 8020),
    "sp3": (f"{GECKO}/third_party/webkit/PerformanceTests/Speedometer3", 8021),
    "mm": (f"{DL}/MotionMark/MotionMark", 8022),
    "aq": (f"{DL}/wgs", 8023),
    "three": (f"{DL}/three", 8024),
}
PORT = 2860
# Par défaut : KWin sans écran (kwin_wayland --virtual, socket "corebench"),
# composité sur le GPU (render node) sans rien afficher sur la session de
# l'utilisateur. BENCH_X11=:92 pour passer par un Xvfb à la place.
X11 = os.environ.get("BENCH_X11")
WAYLAND = os.environ.get("BENCH_WAYLAND", "corebench")
XDG = os.environ.get("BENCH_XDG", f"{DL}/xdg")
FPS_SECONDS = int(os.environ.get("FPS_SECONDS", "30"))

COMMON = [
    ("marionette.port", PORT),
    ("browser.shell.checkDefaultBrowser", False),
    ("datareporting.policy.dataSubmissionEnabled", False),
    ("toolkit.telemetry.reportingpolicy.firstRun", False),
    ("app.update.disabledForTesting", True),
]


def parse_prefs(s):
    out = []
    for kv in filter(None, (s or "").split(";")):
        k, v = kv.split("=", 1)
        if v in ("true", "false"):
            v = v == "true"
        else:
            try:
                v = int(v)
            except ValueError:
                pass
        out.append((k.strip(), v))
    return out


EXTRA = {t: parse_prefs(os.environ.get("PREFS_" + t)) for t in "AB"}


def fmt(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    return json.dumps(v)


def launch(t, prefs):
    prof = tempfile.mkdtemp(prefix=f"pjw-{t}-", dir=DL)
    with open(prof + "/user.js", "w") as f:
        for k, v in COMMON + prefs + EXTRA[t]:
            f.write(f'user_pref("{k}", {fmt(v)});\n')
    env = {k: v for k, v in os.environ.items() if k not in ("DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY")}
    env["MOZ_CRASHREPORTER_DISABLE"] = "1"
    if X11:
        env.update(DISPLAY=X11, MOZ_ENABLE_WAYLAND="0")
    else:
        env.update(WAYLAND_DISPLAY=WAYLAND, XDG_RUNTIME_DIR=XDG, MOZ_ENABLE_WAYLAND="1")
    p = subprocess.Popen([BUILDS[t], "-no-remote", "-profile", prof, "--marionette"] + (["-remote-allow-system-access"] if os.environ.get("BENCH_SYSTEM") else []) + ["about:blank"],
                         env=env, cwd="/var/tmp", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    m = Marionette(port=PORT, timeout=120)
    time.sleep(5)
    for _ in range(5):
        try:
            m.cmd("WebDriver:SetWindowRect", {"x": 0, "y": 0, "width": 1600, "height": 1000})
            break
        except RuntimeError:
            time.sleep(2)
    return p, m, prof


def stop(p, m, prof):
    m.quit()
    try:
        p.wait(30)
    except subprocess.TimeoutExpired:
        p.kill(); p.wait()
    shutil.rmtree(prof, ignore_errors=True)


def poll(m, script, limit, step=5):
    t = time.time()
    while time.time() - t < limit:
        time.sleep(step)
        r = m.js(script)
        if r:
            return r, time.time() - t
    raise TimeoutError(script)


def url(name, path):
    return f"http://127.0.0.1:{SERVERS[name][1]}/{path}"


def run_js(m, detail):
    m.go(url("js", "index.html?startAutomatically=true"))
    _, d = poll(m, "return globalThis.JetStream && JetStream.isDone", 3600, 10)
    r = m.js("""const b = JetStream.benchmarks.map(x => [x.name, x.score]);
                const s = Math.exp(b.reduce((a, x) => a + Math.log(x[1]), 0) / b.length);
                return [s, Object.fromEntries(b)];""")
    detail.update(r[1])
    return r[0], d


def run_sp3(m, detail):
    m.go(url("sp3", "index.html?startAutomatically"))
    r, d = poll(m, 'return document.getElementById("result-number").textContent', 1800)
    return float(r), d


def run_mm(m, detail):
    m.go(url("mm", "index.html"))
    poll(m, 'return !document.getElementById("start-button").disabled', 120, 2)
    m.js("benchmarkController.startBenchmark()")
    r, d = poll(m, 'return document.querySelector("#results.selected") && benchmarkRunnerClient.results.score', 1800)
    return float(r), d


FPS_JS = """const [secs, done] = [arguments[0], arguments[arguments.length - 1]];
let n = 0, t0 = 0;
function f(t) { if (!t0) t0 = t; n++;
  if (t - t0 < secs * 1000) requestAnimationFrame(f); else done((n - 1) * 1000 / (t - t0)); }
requestAnimationFrame(f);"""


def fps(m, ready):
    poll(m, ready, 120, 1)
    time.sleep(5)  # chauffe : compilation des shaders, JIT
    t = time.time()
    return m.js(FPS_JS, [FPS_SECONDS], async_=True), time.time() - t


def run_aq(m, detail, n):
    m.go(url("aq", f"aquarium/aquarium.html?numFish={n}"))
    return fps(m, 'const e = document.getElementById("fps"); return e && parseFloat(e.textContent) > 0')


def run_three(m, detail, method, n):
    m.go(url("three", f"examples/bench_instancing.html?method={method}&count={n}"))
    return fps(m, 'return window.scene && window.scene.children.some(o => o.isMesh)')


def bench_fn(name):
    if name in ("js", "sp3", "mm"):
        return {"js": run_js, "sp3": run_sp3, "mm": run_mm}[name], [], name
    if name.startswith("aq"):
        n = int(name[2:])
        return (lambda m, d: run_aq(m, d, n)), [("layout.frame_rate", 0)], "aq"
    if name.startswith("three-"):
        kind, n = name[6:].rstrip("0123456789"), int(name[6:].lstrip("abcdefghijklmnopqrstuvwxyz"))
        method = {"naive": "NAIVE", "inst": "INSTANCED", "merged": "MERGED"}[kind]
        return (lambda m, d: run_three(m, d, method, n)), [("layout.frame_rate", 0)], "three"
    raise ValueError(name)


def main():
    runs, out = int(sys.argv[1]), sys.argv[2]
    benches = (sys.argv[3] if len(sys.argv) > 3 else "js,sp3").split(",")
    fns = {b: bench_fn(b) for b in benches}
    servers = [subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                                cwd=d, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
               for k, (d, port) in SERVERS.items() if any(f[2] == k for f in fns.values())]
    time.sleep(1)
    new = not os.path.exists(out)
    f = open(out, "a", newline="")
    w = csv.writer(f)
    if new:
        w.writerow(["time", "bench", "config", "round", "score", "seconds", "prefs", "detail"])
    label = {t: (os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(BUILDS[t]))))) + " " +
                 ";".join(f"{k}={v}" for k, v in EXTRA[t])).strip() for t in "AB"}
    try:
        for i in range(runs):
            order = "AB" if i % 2 == 0 else "BA"
            for b in benches:
                fn, prefs, _ = fns[b]
                for t in order:
                    detail = {}
                    try:
                        p, m, prof = launch(t, prefs)
                    except Exception as e:
                        print(f"{b} {t} {i+1}: lancement impossible {e}", flush=True)
                        continue
                    try:
                        s, d = fn(m, detail)
                    except Exception as e:
                        print(f"{b} {t} round {i+1}: erreur {e}", flush=True)
                        s, d = float("nan"), 0
                    finally:
                        stop(p, m, prof)
                    w.writerow([time.strftime("%Y-%m-%dT%H:%M:%S"), b, t, i + 1, s, round(d), label[t],
                                json.dumps(detail) if detail else ""])
                    f.flush()
                    print(f"{b} {t} round {i+1}: {s:.2f} ({d:.0f} s)", flush=True)
    finally:
        for s in servers:
            s.kill()


if __name__ == "__main__":
    main()
