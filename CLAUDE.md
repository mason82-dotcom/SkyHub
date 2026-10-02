# CLAUDE.md - SkyHub OnPrem (harte Projektregeln)

## Zweck
Self-hosted Leitstand fuer DJI Enterprise via DJI Cloud API (Pilot 2 -> MQTT/HTTP).
Zielhardware Server: ODROID-HC4 / Raspberry Pi 5 (ARM64, Docker).
Drohnen: RC Pro Enterprise + M3E/M3T/M3M, RC Plus 2 + Matrice 4T.

## Regeln
1. Alle Versionen strikt gepinnt (Docker-Tags und requirements.txt). Kein `latest`, kein `^`/`~`/`>=`.
2. Secrets nur in `.env` (gitignored). `.env.example` immer aktuell halten.
3. Quelldateien ASCII-only. Deutsche UI-Texte in HTML ueber Entities (&auml; &ouml; &uuml; &szlig;).
4. DJI-Antwortformat immer `{"code","message","data"}` ueber `common.ok()/fail()`; Fehler = HTTP 200 + code != 0.
5. Normative DJI-Protokollbasis ist Cloud API v1.16.1 (Release 2025-12-17,
   developer.dji.com/doc/cloud-api-tutorial). MQTT-Topics, HTTP-/WS-Vertraege,
   DTOs und Methoden zuerst gegen diese Version bzw. die aktuellere offizielle
   DJI-Dokumentation pruefen, nicht raten. Unbestaetigte Werte mit
   `UNVERIFIZIERT` markieren.
6. Geraete-Keys (domain-type-sub_type) ausschliesslich in `device_dict.py`.
7. Keine Steuerbefehle (Flug, Takeoff, RTH, DRC) ohne explizite Freigabe des Nutzers implementieren.
8. DJI-Cloud-API-Demo nur kontrolliert als Protokoll-/Kompatibilitaetsreferenz verwenden. Uebernahmen muessen Security-Review, aktuelle Doku-Pruefung, Tests und Herkunftsdokumentation durchlaufen. Keine Demo-Auth-, Session-, Storage-, Controller- oder Flugsteuerungsimplementierung ungeprueft uebernehmen.
9. Vor Commit: `python -c "import app.main"` im backend/ muss laufen.

## Verifikationsstand
- Getestet: Import, Routen, MQTT-Dispatch simuliert (SQLite), KMZ-Parser.
- FH-Clone-Referenz: reale redigierte M3M-MQTT-Evidence bestaetigt update_topo 0-77-2 und payload_index 68-0-0 am 2026-10-01.
- NICHT getestet: kompletter SkyHub-Stack gegen echte RC/Pilot 2, STS-Upload, Livestream, Kartenelement-Format, TSA.
- Offizielle DJI-Support-Matrix und reale Projekt-Evidence strikt getrennt behandeln.
- Normative Zielversion: DJI Cloud API v1.16.1; Versionspolitik siehe docs/DJI_CLOUD_API_VERSION.md.
- DJI-Demo-Referenznutzung ist in docs/DJI_DEMO_REFERENCE.md nachvollziehbar dokumentiert.
