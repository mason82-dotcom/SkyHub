# SkyHub Enterprise Command Center (v3.0 - Complete Local Infrastructure)

Eigenständiges Backend- und Frontend-System zur Steuerung, Telemetrie-Überwachung und automatisierten Auswertung von DJI Enterprise-Drohnen (Mavic 3 Enterprise, Thermal, Multispectral), optimiert für das lokale Netzwerk (`192.168.178.*`).

## 🛠️ Vorkonfigurierte Dienste in Docker Compose

| Dienst | Technologie | Port | Beschreibung |
|---|---|---|---|
| **Backend API & WebSockets** | Node.js Express / Socket.IO | `4000` | REST API, Pilot 2 Login Service & WebSocket Orchestrator |
| **Relational / GIS Database** | PostGIS (PostgreSQL 15) | `5432` | Geo-Räumliche Datenbank mit GIST-Indizes für Telemetrie & Annotations |
| **In-Memory Telemetry Cache** | Redis 7 Alpine | `6379` | High-Frequency OSD Telemetrie Caching & Pilot 2 Session Store |
| **S3 Objektspeicher** | MinIO | `9000` / `9001` | S3-kompatibler Speicher für KMZ-Flugpläne, R-JPEG & TIFF Bilder |
| **MQTT 5.0 IoT Broker** | EMQX 5.3 | `1883` / `18083` | DJI IoT Thing Model Message Broker |

## 🚀 Schnellstart

1. **Repository klonen & in Ordner wechseln:**
   ```bash
   git clone https://github.com/mason82-dotcom/SkyHub.git
   cd SkyHub
   ```

2. **Gesamte Infrastruktur im lokalen Netz starten:**
   ```bash
   docker-compose up -d --build
   ```

3. **Zugriffspunkte:**
   * **Web Dashboard:** `http://<IP-Ihres-Servers>:4000`
   * **MinIO S3 Console:** `http://<IP-Ihres-Servers>:9001` (User: `skyhub_minio_admin`, Pass: `secure_minio_password_123`)
   * **EMQX Dashboard:** `http://<IP-Ihres-Servers>:18083` (User: `admin`, Pass: `public`)
   * **PostGIS DB:** `localhost:5432` (User: `skyhub`, Pass: `secure_local_db_password_123`)
   * **Redis Cache:** `localhost:6379`

## 🔑 DJI Pilot 2 Login Config

Für das Onboarding von **DJI Pilot 2** auf der Fernsteuerung in der Cloud-Server Konfiguration:
* **Server-Adresse:** `http://<IP-Ihres-Servers>:4000`
* **Account/Passwort:** Im lokalen Modus (`DISABLE_AUTH=true` in `.env`) wird jeder Anmeldeversuch automatisch akzeptiert und eine Session in **Redis** angelegt.
