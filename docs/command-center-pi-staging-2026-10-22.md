# Command Center – isolierte Raspberry-Pi-Staging-Abnahme

Stand: 22.10.2026. Quellbranch: `feature/command-center-loopback-stage-20261022`.
Diese Phase stellt **keinen** zweiten Backend-/MQTT-/MinIO-/Datenbank-Stack bereit.
Der vorhandene SkyHub-Next-Backend-Prozess bleibt auf `127.0.0.1:4001`.
Die Browser-Vorschau bindet **ausschließlich** `127.0.0.1:4015`.

## 1. Vorbedingungen

- Der Pi verfügt über einen erreichbaren **bestehenden** SkyHub-Next-Dienst
  mit `GET http://127.0.0.1:4001/api/health` und `readOnly: true`.
  `status=degraded` wird bewusst zugelassen und muss untersucht werden:
  keine Behauptung, dass MQTT, Drohne oder RC online sind.
- Node.js ist installiert; es werden keine npm-Pakete für den Staging-Server benötigt.
- Der Staging-Checkout wird vom Produktiv-Checkout getrennt angelegt.
  Keine Änderung von dessen `.env`, Docker-Projekt, S3-Volumes oder Redis.
- Für das Medieninventar muss der vorhandene Backend-Dienst bereits
  `SKYHUB_MEDIA_ENABLED=true` konfiguriert haben; dieses Staging ändert das
  Flag **nicht**. Ohne dieses Feature zeigt die Oberfläche „nicht aktiviert“.

## 2. Optional: aktuellen Pi-Stand nur lesen

Im Pi-Terminal (keine Geheimnisse ausgeben):

```bash
printf 'Produktiver Checkout: '
git -C ~/Projekte/SkyHub-Next status --short --branch
curl -fsS --max-time 4 http://127.0.0.1:4001/api/health |
  python3 -c 'import json,sys; h=json.load(sys.stdin); print("readOnly=",h.get("readOnly"),"status=",h.get("status"),"mqtt=",h.get("mqtt"),"subscribed=",h.get("subscribed"))'
ss -ltnH | awk '$4 ~ /:(4001|4015|1884)$/ {print "Listener vorhanden:",$4}'
```

**Keine** kompletten `.env`-, Docker-`inspect`-, Geräte- oder MQTT-Payloads
in Support-Ausgaben kopieren.

## 3. Isolierten Git-Worktree anlegen (bewusster Schreibvorgang nur in neuem Verzeichnis)

Nach GitHub-Merge den freigegebenen Commit ausdrücklich wählen.
Der folgende Befehl verändert weder produktiven Checkout noch Dienst:

```bash
git -C ~/Projekte/SkyHub-Next fetch origin
git -C ~/Projekte/SkyHub-Next worktree add --detach \
  ~/Projekte/SkyHub-CommandCenter-Stage \
  origin/develop/skyhub-integrated-readonly-20261022
cd ~/Projekte/SkyHub-CommandCenter-Stage
git log -1 --format='%h %s'
```

**Wichtig:** Nicht versehentlich `main`, ein altes Feature-Branch oder
einen produktiven `git pull` für die Staging-Vorschau verwenden.

## 4. Nur lesende Vorprüfung

```bash
cd ~/Projekte/SkyHub-CommandCenter-Stage
node scripts/command-center-stage.js --check
```

Sie prüft nur das Vorhandensein der freigegebenen statischen Dateien
und den Backend-Health-Contract. **Keine** IDs, Speicherobjekte,
Passwörter, MQTT-Nachrichten oder Schreibaktionen werden gelesen bzw. gesendet.

## 5. Temporäre Vorschau starten – ohne neue Container

```bash
node scripts/command-center-stage.js --serve
```

Die Vorschau läuft im Vordergrund. Lokale Adresse:
`http://127.0.0.1:4015/command-center.html`.
Beenden mit `Ctrl+C`. Für den Zugang vom PC ausschließlich einen
SSH-Local-Forward verwenden (keine Bindung an `0.0.0.0`,
keine neue Caddy-LAN-Route):

```bash
ssh -N -L 4015:127.0.0.1:4015 mason@rpi5
```

Danach am **gleichen PC** `http://127.0.0.1:4015/command-center.html`
aufrufen. Bei SSH vom Mobilgerät muss der lokale Portforward auch
auf demselben Gerät eingerichtet sein.

### Was der Gateway zulässt

- Statische Seiten `index.html`, `command-center.html`,
  lokale Command-Center-/WPML-JavaScript-Dateien.
- Nur bekannte **GET**-Routen für den Geräte-, Health-, Topologie-,
  Event-, Track- und MinIO-Lesestatus.
- `/socket.io/` WebSocket-Upgrade und die Engine.IO-Polling-Handshake-
  Route; die Socket-Authentifizierung und Datenberechtigung verbleiben
  vollständig beim bestehenden Backend.
- Kein Remote-Zugriff: TCP-Listener ausschließlich `127.0.0.1`.
  Keine zusätzlichen DJI-Cloud-/MQTT-Sitzungen.
- Keine DJI-Service-, Pilot-2-Admin-, Media-Upload-, STS-,
  Objekt-DELETE- oder sonstigen Backend-Schreibendpunkte.

Die **Socket.IO-POST-Ausnahme** dient nur der Transport-/Auth-Aushandlung.
Sie darf nicht als generelle Freigabe für Backend-Schreibaktionen
interpretiert werden. Der bestehende Socket.IO-Server nimmt nur
Snapshots/Status vor; Änderungen an diesem Vertrag müssen gesondert
geprüft werden.

## 6. Manuelle Abnahme mit realem, bereits vorhandenen Datenpfad

1. Die Seite darf **keine** simulierten Geräte, HMS-Ereignisse,
   Akkuwerte, Wärmebilder oder Vegetationskarten anzeigen.
2. Ohne Berechtigung muss `/api/devices` den Zugriff verweigern
   (sofern kein bewusst konfigurierter LAN-Lesezugang besteht).
3. Mit gültigem View-Token muss die Geräteübersicht mit
   `/api/devices` übereinstimmen; fehlende OSD-Felder bleiben „—“.
4. `MQTT=false` oder `subscribed=false` wird nicht als „LIVE“
   behauptet. Bei aktivem Drohnenbetrieb: aktualisierte OSD-Felder,
   frische HMS-Warnungen und GPS-Positionen auf dem Dashboard prüfen.
5. MinIO nur bei bestehendem aktivem Media-Feature:
   Buckets anzeigen, Präfix auswählen, Seite 1/Nächste/Vorherige testen.
   Keine Objektinhalte oder URL-Tokens exportieren.
6. WebSocket-Verbindung kurz trennen: Zustände müssen altern,
   erneuter Connect darf keine alten gerätespezifischen Daten
   einer anderen View-Token-Sitzung übernehmen.
7. Vorhandene WPML-Editor-/Survey-Seiten über die Navigation öffnen.
   Sie bleiben **Offline-Werkzeuge**, `flightReady=false`,
   niemals DJI-Missionsausführung.

## 7. Abnahmeschranken

Die CI prüft zusätzlich Unit-/Browser-Harness-, Socket-Upgrade-,
Route-Allowlist-, Schema- und Staging-Port-Tests. Das ersetzt
**keine** reale Raspberry-Pi-, Browser-, Pilot-2- oder MinIO-Hardwareabnahme.

**Nicht Teil dieser Phase:** Automatischer Staging-Service,
Systemd-Timer, Caddy-Änderung, Deploy, Neustart, Docker-Compose-Up,
MQTT-Broker-Benutzer, STS-Credentials, Backup-/Restore-Ausführung,
Workerstart oder Datenbankmigration.

Ein isolierter Worktree lässt sich nach Stoppen der Vorschau
mit `git -C ~/Projekte/SkyHub-Next worktree remove
~/Projekte/SkyHub-CommandCenter-Stage` entfernen.
