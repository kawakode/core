# Performances

Règle du projet : aucun gain n'est annoncé avant d'être mesuré, et chaque
réglage de performance est gardé seulement s'il paie sur la mesure.

## Core face à Firefox officiel (Linux)

**Tests du 20 octobre 2026.** Core 153.5.0 en build PGO + LTO
(`scripts/pgo/build.sh`) contre le Firefox officiel de Mozilla (lui aussi PGO
+ LTO), sur la même machine Linux. Médianes de plusieurs passes, pilotées par
WebDriver.

| Mesure | Core | Firefox officiel | Écart |
|---|---|---|---|
| Speedometer 3 (plus haut = mieux) | **10,82** | 10,74 | +0,7 % |
| MotionMark (plus haut = mieux) | 570 | **584** | −2,4 % |
| Premier affichage, pages réelles | **88 ms** | 129 ms | −32 % |
| Chargement complet, pages réelles | **273 ms** | 303 ms | −10 % |
| Mémoire, après 12 navigations ¹ | **669 Mo** | 1 166 Mo | −43 % |

¹ Mesure de mémoire faite lors de la première série (PR #10), avec le même
build PGO + LTO ; les quatre autres lignes viennent de la série finale
(PR #11).

Lecture :

- **Moteur à parité.** Speedometer et MotionMark sont dans le bruit de
  mesure : c'est le même Gecko, compilé de la même façon. Aller plus loin
  demanderait de modifier le code de Gecko.
- **Affichage et chargement plus rapides**, parce que Core charge moins de
  choses autour de la page (pas d'interface ni de services de `browser/`).
- **Mémoire presque divisée par deux**, pour la même raison.

### Ce qui a compté

| Étape | Speedometer 3 | Premier affichage | Mémoire |
|---|---|---|---|
| Core avant (optimisé, sans PGO, bfcache à 0) | 8,18 | 316 ms | 584 Mo |
| Core PGO + LTO, bfcache à 1 (PR #10) | 10,64 | 92 ms | 669 Mo |

Le bfcache à 0 détruisait le processus de la page quittée : chaque navigation
en relançait un, d'où un premier affichage 2 à 3 fois plus lent pour environ
50 Mo économisés. Core en garde maintenant une page (Firefox jusqu'à 8).

## Windows (sous Wine)

**Tests du 21 octobre 2026**, sur Linux sous Wine, rendu WebRender logiciel.
Ce n'est pas une comparaison avec Firefox, seulement l'effet du PGO sur le
build Windows de Core :

| Build Windows de Core | Speedometer 3 |
|---|---|
| LTO, sans PGO | 14,5 |
| PGO + LTO (`scripts/pgo/build-win64.sh`) | **20,0** (+38 %) |

Les chiffres absolus ne sont pas comparables à ceux de Linux (autre machine,
Wine, rendu logiciel). Reste à mesurer sur une vraie machine Windows.

## Patchs de Mozilla jamais intégrés

**Tests du 22 au 24 octobre 2026**, sur Rycore (Ryzen 9 5900X, 32 Go,
Xvfb, WebRender logiciel, bac à sable actif). Builds PGO + LTO des deux
côtés, chacun avec son propre profilage, passes alternées avec un profil neuf.

Sur environ 300 patchs de performance jamais intégrés par Mozilla (Bugzilla et
Phabricator), les plus prometteurs ont été essayés. Aucun n'est gardé :

| Essai | Mesure | Sans | Avec | Verdict |
|---|---|---|---|---|
| Rendu, bugs 1933414 + 1933417 | Speedometer 3 | 25,70 | 25,65 | Dans le bruit |
| | MotionMark 1.3.1 | 1 235,6 | 1 235,8 | |
| ShortAtomCache (bug 2052769, venu de Firefox 156) | Speedometer 3 | 25,85 | 25,85 | Dans le bruit |
| | MotionMark 1.3.1 | 1 238 | 1 242 | |
| Pref `gc_balanced_heap_limits` | Speedometer 3 | 25,9 | 25,9 | Pic mémoire +62 % |
| | Mémoire au repos (PSS) | 937 Mo | 897 Mo | |
| Canal jar hors du thread principal (bug 1456626) | Premier affichage, à chaud | 312 ms | 308 ms | Dans le bruit |

Lecture : les gains annoncés par Mozilla pour ces patchs (0,2 à 1,7 %) sont
plus petits que l'écart entre deux passes. Les autres candidats étaient
périmés (code réécrit depuis), déjà corrigés dans ESR 153, ou propres à
Firefox (Safe Browsing, interface).

## Démarrage

**Tests du 24 octobre 2026**, mêmes conditions, 20 lancements par côté
(`scripts/perf/startup.py`). Premier affichage depuis le lancement du
processus : **312 ms** à chaud, **environ 600 ms** à froid (cache disque
vidé). À froid, comparer des copies fraîches des deux builds : l'emplacement
des fichiers sur le disque suffit à faire varier le résultat d'environ 7 %.

## JavaScript et WebGL, avec un vrai GPU

**Tests du 26 et 27 octobre 2026**, sur Rycore (Ryzen 9 5900X, 32 Go,
Radeon RX 9070 XT, Mesa 26.2.4). Rendu sur le GPU via une session KWin hors
écran (`kwin_wayland --virtual`) : WebRender matériel, WebGL et Canvas2D
accélérés, bac à sable et Fission actifs. Builds PGO + LTO, 6 passes
alternées par essai, profil neuf à chaque passe, médianes.

Références de Core 153.5 :

| Mesure | Résultat |
|---|---|
| JetStream 3 (préversion) | 168,5 |
| Speedometer 3 | 26,9 |
| MotionMark 1.3.1 | 1 985 (1 235 sous Xvfb sans GPU) |
| WebGL Aquarium, 30 000 poissons | 55,6 i/s |
| three.js, 10 000 appels de dessin | 67,5 i/s |

Firefox ne règle aucune pref `javascript.*`, `webgl.*`, `gfx.*` ou `layers.*`
dans `firefox.js` : Core n'en perd donc aucune. Les valeurs par défaut de
Gecko sont déjà les meilleures (wasm à compilation paresseuse, AVX, marquage
du GC en parallèle, canvas accéléré ; mitigations Spectre levées seulement
pour le contenu isolé par Fission). Rien n'est gardé :

| Essai | Effet | Verdict |
|---|---|---|
| Nursery du GC à 128 Mo | JetStream −1,2 % | Rejeté |
| 4 fils de marquage du GC | JetStream +0,8 %, non significatif | Dans le bruit |
| Plus de fils d'aide au GC | +0,3 % | Dans le bruit |
| Processus GPU sous Wayland | Reste bloqué par Gecko : passe A/A, bruit ±0,6 % | Sans objet |
| Compositeur natif de WebRender forcé | MotionMark −9,6 % | Rejeté |
| Compilation x86-64-v2 (SSE4.2) | JetStream −0,7 % | Rejeté |
| Rust en opt-level 3 | Neutre | Rejeté |
| Compilation x86-64-v3 (AVX2), pour info | +0,7 %, casse les CPU sans AVX2 | Rejeté |

Le C et le C++ sont déjà compilés en `-O3` sous PGO. Deux builds PGO
identiques diffèrent déjà d'environ 0,7 % : c'est le seuil sous lequel une
option de compilation ne se distingue pas.

## GPU : Core face à Firefox ESR, préférences graphiques

**Tests du 27 octobre 2026**, mêmes conditions que ci-dessus (Rycore,
RX 9070 XT, KWin hors écran). Core main (Gecko 153.5.1, PGO + LTO) contre
Firefox ESR 153.5.1 officiel de Mozilla, 6 passes alternées. about:support
est identique dans les deux : WebRender matériel, WebGL sur le GPU, Canvas2D
accéléré, décodage VA-API (H.264, VP9, AV1, HEVC).

| Mesure | Core | Firefox ESR | Écart |
|---|---|---|---|
| Speedometer 3 | 27,1 | 26,9 | +0,9 %, bruit |
| MotionMark 1.3.1 | 1 999 | 1 990 | +0,5 %, bruit |
| Aquarium, 5 000 poissons | 287,5 i/s | 278,5 i/s | +3,1 % |
| Aquarium, 30 000 poissons | 55,1 i/s | 54,7 i/s | bruit |
| three.js, 10 000 appels de dessin | 67,5 i/s | 67,1 i/s | bruit |
| three.js, 100 000 instances | 163,5 i/s | 163,9 i/s | bruit |
| Vidéo AV1 4K60, CPU (`video.py`) | **8,8 %** | 14,1 % | −37 % |
| Vidéo H.264 4K60, CPU | **10,4 %** | 15,0 % | −31 % |

Même moteur, même débit ; la lecture vidéo coûte moins de CPU dans Core
(décodeur du GPU occupé à 35 % dans les deux, aucune image perdue), sans doute
parce qu'il fait tourner moins de choses autour. Sans VA-API
(`media.hardware-video-decoding.enabled=false`), la même vidéo AV1 prend
109 % de CPU : le décodage matériel est bien actif par défaut.

Préférences essayées sur Core (A = réglages de Gecko) :

| Essai | Effet | Verdict |
|---|---|---|
| **Tampon de commandes WebGL à 1 Mo** (`webgl.out-of-process.shmem-size`, 100 Ko dans Gecko) | Aquarium 5 000 **+12,8 %**, 30 000 **+5,4 %**, three.js 10 000 appels **+3,9 %**, 2 000 appels +2,9 % (p ≤ 0,016, confirmé sur une 2e série) | **Gardé (Linux)** |
| Même tampon à 400 Ko | Aquarium 30 000 +0,5 % seulement | 1 Mo vaut mieux |
| Même tampon à 4 Mo | Comme 1 Mo, un peu moins sur Aquarium 30 000 | 1 Mo suffit |
| Cache du Canvas2D accéléré à 512 Mo, tampon canvas à 128 Ko | MotionMark −1,2 %, bruit | Rejeté |
| `widget.dmabuf-feedback.enabled` | MotionMark +3,2 % (p = 0,39), Aquarium = | Bruit |
| Décodage vidéo par Vulkan | Retombe en décodage logiciel : CPU ×11 | Rejeté |
| Cache disque des shaders WebRender (`gfx.webrender.program-binary-disk`) | Premier affichage 386 ms contre 388 ms | Sans effet |

Avec ce réglage dans `core.js`, contre Firefox ESR (4 passes) : Aquarium
5 000 poissons **322,6 contre 278,2 i/s (+16 %)**, 30 000 poissons **59,2
contre 54,7 (+8 %)**, three.js 10 000 appels **70,0 contre 67,6 (+3,6 %)**.

Le tampon de commandes WebGL est rempli par la page puis envoyé au processus
de rendu ; plein, il part avant la fin de l'image. À 1 Mo, une page qui
dessine beaucoup l'envoie jusqu'à dix fois moins souvent. Le coût est d'au
plus 1 Mo par contexte WebGL actif. Pas encore mesuré sous Windows : la valeur
n'est réglée que sous Linux.

## Cache de bytecode JavaScript

**Tests du 27 octobre 2026**, mêmes conditions (Rycore, RX 9070 XT, build
PGO + LTO). Aucun moteur n'accélère une bibliothèque précise : React ou jQuery
sont minifiés et fondus dans les fichiers de chaque site, et le JIT les traite
comme n'importe quel JavaScript. Le levier est de ne pas recompiler les mêmes
scripts à chaque visite : Gecko enregistre le bytecode compilé dans le cache
disque, mais seulement au 4e chargement d'un script.

Six sites réels enregistrés et servis en local (react.dev, vuejs.org,
angular.dev, jQuery UI, un exemple three.js, mui.com ; 9,1 Mo de JavaScript),
un chargement puis cinq visites dans le même profil, 6 passes alternées.
Temps CPU des processus web, somme des six sites, écart au réglage de Gecko :

| `dom.script_loader.bytecode_cache.strategy` | 2e visite | 3e et 4e visites | 5e et après |
|---|---|---|---|
| 0 (Gecko : bytecode au 4e chargement) | référence | référence | référence |
| **1 (au 2e chargement, gardé)** | = | **−28 % / −25 %**, `load` −12 % | = |
| −1 (dès le 1er chargement) | −22 à −25 % | −22 à −25 % | = |

Gain net sur 5 sites sur 6 (Vue, 0,2 Mo de JS, ne bouge pas). Premier
chargement, mémoire et Speedometer 3 inchangés. Une fois écrit, le cache
occupe la même place quel que soit le réglage (45,5 Mo pour les six sites,
dont 28 Mo de bytecode). À −1, ce bytecode serait écrit aussi pour chaque
script vu une seule fois : Core garde 1.

Écartés : le cache des scripts en mémoire
(`dom.script_loader.experimental.navigation_cache`, « testing only »), −48 %
de CPU dans une session mais rien sur disque, d'où +24 % après un redémarrage
et un premier affichage retardé (Angular +75 %). La délazification et la
compilation hors du thread principal sont déjà au plus agressif dans Gecko.

## À mesurer

- Démarrage face à Firefox officiel, et Core empaqueté en omni.ja.
- Mémoire face à un Firefox ESR 153.5 compilé dans les mêmes conditions (même
  compilateur, mêmes options), pour isoler ce que gagne la coquille seule.
- Processus GPU sous Linux/X11 (bloqué sous Wayland).
- Windows et macOS sur du matériel réel.
