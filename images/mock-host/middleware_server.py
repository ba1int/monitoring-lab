#!/usr/bin/env python3

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import ClassVar


STATE_FILE = Path(os.environ.get("LAB_STATE_FILE", "/state/status"))
METADATA_FILE = Path("/etc/lab-metadata")
PORT = int(os.environ.get("LAB_MIDDLEWARE_PORT", "8080"))
VALID_STATES = {"ok", "warning", "critical"}


def read_status() -> str:
    try:
        first_line = STATE_FILE.read_text(encoding="utf-8").splitlines()[0]
    except (IndexError, OSError, UnicodeError):
        return "unknown"
    status = first_line.strip().lower()
    return status if status in VALID_STATES else "unknown"


def read_metadata() -> dict[str, str]:
    metadata: dict[str, str] = {}
    try:
        lines = METADATA_FILE.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return metadata
    for line in lines:
        key, separator, value = line.partition("=")
        if separator and key in {"host", "environment", "role", "site"}:
            metadata[key] = value
    return metadata


class MiddlewareHandler(BaseHTTPRequestHandler):
    server_version = "lab-middleware/1"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    status_codes: ClassVar[dict[str, int]] = {
        "ok": 200,
        "warning": 200,
        "critical": 503,
        "unknown": 500,
    }

    def send_json(self, status_code: int, payload: dict[str, object]) -> None:
        body = (json.dumps(payload, sort_keys=True) + "\n").encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        if self.path == "/ready":
            self.send_json(200, {"ready": True})
            return

        if self.path in {"/", "/health"}:
            state = read_status()
            payload: dict[str, object] = read_metadata()
            payload.update({"service": "middleware", "status": state})
            self.send_json(self.status_codes[state], payload)
            return

        if self.path == "/metadata":
            self.send_json(200, read_metadata())
            return

        self.send_json(404, {"error": "not found"})

    def log_message(self, message: str, *args: object) -> None:
        print(
            f"[middleware] {self.client_address[0]} {message % args}",
            flush=True,
        )


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), MiddlewareHandler)
    server.daemon_threads = True
    print(f"[middleware] listening on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever(poll_interval=0.25)


if __name__ == "__main__":
    main()
