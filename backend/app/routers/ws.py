from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..state import hub
from .auth import decode_token

router = APIRouter()


@router.websocket("/api/v1/ws")
async def ws_endpoint(ws: WebSocket):
    token = ws.query_params.get("x-auth-token") or ws.query_params.get("token")
    try:
        decode_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    await ws.accept()
    hub.register(ws)
    try:
        while True:
            await ws.receive_text()  # Heartbeats von Pilot/Web ignorieren
    except WebSocketDisconnect:
        pass
    finally:
        hub.unregister(ws)
