#!/bin/bash
# tron kit — persona anchor injector (SessionStart hook, matcher: compact).
# Contract: principles-base.md §17 (persona persistence) + deterministic-fleet plan §1.7.
#
# After every compaction this hook re-injects the persona anchor(s) for the agents
# working this project, so identity, hard rules, and the active mandate survive
# context loss. stdout is added to the session context by the SessionStart hook.
#
# Anchor homes searched (defaults; override via config):
#   - project meta repo:      {project}/*-meta/agents/*-anchor.md
#   - canon-repo layout:      {project}/agents/*-anchor.md
#   - harness memory (cross-project agents / TRON modes), one per (agent, project):
#     ~/.claude/projects/{project-dir-slug}/memory/*-anchor.md
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
  slug=$(printf '%s' "$proj" | sed 's|[/.]|-|g')
  globs=("$proj"/*-meta/agents/*-anchor.md
         "$proj"/agents/*-anchor.md
         "$HOME/.claude/projects/$slug/memory/"*-anchor.md)
fi

anchors=()
for g in "${globs[@]}"; do
  for f in $g; do
    [ -f "$f" ] && anchors+=("$f")
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
