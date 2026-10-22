# MinIO STS AssumeRole: signierter Aussteller und Berechtigungsabnahme

Stand: 22.10.2026. **Nur Entwicklung/CI – nicht auf den Raspberry Pi deployt.**

## MinIO API und Sicherheitsmodell

SkyHub nutzt für Pilot 2 den **HTTPS**-Medienpfad. Der neue `backend/minio-sts-issuer.js` ist ein echter, SigV4-signierter MinIO-STS-`AssumeRole`-Client (POST, `Version=2011-06-15`, `DurationSeconds=900`, `Policy=<JSON>`). Er benötigt **einen gesonderten, nicht administrativen MinIO-Benutzer** mit für die Testumgebung beschränktem Eltern-IAM und einem HTTPS-Origin. Es werden keinerlei `process.env`-Zugangsdaten automatisch ausgelesen. Weder `server.js` noch Docker Compose importieren oder verwenden diesen Aussteller.

MinIO-Dokumentation:
- https://github.com/minio/minio/blob/master/docs/sts/assume-role.md
- https://docs.min.io/aistor/developers/security-token-service/assumerole/

**Wichtig:** Laut MinIO beträgt die Mindestlaufzeit bei `AssumeRole` 900 Sekunden. Ein 60-Sekunden-STS-Token ist auf diesem Pfad nicht dokumentiert/zu erwarten. SkyHub fordert exakt 900 s an, überprüft die serverseitige Ablaufzeit und gibt nur die verbleibenden Sekunden aus.

## Erzeugte Session-Policy

Für den validierten Workspace `<workspace-uuid>` und eine kryptografisch zufällige `<session-id>` mit 128 Bit Entropie:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject"],
    "Resource": ["arn:aws:s3:::dji-cloud/<workspace-uuid>/media/<session-id>/*"]
  }]
}
```

Kein `GetObject`, `DeleteObject`, `ListBucket`, Bucketauswahl durch den Client, keine fremden Workspaces. Die Inline-Policy ist eine zusätzliche Einschränkung der Elternpolicy, **keine** globale Sicherheitsgarantie. Die IAM-Policy des ausstellenden Benutzers muss in einer dedizierten MinIO-Instanz konfiguriert und mit echten STS-Sessions überprüft werden. Die Session-Policy genügt allein nicht als produktive Freigabe; Benutzername/Schlüssel des Ausstellers dürfen niemals `MINIO_ROOT_USER` oder einen `consoleAdmin`-Benutzer verwenden.

Die signierte Anfrage verwendet den fest konfigurierten HTTPS-Origin, SigV4-`Authorization`, Body-SHA256 und UTC-Zeitstempel. Der Transport folgt keinen Redirects, erzwingt die Standard-TLS-Zertifikatsprüfung, begrenzt den Antwortkörper auf 32 KiB und setzt 5 Sekunden Timeout. Es werden ausschließlich vier Credential-/Ablauffelder aus dem MinIO-XML gelesen; `DOCTYPE`, `ENTITY`, doppelte Elemente und ungültige Werte werden abgewiesen.

## Anbindung an den vorhandenen Pilot-Medien-STS-Vertrag

`createMinioStsIssuer({endpoint,accessKeyId,secretAccessKey,region})` liefert eine `issueGrant`-Funktion. Sie kann der bereits vorhandenen `createPilotMediaStsHandler`-Schnittstelle **nach** dem realen Berechtigungsnachweis übergeben werden. Der bestehende HTTPS-Handler bleibt standardmäßig **nicht verdrahtet** und erfordert weiterhin Workspace-Principal, Tokenprüfung, eigenständige Rate-Limits und eine streng konfigurierte MinIO-Zieladresse.

**Kein echter Pi-Verbindungstest durchgeführt.** Das vorhandene MinIO-Image/Release auf dem Pi und seine tatsächliche STS-Konfiguration wurden hier nicht geprüft; die Signatur und die XML-Verarbeitung sind aktuell mit synthetischen MinIO-Antworten validiert.

## Berechtigungsabnahme gegen Wegwerf-MinIO

`backend/minio-sts-attestation.js` enthält `attestPutOnlySession`. Sie erhält einen extern initialisierten S3-Client mit **temporären** STS-Credentials, eine Workspace-UUID, den zugehörigen Session-Präfix und `confirmIsolated:true`. Der S3-Client **muss** zuvor auf eine isolierte MinIO-Instanz mit Wegwerf-Bucket `dji-cloud` gesetzt werden; Skript und Tests konfigurieren keine externen Zielserver.

Die Funktion verwendet ausschließlich neu erzeugte Testobjektschlüssel und prüft:

1. `PutObject` unter dem eigenen Session-Präfix **erlaubt**.
2. `GetObject` des eigenen frisch hochgeladenen Testobjekts **403 AccessDenied**.
3. `DeleteObject` desselben Testobjekts **403 AccessDenied**.
4. `ListObjectsV2` unter eigenem Präfix **403 AccessDenied**.
5. `PutObject` unter fremdem Workspace **403 AccessDenied**.

**Jeder** unerwartete Erfolg führt zum Testfehler. HTTP 404, Verbindungsfehler oder allgemeine Exceptions zählen nicht als Berechtigungsverweigerung. Da ein reiner Upload-Benutzer den hochgeladenen Testgegenstand nicht löschen kann, muss das Wegwerf-Testbucket nach der Abnahme durch den isolierten Testadministrator bereinigt werden. **Niemals** gegen produktive Missionsdaten oder das produktive MinIO-Bucket ausführen.

## Automatisierte reale Abnahme in GitHub Actions

Der CI-Job `isolated-minio-sts` startet mit `scripts/ci-minio-sts-live.sh` eine **temporäre TLS-S3-Instanz auf Basis von PGSTY SILO (MinIO-kompatibler Fork, Release 2026-10-18)** in einem separaten Docker-Netz. Die eigens für den Workflow erzeugten Testidentitäten (`ci_sts_root` und der nicht administrative `skyhub_sts_ci_upload`) besitzen keine produktiven Schlüssel. Der Test erstellt den Wegwerf-Bucket `dji-cloud`, bindet die Elternpolicy `scripts/ci-minio-sts-parent-policy.json` an den Testbenutzer und verwendet danach den **echten** signierten `AssumeRole`-Aufruf mit der noch engeren Workspace-Session-Policy.

Das Skript `scripts/ci-minio-sts-live.js` prüft mit den echten STS-Credentials die fünf Operationen aus dem Abschnitt oben gegen MinIO. Anschließend werden Container, Netzwerk und temporäres Zertifikat automatisch entfernt. Keine Portfreigabe außer `127.0.0.1:19010` auf dem GitHub-CI-Runner.

**Das Vorhandensein des CI-Jobs ist noch kein Erfolgsnachweis:** Nur ein grüner `isolated-minio-sts`-Job beweist die End-to-End-Funktion gegen die dort gewählte MinIO-Version. Eine erfolgreiche CI-Abnahme ersetzt außerdem nicht den separaten Versions-/TLS-/Policy-Abgleich auf dem Raspberry Pi.

## Status und Abnahmekriterien

- `node --test backend/test/minio-sts-issuer.test.js backend/test/minio-sts-attestation.test.js`: synthetische Unit-/Adaptertests im CI.
- Echter Test gegen isoliertes MinIO mit einem dedizierten Built-in-User und begrenzter Elternpolicy: **noch ausstehend**.
- Kompatibilität der realen Pi-MinIO-Version mit STS-`AssumeRole`: **noch ausstehend**.
- Nachweis für große M3M-Bilder/Multipart-Uploads: **noch ausstehend**; nur `PutObject` könnte für bestimmte DJI-SDK-Resumefunktionen unzureichend sein.
- Keine Änderung an EMQX, Pilot-Webview, Caddy, Pi-Docker-Volumes, produktiven Daten oder externen Geheimnissen.

Folgeschritt: isolierte echte MinIO-STS-Session mit Negativtests in CI; danach Upload-Registrierung und Pilot-2-`api`/`media`-Module schrittweise unter einem deaktivierten Feature-Flag entwickeln.

**Image-Verfügbarkeit (22.10.2026):** Das bisherige Compose-Image `minio/minio:RELEASE.2023-09-04T19-57-37Z` ist von Docker Hub derzeit nicht anonym abrufbar; der erste Testlauf scheiterte deshalb bereits beim Pull, vor einem STS-Aufruf. Der CI-Workflow nutzt ausschließlich für den Wegwerftest das verfügbare `pgsty/silo` und `pgsty/mc` (beide `RELEASE.2026-10-18T00-00-00Z`). Ein erfolgreicher SILO-Test ist **kein** Versionsnachweis für die bestehende Pi-MinIO-Installation. Es wurde weder die produktive Compose-Datei noch ein MinIO-Datenvolume umgestellt.
