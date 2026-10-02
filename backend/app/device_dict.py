"""Geraetewoerterbuch fuer DJI Cloud API product identities.

Normative Quelle fuer OFFICIAL_DEVICES / OFFICIAL_DEFAULT_CAMERA ist die
aktuelle offizielle DJI Cloud API Produkt-Support-Seite fuer v1.16.1.
M3M 0-77-2 und payload 68-0-0 wurden dagegen am 2026-10-01 durch reale,
redigierte FH-Clone MQTT-Evidence beobachtet und bleiben bewusst getrennt.

Runtime-Topologien werden fail-closed aus update_topo validiert.
"""

OFFICIAL_DEVICES: dict[str, tuple[str, str]] = {
    # Aircraft
    "0-60-0": ("Matrice 300 RTK", "aircraft"),
    "0-67-0": ("Matrice 30", "aircraft"),
    "0-67-1": ("Matrice 30T", "aircraft"),
    "0-77-0": ("Mavic 3E", "aircraft"),
    "0-77-1": ("Mavic 3T", "aircraft"),
    "0-77-3": ("Mavic 3TA", "aircraft"),
    "0-89-0": ("Matrice 350 RTK", "aircraft"),
    "0-91-0": ("Matrice 3D", "aircraft"),
    "0-91-1": ("Matrice 3TD", "aircraft"),
    "0-99-0": ("Matrice 4E", "aircraft"),
    "0-99-1": ("Matrice 4T", "aircraft"),
    "0-100-0": ("Matrice 4D", "aircraft"),
    "0-100-1": ("Matrice 4TD", "aircraft"),
    "0-103-0": ("Matrice 400", "aircraft"),

    # Remote controllers
    "2-56-0": ("DJI Smart Controller Enterprise", "rc"),
    "2-119-0": ("DJI RC Plus", "rc"),
    "2-144-0": ("DJI RC Pro Enterprise", "rc"),
    "2-174-0": ("DJI RC Plus 2", "rc"),

    # Docks. SkyHub recognizes these passively but does not enable Dock control.
    "3-1-0": ("DJI Dock", "dock"),
    "3-2-0": ("DJI Dock 2", "dock"),
    "3-3-0": ("DJI Dock 3", "dock"),
}

EVIDENCE_ONLY_DEVICES: dict[str, tuple[str, str]] = {
    "0-77-2": ("Mavic 3M", "aircraft"),
}

DEVICES: dict[str, tuple[str, str]] = {
    **OFFICIAL_DEVICES,
    **EVIDENCE_ONLY_DEVICES,
}

# Offiziell dokumentierte Hauptkamera fuer Fluggeraete mit integrierter Kamera.
# Aircraft with interchangeable payloads intentionally have no default here.
OFFICIAL_DEFAULT_CAMERA: dict[str, str] = {
    "0-67-0": "52-0-0",
    "0-67-1": "53-0-0",
    "0-77-0": "66-0-0",
    "0-77-1": "67-0-0",
    "0-77-3": "129-0-0",
    "0-91-0": "80-0-0",
    "0-91-1": "81-0-0",
    "0-99-0": "88-0-0",
    "0-99-1": "89-0-0",
    "0-100-0": "98-0-0",
    "0-100-1": "99-0-0",
}

EVIDENCE_ONLY_DEFAULT_CAMERA: dict[str, str] = {
    "0-77-2": "68-0-0",
}

DEFAULT_CAMERA: dict[str, str] = {
    **OFFICIAL_DEFAULT_CAMERA,
    **EVIDENCE_ONLY_DEFAULT_CAMERA,
}

# Auszug mode_code Fluggeraet (OSD)
MODE_CODES: dict[int, str] = {
    0: "Bereit",
    1: "Startvorbereitung",
    2: "Startbereit",
    3: "Manueller Flug",
    4: "Automatischer Start",
    5: "Wegpunktflug",
    6: "Panorama",
    7: "Intelligentes Tracking",
    8: "ADS-B Ausweichen",
    9: "Automatische Rueckkehr (RTH)",
    10: "Automatische Landung",
    11: "Zwangslandung",
    12: "Three-blade landing",
    13: "Firmware-Update",
    14: "Nicht verbunden",
    15: "APAS",
    16: "Virtual Stick",
    17: "Live Flight Controls",
    18: "Airborne RTK fixing",
}

MODE_CODE_REASONS: dict[int, str] = {
    0: "Keine besondere Ursache",
    1: "Akkustand zu niedrig",
    2: "Akkuspannung zu niedrig",
    3: "Kritisch niedrige Spannung",
    4: "Durch Fernsteuerung angefordert",
    5: "Durch App angefordert",
    6: "Fernsteuerungssignal verloren",
    7: "Durch externes Geraet/SDK angefordert",
    8: "Dock-GEO-Zone erreicht",
    9: "RTH nahe am Homepoint",
    10: "RTH zu weit vom Homepoint",
    11: "Durch Wegpunktmission angefordert",
    12: "Landung nach Erreichen des Homepoints",
    13: "Zweite Sinkphase nahe Boden",
    14: "Low-altitude protection uebersteuert",
    15: "Verkehr in der Umgebung",
    16: "Hoehenregelungsfehler",
    17: "Intelligent Low Battery Return",
    18: "AP steuert manuellen Flugmodus",
    19: "Hardwareanomalie",
    20: "Ende Kollisionsschutz",
    21: "Rueckkehr abgebrochen",
    22: "Hindernis waehrend Rueckkehr",
}


def model_key(domain: int, type_: int, sub_type: int) -> str:
    return f"{domain}-{type_}-{sub_type}"


def describe(key: str) -> tuple[str, str]:
    if key in DEVICES:
        return DEVICES[key]
    domain = key.split("-")[0]
    kind = "aircraft" if domain == "0" else "rc" if domain == "2" else "dock" if domain == "3" else "other"
    return (f"Unbekannt ({key})", kind)


def support_source(key: str) -> str:
    if key in OFFICIAL_DEVICES:
        return "dji-cloud-api-v1.16.1"
    if key in EVIDENCE_ONLY_DEVICES:
        return "fh-clone-real-hardware"
    return "unknown"
