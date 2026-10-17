#!/bin/sh
# Runs deploy/backup.sh schedule against stub pg_dump, pg_restore and sleep. A failing run must
# exit only after an hour, so the restart (and Coolify's "Resource restarted" alert) comes at
# most hourly; a good run must keep the daily loop going.
set -eu

cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"

cat >"$tmp/bin/pg_dump" <<'EOF'
#!/bin/sh
[ "${STUB_DUMP:-ok}" = ok ] || exit 1
for arg; do case "$arg" in --file=*) echo dump >"${arg#--file=}" ;; esac; done
EOF
cat >"$tmp/bin/pg_restore" <<'EOF'
#!/bin/sh
echo '1; 0 0 TABLE DATA public transactions spending_app'
EOF
# The hour before exiting returns at once; the loop's wait until 03:00 ends the run (or, with
# STUB_LOOP=once, returns the first time so the scheduled dump runs).
cat >"$tmp/bin/sleep" <<'EOF'
#!/bin/sh
echo "$1" >>"$STUB_LOG"
[ "$1" = 3600 ] && exit 0
if [ "${STUB_LOOP:-stop}" = once ] && ! grep -q loop "$STUB_LOG.state" 2>/dev/null; then
  echo loop >"$STUB_LOG.state"
  exit 0
fi
kill -KILL "$PPID"
EOF
chmod +x "$tmp/bin/"*

failures=0

# run_case <name> <wanted exit> <wanted sleeps> [VAR=value ...]
run_case() {
  name=$1 wanted=$2 sleeps=$3
  shift 3
  : >"$tmp/$name.sleeps"
  env PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/$name.sleeps" BACKUP_DIR="$tmp/$name" \
    DATABASE_URL=postgres://spending_app:abc123@db:5432/spending "$@" \
    sh deploy/backup.sh schedule >"$tmp/$name.out" 2>&1 && actual=0 || actual=$?
  got=$(tr '\n' ' ' <"$tmp/$name.sleeps")
  if [ "$actual" -eq "$wanted" ] && { [ "$sleeps" = any ] || [ "$got" = "$sleeps" ]; }; then
    echo "ok   $name (exit $actual, sleeps: $got)"
  else
    echo "FAIL $name (exit $actual, wanted $wanted; sleeps: '$got', wanted '$sleeps')"
    sed 's/^/       /' "$tmp/$name.out"
    failures=$((failures + 1))
  fi
}

today=$(date -u +%Y-%m-%d)

run_case startup_failure 1 '3600 ' STUB_DUMP=fail
grep -q 'daily dump failed' "$tmp/startup_failure.out" || {
  echo "FAIL startup_failure did not log the failure"
  failures=$((failures + 1))
}

# A good run reaches the daily loop; the killed sleep ends it with 137.
run_case startup_success 137 any STUB_DUMP=ok
if grep -qx 3600 "$tmp/startup_success.sleeps"; then
  echo "FAIL startup_success waited the failure hour"
  failures=$((failures + 1))
fi
[ -e "$tmp/startup_success/daily/daily-$today.dump" ] || {
  echo "FAIL startup_success wrote no dump"
  failures=$((failures + 1))
}

# A scheduled run that fails also waits the hour, then exits.
mkdir -p "$tmp/scheduled_failure/daily"
echo dump >"$tmp/scheduled_failure/daily/daily-$today.dump"
env PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/scheduled.sleeps" STUB_LOOP=once STUB_DUMP=fail \
  BACKUP_DIR="$tmp/scheduled_failure" DATABASE_URL=postgres://u:abc123@db:5432/spending \
  sh deploy/backup.sh schedule >"$tmp/scheduled.out" 2>&1 && actual=0 || actual=$?
if [ "$actual" -eq 1 ] && [ "$(tail -n 1 "$tmp/scheduled.sleeps")" = 3600 ]; then
  echo "ok   scheduled_failure (exit 1 after the hour)"
else
  echo "FAIL scheduled_failure (exit $actual, sleeps: $(tr '\n' ' ' <"$tmp/scheduled.sleeps"))"
  sed 's/^/       /' "$tmp/scheduled.out"
  failures=$((failures + 1))
fi

# After that restart, today's dump exists, but the failed run is retried at startup.
: >"$tmp/scheduled.sleeps.state"
env PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/retry.sleeps" STUB_DUMP=ok \
  BACKUP_DIR="$tmp/scheduled_failure" DATABASE_URL=postgres://u:abc123@db:5432/spending \
  sh deploy/backup.sh schedule >"$tmp/retry.out" 2>&1 || true
if grep -q "wrote daily-$today.dump" "$tmp/retry.out"; then
  echo "ok   retry_after_restart"
else
  echo "FAIL retry_after_restart never dumped"
  sed 's/^/       /' "$tmp/retry.out"
  failures=$((failures + 1))
fi

# A configuration error cannot crash-loop either.
run_case bad_config 1 '3600 ' DATABASE_URL=mysql://nope

[ "$failures" -eq 0 ] || { echo "$failures check(s) failed"; exit 1; }
echo "all cases passed"
