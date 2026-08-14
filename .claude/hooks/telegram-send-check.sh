#!/bin/bash
# tron kit — Telegram send check (PreToolUse hook, matcher: Bash).
# Contract it enforces: the fleet Telegram channel registry (canon home:
# tortuga/dead-mans-chest/reference/telegram-channels.md) + deterministic-fleet plan §1.5.
#
# Scope: only Bash commands touching the Telegram send surface — api.telegram.org
# calls and the fleet's send wrappers (telegram-send / tg-send). Everything else
# passes untouched.
#
# Rule: the chat ID in the command must equal a channel registered for this project,
# or the send is refused. A missing project registry is a refusal too — the group is
# confirmed with the operator once at project start and recorded; never guessed
# (registry rule 2).
#
# Project registry (untracked, written at project start / retrofit):
#   .claude/hooks/telegram-channels.local.json
#   { "bots": { "TRON":  { "chat_id_env": "TRON_TG_CHAT_ID" },
#               "ALFRED": { "chat_id": "-100123..." } } }
# Prefer `chat_id_env` (secrets by ENV NAME only — fleet convention); a literal
# `chat_id` is allowed ONLY because this file is untracked project-local config.
# Installed per project at retrofit — inert until wired into .claude/settings.json.

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  echo "telegram-send-check: jq not found — check skipped, send surface UNENFORCED this call. Install jq to arm this gate." >&2
  exit 0
fi

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0

printf '%s' "$cmd" | grep -qE 'api\.telegram\.org|telegram[-_]send|tg[-_]send' || exit 0

proj="${CLAUDE_PROJECT_DIR:-.}"
reg="$proj/.claude/hooks/telegram-channels.local.json"

if [ ! -f "$reg" ]; then
  echo "telegram-send-check: REFUSED — no project channel registry at .claude/hooks/telegram-channels.local.json. The chat is confirmed with the operator once at project start and recorded there (telegram-channels.md rule 2); never guess a chat ID. Ask the operator (ACT), write the registry, then retry." >&2
  exit 2
fi

allowed_literals=$(jq -r '[.bots // {} | .[] | .chat_id // empty] | .[]' "$reg" 2>/dev/null)
allowed_envs=$(jq -r '[.bots // {} | .[] | .chat_id_env // empty] | .[]' "$reg" 2>/dev/null)

# Candidate chat IDs in the command: chat_id=VALUE / -d chat_id=... / "chat_id": "..."
# / --chat_id "VALUE" (separator may be =, :, or whitespace).
candidates=$(printf '%s' "$cmd" \
  | grep -oE 'chat_id["'"'"' ]*[=:[:space:]]["'"'"' ]*[$]?\{?[-@A-Za-z0-9_]+\}?' \
  | sed -E 's/^chat_id["'"'"' ]*[=:[:space:]]["'"'"' ]*//; s/^\$\{?//; s/\}$//' \
  | sort -u)

if [ -z "$candidates" ]; then
  echo "telegram-send-check: REFUSED — Telegram send surface detected but no explicit chat_id found in the command. Sends must name their chat_id explicitly (literal or \$ENV_NAME) so it can be checked against the project registry." >&2
  exit 2
fi

bad=""
for c in $candidates; do
  # An env-style token ($VAR was stripped to VAR): allowed if VAR is a registered
  # chat_id_env name, or if its resolved value matches a registered literal.
  if printf '%s\n' "$allowed_envs" | grep -qxF -- "$c"; then
    continue
  fi
  if printf '%s\n' "$allowed_literals" | grep -qxF -- "$c"; then
    continue
  fi
  if printf '%s' "$c" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*$'; then
    resolved=$(eval "printf '%s' \"\${$c:-}\"" 2>/dev/null)
    if [ -n "$resolved" ] && printf '%s\n' "$allowed_literals" | grep -qxF -- "$resolved"; then
      continue
    fi
  fi
  bad="$bad $c"
done

if [ -n "$bad" ]; then
  echo "telegram-send-check: REFUSED — chat_id token(s)$bad not registered for this project (.claude/hooks/telegram-channels.local.json). One bot, one purpose: a send goes to exactly the registered channel (telegram-channels.md rules 1–2). If the channel is legitimate, register it with the operator's confirmation first." >&2
  exit 2
fi

exit 0
