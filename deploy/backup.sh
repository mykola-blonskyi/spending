#!/bin/sh
# pg_dump backups into $BACKUP_DIR (the spending-backups volume).
#
#   backup.sh pre-migrate  one dump before migrations; keeps the newest 10
#   backup.sh daily        today's dump (rerunning the same day overwrites it); keeps 14 daily
#                          and 8 weekly
#   backup.sh schedule     daily at 03:00 UTC, forever
#
# Dumps use pg_dump's custom format, which is gzip-compressed and is what pg_restore reads.
# DATABASE_URL is passed to pg_dump and never printed.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
dir=${BACKUP_DIR:-/backups}
umask 077

log() {
  printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

dump_to() {
  partial="$1.partial"
  trap 'rm -f "$partial"' EXIT
  pg_dump --dbname="$DATABASE_URL" --format=custom --compress=gzip:6 --file="$partial"
  chmod 600 "$partial"
  mv "$partial" "$1"
  trap - EXIT
  log "wrote $(basename "$1") ($(wc -c <"$1" | tr -d ' ') bytes)"
}

# Names embed a sortable UTC timestamp, so name order is age order.
prune() {
  for f in "$1/$2"-*.dump; do
    [ -e "$f" ] && printf '%s\n' "$f"
  done | sort -r | tail -n +"$(($3 + 1))" | while read -r old; do
    rm -f "$old"
    log "pruned $(basename "$old")"
  done
}

pre_migrate() {
  mkdir -p "$dir/pre-migrate"
  dump_to "$dir/pre-migrate/pre-migrate-$(date -u +%Y%m%dT%H%M%SZ).dump"
  prune "$dir/pre-migrate" pre-migrate 10
}

daily() {
  mkdir -p "$dir/daily" "$dir/weekly"
  today="$dir/daily/daily-$(date -u +%Y-%m-%d).dump"
  dump_to "$today"
  week="$dir/weekly/weekly-$(date -u +%G-W%V).dump"
  if [ ! -e "$week" ]; then
    cp "$today" "$week.partial"
    mv "$week.partial" "$week"
    log "wrote $(basename "$week")"
  fi
  prune "$dir/daily" daily 14
  prune "$dir/weekly" weekly 8
}

schedule() {
  run_at=$((3 * 3600))
  # A separate process keeps set -e in force; inside `||` it would be suspended.
  [ -e "$dir/daily/daily-$(date -u +%Y-%m-%d).dump" ] || "$0" daily || log "daily dump failed"
  while :; do
    now=$(($(date -u +%s) % 86400))
    wait=$(((run_at - now + 86400) % 86400))
    [ "$wait" -gt 0 ] || wait=86400
    sleep "$wait"
    "$0" daily || log "daily dump failed"
  done
}

case "${1:-}" in
  pre-migrate) pre_migrate ;;
  daily) daily ;;
  schedule) schedule ;;
  *)
    echo "usage: backup.sh pre-migrate|daily|schedule" >&2
    exit 2
    ;;
esac
