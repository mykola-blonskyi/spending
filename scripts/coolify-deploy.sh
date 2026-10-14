#!/bin/sh
# Triggers a Coolify deployment and waits until it finishes or fails.
# Adapted from the todolist project's script (same owner, same Coolify instance).
#
# Coolify answers the deploy webhook with 200 and a deployment_uuid as soon as it queues the
# work, so a 200 says nothing about the deployment. Only the polled status does.
#
#   COOLIFY_DEPLOY_WEBHOOK_URL  the resource's deploy webhook (Coolify → resource → Webhooks)
#   COOLIFY_DEPLOY_TOKEN        API token with the "deploy" and "read" abilities
#   COOLIFY_POLL_SECONDS        default 10
#   COOLIFY_TIMEOUT_SECONDS     default 1800
set -eu

: "${COOLIFY_DEPLOY_WEBHOOK_URL:?COOLIFY_DEPLOY_WEBHOOK_URL is required}"
: "${COOLIFY_DEPLOY_TOKEN:?COOLIFY_DEPLOY_TOKEN is required}"

poll_seconds=${COOLIFY_POLL_SECONDS:-10}
timeout_seconds=${COOLIFY_TIMEOUT_SECONDS:-1800}

# The status API hangs off the webhook URL's origin, so no second URL secret is needed.
scheme=${COOLIFY_DEPLOY_WEBHOOK_URL%%://*}
host=${COOLIFY_DEPLOY_WEBHOOK_URL#*://}
host=${host%%/*}
case "$scheme" in
  http | https) ;;
  *) echo "COOLIFY_DEPLOY_WEBHOOK_URL is not an http(s) URL." >&2; exit 1 ;;
esac
[ -n "$host" ] || { echo "COOLIFY_DEPLOY_WEBHOOK_URL has no host." >&2; exit 1; }
api_base="$scheme://$host"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# The token goes to curl through a file, so it never appears in a process argument list.
(umask 077 && printf 'Authorization: Bearer %s\n' "$COOLIFY_DEPLOY_TOKEN" >"$work/auth")
body="$work/body"

refused() {
  echo "Coolify refused the $1 (HTTP $2)." >&2
  echo "Check COOLIFY_DEPLOY_TOKEN: it must be valid and hold the \"deploy\" and \"read\" abilities." >&2
  exit 1
}

report_logs() {
  logs=$(jq -r '.logs // empty' "$body" 2>/dev/null || true)
  if [ -z "$logs" ]; then
    echo "Coolify returned no build log (the token needs \"read:sensitive\" for that)." >&2
    return
  fi
  # `>&2` must precede `2>/dev/null`, or jq's output follows fd 2 into /dev/null.
  printf '%s' "$logs" | jq -r 'map(.output) | join("\n")' >&2 2>/dev/null ||
    printf '%s\n' "$logs" >&2
}

# Coolify's /deploy route only deploys on POST; GET answers "use POST instead".
http_code=$(curl --silent --show-error --max-time 30 --request POST \
  --header "@$work/auth" --output "$body" --write-out '%{http_code}' \
  "$COOLIFY_DEPLOY_WEBHOOK_URL") || http_code=000
case "$http_code" in
  200) ;;
  401 | 403) refused "deploy trigger" "$http_code" ;;
  *)
    echo "Coolify did not accept the deploy trigger (HTTP $http_code)." >&2
    exit 1
    ;;
esac

# When a deployment for the commit is already queued, Coolify returns that deployment's uuid,
# and it only deduplicates against queued or in-progress ones, so this is never stale.
deployment_uuid=$(jq -er '.deployments[0].deployment_uuid' "$body" 2>/dev/null) || {
  echo "Coolify accepted the trigger but returned no deployment_uuid." >&2
  exit 1
}
echo "Coolify queued deployment $deployment_uuid."

deadline=$(($(date +%s) + timeout_seconds))
while :; do
  http_code=$(curl --silent --max-time 30 --header "@$work/auth" --output "$body" \
    --write-out '%{http_code}' "$api_base/api/v1/deployments/$deployment_uuid" 2>/dev/null) ||
    http_code=000
  status=''
  case "$http_code" in
    200) status=$(jq -r '.status // empty' "$body" 2>/dev/null || true) ;;
    # A token without "read" gets 401 forever; waiting out the deadline would hide why.
    401 | 403) refused "status request for $deployment_uuid" "$http_code" ;;
  esac

  case "$status" in
    finished)
      echo "Deployment $deployment_uuid finished."
      exit 0
      ;;
    failed | cancelled-by-user)
      echo "Deployment $deployment_uuid ended as $status." >&2
      report_logs
      exit 1
      ;;
    # An empty status is a poll that did not land (Coolify reloads its proxy mid-deploy).
    '' | queued | in_progress) ;;
    *)
      echo "Deployment $deployment_uuid reported an unrecognised status: $status" >&2
      exit 1
      ;;
  esac

  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "Deployment $deployment_uuid reached no terminal status in ${timeout_seconds}s (last HTTP $http_code, status ${status:-none})." >&2
    report_logs
    exit 1
  fi
  sleep "$poll_seconds"
done
