"""Client Marionette minimal (protocole JSON préfixé par la longueur)."""
import json, socket, time

class Marionette:
    def __init__(self, port=2828, timeout=60):
        end = time.time() + timeout
        while True:
            try:
                self.s = socket.create_connection(("127.0.0.1", port), timeout=5)
                # Sous Wine, la poignée de main reste parfois sans réponse :
                # on se reconnecte.
                self.s.settimeout(10)
                self.buf = b""
                self._recv()  # handshake
                break
            except (OSError, ValueError):
                if time.time() > end:
                    raise
                time.sleep(0.5)
        self.s.settimeout(None)
        self.id = 0
        self.cmd("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"pageLoadStrategy": "normal"}}})
        self.cmd("WebDriver:SetTimeouts", {"script": 3600000, "pageLoad": 120000})

    def _read(self):
        data = self.s.recv(65536)
        if not data:
            raise ConnectionError("connexion Marionette fermée")
        return data

    def _recv(self):
        while b":" not in self.buf:
            self.buf += self._read()
        n, rest = self.buf.split(b":", 1)
        n = int(n)
        while len(rest) < n:
            rest += self._read()
        self.buf = rest[n:]
        return json.loads(rest[:n])

    def cmd(self, name, params=None):
        self.id += 1
        data = json.dumps([0, self.id, name, params or {}]).encode()
        self.s.sendall(str(len(data)).encode() + b":" + data)
        while True:
            msg = self._recv()
            if msg[0] == 1 and msg[1] == self.id:
                if msg[2]:
                    raise RuntimeError(msg[2])
                return msg[3]

    def go(self, url):
        return self.cmd("WebDriver:Navigate", {"url": url})

    def js(self, script, args=None, async_=False):
        name = "WebDriver:ExecuteAsyncScript" if async_ else "WebDriver:ExecuteScript"
        r = self.cmd(name, {"script": script, "args": args or []})
        return r.get("value") if isinstance(r, dict) else r

    def quit(self):
        try:
            self.cmd("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            pass
