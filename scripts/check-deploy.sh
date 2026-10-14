#!/bin/sh
# Post-deploy check: the API is ready through nginx and the security headers are served.
#
#   APP_URL=https://spending.blonskyi.dev sh scripts/check-deploy.sh
set -eu

: "${APP_URL:?APP_URL is required}"
attempts=${CHECK_ATTEMPTS:-12}
delay=${CHECK_DELAY_SECONDS:-10}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

i=1
until curl --fail --silent --show-error --max-time 10 --output "$work/ready" \
  "$APP_URL/api/health/ready" && grep -q '"status":"ok"' "$work/ready"; do
  [ "$i" -lt "$attempts" ] || { echo "$APP_URL/api/health/ready never reported ok." >&2; exit 1; }
  i=$((i + 1))
  sleep "$delay"
done
echo "API ready."

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
[ "$missing" -eq 0 ] || exit 1
echo "Security headers present."
