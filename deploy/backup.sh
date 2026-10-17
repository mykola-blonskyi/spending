#!/bin/sh
# pg_dump backups into $BACKUP_DIR (the spending-backups volume).
#
#   backup.sh pre-migrate  one dump before migrations; keeps the newest 10
#   backup.sh daily        today's dump (rerunning the same day overwrites it); keeps 14 daily
#                          and 8 weekly
#   backup.sh schedule     daily at 03:00 UTC, forever; exits an hour after any failure
#
# Dumps use pg_dump's custom format, which is gzip-compressed and is what pg_restore reads.
# Every dump is checked with pg_restore --list before it is kept (a daily dump must list the
# transactions table data), so a corrupt, empty or wrong-database dump fails the run instead of
# replacing a good backup. When BACKUP_OFFSITE_REMOTE is set (an rclone destination such as
# :s3:bucket/spending, credentials in RCLONE_* variables), each daily dump is also copied there
# and $BACKUP_DIR/offsite.ok is touched; a failed copy fails the run after local pruning.
# Off-host retention is the bucket's lifecycle rule.
# DATABASE_URL (optionally ?sslmode=...) is split into the PG* environment variables, so the password is never in a
# process argument list, and is never printed.
set -eu

# Coolify alerts on a restart, not on an unhealthy healthcheck. A failed scheduled run therefore
# exits, and `restart: unless-stopped` restarts the container: one "Resource restarted" alert and
# one retry. Waiting an hour first keeps a lasting failure from restarting faster than that.
if [ "${1:-}" = schedule ]; then
  trap 'status=$?; [ "$status" -eq 0 ] || sleep 3600; exit "$status"' EXIT
fi

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
query=''
case "$PGDATABASE" in
  *\?*)
    query=${PGDATABASE#*\?}
    PGDATABASE=${PGDATABASE%%\?*}
    ;;
esac
# Only sslmode is understood; any other parameter is refused instead of silently dropped.
oldifs=$IFS
IFS='&'
for param in $query; do
  case "$param" in
    sslmode=?*) PGSSLMODE=${param#sslmode=}; export PGSSLMODE ;;
    *) echo "DATABASE_URL query parameters other than sslmode are not supported." >&2; exit 1 ;;
  esac
done
IFS=$oldifs
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
  # A daily dump must list the transactions table data, so a dump of an empty or wrong database
  # fails. pre-migrate runs before the first migration, when that table does not exist yet.
  if ! pg_restore --list "$partial" | grep -q "${2:-.}"; then
    log "$(basename "$1") failed verification"
    return 1
  fi
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
  dump_to "$today" 'TABLE DATA public transactions '
  week="$dir/weekly/weekly-$(date -u +%G-W%V).dump"
  if [ ! -e "$week" ]; then
    cp "$today" "$week.partial"
    mv "$week.partial" "$week"
    log "wrote $(basename "$week")"
  fi
  rc=0
  if [ -n "${BACKUP_OFFSITE_REMOTE:-}" ]; then
    if rclone copyto --quiet "$today" "${BACKUP_OFFSITE_REMOTE%/}/daily/$(basename "$today")"; then
      touch "$dir/offsite.ok"
      log "copied $(basename "$today") off-host"
    else
      log "off-host copy failed"
      rc=1
    fi
  fi
  prune "$dir/daily" daily 14
  prune "$dir/weekly" weekly 8
  return $rc
}

# `daily.failed` survives the restart, so the startup check retries even when today's dump exists
# and only the off-host copy failed.
run_daily() {
  if ! "$0" daily; then
    touch "$dir/daily.failed"
    log "daily dump failed; restarting in an hour to retry"
    exit 1
  fi
  rm -f "$dir/daily.failed"
}

schedule() {
  run_at=$((3 * 3600))
  # Run at start when today's dump is missing, when the last run failed, or when an off-host copy
  # is configured but none is fresh (just enabled, or the last copy failed): the healthcheck needs
  # both. A separate process keeps set -e in force; inside `if !` it would be suspended.
  if [ ! -e "$dir/daily/daily-$(date -u +%Y-%m-%d).dump" ] || [ -e "$dir/daily.failed" ] || {
    [ -n "${BACKUP_OFFSITE_REMOTE:-}" ] &&
      ! find "$dir/offsite.ok" -mmin -1560 2>/dev/null | grep -q .
  }; then
    run_daily
  fi
  while :; do
    now=$(($(date -u +%s) % 86400))
    wait=$(((run_at - now + 86400) % 86400))
    [ "$wait" -gt 0 ] || wait=86400
    sleep "$wait"
    run_daily
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
