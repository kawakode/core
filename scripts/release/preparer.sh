#!/bin/bash
# Prépare la machine d'un job de release (.github/workflows/release.yml) :
# dossier de travail et, sur les runners de GitHub, place disque, swap et
# paquets système.
#   scripts/release/preparer.sh linux|win64 true|false(pgo)
set -euo pipefail
cible=$1
pgo=$2

if [ "${RUNNER_ENVIRONMENT:-}" != github-hosted ]; then
  # Runner auto-hébergé : mach bootstrap, Xvfb, msitools et wine y sont déjà
  # installés. RUNNER_TEMP est vidé à chaque job, donc chaque release part
  # d'un Gecko propre.
  echo "GECKO_DIR=$RUNNER_TEMP/gecko" >> "$GITHUB_ENV"
  exit 0
fi

# Environ 14 Go libres sur / : on retire les SDK préinstallés dont le build
# n'a pas l'usage.
sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /usr/local/.ghcup \
  /opt/hostedtoolcache/CodeQL /usr/share/swift /usr/local/share/powershell
sudo docker image prune --all --force > /dev/null 2>&1 || true

# Le disque temporaire /mnt, quand il existe, a souvent plus de place que /.
base=
if mountpoint -q /mnt &&
   [ "$(df --output=avail -k /mnt | tail -1)" -gt "$(df --output=avail -k / | tail -1)" ]; then
  base=/mnt
fi
work=$base/core-build
sudo mkdir -p "$work"
sudo chown "$USER" "$work"
# Toolchains de mach bootstrap (clang, SDK Windows…) : plusieurs Go.
mkdir -p "$work/mozbuild"
[ -e "$HOME/.mozbuild" ] || ln -s "$work/mozbuild" "$HOME/.mozbuild"
echo "GECKO_DIR=$work/gecko" >> "$GITHUB_ENV"

# 16 Go de RAM ne suffisent pas toujours à l'édition de liens LTO de libxul
# quand rustc tourne en parallèle.
sudo swapoff -a || true
sudo rm -f "$base/swapfile"
sudo fallocate -l 16G "$base/swapfile"
sudo chmod 600 "$base/swapfile"
sudo mkswap "$base/swapfile" > /dev/null
sudo swapon "$base/swapfile"

paquets=()
# Le Wine de ~/.mozbuild, qui lance midl.exe pendant le build Windows, est
# en 32 bits : il lui faut le chargeur i386 (/lib/ld-linux.so.2).
if [ "$cible" = win64 ]; then
  sudo dpkg --add-architecture i386
  paquets+=(msitools libc6:i386)
fi
[ "$pgo" = true ] && paquets+=(xvfb)
[ "$cible" = win64 ] && [ "$pgo" = true ] && paquets+=(wine)
if [ ${#paquets[@]} -gt 0 ]; then
  sudo apt-get update -q
  sudo apt-get install --yes --no-install-recommends "${paquets[@]}"
fi

df -h / "$work"
free -h
