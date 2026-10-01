"""Geraetewoerterbuch fuer DJI Cloud API product identities.

Die statischen Namen sind nur Darstellungsdaten. Runtime-Topologien werden
fail-closed aus update_topo validiert. M3M 0-77-2 und payload 68-0-0 wurden
am 2026-10-01 durch reale, redigierte FH-Clone MQTT-Evidence beobachtet.
Das ist kein Ersatz fuer DJIs offizielle Support-Matrix.
"""

DEVICES: dict[str, tuple[str, str]] = {
    "0-77-0": ("Mavic 3E", "aircraft"),
    "0-77-1": ("Mavic 3T", "aircraft"),
    "0-77-2": ("Mavic 3M", "aircraft"),          # REAL-HW evidence in FH-Clone
    "0-77-3": ("Mavic 3TA", "aircraft"),
    "0-99-0": ("Matrice 4E", "aircraft"),
    "0-99-1": ("Matrice 4T", "aircraft"),
    "2-119-0": ("DJI RC Plus", "rc"),
    "2-144-0": ("DJI RC Pro Enterprise", "rc"),
    "2-174-0": ("DJI RC Plus 2", "rc"),
}

# Haupt-Kamera (payload_index) je Fluggeraet, fuer live_start_push video_id
DEFAULT_CAMERA: dict[str, str] = {
    "0-77-0": "66-0-0",
    "0-77-1": "67-0-0",
    "0-77-2": "68-0-0",                         # REAL-HW evidence in FH-Clone
    "0-99-0": "88-0-0",
    "0-99-1": "89-0-0",
}

# Auszug mode_code Fluggeraet (OSD)
MODE_CODES: dict[int, str] = {
    0: "Bereit", 1: "Startvorbereitung", 2: "Startbereit", 3: "Manuell",
    4: "Auto-Start", 5: "Wegpunktflug", 6: "Panorama", 7: "Tracking",
    8: "ADS-B Ausweichen", 9: "Rueckkehr (RTH)", 10: "Landung",
    11: "Zwangslandung", 13: "Update", 14: "Getrennt", 16: "Virtual Stick",
    18: "Airborne RTK fixing",
}


def model_key(domain: int, type_: int, sub_type: int) -> str:
    return f"{domain}-{type_}-{sub_type}"


def describe(key: str) -> tuple[str, str]:
    if key in DEVICES:
        return DEVICES[key]
    domain = key.split("-")[0]
    return (f"Unbekannt ({key})", "aircraft" if domain == "0" else "rc" if domain == "2" else "other")
