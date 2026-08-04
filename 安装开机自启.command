#!/bin/zsh
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$APP_DIR/data/app.log"
mkdir -p "$APP_DIR/data"
PLIST="$HOME/Library/LaunchAgents/com.zhaohui.bidhunter.plist"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.zhaohui.bidhunter</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/linjunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node</string>
    <string>$APP_DIR/server/index.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$LOG_FILE</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST"
echo "已安装开机自启：http://localhost:8710"
