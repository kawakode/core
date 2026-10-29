#!/usr/bin/env python3
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Lecture vidéo A/B : temps CPU de tous les processus du navigateur, occupation
du décodeur vidéo du GPU (VCN, AMD), du GPU et sa puissance, images perdues.

  core/scripts/perf/video.py <passes> <out.csv> <vidéo,...>
  ex. : CORE_B=../firefox/firefox core/scripts/perf/video.py 4 vid.csv av1-4k60,h264-4k60

Configurations A et B comme bench.py (CORE_A / CORE_B, PREFS_A / PREFS_B).
Les vidéos sont des fichiers <nom>.mp4 de $PERF_DL/video, par exemple
(encodées par le GPU, 40 s en 4K à 60 i/s) :

  ffmpeg -init_hw_device vaapi=va:/dev/dri/renderD128 -filter_hw_device va \\
    -f lavfi -i testsrc2=size=3840x2160:rate=60 -t 40 -vf format=nv12,hwupload \\
    -c:v av1_vaapi -b:v 25M av1-4k60.mp4

Un vcn à 0 signifie un décodage logiciel. Mesure sur VIDEO_SECONDS (20 s)
après 3 s de lecture.
"""
import csv, glob, os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bench

DEV = os.path.dirname(glob.glob("/sys/class/drm/card*/device/vcn_busy_percent")[0])
PWR = glob.glob(DEV + "/hwmon/*/power1_average")[0]
SECS = int(os.environ.get("VIDEO_SECONDS", "20"))
CLK = os.sysconf("SC_CLK_TCK")
PORT = 8030
QUALITY = "const q = document.querySelector('video').getVideoPlaybackQuality(); return [q.totalVideoFrames, q.droppedVideoFrames]"


def tree(root):
    kids = {}
    for st in glob.glob("/proc/[0-9]*/stat"):
        try:
            s = open(st).read()
            kids.setdefault(int(s[s.rindex(")") + 2:].split()[1]), []).append(int(s.split()[0]))
        except (OSError, ValueError):
            pass
    out, todo = [], [root]
    while todo:
        p = todo.pop()
        out.append(p)
        todo += kids.get(p, [])
    return out


def cpu(pids):
    t = 0
    for p in pids:
        try:
            f = open(f"/proc/{p}/stat").read()
            f = f[f.rindex(")") + 2:].split()
            t += int(f[11]) + int(f[12])
        except (OSError, ValueError):
            pass
    return t / CLK


def read(path):
    return float(open(path).read())


def run(t, name):
    p, m, prof = bench.launch(t, [])
    try:
        m.go(f"http://127.0.0.1:{PORT}/play.html?{name}")
        bench.poll(m, "const v = document.querySelector('video'); return v && v.currentTime > 1", 60, 1)
        time.sleep(3)
        q0 = m.js(QUALITY)
        c0 = cpu(tree(p.pid))
        vcn = gpu = watts = n = 0
        t0 = time.time()
        while time.time() - t0 < SECS:
            time.sleep(0.5)
            n += 1
            vcn += read(DEV + "/vcn_busy_percent")
            gpu += read(DEV + "/gpu_busy_percent")
            watts += read(PWR) / 1e6
        c1 = cpu(tree(p.pid))
        dt = time.time() - t0
        q1 = m.js(QUALITY)
        return dict(cpu=100 * (c1 - c0) / dt, vcn=vcn / n, gpu=gpu / n, watts=watts / n,
                    fps=(q1[0] - q0[0]) / dt, dropped=q1[1] - q0[1])
    finally:
        bench.stop(p, m, prof)


def main():
    runs, out, videos = int(sys.argv[1]), sys.argv[2], sys.argv[3].split(",")
    d = bench.DL + "/video"
    with open(d + "/play.html", "w") as f:
        f.write('<!doctype html><body style="margin:0;background:#000">'
                '<video muted autoplay loop style="width:100vw;height:100vh"></video>'
                "<script>document.querySelector('video').src = location.search.slice(1) + '.mp4';</script>")
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=d,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    cols = ("cpu", "vcn", "gpu", "watts", "fps", "dropped")
    new = not os.path.exists(out)
    f = open(out, "a", newline="")
    w = csv.writer(f)
    if new:
        w.writerow(["time", "video", "config", "round", *cols, "build", "prefs"])
    try:
        for i in range(runs):
            for v in videos:
                for t in ("AB" if i % 2 == 0 else "BA"):
                    r = run(t, v)
                    w.writerow([time.strftime("%Y-%m-%dT%H:%M:%S"), v, t, i + 1, *(round(r[c], 2) for c in cols),
                                bench.BUILDS[t], os.environ.get("PREFS_" + t, "")])
                    f.flush()
                    print(f"{v} {t} round {i + 1}: " + " ".join(f"{c} {r[c]:.1f}" for c in cols), flush=True)
    finally:
        srv.kill()


if __name__ == "__main__":
    main()
