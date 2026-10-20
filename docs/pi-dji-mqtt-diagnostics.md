# Raspberry Pi: DJI Pilot 2 / EMQX MQTT Diagnose

**Ziel:** Datenfluss verifizieren, ohne bestehende SkyHub-, AeroNexus-, Mosquitto- oder EMQX-Dienste zu verändern.

## Bestätigte Topologie (20.10.2026)

| Komponente | Endpunkt |
|---|---|
| Pi MQTT / EMQX | `Pi-LAN-IP:1884` -> `skyhub_emqx:1883` |
| Unabhängiger Mosquitto | `Pi-LAN-IP:1883` (nicht für SkyHub) |
| Altes SkyHub Backend | Host HTTP `4000` |
| SkyHub Next | Host `127.0.0.1:4001` -> Container `4000` |

Bereits beobachtet: `connections.count=2`, `subscriptions.count=6`,
`messages.received=0`, `messages.delivered=0`, `packets.publish.received=0`.
Als Clients wurden nur `SkyHub_Cloud_Server_Core` und
`aeronexusadvanced-osd-...` angezeigt, jeder mit 3 Subscriptions.
**Es war zu diesem Zeitpunkt kein DJI Pilot 2 MQTT-Client verbunden.**
Die Werte sind Broker-Zähler seit Reset/Neustart, keine Langzeithistorie.

Die vorhandene SkyHub-API liefert auf `/api/health` HTTP-HTML
`Cannot GET /api/health`, da diese Route nicht Teil des alten Backends ist.
Erst SkyHub Next implementiert einen solchen Endpunkt.

## Lesende Diagnose während des Pilot-2-Verbindungsversuchs

Update der neuen Git-Arbeitskopie:

```bash
cd ~/Projekte/SkyHub-Next
git pull --ff-only
bash scripts/pi-mqtt-observe.sh 30
```

Der Beobachter ruft nur die aggregierten `emqx ctl broker metrics` und
`broker stats` ab. Er erstellt **keine** MQTT-Client-Verbindung, keine
Subscription und keinen Publish. Während der 30 Sekunden Pilot 2 mit
einer bereits konfigurierten Cloud-Plattform verbinden. Zwischen den
beiden Zählerständen dürfen die bestehenden Dienste weiterlaufen.

- `connections.count` steigt: ein zusätzlicher MQTT-Client könnte
  verbunden sein, Identität und Erfolg sind damit noch nicht bewiesen.
- `packets.publish.received` steigt: irgendein Client sendet MQTT PUBLISH.
  Dies beweist **noch nicht**, dass die Nachricht von DJI stammt.
- `messages.received` steigt: der Broker hat Nachrichten registriert;
  die genaue Semantik ist brokerversionsabhängig.
- Alle Nachrichtenzähler bleiben gleich: während des Intervalls kamen
  keine neuen Publish-Nachrichten an.
- Fallende Zähler: Neustart/Reset während der Messung, Intervall nicht
  auswertbar.

Bei erforderlicher Clientzuordnung (Ausgabe enthält potentiell vertrauliche
IP-Adressen/Client-IDs und Nutzernamen):

```bash
docker exec skyhub_emqx emqx ctl clients list
```

Seriennummern, private IPs und Zugangsdaten vor Weitergabe entfernen.
Keine MQTT-Nutzdaten, Tokens oder Secrets veröffentlichen.

## Warum der Broker allein Pilot 2 nicht verbindet

DJI Cloud API verlangt eine H5-Webview-Anmeldeseite, gültige Cloud API App
ID/Key/License, Token-/Workspace-Flows und JSBridge-Initialisierung des
`thing`-Cloudmoduls. Erst dadurch bekommt Pilot 2 MQTT-Host,
Anmeldedaten und Verbindungsparameter und startet eine eigene MQTT-Session.

- In Pilot 2 unter **Cloud Services -> Open Platforms** ist eine
  **HTTP(S)-H5-Webseite** einzutragen, nicht `mqtt://...:1884`.
- Der MQTT-Endpunkt, der anschließend vom Cloudmodul verwendet wird,
  muss auf die **Pi-LAN-IP mit Port 1884** zeigen. Der Docker-interne Hostname
  `host.docker.internal` ist dafür nicht geeignet; dieser ist nur für
  den SkyHub-Next-Backend-Container bestimmt.
- Ein funktionierendes Anmeldeformular allein beweist weder eine gültige
  DJI-Lizenzprüfung noch eine gestartete MQTT-Verbindung.
- SkyHub Next enthält jetzt eine **optional aktivierbare** H5-/JSBridge-
  Pilot-2-Anmeldestrecke mit Lizenzprüfung und `thing`-Initialisierung.
  Die produktive DJI-Funktionalität ist noch nicht durch Hardware-Tests,
  Broker-ACLs und vollständige Cloud-API-Replies bestätigt. Der neue
  Dienst sendet selbst weiterhin keine Flugsteuerungskommandos.
  Keine Credentials oder App-Keys in das Git-Repository einchecken.
- Eine weitere bereits existierende lokale Cloud-Plattform könnte das
  Onboarding bereitstellen; sie wurde durch die Brokerstatistik jedoch
  **nicht bestätigt**.

Ein optionaler Test der bestehenden Route, ohne Veränderungen:

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' --max-time 5 http://127.0.0.1:4000/pilot-login
```

Selbst HTTP 200 ist kein Beleg einer funktionsfähigen DJI-JSBridge.

## DJI-Referenzen

- [Cloud API: Pilot access to cloud](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-access-to-cloud.html)
- [Cloud API: HTTPS/Webview](https://developer.dji.com/doc/cloud-api-tutorial/en/overview/basic-concept/https.html)
- [Cloud API: MQTT](https://developer.dji.com/doc/cloud-api-tutorial/en/overview/basic-concept/mqtt.html)
- [DJI Demo Deploy / Pilot 2 Login](https://developer.dji.com/doc/cloud-api-tutorial/en/quick-start/source-code-deployment-steps.html)

Die DJI-Beispieldemo verwendet ältere Cloud-API-Stände und darf nicht als
verifizierte Cloud-API-1.18-Implementierung betrachtet werden.
