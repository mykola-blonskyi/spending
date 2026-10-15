#!/bin/sh
# pg_dump backups into $BACKUP_DIR (the spending-backups volume).
#
#   backup.sh pre-migrate  one dump before migrations; keeps the newest 10
#   backup.sh daily        today's dump (rerunning the same day overwrites it); keeps 14 daily
#                          and 8 weekly
#   backup.sh schedule     daily at 03:00 UTC, forever
#
# Dumps use pg_dump's custom format, which is gzip-compressed and is what pg_restore reads.
# Every dump is checked with pg_restore --list before it is kept, so a corrupt or empty dump
# fails the run instead of replacing a good backup. When BACKUP_OFFSITE_REMOTE is set (an rclone
# destination such as :s3:bucket/spending, credentials in RCLONE_* variables), each daily dump is
# also copied there; retention off-host is the bucket's lifecycle rule.
# DATABASE_URL is split into the PG* environment variables, so the password is never in a
# process argument list, and is never printed.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
dir=${BACKUP_DIR:-/backups}
umask 077

# postgres://user:password@host[:port]/database. Passwords are hex (docs/operations.md), so no
# percent-decoding is implemented; a URL that needs it is refused instead of misread.
case "$DATABASE_URL" in
  *%*) echo "DATABASE_URL must not contain percent-encoding; use a hex password." >&2; exit 1 ;;
  postgres://* | postgresql://*) ;;
  *) echo "DATABASE_URL must be a postgres:// URL." >&2; exit 1 ;;
esac
rest=${DATABASE_URL#*://}
userinfo=${rest%%@*}
hostpart=${rest#*@}
[ "$userinfo" != "$rest" ] || { echo "DATABASE_URL has no credentials." >&2; exit 1; }
PGUSER=${userinfo%%:*}
PGPASSWORD=${userinfo#*:}
PGHOST=${hostpart%%/*}
PGDATABASE=${hostpart#*/}
PGDATABASE=${PGDATABASE%%\?*}
PGPORT=5432
case "$PGHOST" in
  *:*)
    PGPORT=${PGHOST##*:}
    PGHOST=${PGHOST%:*}
    ;;
esac
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

log() {
  printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

dump_to() {
  partial="$1.partial"
  trap 'rm -f "$partial"' EXIT
  pg_dump --format=custom --compress=gzip:6 --file="$partial"
  pg_restore --list "$partial" >/dev/null || { log "$(basename "$1") failed verification"; return 1; }
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
  if [ -n "${BACKUP_OFFSITE_REMOTE:-}" ]; then
    rclone copyto --quiet "$today" "${BACKUP_OFFSITE_REMOTE%/}/daily/$(basename "$today")" ||
      { log "off-host copy failed"; return 1; }
    log "copied $(basename "$today") off-host"
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
