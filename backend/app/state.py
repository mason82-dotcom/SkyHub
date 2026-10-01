import json
import time

from fastapi import WebSocket


class Hub:
    """Live-Zustand im RAM + WebSocket-Broadcast an Web-UI und Pilot 2 (TSA)."""

    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.osd: dict[str, dict] = {}
        self.normalized: dict[str, dict] = {}
        self.state: dict[str, dict] = {}
        self.last_seen: dict[str, float] = {}
        self.online: set[str] = set()
        self.kind: dict[str, str] = {}          # sn -> aircraft | rc
        self.topo: dict[str, list[str]] = {}    # gateway_sn -> [sub sn]

    def register(self, ws: WebSocket) -> None:
        self.clients.add(ws)

    def unregister(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    def gateway_of(self, sn: str) -> str | None:
        for gw, subs in self.topo.items():
            if sn in subs:
                return gw
        return None

    async def broadcast(self, biz_code: str, data: dict) -> None:
        msg = json.dumps({"biz_code": biz_code, "version": "1.0",
                          "timestamp": int(time.time() * 1000), "data": data})
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()
