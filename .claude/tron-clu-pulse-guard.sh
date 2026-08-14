#!/bin/bash
# tron-clu PULSE guard (Stop hook). v3.
# No-op unless a CLU run is active (.tron-clu-active flag in project root).
# Flag format: "<epoch>" (armed until expiry) or "<epoch>:<state>", state in
# {done, walled} — a recorded kill state lets the turn end (PULSE off by rule),
# except that a `walled` run with pending operator items must raise one of them
# as a blocking question before it may end (see below).
# Otherwise blocks turn end if the PULSE timer has lapsed, forcing a re-arm.

input=$(cat)

proj="${CLAUDE_PROJECT_DIR:-.}"
flag="$proj/.tron-clu-active"

[ -f "$flag" ] || exit 0

# Already blocked once this stop — let it through to avoid an infinite loop.
echo "$input" | grep -q '"stop_hook_active":true' && exit 0

# Session scoping: hooks fire in EVERY session of the project. If the sidecar
# names CLU's session, only that session is guarded; others pass untouched.
sid_file="$proj/.tron-clu-session"
if [ -f "$sid_file" ]; then
  sid=$(tr -d '[:space:]' < "$sid_file")
  if [ -n "$sid" ] && ! echo "$input" | grep -q "$sid"; then
    exit 0
  fi
fi

raw=$(tr -d '[:space:]' < "$flag" 2>/dev/null)
armed_until="${raw%%:*}"
state=""
case "$raw" in *:*) state="${raw#*:}" ;; esac

# Kill states: done / walled — PULSE is legitimately off; the turn may end.
# (Teardown/flag deletion still belongs to skill-session-end, not this hook.)
# Exception (gate 4): a `walled` run whose attention queue is non-empty is in the
# one state where waiting on the operator is all that is left — so the turn may
# not simply end in silence. AskUserQuestion is model-invoked only; this hook can
# only refuse the ending and say why, which it does exactly once per stop.
case "$state" in
  walled)
    att="$proj/.tron-clu-attention"
    if [ -s "$att" ]; then
      echo "Walled with pending operator items ($att). Nothing is parallelizable and the only remaining state is waiting on the operator — so do not end silently: convert the OLDEST pending item into a blocking AskUserQuestion now (skill-operator-comms §Blocking moments), then end the turn." >&2
      exit 2
    fi
    exit 0 ;;
  done) exit 0 ;;
  '') : ;;
  *)
    echo "PULSE flag malformed ('$raw'): state token must be 'done' or 'walled'. Either arm a fresh beat (echo \$(( \$(date +%s) + 240 )) > .tron-clu-active) or record a valid kill state (echo \"\$(date +%s):done\" or ...:walled > .tron-clu-active)." >&2
    exit 2 ;;
esac

case "$armed_until" in ('' | *[!0-9]*) armed_until=0 ;; esac

now=$(date +%s)
if [ "$now" -gt "$armed_until" ]; then
  echo "PULSE not armed or lapsed. Arm the background timer now (sleep per the adaptive cadence, run_in_background) and write the new expiry: echo \$(( \$(date +%s) + 240 )) > .tron-clu-active — or, if the run is finished or fully walled with nothing parallelizable, record the kill state: echo \"\$(date +%s):done\" (or :walled) > .tron-clu-active. Then continue." >&2
  exit 2
fi

exit 0
