#!/bin/bash
# tron kit — gate-ledger gate (PreToolUse hook, matcher: Bash).
# gate-ledger-gate-version: 2026-08-13.1
# Contract it enforces: {meta}/skills/skill-gate-ledger.md (canon home:
# tortuga/dead-mans-chest/skills/skill-gate-ledger.md) + deterministic-fleet plan §1.8.
#
# No record, no advance: a stage-advancing command may run only when every prior
# stage of the active block has a ledger record (`## {stage} — DONE` or the
# block-start `## {stage} — n/a` declaration).
#
# Activation is explicit: the supervising process writes block entries to
# .tron-active-block (project root), ONE PER LINE:
#   <id>          — active: the block's gates are up
#   <id> closed   — closed-marked: the block's evidence landed, its gates are down
# No active-block file, or a file with zero active entries → no supervised block in
# flight → this hook passes everything (supervisors still self-enforce the ledger as
# canon text).
#
# Block resolution is fail-closed and never branch-derived:
#   1. an explicit `TRON_BLOCK=<id>` token in the command wins — an active entry
#      governs; a closed-marked entry is ungated; an id in no entry is REFUSED
#      (a mistyped id must never silently disarm the gate);
#   2. else a single active entry governs every guarded command;
#   3. else (two or more active entries, no token) the command is REFUSED with the
#      token form named — never passed unresolved.
#
# Guarded surfaces (defaults; override via config):
#   pr     — `gh pr create`                     → requires build..validation recorded
#            CONFIG-GATED, DEFAULT OFF: inert unless `pr_pattern` is set.
#   merge  — `git merge`, `gh pr merge`         → requires build..ci recorded
#   deploy — `vercel ... --prod`, deploy runs   → requires build..merge recorded
#
# Config (optional): .claude/hooks/gate-ledger.config.json
#   { "ledger_dir": "myproj-meta/blocks/ledger",
#     "active_block_file": ".tron-active-block",
#     "pr_pattern": "...", "merge_pattern": "...", "deploy_pattern": "..." }
# Installed per project at retrofit — inert until wired into .claude/settings.json.

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  echo "gate-ledger-gate: jq not found — gate skipped, ledger UNENFORCED this call. Install jq to arm this gate." >&2
  exit 0
fi

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0

proj="${CLAUDE_PROJECT_DIR:-.}"
cfg="$proj/.claude/hooks/gate-ledger.config.json"

active_file="$proj/.tron-active-block"
ledger_dir=""
pr_pattern=''
merge_pattern='(^|[;&|[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+merge|gh[[:space:]]+pr[[:space:]]+merge'
deploy_pattern='vercel[[:space:]][^;|&]*--prod|gh[[:space:]]+workflow[[:space:]]+run[[:space:]][^;|&]*deploy'
if [ -f "$cfg" ]; then
  v=$(jq -r '.active_block_file // empty' "$cfg" 2>/dev/null); [ -n "$v" ] && active_file="$proj/$v"
  v=$(jq -r '.ledger_dir // empty' "$cfg" 2>/dev/null);        [ -n "$v" ] && ledger_dir="$proj/$v"
  v=$(jq -r '.pr_pattern // empty' "$cfg" 2>/dev/null);        [ -n "$v" ] && pr_pattern="$v"
  v=$(jq -r '.merge_pattern // empty' "$cfg" 2>/dev/null);     [ -n "$v" ] && merge_pattern="$v"
  v=$(jq -r '.deploy_pattern // empty' "$cfg" 2>/dev/null);    [ -n "$v" ] && deploy_pattern="$v"
fi

[ -f "$active_file" ] || exit 0

stage=""
[ -n "$pr_pattern" ] && printf '%s' "$cmd" | grep -qE "$pr_pattern" && stage="pr"
printf '%s' "$cmd" | grep -qE "$merge_pattern"  && stage="merge"
printf '%s' "$cmd" | grep -qE "$deploy_pattern" && stage="deploy-verify"
[ -n "$stage" ] || exit 0

# Parse the active-block file: one entry per line, `<id>` or `<id> closed`.
# Any marker that is not exactly `closed` counts as ACTIVE — fail-closed.
active_ids=""; closed_ids=""; all_ids=""
while IFS= read -r line || [ -n "$line" ]; do
  # shellcheck disable=SC2086
  set -- $line
  [ -n "$1" ] || continue
  all_ids="$all_ids $1"
  if [ "$2" = "closed" ]; then closed_ids="$closed_ids $1"; else active_ids="$active_ids $1"; fi
done < "$active_file"

in_list() { case " $2 " in *" $1 "*) return 0 ;; esac; return 1; }

token=$(printf '%s' "$cmd" | grep -oE 'TRON_BLOCK=[^[:space:];&|"'"'"']+' | head -1 | sed 's/^TRON_BLOCK=//')

block_id=""
if [ -n "$token" ]; then
  if in_list "$token" "$active_ids"; then
    block_id="$token"
  elif in_list "$token" "$closed_ids"; then
    exit 0   # closed-marked: the block's evidence landed, its gates are down
  else
    echo "gate-ledger-gate: REFUSED — TRON_BLOCK=$token names no entry in $active_file (entries:$all_ids). A mistyped block id never disarms the gate: use the exact id of an active entry, or drop the token where a single active entry governs." >&2
    exit 2
  fi
else
  set -- $active_ids
  case $# in
    0) exit 0 ;;                     # zero active entries → no active block → pass
    1) block_id="$1" ;;
    *) echo "gate-ledger-gate: REFUSED — $active_file holds $# active blocks ($active_ids) and the command names none. Prefix the command with 'TRON_BLOCK=<id> ' to say which block this $stage action advances." >&2
       exit 2 ;;
  esac
fi

# Locate the ledger: configured dir first, then the kit's standard homes.
ledger=""
for d in "$ledger_dir" "$proj"/*-meta/blocks/ledger "$proj/blocks/ledger" "$proj/meta/blocks/ledger"; do
  [ -n "$d" ] && [ -f "$d/$block_id.ledger.md" ] && { ledger="$d/$block_id.ledger.md"; break; }
done
if [ -z "$ledger" ]; then
  echo "gate-ledger-gate: REFUSED — active block '$block_id' has no ledger file ({meta}/blocks/ledger/$block_id.ledger.md). No record, no advance (skill-gate-ledger.md): create the ledger and record the completed stages before a $stage action." >&2
  exit 2
fi

case "$stage" in
  pr)            required="build challenge validation" ;;
  merge)         required="build challenge validation review ci" ;;
  deploy-verify) required="build challenge validation review ci merge" ;;
esac

missing=""
for s in $required; do
  grep -qE "^## $s — (DONE|n/a)" "$ledger" || missing="$missing $s"
done

if [ -n "$missing" ]; then
  echo "gate-ledger-gate: REFUSED — block '$block_id' is missing ledger record(s) for:$missing (ledger: $ledger). No record, no advance (skill-gate-ledger.md): append '## {stage} — DONE' with when/by/evidence for each completed stage (or the block-start '## {stage} — n/a' declaration), then retry. Skipping a stage is a defect regardless of whether the work 'was actually done'." >&2
  exit 2
fi

exit 0
