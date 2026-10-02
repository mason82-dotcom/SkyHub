import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings, validate_runtime_settings
from .db import init_db
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


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(STATIC / "index.html")


@app.get("/pilot", include_in_schema=False)
async def pilot_page():
    return FileResponse(STATIC / "pilot.html")
