#!/usr/bin/env bash
# Deploy Pickle Pop lên một server Linux bằng rsync + PM2 (không cần Docker / sudo).
# Dùng: DEPLOY_HOST=<tên-host-trong-~/.ssh/config> ./deploy/deploy-pm2.sh
#   Biến tùy chọn: DEPLOY_DIR (mặc định apps/pickle-pop), cổng/cấu hình xem deploy/ecosystem.config.js
set -euo pipefail
HOST="${DEPLOY_HOST:?Hãy đặt DEPLOY_HOST=<tên host SSH>, ví dụ DEPLOY_HOST=my-server ./deploy/deploy-pm2.sh}"
DIR="${DEPLOY_DIR:-apps/pickle-pop}"
cd "$(dirname "$0")/.."
echo "→ Đồng bộ code lên $HOST:~/$DIR"
ssh "$HOST" "mkdir -p ~/$DIR"
rsync -az --delete \
  --exclude node_modules --exclude 'server/data' --exclude .git --exclude .env \
  --exclude docker-compose.override.yml --exclude .DS_Store \
  ./ "$HOST:$DIR/"
echo "→ Cài thư viện và khởi động lại bằng PM2"
ssh "$HOST" "set -e; cd ~/$DIR/server && npm ci --omit=dev --no-audit --no-fund --loglevel=error
  cd ~/$DIR
  if pm2 describe pickle-pop >/dev/null 2>&1; then pm2 reload deploy/ecosystem.config.js --update-env; else pm2 start deploy/ecosystem.config.js; fi
  pm2 save >/dev/null
  sleep 2
  curl -fsS http://127.0.0.1:8095/healthz && echo"
echo "✓ Xong. Kiểm tra: ssh $HOST 'pm2 logs pickle-pop --lines 50'"
