#!/bin/bash
# tron kit — Linear card-write linter (PreToolUse hook, matcher: mcp__linear__save_issue).
# Contract it enforces: {meta}/skills/skill-linear-cards.md (canon home:
# tortuga/dead-mans-chest/skills/skill-linear-cards.md) + deterministic-fleet plan §1.4.
#
# Blocks a save_issue call when:
#   - `state` is outside the agent vocabulary (all other states are operator-only),
#   - `assignee` is present and is not the fleet default,
#   - a CREATE call (no `id`) is missing the universal label, the owner line, or the
#     signature history in its description.
# On close/update calls the current card body is not readable here, so description
# checks apply only when the call carries a `description` — the skill still binds.
#
# Config (optional): .claude/hooks/linear-lint.config.json
#   { "allowed_states": ["..."], "assignee": "ops@42labs.io" }
# Defaults below are the fleet contract. Installed per project at retrofit — inert
# until wired into .claude/settings.json.

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  echo "linear-card-lint: jq not found — linter skipped, card contract UNENFORCED this call. Install jq to arm this gate." >&2
  exit 0
fi

proj="${CLAUDE_PROJECT_DIR:-.}"
cfg="$proj/.claude/hooks/linear-lint.config.json"

allowed_states='["Backlog","On the Horizon","Minions Deployed","Done","Canceled","Duplicate"]'
assignee_expected="ops@42labs.io"
if [ -f "$cfg" ]; then
  s=$(jq -c '.allowed_states // empty' "$cfg" 2>/dev/null); [ -n "$s" ] && allowed_states="$s"
  a=$(jq -r '.assignee // empty' "$cfg" 2>/dev/null); [ -n "$a" ] && assignee_expected="$a"
fi

ti=$(printf '%s' "$input" | jq '.tool_input // {}')
state=$(printf '%s' "$ti" | jq -r '.state // .status // empty')
assignee=$(printf '%s' "$ti" | jq -r '.assignee // empty')
card_id=$(printf '%s' "$ti" | jq -r '.id // empty')
desc=$(printf '%s' "$ti" | jq -r '.description // empty')

fail=0
say() { echo "linear-card-lint: $1" >&2; fail=1; }

# 1. State vocabulary — case-exact against the agent allow-list.
if [ -n "$state" ]; then
  ok=$(printf '%s' "$allowed_states" | jq --arg s "$state" 'index($s) != null')
  [ "$ok" = "true" ] || say "state '$state' is not in the agent vocabulary $(printf '%s' "$allowed_states" | jq -c .). All other states are operator-only (skill-linear-cards §2c). A walled card keeps its state; surface the wall via ACT/FLAG."
fi

# 2. Assignee — fleet default, exact. Rejection upstream escalates, never retries blind.
if [ -n "$assignee" ] && [ "$assignee" != "$assignee_expected" ]; then
  say "assignee '$assignee' is not the fleet default '$assignee_expected' (skill-linear-cards §8). Custody is expressed by the owner line + signature, not the assignee."
fi

# 3. Create-call format — description opens with the owner line, ends with a signature,
#    labels carry the universal marker (skill-linear-cards §4/§6).
if [ -z "$card_id" ]; then
  if [ -z "$desc" ]; then
    say "create call has no description — the card must open with the owner line ('> **Owner:** ...') and end with the signature history (skill-linear-cards §6)."
  else
    printf '%s\n' "$desc" | head -1 | grep -q '^> \*\*Owner:\*\*' \
      || say "description does not OPEN with the owner line '> **Owner:** <AGENT_ROLE> · Session ...' (skill-linear-cards §6a)."
    printf '%s\n' "$desc" | grep -q '^🤖 _' \
      || say "description has no signature history line ('🤖 _<AGENT_ROLE> · ... — created_') (skill-linear-cards §6b)."
  fi
  labels_joined=$(printf '%s' "$ti" | jq -r '(.labels // []) | join("|")')
  case "$labels_joined" in
    *"🤖 beep-boop"*) : ;;
    *) say "create call labels are missing the universal marker '🤖 beep-boop' (skill-linear-cards §4 tier 1; labels is a full replace — send universal + persona + project labels together)." ;;
  esac
elif [ -n "$desc" ]; then
  printf '%s\n' "$desc" | head -1 | grep -q '^> \*\*Owner:\*\*' \
    || say "description rewrite dropped the opening owner line (skill-linear-cards §6a — exactly one, first line)."
  printf '%s\n' "$desc" | grep -q '^🤖 _' \
    || say "description rewrite has no signature history (skill-linear-cards §6b — append-only, never removed)."
fi

[ "$fail" -eq 1 ] && exit 2
exit 0
