# Sources tierces ajoutées à Gecko

`scripts/bootstrap.sh` copie ce dossier dans l'arbre de Gecko avant d'appliquer
`patches/`. Les fichiers sont repris sans modification de leur projet d'origine.

## `ffvpx/` : décodeur H.265/HEVC de FFmpeg

- Origine : FFmpeg, révision `9917308cc209a885c6870f0345905104c6ea8799`, la même
  que le ffvpx de Gecko (voir `media/ffvpx/README_MOZILLA` dans Gecko).
- Licence : LGPL 2.1 ou ultérieure, comme le reste de ffvpx.
- Contenu : `libavcodec/hevc/`, l'analyse H.264/H.265 commune (`h2645_*`,
  `cabac`, `h274`…), l'assembleur x86 et NEON (aarch64), l'accélération VA-API
  (`vaapi_hevc.c`) et les quelques fichiers de `libavutil` qu'ils utilisent.
- Seul fichier écrit pour Core : `libavcodec/hevc/moz.build`.
- L'activation (configuration, liste des codecs, liens avec Gecko) est dans
  `patches/0004-hevc-ffvpx-core.patch`.
- Dolby Vision n'est pas inclus : Gecko remplace `dovi_rpu.h` par des fonctions
  vides, et le correctif en ajoute deux.

Pour passer à une autre révision de FFmpeg (montée d'ESR), recopier les mêmes
chemins depuis la révision indiquée dans `README_MOZILLA` du nouveau Gecko.

## `mozva/` : en-tête VA-API HEVC

- `va/va_dec_hevc.h` de libva 2.13.0 (VA-API 1.13, la version de `media/mozva`).
- Licence : MIT (Intel).
