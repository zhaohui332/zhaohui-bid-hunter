#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

ALIYUN_SERVER="${ALIYUN_SERVER:-}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/zhaohui_aliyun}"
if [ -z "$ALIYUN_SERVER" ]; then
  read -r -p "请输入阿里云服务器地址，例如 root@1.2.3.4: " ALIYUN_SERVER
fi
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=accept-new"

REMOTE_DIR="/opt/zhaohui-bid-hunter"

echo "同步代码到 $ALIYUN_SERVER:$REMOTE_DIR"
rsync -av --delete \
  -e "ssh $SSH_OPTS" \
  --exclude node_modules \
  --exclude data \
  --exclude .git \
  --exclude work \
  ./ "$ALIYUN_SERVER:$REMOTE_DIR/"

ssh $SSH_OPTS "$ALIYUN_SERVER" "mkdir -p '$REMOTE_DIR/data'"
if [ -d data ]; then
  rsync -av --exclude='browser-*' --include='*/' --include='storage-*.json' --exclude='*' \
    -e "ssh $SSH_OPTS" \
    data/ "$ALIYUN_SERVER:$REMOTE_DIR/data/"
  ssh $SSH_OPTS "$ALIYUN_SERVER" "chmod 600 '$REMOTE_DIR'/data/storage-*.json 2>/dev/null || true"
  ssh $SSH_OPTS "$ALIYUN_SERVER" "rm -rf '$REMOTE_DIR'/data/browser-*"
fi

ssh $SSH_OPTS "$ALIYUN_SERVER" "cd '$REMOTE_DIR' && \
  mkdir -p data && \
  (command -v node || (apt-get update -y >/dev/null 2>&1 || true; (command -v curl || apt-get install -y curl >/dev/null 2>&1); curl -fsSL https://deb.nodesource.com/setup_24.x | bash -; apt-get install -y nodejs)) && \
  npm install --omit=dev && \
  (PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright npx playwright install chromium-headless-shell || true)"

ssh $SSH_OPTS "$ALIYUN_SERVER" "cat > /etc/systemd/system/zhaohui-bid-hunter.service <<'EOF'
[Unit]
Description=Zhaohui Bid Hunter
After=network.target

[Service]
WorkingDirectory=$REMOTE_DIR
ExecStart=/usr/bin/node $REMOTE_DIR/server/index.js
Restart=always
Environment=PORT=8710

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable zhaohui-bid-hunter
systemctl restart zhaohui-bid-hunter"

PUBLIC_HOST="${ALIYUN_SERVER#*@}"
echo "已部署到 http://$PUBLIC_HOST/zhbid/ （Nginx 反向代理）"
