# SkyHub UX Contract

## Product context

- Zielgruppe: Technische Betreiber einer lokalen DJI-Installation.
- Hauptaufgabe: DJI-Telemetrie, Datenalter und RTK-Zustand beobachten.
- Sprache: Deutsch; Protokollbegriffe bleiben technisch eindeutig.
- Sicherheitsgrenze: Das Dashboard ist read-only und erteilt keine Flugfreigabe.
- Accessibility target: WCAG 2.2 AA.

## Canonical states

| Zustand | Auslöser | Anzeige |
|---|---|---|
| Prüfen | Seite geladen, Socket noch offen | „Verbindung wird geprüft“ |
| Verbunden/wartend | Socket verbunden, keine OSD-Nachricht | „Verbunden · wartet auf Daten“ |
| Live | validierte OSD-Nachricht höchstens 15 Sekunden alt | „Telemetrie live“ |
| Veraltet | letzte OSD-Nachricht älter als 15 Sekunden | „Telemetrie veraltet“ |
| Getrennt | Socket getrennt oder nicht erreichbar | explizite Offline-Meldung |

## Data behavior

- Fehlende Messfelder erscheinen als `–`; Null ist ein gültiger Wert.
- Datenquelle, Device-SN, Gateway-SN und Empfangszeit bleiben sichtbar.
- RTK-Fix wird nur bei `position_state.is_fixed = 2` als fixiert bezeichnet.
- Eine Socket- oder Broker-Verbindung allein darf nie als Live-Telemetrie erscheinen.

## Permissions and safety

- Das Frontend bietet keine Missionssteuerung an.
- Der Server autorisiert Flugaktionen unabhängig von der UI.
- Der Missionsendpunkt ist standardmäßig deaktiviert und antwortet in diesem Zustand mit HTTP 503.
- Aktivierte Missionsanfragen benötigen ein Admin-Bearer-Token und serverseitige Allowlist-Validierung.

## Accessibility and resilience

- Statusänderungen verwenden eine höfliche Live-Region.
- Zustände werden mit Text und Farbe vermittelt.
- Bei reduzierter Bewegung entfallen nicht notwendige Übergänge.
- Das Layout bleibt ab 320 px Breite lesbar und dokumentbasiert scrollbar.

## Verification

- Backend-Unit-Tests prüfen MQTT-Envelope, Größenlimits, Telemetrie-Normalisierung, Mission-Allowlist und Tokenparser.
- Der Frontend-Build muss ohne Netzwerkzugriff reproduzierbar sein.
- Compose muss ohne offene Datenbank-/Redis-Ports rendern und Missionsversand standardmäßig deaktivieren.
