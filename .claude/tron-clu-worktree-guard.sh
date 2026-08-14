#!/bin/bash
# tron-clu worktree guard (PreToolUse hook, matcher: Edit|Write|MultiEdit|NotebookEdit).
# Enforces "TRON never touches the project" (clu.md §Invariants) and the dispatch
# Term that workers write only inside their assigned worktree
# (skill-dispatch PMT §Terms; skill-pulse §Tick sweep).
#
# No-op unless a CLU run is active (.tron-clu-active in the project root).
#
# While a run is live, a write whose path is INSIDE the project root is denied
# unless it is:
#   · inside a worktree home — `.worktrees/` or `worktrees/`
#     (principles-base.md §14); or
#   · on the allow-list — TRON's own run state and install surface: the
#     `.tron-clu-*` sidecars (incl. `.tron-clu.env` and `.tron-clu-merge-grant`),
#     `.tron-active-block`, the block ledger dir (`{meta}/blocks/ledger/`, or
#     `ledger_dir` from .claude/hooks/gate-ledger.config.json), and `.claude/`
#     (settings merge + project-local hook copies at install).
# The project `.gitignore` is NOT allow-listed: it is tracked project source, and
# the grant-file ignore line is operator/engineer-routed guidance, never a CLU write.
# Paths outside the project root pass untouched.
#
# Session scoping is deliberately ABSENT — same reason as merge-guard.sh: a subagent
# inherits the PARENT session id (verified 2026-08-13), so scoping buys nothing here;
# the gate covers the project root while a run is live (plan Decision 1, unscoped
# branch; impact in install/README.md).
#
# Decision 3 — this covers the FILE TOOLS ONLY. Bash-mediated writes (`echo >`,
# `sed -i`, `cp`) are NOT covered and stay model-walked. Layered guardrail, not a
# security boundary; same trust level as the ledger. No tamper defense is claimed.

input=$(cat)

proj="${CLAUDE_PROJECT_DIR:-.}"
flag="$proj/.tron-clu-active"

[ -f "$flag" ] || exit 0

if ! command -v jq >/dev/null 2>&1; then
  echo "tron-clu worktree-guard: jq not found — gate skipped, project writes UNGATED this call. Install jq to arm this gate." >&2
  exit 0
fi

path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -n "$path" ] || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -n "$cwd" ] || cwd="$proj"

case "$path" in /*) : ;; *) path="$cwd/$path" ;; esac

# Normalize both sides without requiring the file to exist (no realpath dependency).
norm() { printf '%s' "$1" | sed -E 's#/\./#/#g; s#/+#/#g; s#/$##'; }
path=$(norm "$path")
root=$(norm "$(cd "$proj" 2>/dev/null && pwd)")
[ -n "$root" ] || exit 0

# Outside the project root → not ours to gate.
case "$path/" in "$root"/*) : ;; *) exit 0 ;; esac

rel=${path#"$root"/}

# (a) worktree homes
case "$rel" in
  .worktrees/*|worktrees/*|*/.worktrees/*|*/worktrees/*) exit 0 ;;
esac

# (b) allow-list: TRON's own run state and install surface
case "$rel" in
  .tron-clu-*|.tron-clu.env|.tron-active-block|.claude/*) exit 0 ;;
esac

ledger_dir=""
cfg="$root/.claude/hooks/gate-ledger.config.json"
[ -f "$cfg" ] && ledger_dir=$(jq -r '.ledger_dir // empty' "$cfg" 2>/dev/null)
case "$rel" in
  blocks/ledger/*|meta/blocks/ledger/*|*-meta/blocks/ledger/*) exit 0 ;;
esac
[ -n "$ledger_dir" ] && case "$rel" in "${ledger_dir%/}"/*) exit 0 ;; esac

echo "tron-clu worktree-guard: REFUSED — a CLU run is live and '$rel' is in the project checkout. TRON never touches the project: block work belongs in the assigned worktree (.worktrees/<branch>/...). Write there instead, or — if this is genuinely CLU run state — it belongs in a .tron-clu-* sidecar or the block ledger. Nothing else in this checkout is writable while the run flag stands." >&2
exit 2
