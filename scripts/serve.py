"""Dev server for dev/preview.html: plain static files, but with caching disabled.

`python -m http.server` sends Last-Modified without Cache-Control, so browsers heuristically cache
ES modules and keep running the old code after an edit ("actions.pinTab is not a function").
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(NoCache, directory=str(ROOT)))
    print(f"preview: http://127.0.0.1:{port}/dev/preview.html  (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
