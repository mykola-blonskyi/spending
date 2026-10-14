"""A Coolify stand-in for scripts/coolify-deploy.test.sh.

Serves the two routes the deploy script calls. The trigger answers 200 with a
deployment_uuid whatever the deployment then does, as the real one does. Statuses are
Coolify's own (app/Enums/ApplicationDeploymentStatus.php).
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

TOKEN = "Bearer test-token-0f3c9a"

TERMINAL = {
    "finished": "finished",
    "flaky": "finished",
    "failed": "failed",
    "cancelled": "cancelled-by-user",
    "unknown_status": "something-coolify-never-returns",
}

LOGS = json.dumps([{"output": "ERROR: no space left on device"}])

seen = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _authorized(self):
        return self.headers.get("Authorization") == TOKEN

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/ready":
            return self._send(200, {"ready": True})
        if not path.startswith("/api/v1/deployments/"):
            return self._send(404, {"message": "Not found."})
        if not self._authorized():
            return self._send(401, {"message": "Unauthenticated."})

        case = path.rsplit("/", 1)[-1]
        seen[case] = seen.get(case, 0) + 1
        polls = seen[case]

        # Sanctum's answer to a token holding "deploy" but not "read". It never recovers.
        if case == "status_unauthorized":
            return self._send(401, {"message": "Invalid ability provided."})
        if case == "flaky" and polls == 1:
            return self._send(502, {"message": "Bad gateway."})
        # Two non-terminal polls first, so reading only the first response cannot pass.
        if case == "never_settles" or polls <= 2:
            status = "queued" if polls == 1 else "in_progress"
        else:
            status = TERMINAL[case]
        return self._send(200, {"status": status, "logs": LOGS})

    def do_POST(self):
        case = parse_qs(urlparse(self.path).query).get("case", ["finished"])[0]
        if case == "trigger_unauthorized" or not self._authorized():
            return self._send(401, {"message": "Unauthenticated."})
        if case == "no_uuid":
            return self._send(200, {"deployments": [{"message": "queued."}]})
        return self._send(200, {"deployments": [{"deployment_uuid": case}]})


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
