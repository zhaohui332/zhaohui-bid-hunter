#!/bin/zsh
PLIST="$HOME/Library/LaunchAgents/com.zhaohui.bidhunter.plist"
launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"
echo "已停止开机自启"
