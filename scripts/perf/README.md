# Mesures de performance

Scripts des mesures de `docs/wiki/Performances.md`, lancés depuis la racine de
Gecko (`core/scripts/perf/...`). Chaque mesure est un A/B : passes alternées
(A,B puis B,A), profil neuf à chaque passe, médianes.

- `startup.py` : démarrage (premier affichage), à chaud ou à froid.
- `mem.py` : mémoire après une session scriptée, B = préférences en plus.
- `bench.py` : JavaScript et WebGL (JetStream 3, Speedometer 3,
  MotionMark 1.3.1, WebGL Aquarium, three.js), B = autre binaire (`CORE_B`)
  ou préférences en plus (`PREFS_B`).
- `video.py` : lecture vidéo (4K AV1, H.264...) : CPU, décodeur vidéo du GPU,
  images perdues ; B = autre binaire ou préférences en plus.
- `summarize.py` : médiane, min-max, écart et test de Mann-Whitney d'un CSV de
  `bench.py` ; `subtests.py` : sous-tests JetStream les plus marqués.

## JavaScript et WebGL sur le GPU

    core/scripts/perf/fetch.sh                 # une fois : benchs dans $PERF_DL
    core/scripts/perf/kwin-headless.sh &       # affichage GPU sans écran
    CORE_B=../autre/obj-core-pgo/dist/bin/core core/scripts/perf/bench.py 6 res.csv js,sp3
    PREFS_B="javascript.options.mem.nursery.max_kb=131072" core/scripts/perf/bench.py 6 res.csv js,sp3
    core/scripts/perf/bench.py 6 res.csv mm,aq30000,three-naive10000
    core/scripts/perf/summarize.py res.csv

`kwin-headless.sh` lance un KWin sans écran (`kwin_wayland --virtual`) qui
compose sur le GPU via le render node : WebRender matériel et WebGL sur le vrai
GPU, sans fenêtre sur la session graphique en cours. `BENCH_X11=:92` passe par
un Xvfb à la place (rendu logiciel, WebGL en llvmpipe).

Benchs : `js` (JetStream 3, préversion c603c04), `sp3` (Speedometer 3 de
l'arbre), `mm` (MotionMark 1.3.1), `aq<N>` (Aquarium, N poissons),
`three-naive<N>` / `three-inst<N>` (three.js, N objets en N appels de dessin
ou instanciés). Les mesures en images/s sont faites avec `layout.frame_rate=0`
(sans plafond vsync). Les binaires doivent être hors d'un dossier en 0700
(processus de contenu sandboxés).

Deux builds PGO identiques diffèrent d'environ 0,7 % : pour comparer des
options de compilation, reconstruire aussi un témoin sans l'option.
