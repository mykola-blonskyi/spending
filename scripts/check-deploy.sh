#!/bin/sh
# Post-deploy check: the API is ready through nginx, and the security and cache headers are served.
#
#   APP_URL=https://spending.blonskyi.dev sh scripts/check-deploy.sh
#
# EXPECTED_VERSION (optional, the commit SHA) makes the check wait until the API reports exactly
# that version. "unknown" never matches, so a build that lost SOURCE_COMMIT fails loudly.
set -eu

: "${APP_URL:?APP_URL is required}"
attempts=${CHECK_ATTEMPTS:-12}
delay=${CHECK_DELAY_SECONDS:-10}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

expected=${EXPECTED_VERSION:-}
version=''

# Succeeds when /api/health/ready is ok and, if EXPECTED_VERSION is set, reports that version.
ready_and_current() {
  curl --fail --silent --show-error --max-time 10 --output "$work/ready" \
    "$APP_URL/api/health/ready" || return 1
  grep -q '"status":"ok"' "$work/ready" || return 1
  version=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$work/ready")
  [ -z "$expected" ] || [ "$version" = "$expected" ]
}

i=1
until ready_and_current; do
  if [ "$i" -ge "$attempts" ]; then
    if [ -n "$expected" ] && [ -n "$version" ] && [ "$version" != "$expected" ]; then
      echo "Deployed version $version, expected $expected. main moved after the CI gate, or the" \
        "build lost SOURCE_COMMIT. Dispatch Deploy again on the current head, or revert." >&2
    else
      echo "$APP_URL/api/health/ready never reported ok (last version: ${version:-none})." >&2
    fi
    exit 1
  fi
  i=$((i + 1))
  sleep "$delay"
done
echo "API ready (version ${version:-unknown})."

missing=0
for path in / /api/health; do
  curl --fail --silent --show-error --max-time 10 --dump-header "$work/headers" \
    --output /dev/null "$APP_URL$path"
  for header in content-security-policy strict-transport-security x-content-type-options \
    referrer-policy permissions-policy cross-origin-opener-policy x-frame-options; do
    if ! grep -qi "^$header:" "$work/headers"; then
      echo "$path is missing $header." >&2
      missing=1
    fi
  done
done
grep -qi "^content-security-policy:.*frame-ancestors 'none'" "$work/headers" || {
  echo "The served CSP is not the one in deploy/security-headers.conf." >&2
  missing=1
}
for path in /index.html /sw.js /manifest.webmanifest; do
  curl --fail --silent --show-error --max-time 10 --dump-header "$work/headers" \
    --output /dev/null "$APP_URL$path"
  grep -qi '^cache-control:.*no-cache' "$work/headers" || {
    echo "$path is not served with Cache-Control: no-cache." >&2
    missing=1
  }
done
[ "$missing" -eq 0 ] || exit 1
echo "Security headers and cache headers present."
