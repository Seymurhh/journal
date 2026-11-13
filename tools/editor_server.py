#!/usr/bin/env python3
"""Local editor server for the journal. Runs only on this computer (127.0.0.1).
Serves the site and lets the editor page save encrypted files into content/ and media/."""
import http.server, json, os, re, sys, threading, webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8321
SAFE = re.compile(r"^/(content|media)/([A-Za-z0-9][A-Za-z0-9._-]{0,80})$")
MAX_BYTES = 100 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _target(self):
        # Only requests from this editor page may write; other websites are refused.
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"):
            return None
        m = SAFE.match(self.path.split("?")[0])
        if not m or m.group(2) == "starter.json":
            return None
        return os.path.join(ROOT, m.group(1), m.group(2))

    def do_GET(self):
        if self.path.startswith("/__editor/ping"):
            return self._json(200, {"editor": True})
        super().do_GET()

    def do_PUT(self):
        path = self._target()
        size = int(self.headers.get("Content-Length") or -1)
        if not path or size < 0 or size > MAX_BYTES:
            return self._json(400, {"ok": False})
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            left = size
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        if left:
            os.remove(tmp)
            return self._json(400, {"ok": False})
        os.replace(tmp, path)
        self._json(200, {"ok": True})

    def do_DELETE(self):
        path = self._target()
        if not path or "/media/" not in path.replace(os.sep, "/"):
            return self._json(400, {"ok": False})
        if os.path.exists(path):
            os.remove(path)
        self._json(200, {"ok": True})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/admin.html"
    print(f"\n  Journal editor is running: {url}\n  Leave this window open while you edit. Close it when you are done.\n")
    if "--no-open" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
