"""Piepklein endpoint: de generator-pagina (tools/og.html) POST't de kaart hierheen.
Zo hoeft de afbeelding nergens door een tekstkanaal. Schrijft enkel og.jpg in de repo-root.
Threaded en met een kort antwoord op GET: een browser die toevallig op deze poort langskomt,
houdt anders de enige verbinding bezet en de POST van de generator blijft hangen."""
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo-root
ALLOWED = {"og.jpg"}


class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def _text(self, status, msg):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(msg.encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        self._text(200, "ogsave staat klaar. Open tools/og.html op de andere server.")

    def do_POST(self):
        name = os.path.basename(self.path.lstrip("/"))
        if name not in ALLOWED:
            self._text(400, "enkel og.jpg")
            return
        n = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(n)
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(data)
        self._text(200, "saved %s (%d bytes)" % (name, len(data)))
        print("saved %s (%d bytes)" % (name, len(data)), flush=True)

    def log_message(self, *a):
        pass


srv = ThreadingHTTPServer(("127.0.0.1", 8124), H)
srv.daemon_threads = True
print("ogsave luistert op http://127.0.0.1:8124", flush=True)
srv.serve_forever()
