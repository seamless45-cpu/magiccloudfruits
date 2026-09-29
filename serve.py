#!/usr/bin/env python3
"""Serve the built game (dist/index.html) with no dependencies and no caching.

Usage:
    npm run build            # produces the self-contained dist/index.html
    python3 serve.py [port]  # default 5173

Routes:
    /                 the game
    /index.html       the game (a distinct URL, so it dodges a stale cached "/")
    /safe, /arena     the game in low-graphics ("safe") mode
    /src/...          404 -> returns a tiny script that forwards to the game
    anything else     the game (single-page fallback)

Why the /src/* redirect exists: a browser that still holds a page from an earlier
dev session keeps asking for /src/main.tsx. Answering that with a 404 leaves it
stuck on a boot screen forever, so instead we return a script that sends it to
the current build. Recovery then needs no user action.

`Cache-Control: no-store` is also deliberate: if a browser keeps a cached page
while the server is down, the page can hang waiting for a script that no longer
exists.
"""
import http.server
import os
import socketserver
import sys
import urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173

# Returned for dev-server paths (e.g. /src/main.tsx) requested by a stale cached page.
STALE_PAGE_SHIM = (
    "/* This build is served as a single self-contained file. A page from an earlier dev "
    "session asked for a module that no longer exists, so send it to the current build "
    "instead of failing with 404. Fall back to '/' when /index.html is not routed, which "
    "keeps this working behind a proxy that only forwards the root path. */\n"
    "fetch('/index.html', { method: 'HEAD' })\n"
    "  .then(function (r) { if (r.ok) location.replace('/index.html'); })\n"
    "  .catch(function () { /* leave the page as it is: never navigate in a loop */ });\n"
).encode()

FAVICON = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
           "<circle cx='16' cy='16' r='13' fill='#33e0ff'/></svg>").encode()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _send_bytes(self, body: bytes, ctype: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_head(self):
        path = urllib.parse.urlparse(self.path).path

        # A stale dev page asking for its module: hand it a forwarder, never a 404.
        if path.startswith("/src/") or path.startswith("/@") or path.endswith(".tsx") or path.endswith(".ts"):
            return self._send_bytes(STALE_PAGE_SHIM, "text/javascript; charset=utf-8")

        if path == "/favicon.ico":
            return self._send_bytes(FAVICON, "image/svg+xml")

        # Every other path serves the game, so /index.html and /safe always work.
        self.path = "/index.html"
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

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
        print("routes: / /index.html /safe — stale /src/* requests are forwarded, not 404'd", flush=True)
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
