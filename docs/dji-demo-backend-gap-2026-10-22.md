# DJI-Cloud-API-Demo → SkyHub Next: Backend-Gap-Abgleich (22.10.2026)

**Basis:** DJI `dji-sdk/DJI-Cloud-API-Demo` auf `main`, Tree `bef525cb92772b06786c1e033719a6fa1b94bcc5`; SkyHub `feature/m3m-minio-integration-20261021` auf `bbded73ff2cc3e0d27a3df6ad85e05a520016a4f`.

**Entscheidung:** Kein Backend-Austausch. Die DJI-Demo (Java/Spring Boot 2.7.12, Java 11, Cloud-API-Demo 1.10.0) wurde laut README am 10.04.2025 eingestellt und ist keine produktionsreife Vorlage. SkyHub ist Node.js/Express mit MQTT.js, Redis, PostGIS und MinIO; Ziel ist Cloud API 1.18. Alle verwendeten Protokollverträge sind gegen die aktuelle DJI-Referenz zu prüfen.

## Konkrete Datei-/Funktionslücken

| DJI-Implementierung | SkyHub-Istzustand | Ergebnis / nächste Voraussetzung |
| --- | --- | --- |
| `cloud-sdk/.../mqtt/{InboundMessageRouter,CloudApiTopicEnum}.java` | `backend/dji.js`, `backend/mqtt-ingest.js`: status, osd, state, events, services_reply | Read-only-Kanäle bereits abgedeckt; keine Migration der Java-MQTT-Engine erforderlich. |
| `cloud-sdk/.../mqtt/services/{ServicesPublish,ServicesReplyHandler}.java` | `services_reply` abonniert und im Eingang generisch ausgewertet, aber keine aktive ausgehende Service-Korrelation | Neu: isolierter `backend/dji-service-reply-contract.js` und Tests; noch **nicht** im Server importiert. Später Command-Registry, Berechtigungen, Replay-Schutz und gesonderte Hardwareabnahme. |
| `cloud-sdk/.../mqtt/requests/{RequestsRouter,RequestsSubscribe}.java` | Keine `requests`-Subscription oder `requests_reply`-Publikation | Vor Aktivierung: request-spezifische Handler, AuthN/AuthZ, MQTT-ACL, minimales STS, Audit, Denial-Tests. |
| `sample/.../component/oss/service/impl/MinIOServiceImpl.java` | `backend/s3-storage.js` und `backend/media-upload-contract.js`, MinIO-Read-Only-Diagnosen | **Nicht portieren:** DJI `getObject` liest mit `readAllBytes()`, Upload nutzt `input.available()` als Größe. Streaming und begrenzte zeitweilige Schreibrechte priorisieren. |
| `sample/.../media/{controller,service}` | Read-only `backend/media-api.js`; isolierter Upload-Vertrag ohne live Route | Pilot-2-Media-Modul erst mit getrenntem Upload-Bucket, kurzlebiger STS, Workspace-Präfixrechten und Hardwaretest aktivieren. |
| `sample/.../wayline/service/impl/{FlightTaskServiceImpl,WaylineJobServiceImpl}.java` | WPML-Validierungs-/Generatorarbeit vorhanden, kein produktiver allgemeiner Missions-Jobmanager | Persistente Job-Zustandsmaschine, Idempotenz, Ablauf- und Gerätefähigkeitsprüfung vor irgendeinem Flugkommando. Die Demo ist Dock-orientiert. |
| `sample/.../control/service/impl/DrcServiceImpl.java` | Kein aktiver DRC-Kanal | Separater späterer Architekturzweig; keine Freigabe durch bloße Repo-Kompatibilität. |
| `sample/.../component/websocket` | `backend/tsa-hub.js`, Pilot-Authentifizierung | Bereits separates TSA-WebSocket-Modul; kein Ersatz durch Demo erforderlich. |

## Dieser Branch-Baustein

- `backend/dji-service-reply-contract.js`: prüft nur `thing/product/{gateway_sn}/services_reply`; verwirft Retained-Pakete, ungültige IDs/Gateway-Zuordnungen, zu große JSON-Nachrichten und veraltete/zu zukünftige Zeitstempel.
- Liefert nur erlaubte Felder (Gateway, `tid`, `bid`, optionale Methode, Zeitstempel, Status, Result-Code, terminal). Keine Payload-/Secret-Persistenz.
- `correlateServiceReply` erfordert eine exakt passende ausstehende Anforderung einschließlich Gateway, `tid`, `bid`, optionaler Methode und Ablaufzeit; Zwischenstatus ist noch kein Erfolg.
- Es gibt **keine** MQTT-Subscriptions, Publisher, Flug- oder MinIO-Schreiboperationen und **keinen** Import in `backend/server.js`. Ein bestandener Unit-Test ist kein Cloud-API-1.18-Hardware-Nachweis.

Test lokal im SkyHub-Repository: `node --test backend/test/dji-service-reply-contract.test.js`. Der vorhandene Test-Runner nimmt die neue Datei künftig durch `node --test backend/test/*.test.js` auf.

## Reihenfolge für Folgeschritte

1. `services_reply` im existierenden MQTT-Eingang nur lesend an den validierten Contract koppeln; ohne pending Command dürfen Replies keinerlei Aktion auslösen. Diagnose nur als aggregierte Zähler ohne IDs und Rohdaten.
2. Einen separaten, explizit deaktivierten `requests`-Eingang entwerfen. `storage_config_get` mit MinIO-STS als isolierten Handler implementieren und mit Least-Privilege-/Fremdworkspace-Tests absichern; keine Ausgabe produktiver Zugangsdaten in Tests oder Logs.
3. Pilot-2-`api`/`media`-Module und HTTPS-Endpunkte gegen die gerätespezifische offizielle Cloud-API-1.18-Dokumentation abgleichen.
4. Erst danach Wayline-State-Machine und Dienste zu Missionsaufträgen; keine simulierte Flugbereitschaft und kein Start realer Flüge ohne getrennte Hardwarefreigabe.

## Referenzen

- https://github.com/dji-sdk/DJI-Cloud-API-Demo/tree/main/cloud-sdk/src/main/java/com/dji/sdk/mqtt
- https://github.com/dji-sdk/DJI-Cloud-API-Demo/blob/main/sample/src/main/java/com/dji/sample/component/oss/service/impl/MinIOServiceImpl.java
- https://github.com/dji-sdk/DJI-Cloud-API-Demo/blob/main/sample/src/main/java/com/dji/sample/wayline/service/impl/FlightTaskServiceImpl.java
- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/
- https://developer.dji.com/doc/cloud-api-tutorial/cn/api-reference/pilot-to-cloud/mqtt/topic-definition.html
