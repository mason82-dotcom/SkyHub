# DJI Flight Areas: signierter Labor-Prüfbeleg (Offline-Entwurf)

**Stand: 24.10.2026** · Dieses Review-Modul ist auf
[PR #75](https://github.com/mason82-dotcom/SkyHub-Next/pull/75)
gestapelt, welcher wiederum von
[PR #70](https://github.com/mason82-dotcom/SkyHub-Next/pull/70) abhängt.
**Kein** Main-Merge, kein MQTT, keine Hardwareprüfung, kein Raspberry-Pi-Deployment.

## Entscheidende Vertrauensgrenze

**Ein Ed25519-signiertes Manifest authentifiziert nur die signierende
Labor-/Reviewer-Identität und die Unverändertheit ihrer Behauptung.**

Es liefert **keinen** unabhängigen Beweis, dass das DJI-Fluggerät die
Datei installiert, aktiviert oder zur aktuellen Mission übernommen hat.
Es ist insbesondere **keine DJI-Device-Attestation**.

Deshalb setzt die erfolgreich geprüfte Ausgabe:
`reviewerSignatureValid=true` und `claimMatchesTarget=true`, aber
`independentDeviceReadbackVerified=false`,
`deviceInstallationVerified=false`, `revisionVerified=false`,
`syncVerified=false`, `flightReady=false` und `hardwareVerified=false`.
Dieses PR schafft einen überprüfbaren Belegvertrag, **noch keinen
vertrauenswürdigen Geräte-Readback-Kanal**.

## API und Signatur

Die reine Node.js-Funktion
`verifySignedLabReview({manifestBytes,signatureBase64,trustedSpkiDer,expectedKeySha256,expected,now})`
enthält keine Seiteneffekte. `manifestBytes` sind die originalen
**kanonischen** UTF-8-JSON-Bytes, höchstens 2048 Bytes.

Das Schema muss exakt die folgenden Felder **in dieser Reihenfolge**
enthalten, ohne zusätzliche Felder oder Whitespace außerhalb
`JSON.stringify`:

```json
{
  "schema": "skyhub-flight-area-lab-review-v1",
  "source": "operator_reviewed_lab",
  "workspaceId": "11111111-2222-4333-8444-555555555555",
  "gatewaySn": "EXAMPLE-DOCK",
  "revision": 1,
  "fileSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "challengeNonce": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "observedAt": 1792740000000,
  "expiresAt": 1792740060000,
  "claim": "file_present_in_lab_readback"
}
```

Das obige Dokument ist ein **rein synthetisches Testbeispiel**,
kein tatsächlicher DJI-Beleg.

Signierte Bytes: UTF-8 von
`SkyHub-Next/flight-area/lab-review/v1\0`
unmittelbar gefolgt von den unveränderten kanonischen JSON-Bytes.
Die detached Ed25519-Signatur wird als strikt kanonisches Base64
(64 Signaturbytes) übergeben.

Der öffentliche Ed25519-SPKI-DER-Schlüssel und **sein SHA-256-Fingerprint**
sowie die erwarteten Werte müssen aus einer
**separat authentifizierten, serverseitig konfigurierten Vertrauensquelle**
stammen. Sie dürfen **nicht** aus einem vom Browser/MQTT-Gerät
eingereichten Manifest entnommen werden. Keine privaten Signaturschlüssel
oder Beispiel-Produktionszugänge in Git einchecken.

`expected` enthält die vertrauenswürdige Workspace-UUID,
Gateway-Serienkennung, positive Sollrevision, SHA-256-Dateidigest
und eine je Prüfvorgang frisch bereitgestellte 16-Byte-Challenge
als 32 Hexziffern. Ein neuer Prüfversuch braucht **eine neue
Challenge**, die serverseitig an die Zielrevision gebunden und
gespeichert werden muss. Die Implementierung ist stateless und
**garantiert selbst keine Challenge-Einmalverwendung**.

## Strikte Prüfschritte

1. Vertrauenskontext und Fingerprint **vor** Signaturprüfung validieren.
2. Kanonisches JSON, bekannte Felder, zulässige Feldtypen und
   Signaturgröße prüfen; unbekannte Felder, duplizierte JSON-Schlüssel
   oder nicht kanonische Schreibweise ablehnen.
3. Ziel-Werte gegen vertrauenswürdige Sollwerte vergleichen:
   Workspace, Gateway, Revision, Datei-SHA-256, Challenge.
4. `observedAt` und `expiresAt` prüfen: Laufzeit höchstens 300 s;
   Zukunftstoleranz höchstens 30 s; abgelaufene Nachweise ablehnen.
5. Detached Ed25519-Signatur gegen **gepinnte** öffentliche
   SPKI-Identität verifizieren, mit eigenem Domain-Separator.
6. Nur konstante Statusfelder zurückgeben; nie Rohmanifest,
   Challenge, Schlüsselmaterial, Gerätekennung, Prüfsumme,
   Dateiname oder Signatur zurückgeben.

## Ausdrückliche Grenzen und offene Gates

- **Keine** Anbindung in `server.js`, keinerlei Middleware, Broker-
  Abonnement, `events_reply`, DJI-Kommando, Upload, Datenbankmigration,
  Compose-Änderung oder Operator-UI.
- **Keine** Behauptung, DJI-Geräte würden Ed25519-Labor-Manifeste erzeugen.
  Das Format ist **SkyHub-eigen** und liegt nicht im DJI-Cloud-API-Protokoll.
- Erfolgreiche Signaturvalidierung besagt nichts über den Inhalt einer
  signierten Behauptung, wenn Reviewer oder Datenquelle kompromittiert sind.
- Für echte Device-Attestation fehlen belegter Hardware-Readback-Kanal,
  Device-Identität, Firmware-Vertrauensanker, unabhängige Kette,
  Replay-Speicher mit persistenter Challenge-Consumption, Widerruf,
  Schlüsselrotation und eine komplette Hardware-Abnahme.
- Nicht aus dem bestehenden Monitor `device_reported_target`
  automatisch auf `syncVerified=true` umstellen.

## Offline-Test

```sh
node --check backend/dji-flight-area-lab-review.js
node --test backend/test/dji-flight-area-lab-review.test.js
npm test --prefix backend
```

Node.js 22 `node:crypto` genügt; keine neue Dependency erforderlich.
Der vollständige CI-Job führt ohnehin `backend/test/*.test.js` aus.

Weiterführend: [Ereignisgrundlage](dji-flight-area-integration.md),
[Sync-Monitor](dji-flight-area-sync-monitor.md),
[Integrationsregeln](integration-priorities-2026-10-23.md).
