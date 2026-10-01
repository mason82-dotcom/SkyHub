import hmac
import time

import jwt
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from ..common import fail, ok
from ..config import settings

router = APIRouter()


def make_token(user: str) -> str:
    return jwt.encode({"sub": user, "ws": settings.workspace_id,
                       "exp": int(time.time()) + settings.jwt_ttl_hours * 3600},
                      settings.jwt_secret, algorithm="HS256")


def decode_token(token: str | None) -> dict:
    if not token:
        raise HTTPException(401, "Token fehlt")
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Token ungueltig oder abgelaufen")


async def require_user(x_auth_token: str | None = Header(default=None),
                       token: str | None = Query(default=None)) -> str:
    # Pilot 2 sendet den Header x-auth-token, Web-UI ebenso
    return decode_token(x_auth_token or token)["sub"]


class LoginReq(BaseModel):
    username: str
    password: str


@router.post("/api/v1/login")
async def login(req: LoginReq):
    good = (hmac.compare_digest(req.username, settings.admin_user)
            and hmac.compare_digest(req.password, settings.admin_password))
    if not good:
        return fail(401, "Benutzername oder Passwort falsch")
    return ok({
        "username": req.username,
        "access_token": make_token(req.username),
        "workspace_id": settings.workspace_id,
        "api_host": settings.api_base,
        "ws_host": f"{settings.ws_base}/api/v1/ws",
        "mqtt_addr": settings.mqtt_public,
        "mqtt_username": settings.mqtt_pilot_user,
        "mqtt_password": settings.mqtt_pilot_password,
    })


@router.get("/api/v1/pilot/config")
async def pilot_config():
    # Nur im LAN erreichbar machen: enthaelt App-Lizenzdaten
    return ok({"app_id": settings.dji_app_id, "app_key": settings.dji_app_key,
               "app_license": settings.dji_app_license,
               "platform_name": settings.platform_name,
               "workspace_name": settings.workspace_name,
               "workspace_id": settings.workspace_id})
