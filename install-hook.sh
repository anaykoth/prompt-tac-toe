#!/usr/bin/env bash
# Installs the prompt-tac-toe Claude Code hook: every prompt you submit pings
# the game API and banks a move credit. Usage: ./install-hook.sh <your-player-token>
set -euo pipefail

TOKEN="${1:?usage: install-hook.sh <player-token>}"
APP_URL="https://prompt-tac-toe.vercel.app"
SETTINGS="$HOME/.claude/settings.json"

mkdir -p "$HOME/.claude"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

python3 - "$SETTINGS" "$APP_URL" "$TOKEN" <<'PY'
import json, sys

path, url, token = sys.argv[1:4]
with open(path) as f:
    cfg = json.load(f)

cmd = (
    "curl -s -m 3 -X POST " + url + "/api/prompt "
    "-H 'Content-Type: application/json' "
    "-d '{\"token\":\"" + token + "\"}' >/dev/null 2>&1"
)
hook = {"type": "command", "command": cmd, "async": True, "timeout": 10}

entries = cfg.setdefault("hooks", {}).setdefault("UserPromptSubmit", [])
for entry in entries:
    for i, h in enumerate(entry.get("hooks", [])):
        if "prompt-tac-toe" in h.get("command", ""):
            entry["hooks"][i] = hook
            break
    else:
        continue
    break
else:
    entries.append({"hooks": [hook]})

with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
print("prompt-tac-toe hook installed in " + path)
print("It takes effect in NEW Claude Code sessions (restart any open ones).")
PY
