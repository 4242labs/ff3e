#!/bin/bash
# tron kit — Dangerous command gate (PreToolUse hook, matcher: Bash).
# Contract it enforces: canon `principles-base.md §19` permission floor.
#
# Why this exists as a hook and not only as a `permissions.deny` list:
#
#   1. `deny` entries are matched as LITERAL PREFIXES. `Bash(git reset --hard:*)` never sees
#      `git -C <path> reset --hard`, and `Bash(git clean -fdx:*)` never sees `git clean -xdf`.
#      Both walk-arounds were reproduced against the 1.9.0 block (KONDO, 2026-08-14).
#   2. `deny` is skipped entirely in bypass-permissions mode. Hooks are not permissions — they run
#      in every mode — so the floor holds without taking the operator's bypass away from them.
#
# The declarative `deny` block stays in settings.json beside this: it is readable in the repo and it
# stops the direct form even where this hook is missing. This gate is the layer that holds.
#
# What it refuses (after normalising the command, so `git -C P`, `--git-dir=`, `-c k=v`, env
# prefixes and reordered short flags are all seen for what they are):
#   - force push in any spelling, including --force-with-lease and --mirror
#   - git reset --hard, git clean -f, git filter-branch / filter-repo
#   - --no-verify (and `git commit -n`), which walks past the canon commit gates
#   - gh pr merge --auto  (canon: auto-merge is never armed — the operator clicks)
#   - gh repo delete, rm -rf /
#   - reading a real .env through Bash (`cat`/`less`/`grep`/… ), which the Read deny cannot see
#
# Limits, stated honestly: it matches the command TEXT. Indirection defeats it
# (`g=reset; git $g --hard`, a wrapper script, `eval "$(printf …)"`). It is a floor, not a sandbox.

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  echo "dangerous-command-gate: jq not found — check skipped, destructive-command floor UNENFORCED this call. Install jq to arm this gate." >&2
  exit 0
fi

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0

# --- normalise -------------------------------------------------------------------------------
# Split compound commands so each segment is judged on its own, then strip the wrappers that make
# an identical operation look different: leading env assignments, absolute paths to the binary,
# `git -C <path>`, `--git-dir=`/`--work-tree=`, `-c key=value`, `--no-pager`.
segments=$(printf '%s' "$cmd" | tr '\n;|&' '\n\n\n\n')

norm() {
  printf '%s' "$1" \
    | sed -E 's/^[[:space:]]*(\(|\{)?[[:space:]]*//' \
    | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)+//' \
    | sed -E 's#^[[:space:]]*(sudo|command|nohup|time)[[:space:]]+##' \
    | sed -E 's#^[[:space:]]*(/[^[:space:]]*/)?(git|gh)([[:space:]])#\2\3#' \
    | sed -E 's#\B-C[[:space:]]+[^[:space:]]+##g; s#[[:space:]]-C[[:space:]]+[^[:space:]]+##g' \
    | sed -E 's#--git-dir(=| )[^[:space:]]+##g; s#--work-tree(=| )[^[:space:]]+##g' \
    | sed -E 's#[[:space:]]-c[[:space:]]+[^[:space:]]+=[^[:space:]]+##g' \
    | sed -E 's#--no-pager##g' \
    | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

refuse() {
  echo "dangerous-command-gate: REFUSED — $1" >&2
  echo "Canon principles-base.md §19 (permission floor). This gate reads the whole command, so \`git -C <path>\`, reordered flags and env prefixes do not step around it. If the operation is genuinely needed, it is the operator's call — surface it as a typed question (§11) rather than rephrasing the command." >&2
  exit 2
}

while IFS= read -r seg; do
  [ -n "$seg" ] || continue
  n=$(norm "$seg")
  [ -n "$n" ] || continue

  case "$n" in
    git\ *)
      # force push, any spelling
      printf '%s' "$n" | grep -qE '^git .*\bpush\b' && \
        printf '%s' "$n" | grep -qE '(--force-with-lease|--force\b|--mirror\b|(^|[[:space:]])-[A-Za-z]*f([[:space:]]|$))' && \
        refuse "force push. The integration branch's history is shared; a force push rewrites what others already have."

      printf '%s' "$n" | grep -qE '^git .*\breset\b.*--hard' && \
        refuse "\`git reset --hard\` discards uncommitted work irreversibly."

      printf '%s' "$n" | grep -qE '^git .*\bclean\b' && \
        printf '%s' "$n" | grep -qE '(--force\b|(^|[[:space:]])-[A-Za-z]*f)' && \
        refuse "\`git clean -f\` deletes untracked files, which git cannot bring back."

      printf '%s' "$n" | grep -qE '^git .*\b(filter-branch|filter-repo)\b' && \
        refuse "history rewriting."

      printf '%s' "$n" | grep -qE '^git .*\b(commit|push|merge)\b.*--no-verify' && \
        refuse "\`--no-verify\` skips the canon commit and push gates."

      printf '%s' "$n" | grep -qE '^git .*\bcommit\b.*(^|[[:space:]])-[A-Za-z]*n[A-Za-z]*([[:space:]]|$)' && \
        refuse "\`git commit -n\` is \`--no-verify\`; it skips the canon commit gates."
      ;;
    gh\ *)
      # Anchor on the subcommand pair. `.*` between `gh` and the verb would swallow
      # `gh pr merge --repo X --delete-branch`, which is an ordinary landing.
      printf '%s' "$n" | grep -qE '^gh( +--[A-Za-z-]+([= ][^ ]+)?)* +pr +merge\b.*(^|[[:space:]])--auto([[:space:]]|=|$)' && \
        refuse "auto-merge. Canon: the merge is the operator's click, never armed to fire later."

      printf '%s' "$n" | grep -qE '^gh( +--[A-Za-z-]+([= ][^ ]+)?)* +repo +delete\b' && \
        refuse "repo deletion."
      ;;
  esac

  printf '%s' "$n" | grep -qE '(^|[[:space:]])rm[[:space:]]+(-[A-Za-z]+[[:space:]]+)*-{0,2}[A-Za-z]*[rR][A-Za-z]*f?[A-Za-z]*[[:space:]]+/([[:space:]]|$)' && \
    refuse "\`rm -rf /\`."

  # A real .env read through Bash. `.env.example`/`.sample`/`.template` are documentation and pass.
  printf '%s' "$n" | grep -qE '(^|[[:space:]])(cat|bat|less|more|head|tail|strings|xxd|od|nl|grep|rg|awk|sed)([[:space:]]|$)' && \
    printf '%s' "$n" | grep -qE '(^|[[:space:]/])\.env([[:space:]]|$|\.[A-Za-z0-9_-]+)' && \
    ! printf '%s' "$n" | grep -qE '\.env\.(example|sample|template|dist)' && \
    refuse "reading a .env through Bash. Secrets are referenced by ENV NAME, never read into a transcript."

done <<EOF
$segments
EOF

exit 0
