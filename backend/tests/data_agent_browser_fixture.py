"""Loopback HTTPS substitute for browser tests; never the real Data Agent service.

Start with TEST_AGENT_API_TOKEN, TEST_AGENT_CERT and TEST_AGENT_KEY. Tokens are
ephemeral and request URLs/Authorization headers are never logged.
"""

import html
import json
import os
import secrets
import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


class SyntheticAgent(BaseHTTPRequestHandler):
    tokens: dict[str, str] = {}
    issued: list[str] = []
    lock = threading.Lock()

    def log_message(self, *_):
        pass

    def reply(self, status: int, body: bytes, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        if self.path != "/api/yiaskAuth:issueUserToken":
            self.reply(404, b"{}")
            return
        if self.headers.get("Authorization") != "Bearer " + os.environ["TEST_AGENT_API_TOKEN"]:
            self.reply(401, b"{}")
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 1024:
                raise ValueError
            body = json.loads(self.rfile.read(size))
            if set(body) != {"username"} or body["username"] not in {
                "synthetic-alice", "synthetic-bob"
            }:
                raise ValueError
        except (ValueError, TypeError):
            self.reply(400, b"{}")
            return
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.tokens[token] = body["username"]
            self.issued.append(body["username"])
        self.reply(200, json.dumps({"data": {"token": token, "user": body}}).encode())

    def do_GET(self):  # noqa: N802
        parsed = urlsplit(self.path)
        if parsed.path == "/test-status":
            with self.lock:
                body = json.dumps({"issued": self.issued}).encode()
            self.reply(200, body)
            return
        query = parse_qs(parsed.query)
        with self.lock:
            username = self.tokens.get(query.get("token", [""])[0])
        if parsed.path != "/admin/chat" or username is None:
            self.reply(401, b"{}")
            return
        question = query.get("ask", [""])[0]
        page = (
            '<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="referrer" content="no-referrer"><title>Synthetic Data Agent</title>'
            '<body style="font:20px sans-serif;padding:30px;background:#f3f6fa">'
            '<h1>Synthetic Data Agent</h1><p>Local contract fixture only</p>'
            '<p id="identity">' + html.escape(username) + '</p>'
            '<p id="question">' + html.escape(question) + '</p></body></html>'
        )
        self.reply(200, page.encode(), "text/html; charset=utf-8")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 18185), SyntheticAgent)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(os.environ["TEST_AGENT_CERT"], os.environ["TEST_AGENT_KEY"])
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    server.serve_forever()
