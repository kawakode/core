#!/bin/bash
# Lance le core.exe instrumenté sous Wine pour le profilage PGO Windows
# (CORE_EXE est fixé par scripts/pgo/build-win64.sh). Les chemins Unix passés
# par mozrunner (-profile) sont convertis en chemins Windows.
args=()
for a in "$@"; do
  case "$a" in
    /*) args+=("$(winepath -w "$a")") ;;
    *) args+=("$a") ;;
  esac
done
exec wine "$CORE_EXE" "${args[@]}"
