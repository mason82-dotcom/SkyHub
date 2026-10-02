from typing import Any


def ok(data: Any = None) -> dict:
    return {"code": 0, "message": "success", "data": {} if data is None else data}


def fail(code: int, message: str, data: Any = None) -> dict:
    # DJI-Konvention: HTTP 200, Fehler ueber code != 0
    return {"code": code, "message": message, "data": {} if data is None else data}
