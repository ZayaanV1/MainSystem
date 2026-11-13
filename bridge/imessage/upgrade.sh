#!/bin/sh
# Updates a bridge that runs under its own macOS user (the one signed into
# Abood's Apple ID) to the current bridge.mjs, answering with Claude.
#
#   Run AS that user:  sh /Users/<owner>/dev/life-planner/bridge/imessage/upgrade.sh
#
# Asks for the token from `claude setup-token` without echoing it, so it never
# lands in shell history or gets split across lines by a paste.
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
OWNER_HOME=$(cd "$SRC/../../../.." && pwd)
DEST="$HOME/abood-bridge"
CONFIG="$HOME/.config/abood-bridge/config.json"

[ -f "$CONFIG" ] || { echo "No bridge config at $CONFIG. Run this as the user whose bridge it is."; exit 1; }

printf 'Paste the Claude token (from claude setup-token), then Return: '
stty -echo; read -r TOKEN; stty echo; echo
case "$TOKEN" in sk-ant-*) ;; *) echo "That does not look like a Claude token (sk-ant-...)."; exit 1 ;; esac

mkdir -p "$DEST"
cp "$SRC/bridge.mjs" "$DEST/bridge.mjs"
node -e 'const fs=require("fs");const [p,t,b]=process.argv.slice(1);const c=JSON.parse(fs.readFileSync(p,"utf8"));c.claude={token:t,model:"sonnet",bin:b};fs.writeFileSync(p,JSON.stringify(c,null,2),{mode:0o600})' \
  "$CONFIG" "$TOKEN" "$OWNER_HOME/.local/bin/claude"

# Restart whatever runs it: its LaunchAgent if it has one, otherwise the process.
LABEL=$(launchctl list | awk '/abood/ {print $3; exit}')
if [ -n "$LABEL" ]; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
else
  pkill -f "$DEST/bridge.mjs" || true
  nohup node "$DEST/bridge.mjs" >>"$HOME/Library/Logs/abood-bridge.log" 2>&1 &
fi
sleep 3
echo "Bridge updated and restarted (Claude, sonnet). Text Abood to try it."
