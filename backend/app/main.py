import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
from fastapi.staticfiles import StaticFiles

from .config import settings, validate_runtime_settings
from .db import engine, init_db
from .dji.protocol import DJI_CLOUD_API_VERSION
from .mqtt_bridge import bridge
from .routers import auth, devices, map, media, storage, wayline, ws

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
STATIC = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_runtime_settings(settings)
    await init_db()
    tasks = [asyncio.create_task(bridge.run()), asyncio.create_task(bridge.watchdog())]
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="SkyHub OnPrem", lifespan=lifespan)
for r in (auth, ws, storage, media, wayline, map, devices):
    app.include_router(r.router)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/healthz", include_in_schema=False)
async def healthz():
    return {
        "status": "ok",
        "dji_cloud_api_version": DJI_CLOUD_API_VERSION,
    }


@app.get("/readyz", include_in_schema=False)
async def readyz():
    database_ready = False
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        database_ready = True
    except Exception:
        logging.getLogger("skyhub.readiness").exception("Database readiness check failed")

    mqtt_ready = bridge.client is not None
    ready = database_ready and mqtt_ready
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "status": "ready" if ready else "not_ready",
            "checks": {
                "database": database_ready,
                "mqtt": mqtt_ready,
            },
            "dji_cloud_api_version": DJI_CLOUD_API_VERSION,
        },
    )


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(STATIC / "index.html")


@app.get("/pilot", include_in_schema=False)
async def pilot_page():
    return FileResponse(STATIC / "pilot.html")
