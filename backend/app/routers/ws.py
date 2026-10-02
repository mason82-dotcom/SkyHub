from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..state import hub
from .auth import decode_token

router = APIRouter()


@router.websocket("/api/v1/ws")
async def ws_endpoint(ws: WebSocket):
    # Pilot 2's WS component uses x-auth-token as a query parameter. SkyHub
    # accepts only the short-lived WS token here, never the long-lived API JWT.
    token = (
        ws.headers.get("x-auth-token")
        or ws.query_params.get("x-auth-token")
        or ws.query_params.get("token")
    )
    try:
        decode_token(token, "ws")
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
