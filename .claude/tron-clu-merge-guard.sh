#!/bin/bash
# tron-clu merge guard (PreToolUse hook, matcher: Bash).
# Enforces law §3 / clu.md "CLU merges nothing, ever" as a mechanism instead of a
# habit: a hook deny fires in EVERY permission mode, including bypassPermissions,
# and also inside subagents — so CLU and every worker are bound alike.
#
# No-op unless a CLU run is active (.tron-clu-active in the project root).
#
# `gh pr merge` — denied unless ALL of:
#   · the PR is named explicitly: a number (`gh pr merge 42`) or a PR URL whose
#     trailing /pull/<n> is read offline (this hook never calls `gh`); a
#     branch-name selector is denied with the numeric form named, because
#     resolving it would need a network call;
#   · a line `<PR#> <owner/repo>` in .tron-clu-merge-grant covers it — the
#     operator's authorization, written by CLU, one line per authorized PR;
#   · no `--auto` / merge-queue flag. That one is denied unconditionally, grant or
#     no grant: a grant authorizes a merge NOW, never a scheduled one, and
#     tron.md §3 bans arming auto-merge absolutely.
#   Target repo = `-R/--repo` if given, else the repo at `git -C <path>`, else the
#   session cwd's repo, normalized to owner/repo from the origin remote. A PR URL
#   supplies its own owner/repo and overrides that ladder.
#
# `git merge` — passes in exactly two forms:
#   · `--ff-only` where the target repo's `.repo-class` is `canon` or `meta` (the
#     law-prescribed no-PR landing, skill-branching.md §Session end). On `app`
#     repos, on a repo with no `.repo-class` marker, and wherever the target repo
#     cannot be resolved, the FF form is denied too — fail-closed; the refusal
#     names the PR path, or the `git -C <repo> merge --ff-only <branch>` form
#     that makes the class check decidable.
#   · the recovery verbs --abort / --continue / --quit: a repo left mid-conflict
#     must have a legal exit.
#   Every other form is denied; refusals name the legal paths.
#
# Session scoping is deliberately ABSENT: this gate binds the whole project root
# while a run is live (plan Decision 1, unscoped branch). Verified 2026-08-13: a
# subagent's hook stdin carries the PARENT session id, so scoping by session would
# cover subagent commands and could not distinguish them. An operator session in
# the same project during a live run is bound too — every refusal names its
# unblock, and `install/README.md` documents the impact.
#
# Layered guardrail, not a security boundary: `gh api` merges, local merge + push,
# plain `git pull` merges, and `--no-verify` sit outside the matcher, at the same
# trust level as the ledger. No tamper defense is claimed.

input=$(cat)

proj="${CLAUDE_PROJECT_DIR:-.}"
flag="$proj/.tron-clu-active"
grant="$proj/.tron-clu-merge-grant"

[ -f "$flag" ] || exit 0

if ! command -v jq >/dev/null 2>&1; then
  echo "tron-clu merge-guard: jq not found — gate skipped, merges UNGATED this call. Install jq to arm this gate." >&2
  exit 0
fi

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -n "$cwd" ] || cwd="$proj"

deny() { echo "tron-clu merge-guard: REFUSED — $1" >&2; exit 2; }

# owner/repo from a remote URL (https://host/owner/repo[.git] or host:owner/repo).
slug_from_url() {
  printf '%s' "${1%.git}" | sed -E 's#/+$##; s#^.*[:/]([^/:]+)/([^/]+)$#\1/\2#'
}

# Everything after the first bare `merge` token, up to the first command separator.
args_after_merge() {
  local seg
  seg=$(printf '%s\n' "$cmd" | awk '{for(i=1;i<=NF;i++) if($i=="merge"){s="";for(j=i+1;j<=NF;j++) s=s" "$j; print s; exit}}')
  seg=${seg%%;*}; seg=${seg%%&&*}; seg=${seg%%|*}
  printf '%s' "$seg"
}

# The directory the command targets: `git -C <path>` if present, else the cwd.
target_dir() {
  local d
  d=$(printf '%s' "$cmd" | grep -oE 'git[[:space:]]+(-[^C[:space:]-][^[:space:]]*[[:space:]]+)*-C[[:space:]]+[^[:space:];&|]+' | head -1 | sed -E 's/.*-C[[:space:]]+//')
  if [ -n "$d" ]; then
    case "$d" in /*) printf '%s' "$d" ;; *) printf '%s/%s' "$cwd" "$d" ;; esac
  else
    printf '%s' "$cwd"
  fi
}

# ---------------------------------------------------------------- gh pr merge --
if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])gh([[:space:]]+-[^[:space:]]+)*[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
  seg=$(args_after_merge)

  pr_num=""; selector=""; repo_arg=""; url_slug=""; skip_next=0; repo_next=0
  for t in $seg; do
    if [ "$skip_next" = 1 ]; then skip_next=0; continue; fi
    if [ "$repo_next" = 1 ]; then repo_arg="$t"; repo_next=0; continue; fi
    case "$t" in
      --auto|--auto=*|--merge-queue|--queue)
        deny "\`--auto\` / merge-queue merges are banned outright (tron.md §3: never arm auto-merge, in any mode, authorized or not). A grant authorizes a merge NOW, never a scheduled one. Drop the flag and merge the PR directly once the operator has granted it." ;;
      *://*/pull/*)
        n=${t##*/pull/}; n=${n%%/*}; n=${n%%\?*}
        url_slug=$(slug_from_url "${t%%/pull/*}")
        case "$n" in ''|*[!0-9]*) : ;; *) pr_num="$n" ;; esac ;;
      -R=*|--repo=*) repo_arg=${t#*=} ;;
      -R|--repo) repo_next=1 ;;
      -b|--body|-t|--subject|--match-head-commit|--author-email|--body-file) skip_next=1 ;;
      -*) : ;;
      *)
        if [ -z "$pr_num$selector" ]; then
          case "$t" in ''|*[!0-9]*) selector="$t" ;; *) pr_num="$t" ;; esac
        fi ;;
    esac
  done

  [ -n "$pr_num" ] || {
    if [ -n "$selector" ]; then
      deny "\`gh pr merge $selector\` selects the PR by branch — resolving that needs a network call this hook must not make. Re-issue with the PR number (\`gh pr merge <number>\`) or the PR URL."
    fi
    deny "\`gh pr merge\` with no PR named. Name the PR explicitly — \`gh pr merge <number>\` or the PR URL — so the grant can be checked. And the merge itself needs the operator's word: CLU writes \`<PR#> <owner/repo>\` into .tron-clu-merge-grant only on their authorization."
  }

  # Target repo: URL wins (it names its repo authoritatively), then -R, then the ladder.
  if [ -n "$url_slug" ]; then repo_slug="$url_slug"
  elif [ -n "$repo_arg" ]; then repo_slug=$(slug_from_url "$repo_arg")
  else
    dir=$(target_dir)
    origin=$(git -C "$dir" remote get-url origin 2>/dev/null)
    [ -n "$origin" ] || deny "cannot resolve the target repo for PR #$pr_num (no origin remote at '$dir'), so the grant cannot be checked. Re-issue with \`-R <owner/repo>\` or the PR URL."
    repo_slug=$(slug_from_url "$origin")
  fi

  [ -f "$grant" ] || deny "no merge grant exists. The merge is the operator's: on their authorization CLU writes \`$pr_num $repo_slug\` into .tron-clu-merge-grant, then this command passes. Ask — an earlier blanket 'merge them all' is never standing authorization."

  grep -qE "^[[:space:]]*$pr_num[[:space:]]+$repo_slug[[:space:]]*$" "$grant" || \
    deny "PR #$pr_num ($repo_slug) is not in .tron-clu-merge-grant. Grant lines are \`<PR#> <owner/repo>\`, one per authorized PR, written by CLU only on the operator's authorization. Put the PR to the operator, then retry."

  exit 0
fi

# ------------------------------------------------------------------ git merge --
if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+merge([[:space:]]|$)'; then
  seg=$(args_after_merge)

  case " $seg " in
    *" --abort "*|*" --continue "*|*" --quit "*) exit 0 ;;
  esac

  case " $seg " in
    *" --ff-only "*) : ;;
    *) deny "\`git merge\` is off-blueprint while a CLU run is active. Parallel-block reconciliation is a rebase (skill-merge-close), trunk sync is \`git pull --ff-only\`, and a landing is \`git -C <repo> merge --ff-only <branch>\` on a canon/meta repo. App repos land through a PR — CLU merges nothing." ;;
  esac

  dir=$(target_dir)
  root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)
  [ -n "$root" ] || deny "\`--ff-only\` landing, but the target repo cannot be resolved from '$dir', so its class cannot be checked. Re-issue naming the repo: \`git -C <repo> merge --ff-only <branch>\` — the invocation style clu.md §Invariants already mandates."

  class=""
  [ -f "$root/.repo-class" ] && class=$(tr -d '[:space:]' < "$root/.repo-class")
  case "$class" in
    canon|meta) exit 0 ;;
    '') deny "\`--ff-only\` landing in $root, which carries no \`.repo-class\` marker. Fail-closed: an unclassified repo has no law-prescribed fast-forward landing. Land through a PR, or classify the repo (canon/meta/app) first." ;;
    *)  deny "\`--ff-only\` landing in $root, class \`$class\`. The no-PR fast-forward landing is for \`canon\`/\`meta\` repos only (skill-branching.md §Session end) — an \`app\` repo lands through a PR the operator merges." ;;
  esac
fi

exit 0
