import hmac
import time

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from ..common import fail, ok
from ..config import settings

router = APIRouter()


def _make_token(user: str, token_type: str, ttl_seconds: int) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": user,
            "ws": settings.workspace_id,
            "typ": token_type,
            "iat": now,
            "exp": now + ttl_seconds,
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def make_access_token(user: str) -> str:
    return _make_token(user, "access", settings.jwt_ttl_hours * 3600)


def make_ws_token(user: str) -> str:
    return _make_token(user, "ws", settings.ws_token_ttl_seconds)


def decode_token(token: str | None, expected_type: str = "access") -> dict:
    if not token:
        raise HTTPException(401, "Token fehlt")
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "Token ungueltig oder abgelaufen") from exc
    if claims.get("typ") != expected_type:
        raise HTTPException(401, "Falscher Token-Typ")
    if not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise HTTPException(401, "Token ohne Benutzer")
    if claims.get("ws") != settings.workspace_id:
        raise HTTPException(403, "Token gehoert zu anderem Workspace")
    return claims


async def require_user(
    x_auth_token: str | None = Header(default=None),
) -> str:
    return decode_token(x_auth_token, "access")["sub"]


async def require_workspace_user(
    workspace_id: str,
    x_auth_token: str | None = Header(default=None),
) -> str:
    claims = decode_token(x_auth_token, "access")
    if workspace_id != settings.workspace_id or workspace_id != claims["ws"]:
        raise HTTPException(403, "Workspace nicht autorisiert")
    return claims["sub"]


class LoginReq(BaseModel):
    username: str
    password: str


@router.post("/api/v1/login")
async def login(req: LoginReq):
    good = (
        hmac.compare_digest(req.username, settings.admin_user)
        and hmac.compare_digest(req.password, settings.admin_password)
    )
    if not good:
        return fail(401, "Benutzername oder Passwort falsch")
    return ok({
        "username": req.username,
        "access_token": make_access_token(req.username),
        "ws_token": make_ws_token(req.username),
        "workspace_id": settings.workspace_id,
        "api_host": settings.api_base,
        "ws_host": f"{settings.ws_base}/api/v1/ws",
        "mqtt_addr": settings.mqtt_public,
        "mqtt_username": settings.mqtt_pilot_user,
        "mqtt_password": settings.mqtt_pilot_password,
        "app_id": settings.dji_app_id,
        "app_key": settings.dji_app_key,
        "app_license": settings.dji_app_license,
    })


@router.post("/api/v1/ws-ticket")
async def ws_ticket(user: str = Depends(require_user)):
    return ok({
        "ws_token": make_ws_token(user),
        "expires_in": settings.ws_token_ttl_seconds,
    })


@router.get("/api/v1/pilot/config")
async def pilot_config():
    # Public bootstrap metadata only. Credentials are released after login.
    return ok({
        "platform_name": settings.platform_name,
        "workspace_name": settings.workspace_name,
        "workspace_id": settings.workspace_id,
    })
