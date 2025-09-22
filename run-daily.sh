#!/bin/bash
# cron/launchd have a small PATH; include where node & npm live
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

cd /Users/apple/Desktop/jobsearch || exit 1

# ---- simple lock so two runs don't overlap ----
LOCKFILE=".run.lock"
if [ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null; then
  echo "=== Skipping: another run is in progress (PID $(cat "$LOCKFILE")) at $(date '+%Y-%m-%d %H:%M:%S %Z')" >> logs/run.log
  exit 0
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

# ---- timestamp + duration ----
START_TS=$(date +%s)
echo "=== Run started $(date '+%Y-%m-%d %H:%M:%S %Z')" >> logs/run.log

# Keep the Mac awake WHILE the job runs
/usr/bin/env caffeinate -s /usr/bin/env npm run both:deliver >> logs/run.log 2>&1

END_TS=$(date +%s)
ELAPSED=$(( END_TS - START_TS ))
printf '=== Run finished %s (elapsed %02dh:%02dm:%02ds)\n' \
  "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$((ELAPSED/3600))" "$(((ELAPSED%3600)/60))" "$((ELAPSED%60))" \
  >> logs/run.log

