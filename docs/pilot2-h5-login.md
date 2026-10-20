# DJI Pilot 2 – H5 Cloud-Anmeldung auf dem Raspberry Pi (Entwicklungsstand)

## Beobachtung vom 20.10.2026

Foto des RC-Displays: Drittanbieter-Cloud-Dienste öffnet
`http://192.168.178.63:4000/pilot-login`, nach „Verbinden“ erscheint
`Cannot GET /pilot-login`. Der Host wurde per HTTP erreicht, aber der
**alte produktive SkyHub-Dienst auf 4000** hat keine passende GET-Route.
Die Schaltfläche „Abmelden“ bestätigt keine MQTT-Session.

EMQX auf Host **1884** hatte nur die zwei Clients
`SkyHub_Cloud_Server_Core` und `aeronexusadvanced-osd-...` bei
`packets.publish.received=0`. DJI Pilot 2 war in dieser Momentaufnahme
**nicht als MQTT-Client sichtbar**. Ein anderer Cloud-Anmeldeablauf wurde
nicht nachgewiesen.

## Neue Umsetzung auf dem isolierten Entwicklungsbranch

- `GET /pilot-login`: statische responsive H5-Webview-Seite statt 404.
- `GET /api/pilot/status`: nur `configured`, fehlende **Namen**
  der Parameter, Port 1884 und HTTPS-Erfordernis, keine Geheimnisse.
- `POST /api/pilot/bootstrap`: separate, mindestens 32 Zeichen lange
  Pilot-Zugangstoken-Prüfung; ausschließlich über vertrauenswürdiges HTTPS.
  Liefert die drei DJI-Lizenzangaben, dedizierte MQTT-Publisher-Zugangsdaten
  und Workspace-Daten nur für die autorisierte DJI-Webview.
- H5 ruft `platformVerifyLicense`, `platformSetWorkspaceId`,
  `platformSetInformation` und danach `platformLoadComponent("thing", ...)`
  auf. DJI verlangt für den MQTT-Host im JSBridge-Thing-Modul
  **`tcp://192.168.178.63:1884`**, nicht `mqtt://...`.
- JSBridge-Fehler und fehlende Freigabe werden offen gezeigt.
  Eine erfolgreich geladene Seite oder Komponente bedeutet **nicht**,
  dass EMQX MQTT-Daten empfangen hat.
- Der optionale Onboarding-Modus ist standardmäßig **deaktiviert**.
  Kein Auto-Login und keine geheimen Default-Passwörter.
- Das `skyhub-next`-Backend bleibt unter `127.0.0.1:4001`
  (im Container weiterhin 4000). Der alte Dienst auf Host 4000
  und die EMQX-/Mosquitto-Portbelegungen werden nicht verändert.
- Keine Flight-Control-MQTT-Publishes durch SkyHub Next. Das RC kann
  nach erfolgreicher Initialisierung eigenständig zum Broker publishen.

## Voraussetzungen für einen realen DJI-Pilot-2-Test

1. Gültige **DJI Cloud API App ID, App Key und App License** über das
   DJI Developer Center beschaffen. Diese Werte nicht in GitHub einchecken.
2. Eigenen, starken `SKYHUB_PILOT_ACCESS_TOKEN` erstellen
   (`openssl rand -hex 32`).
3. Separaten EMQX-Benutzer für **DJI Pilot 2** bereitstellen, dessen
   Broker-ACL die notwendigen Cloud-API-Publish-/Subscribe-Topics erlaubt.
   Die reinen SkyHub-Subscriber-Credentials sind dafür nicht ausreichend.
   Die konkrete Client-Authentisierung und ACL muss am Pi geprüft werden.
4. Einen gültigen Workspace-UUID erzeugen (`python3 -c 'import uuid;print(uuid.uuid4())'`).
5. SkyHub Next über einen **vertrauenswürdigen HTTPS-Reverse-Proxy**
   bereitstellen, der lokal auf `127.0.0.1:4001` weiterleitet.
   Der Browser muss der TLS-Zertifikatskette vertrauen. Nicht die
   direkte, unverschlüsselte Pi-Port-4001-Bindung als vollständige
   Cloud-Integration ausgeben.
6. Die Werte in `~/Projekte/SkyHub-Next/.env` setzen und explizit
   `SKYHUB_PILOT_ENABLED=true` aktivieren. `SKYHUB_BIND_ADDRESS`
   muss auf `127.0.0.1` bleiben.
7. Die tatsächlich erreichbare **HTTPS-URL** des Proxys auf Pilot 2
   als Plattform-URL eintragen, zum Beispiel
   `https://skyhub.example.invalid/pilot-login` als rein schematisches
   Beispiel (kein bereitgestellter DNS-Name).
8. Auf der H5-Seite den separaten Pilot-Zugangstoken eingeben. Danach
   Verifizierung, Modul-Initialisierung und MQTT-PUBLISH-Eingang prüfen.

## Lokale, noch nicht produktive Prüfung

```bash
cd ~/Projekte/SkyHub-Next
git pull --ff-only
node --test backend/test/*.test.js
bash scripts/pi-preflight.sh
```

Vor einer Inbetriebnahme zuerst das tatsächliche Deployment,
die Pi-Speicherstabilität und die EMQX-Authentisierung prüfen.
Das neue System **nicht** unkontrolliert mit `docker compose up`
auf dem Produktiv-Pi starten.

Ein lokaler `curl http://127.0.0.1:4001/pilot-login` ist erst nach
dem gesonderten Start von SkyHub Next sinnvoll. Der bisherige Endpunkt
`http://192.168.178.63:4000/pilot-login` bleibt unverändert und
liefert weiterhin `Cannot GET`, solange die alte App dort läuft.

## Offene Hardwarevalidierung

- DJI Pilot 2: Firmware- und modellabhängige JSBridge-Callback-Signatur
  und Rückgabewerte auf der echten Fernsteuerung prüfen.
- `thing`-Connect-State und EMQX-Client-ID korrelieren; insbesondere
  `packets.publish.received` muss nach dem Onboarding ansteigen.
- DJI Cloud API 1.18 Kompatibilität gerätespezifisch verifizieren.
- Eventuelle fehlende `status_reply`- und `events_reply`-Rückkanäle
  sind vor produktiver Cloud-Betriebsfreigabe gesondert zu implementieren.
- HTTPS-Proxy, DNS/TLS-Zertifikat und EMQX-ACLs noch nicht bereitgestellt.

## Offizielle DJI-Referenzen

- https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-access-to-cloud.html
- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/jsbridge.html
- https://developer.dji.com/doc/cloud-api-tutorial/en/quick-start/source-code-deployment-steps.html
