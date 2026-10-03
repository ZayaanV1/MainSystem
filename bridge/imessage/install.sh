#!/bin/sh
# Installs the iMessage bridge as a login item on this Mac.
#
#   bridge/imessage/install.sh <apple-id-the-bridge-answers-on> <bridge-key>
#
# The bridge key comes from the planner: Settings > iMessage > Make a bridge
# key. It ties this Mac to that one account — the bridge answers only phones
# linked to it and collects only its check-ins. Safe to re-run; with no key
# given it keeps the one already configured. Needs .env.setup for the project
# ref.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DIR="$HOME/.config/abood-bridge"
CONFIG="$DIR/config.json"
PLIST="$HOME/Library/LaunchAgents/com.planner.abood-bridge.plist"
LOG="$HOME/Library/Logs/abood-bridge.log"
NODE=$(node -e "process.stdout.write(require('fs').realpathSync(process.execPath))")
ADDRESS="${1:-}"
KEY="${2:-}"

set -a; . "$ROOT/.env.setup"; set +a
URL="https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/imessage"

mkdir -p "$DIR"
SECRET=""
if [ -f "$CONFIG" ]; then
  SECRET=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).secret||'')" "$CONFIG")
  [ -z "$ADDRESS" ] && ADDRESS=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).address||'')" "$CONFIG")
fi
[ -n "$KEY" ] && SECRET="$KEY"
if [ -z "$SECRET" ]; then
  echo "No bridge key. In the planner: Settings > iMessage > Make a bridge key, then run:"
  echo "  bridge/imessage/install.sh <apple-id> <bridge-key>"
  exit 1
fi

node -e 'const [p,u,s,a]=process.argv.slice(1); require("fs").writeFileSync(p, JSON.stringify({url:u,secret:s,address:a||null},null,2))' "$CONFIG" "$URL" "$SECRET" "$ADDRESS"
chmod 600 "$CONFIG"

echo "✓ bridge key saved for this Mac"

mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.planner.abood-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ROOT/bridge/imessage/bridge.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PL

launchctl bootout "gui/$(id -u)/com.planner.abood-bridge" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ bridge running (log: $LOG)"
echo
echo "Still needed, and only you can do it:"
echo "  1. System Settings > Privacy & Security > Full Disk Access: add"
echo "     $NODE"
echo "  2. Messages on this Mac signed in to the Apple ID Abood should answer on."
[ -z "$ADDRESS" ] && echo "  3. Re-run this script with that Apple ID:  bridge/imessage/install.sh abood@example.com"
