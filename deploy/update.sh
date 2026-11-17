#!/usr/bin/env bash
# Atualização automática: corre de 5 em 5 minutos (basecom-update.timer).
# Só instala quando o ramo "production" do GitHub muda e fora do horário de trabalho
# (seg–sex 08h45–19h35, sáb 08h45–13h00, hora de Lisboa).
# Exceção para urgências: a versão cuja mensagem contém "[agora]" instala logo.
set -euo pipefail
cd /opt/basecom/app

# App Android publicada (ramo android-releases): copia-a para /opt/basecom/files/android, servida em /android/.
# Os telemóveis veem o aviso «Nova versão» e instalam com um toque.
if git fetch --quiet origin android-releases 2>/dev/null; then
  mkdir -p /opt/basecom/files/android
  if ! cmp -s <(git show origin/android-releases:version.json) /opt/basecom/files/android/version.json 2>/dev/null; then
    git show origin/android-releases:BASECOM.apk > /opt/basecom/files/android/BASECOM.apk.new
    mv /opt/basecom/files/android/BASECOM.apk.new /opt/basecom/files/android/BASECOM.apk
    git show origin/android-releases:version.json > /opt/basecom/files/android/version.json
    echo "App Android atualizada: $(cat /opt/basecom/files/android/version.json)"
  fi
fi

git fetch --quiet origin production
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/production)" ] && exit 0

if ! git log -1 --format=%s origin/production | grep -qF "[agora]"; then
  dow=$(TZ=Europe/Lisbon date +%u); hm=$((10#$(TZ=Europe/Lisbon date +%H%M)))
  if { [ "$dow" -le 5 ] && [ "$hm" -ge 845 ] && [ "$hm" -lt 1935 ]; } || \
     { [ "$dow" -eq 6 ] && [ "$hm" -ge 845 ] && [ "$hm" -lt 1300 ]; }; then
    exit 0
  fi
fi

echo "Nova versão: $(git rev-parse --short origin/production)"
git reset --quiet --hard origin/production
docker compose -f deploy/docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f >/dev/null
