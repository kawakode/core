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

## À mesurer

- Temps de démarrage à froid et à chaud.
- Mémoire face à un Firefox ESR 153.5 compilé dans les mêmes conditions (même
  compilateur, mêmes options), pour isoler ce que gagne la coquille seule.
- MotionMark avec un vrai GPU.
- Windows et macOS sur du matériel réel.
