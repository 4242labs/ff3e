# Kit hooks — deterministic gates

Hook scripts shipped by the scaffold kit and wired into `../settings.json`. They are the
harness-enforcement layer of the deterministic-fleet plan: the model proposes, these
scripts validate. **A gate counts as landed only where its hook is installed** — the
canon text alone is explicitly inert.

| Script | Event · matcher | Enforces |
|:--|:--|:--|
| `dangerous-command-gate.sh` | `PreToolUse` · `Bash` (**first** in the chain) | Permission floor (`principles-base.md` §19): destructive git/gh operations and `.env` reads, matched on the normalised operation rather than a literal prefix |
| `linear-card-lint.sh` | `PreToolUse` · `mcp__linear__save_issue` | Card contract (`skill-linear-cards.md`): agent state vocabulary, fleet assignee, owner line + signature + universal label on create |
| `telegram-send-check.sh` | `PreToolUse` · `Bash` | Channel registry (`telegram-channels.md`): a send's chat ID must equal the registered channel for this project, or it is refused |
| `gate-ledger-gate.sh` | `PreToolUse` · `Bash` | Gate ledger (`skill-gate-ledger.md`): PR/merge/deploy commands blocked while the active block is missing prior-stage records |
| `persona-anchor-inject.sh` | `SessionStart` · `compact` | Persona persistence (`principles-base.md` §17): re-injects `*-anchor.md` files after every compaction |

## Per-project configuration

Each script runs on built-in fleet defaults; optional config files beside the scripts
override them (all untracked-safe, none required to boot):

- `linear-lint.config.json` — `{ "allowed_states": [...], "assignee": "..." }`
- `telegram-channels.local.json` — **required before any Telegram send**; written once at
  project start after the operator confirms the channel. Prefer `chat_id_env` (secrets by
  ENV NAME only); keep this file untracked.
- `gate-ledger.config.json` — `{ "ledger_dir", "active_block_file", "pr_pattern", "merge_pattern", "deploy_pattern" }`.
  `pr_pattern` is **default off**: absent, the `gh pr create` surface is inert; set (e.g.
  `"gh[[:space:]]+pr[[:space:]]+create"`), PR creation requires `build challenge validation`
  recorded. A supervisor that turns it on removes the key again at teardown.
- `persona-anchors.config.json` — `{ "paths": ["glob", ...] }`

## Semantics

- Refusals exit `2` with the reason on stderr — the agent reads it and corrects course;
  it never works around a refusal.
- `jq` is required to parse hook input; if missing, the PreToolUse gates skip **loudly**
  (stderr warning) rather than break every tool call. Install `jq` to arm them.
- The gate-ledger gate activates only while `.tron-active-block` (project root) names an
  **active** block. The supervising process writes one entry per line — `<id>` (active) or
  `<id> closed` (closed-marked: the block's evidence landed, its gates are down) — appending
  at block start and marking at block close. **Zero active entries is inert**: the gate
  passes everything, exactly as an absent file does.
- Block resolution is **fail-closed and never branch-derived**: an explicit `TRON_BLOCK=<id>`
  prefix on the command wins (active entry → that block governs; closed-marked entry →
  ungated; an id in no entry → **refused**, so a mistype never silently disarms the gate);
  else a single active entry governs; else two or more active entries without a token are
  refused with the token form named. A guarded command is never passed unresolved.
- The script header carries a `gate-ledger-gate-version:` line — a supervisor tests an
  installed copy's **marker value** against the current template rather than its mere
  presence, so a stale retrofitted copy is detectable.
- The permission floor is the **hook**, not `settings.json → permissions.deny`. Deny entries are
  literal prefix matches (`git -C <path> reset --hard` and `git clean -xdf` walk past them) and are
  skipped entirely in bypassPermissions mode; PreToolUse hooks run in **every** mode. The deny block
  stays as one readable, tracked layer that stops the direct form — never as the guarantee.
  `disableBypassPermissionsMode` is deliberately **not** shipped: it locks the operator out of their
  own repo and defends nothing the gate does not already defend.
- `dangerous-command-gate.sh` matches command **text**. It normalises away the usual disguises
  (`git -C`, env prefixes, `sudo`, absolute paths, reordered flags) but indirection through a
  variable (`g="reset"; git $g --hard`) still defeats it. Documented in the script header; the gate
  is a floor against accidents and defaults, not an adversary-proof sandbox.
- Retrofits install these same files unchanged; new projects are born with them.
