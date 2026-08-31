#!/bin/bash
# tron kit — persona anchor injector (SessionStart hook, matcher: compact).
# Contract: principles-base.md §17 (persona persistence) + deterministic-fleet plan §1.7.
#
# After every compaction this hook re-injects the persona anchor(s) for the agents
# working this project, so identity, hard rules, and the active mandate survive
# context loss. stdout is added to the session context by the SessionStart hook.
#
# Anchor home (principles-base §17): ~/.agent-anchors/{project}/{persona}.md — host-neutral,
# untracked, outside every repo. No anchor lives in a repo, and none lives under a host runtime's
# own directory. A project migrating off the old homes keeps them by listing them in the config
# below until its migration commit lands.
#
# Config (optional): .claude/hooks/persona-anchors.config.json
#   { "paths": ["glob", ...] }   — replaces the default glob set (project-relative
#                                  or absolute; ~ expands).
# Installed per project at retrofit — inert until wired into .claude/settings.json.
# No anchors found → silent no-op.

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
cfg="$proj/.claude/hooks/persona-anchors.config.json"

globs=()
if [ -f "$cfg" ] && command -v jq >/dev/null 2>&1; then
  while IFS= read -r g; do
    [ -n "$g" ] || continue
    case "$g" in
      "~/"*) globs+=("$HOME/${g#\~/}") ;;
      /*)    globs+=("$g") ;;
      *)     globs+=("$proj/$g") ;;
    esac
  done < <(jq -r '.paths // [] | .[]' "$cfg" 2>/dev/null)
fi

if [ ${#globs[@]} -eq 0 ]; then
  # Anchors are keyed by the workspace directory name. A session's project dir is often
  # deeper than that — a repo inside a multi-repo workspace ({workspace}/{repo}) or an added
  # worktree ({workspace}/worktrees/{repo}--{branch}) — so walk up to the first ancestor that
  # has an anchor directory. No ancestor has one → no anchors → silent no-op, as before.
  d="$proj"
  while [ "$d" != "/" ] && [ "$d" != "$HOME" ]; do
    [ -d "$HOME/.agent-anchors/$(basename "$d")" ] && break
    d="$(dirname "$d")"
  done
  globs=("$HOME/.agent-anchors/$(basename "$d")/"*.md)
fi

anchors=()
seen=""
for g in "${globs[@]}"; do
  for f in $g; do
    [ -f "$f" ] || continue
    # Config globs may overlap, and a migrating project may still point at a symlink — resolve
    # the link itself before collecting, or the same anchor is injected twice.
    r="$f"
    while [ -L "$r" ]; do
      l="$(readlink "$r")"
      case "$l" in /*) r="$l" ;; *) r="$(dirname "$r")/$l" ;; esac
    done
    r="$(cd "$(dirname "$r")" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "$(basename "$r")")"
    case " $seen " in *" $r "*) continue ;; esac
    seen="$seen $r"
    anchors+=("$f")
  done
done

[ ${#anchors[@]} -eq 0 ] && exit 0

echo "<!-- persona-anchor-inject: post-compaction re-injection (kit hook, principles-base §17) -->"
echo "# Persona anchors — re-read after compaction"
echo
echo "Context was just compacted. The anchor(s) below restore identity, hard rules, and the active mandate. Re-read each anchor's named source docs before resuming work."
echo
for f in "${anchors[@]}"; do
  echo "---"
  echo "<!-- anchor: $f -->"
  cat "$f"
  echo
done

exit 0
