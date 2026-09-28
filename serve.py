#!/usr/bin/env python3
"""Serve the built game (dist/index.html) with no-dependency, no-cache hosting.

Usage:
    npm run build      # produces the self-contained dist/index.html
    python3 serve.py [port]     # default 5173

Why this exists: the built bundle is a single self-contained file, so it can be
served by anything. `Cache-Control: no-store` matters — if a browser keeps a
cached page while the server is down, the page can sit forever on its boot
screen waiting for a script that no longer exists.
"""
import http.server
import os
import socketserver
import sys
import threading

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_head(self):
        # Serve index.html for unknown non-file paths (e.g. a preview URL with a path).
        translated = self.translate_path(self.path)
        if not os.path.exists(translated) and "." not in os.path.basename(translated.rstrip("/")):
            self.path = "/index.html"
        return super().send_head()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    index = os.path.join(ROOT, "index.html")
    if not os.path.exists(index):
        print("dist/index.html not found — run: npm install && npm run build", file=sys.stderr)
        return 1
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        size = os.path.getsize(index) / 1024
        print(f"1090 Fruits serving {index} ({size:.0f} KB) on http://0.0.0.0:{PORT}", flush=True)
        print("Cache-Control: no-store — every load fetches the current build.", flush=True)
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
