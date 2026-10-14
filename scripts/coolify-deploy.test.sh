#!/bin/sh
# Runs scripts/coolify-deploy.sh against scripts/coolify-fake.py. The cases that matter most
# are the failing ones: a deploy job that exits 0 for a failed deployment is worse than none.
set -eu

cd "$(dirname "$0")/.."

port=${COOLIFY_FAKE_PORT:-8977}
token=test-token-0f3c9a
tmp=$(mktemp -d)
server_pid=''
# Keep the script's own status: under dash, the killed server's 143 from `wait` would leak out.
trap 'status=$?; kill "$server_pid" 2>/dev/null; wait "$server_pid" 2>/dev/null || true; rm -rf "$tmp"; exit "$status"' EXIT

python3 scripts/coolify-fake.py "$port" &
server_pid=$!

until curl --noproxy '*' --silent --fail --max-time 1 "http://127.0.0.1:$port/ready" >/dev/null 2>&1; do
  kill -0 "$server_pid" 2>/dev/null || { echo "fake Coolify exited before serving"; exit 1; }
  sleep 0.1
done

failures=0

fail() {
  echo "FAIL $1"
  sed 's/^/       /' "$tmp/$2.out"
  failures=$((failures + 1))
}

run_case() {
  name=$1
  expected=$2
  NO_PROXY='*' no_proxy='*' \
  COOLIFY_DEPLOY_WEBHOOK_URL="http://127.0.0.1:$port/api/v1/deploy?uuid=app-1&case=$name" \
  COOLIFY_DEPLOY_TOKEN=${4:-$token} \
  COOLIFY_POLL_SECONDS=0.1 \
  COOLIFY_TIMEOUT_SECONDS=${3:-30} \
    sh scripts/coolify-deploy.sh >"$tmp/$name.out" 2>&1 && actual=0 || actual=$?

  if [ "$actual" -eq "$expected" ]; then
    echo "ok   $name (exit $actual)"
  else
    fail "$name (exit $actual, wanted $expected)" "$name"
  fi
  if grep -q "$token" "$tmp/$name.out"; then
    fail "$name printed the token" "$name"
  fi
  if grep -q 'HIDDEN-SECRET-LINE' "$tmp/$name.out"; then
    fail "$name printed a hidden log entry" "$name"
  fi
}

expect_output() {
  if grep -q "$2" "$tmp/$1.out"; then
    echo "ok   $1 reports \"$2\""
  else
    fail "$1 never reported \"$2\"" "$1"
  fi
}

run_case finished 0
run_case flaky 0
run_case failed 1
run_case cancelled 1
run_case unknown_status 1
run_case no_uuid 1
run_case never_settles 1 1
run_case trigger_unauthorized 1
# A zero deadline tells the paths apart: the 401 exit names the token, a loop would time out.
run_case status_unauthorized 1 0
run_case wrong_token 1 30 not-the-token

expect_output finished 'finished'
expect_output failed 'no space left on device'
expect_output never_settles 'no terminal status'
expect_output trigger_unauthorized 'HTTP 401'
expect_output status_unauthorized '"read" abilities'
expect_output wrong_token 'Check COOLIFY_DEPLOY_TOKEN'

[ "$failures" -eq 0 ] || { echo "$failures check(s) failed"; exit 1; }
echo "all cases passed"
