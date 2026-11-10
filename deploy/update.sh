#!/usr/bin/env bash
# Atualização automática: corre de 5 em 5 minutos (basecom-update.timer).
# Só instala quando o ramo "production" do GitHub muda.
set -euo pipefail
cd /opt/basecom/app
git fetch --quiet origin production
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/production)" ]; then
  echo "Nova versão: $(git rev-parse --short origin/production)"
  git reset --quiet --hard origin/production
  docker compose -f deploy/docker-compose.prod.yml up -d --build --remove-orphans
  docker image prune -f >/dev/null
fi
