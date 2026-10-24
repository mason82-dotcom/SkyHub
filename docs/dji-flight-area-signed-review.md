# DJI Flight Areas – signierter Offline-Reviewvertrag

**Stand:** 24.10.2026 · **Status:** Nur isoliertes Offline-Labor, gestapelt
auf [PR #75](https://github.com/mason82-dotcom/SkyHub-Next/pull/75),
dessen Basis [PR #70](https://github.com/mason82-dotcom/SkyHub-Next/pull/70)
ist. **Nicht** nach `main` gemergt, **nicht** auf dem Raspberry Pi ausgerollt.

## Sicherheitsentscheidung

Ein unabhängiger DJI-Geräte-Readback ist in SkyHub-Next **nicht** belegt.
Die DJI-Methode `flight_areas_sync_progress` meldet den Gerätestatus,
aber selbst bei `synchronized` und passendem berichteten Datei-SHA256
ist keine unabhängige Hardwareprüfung erbracht.

Dieses Modul implementiert deshalb nur den **kryptografisch signierten
Offline-Prüfbeleg eines extern autorisierten Reviewers**. Die Signatur
bestätigt, dass ein vom Betreiber zugelassener Schlüssel genau die
deklarierten Daten signiert hat. Sie bestätigt **nicht**:
- dass ein DJI-Fluggerät die Datei erfolgreich empfangen/aktiviert hat;
- dass das angegebene Artefakt vom Gerät stammt oder überhaupt vorliegt;
- dass Reviewer oder Schlüssel an einen bestimmten DJI-Firmwarestand
  oder realen Einsatz gebunden sind;
- dass eine Mission, ein Luftgebiet oder ein Flug freigegeben wurde.

Deshalb liefert der Verifier auch bei gültiger Signatur immer
`evidenceArtifactInspected=false`,
`independentDeviceReadbackVerified=false`,
`revisionVerified=false`, `syncVerified=false`,
`hardwareVerified=false` und `flightReady=false`.

## Vertrag

`backend/dji-flight-area-signed-review.js` ist eine reine
Node.js-22-Funktion mit `node:crypto`:

```js
inspectSignedFlightAreaReview({
  envelope, expectedWorkspaceId, expectedGatewaySn,
  expectedRevision, expectedFileSha256, approvedKeys, now
});
```

Die erwarteten Felder stammen **ausschließlich aus einem später zu
implementierenden vertrauenswürdigen Workspace-/Gerätekontext**; weder
MQTT-Envelope noch Web-Request dürfen diese Werte selbst autorisieren.
`approvedKeys` ist eine von der Anwendung verwaltete `Map` von
`signerKeyId` auf explizit freigegebene öffentliche **Ed25519**
`KeyObject`-Schlüssel. **Der öffentliche Schlüssel darf nie aus dem
Prüfbeleg selbst als Vertrauensanker übernommen werden.**

### Signierter Inhalt

```json
{
  "schema": "skyhub-flight-area-signed-review-v1",
  "signerKeyId": "offline-reviewer-01",
  "declaration": {
    "reviewKind": "operator-offline-review",
    "workspaceId": "42897e93-d55e-41a4-b744-ec26cefa0bb8",
    "gatewaySn": "DOCK-TEST",
    "revision": 3,
    "fileSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "evidenceSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "reviewId": "672fb402-6c5c-4181-8d71-7da8d03b55f9",
    "issuedAt": 1792800000000,
    "expiresAt": 1792800060000
  },
  "signature": "<base64url-codierte Ed25519-Signatur, 64 Bytes>"
}
```

Die Beispieldaten sind ausschließlich synthetisch und **nicht signiert**.
Keine privaten Schlüssel, Tokens, Dateinamen, Rohhashes oder Gerätedaten
sollen aus dem Verifikationsergebnis weitergereicht werden.

Die zu signierenden Bytes werden **nicht aus dem beliebigen
JSON-Textlayout** übernommen, sondern mit
`reviewSigningBytes(declaration, signerKeyId)` fest definiert:
UTF-8, Domain-Separation
`SkyHub-Next/offline-flight-area-review/v1\n`,
gefolgt vom JSON-Array der neun eindeutigen Werte in fester
Reihenfolge einschließlich der Signer-ID.
Workspace-UUID, Review-UUID und Hashes werden normalisiert; die
DJI-Gatewaykennung bleibt exakt. Alle zusätzlichen oder unbekannten
Felder werden abgelehnt. Die Ed25519-Signatur verwendet SHA-512
intern gemäß Ed25519; **kein** frei wählbarer Hash-Algorithmus.

`evidenceSha256` ist lediglich die Bindung an den Hash eines
extern geprüften Artefakts. Ob dessen tatsächliche Bytes stimmen
oder seine Herkunft vertrauenswürdig ist, ist außerhalb des Moduls.
Die Signer-ID und der zufällige Review-ID-Wert allein verhindern
**keine** Replay-Angriffe: Für produktive Verwendung wären eine
persistente `reviewId`-Deduplizierung, vertrauenswürdige Zeitquelle,
Schlüsselrotations-/Sperrlisten, Wiederanlaufkontrollen und
Auditprotokollierung erforderlich.

### Fail-closed-Regeln

| Prüfung | Ergebnis bei Abweichung |
| --- | --- |
| Workspace/Gateway/Revision/Datei-SHA256 stimmt nicht mit dem vertrauenswürdigen Ziel überein | `target_mismatch` |
| Signer-ID unbekannt, Schlüssel gesperrt oder nicht öffentlicher Ed25519-Schlüssel | `unapproved_signer` |
| Fehlende/falsche Feldtypen, zusätzliche Schlüssel, falscher Reviewtyp, nicht kanonische Signatur | `invalid_envelope` beziehungsweise `invalid_signature` |
| Beleg ist abgelaufen bzw. mehr als 30 Sekunden vor dem Ausstellungszeitpunkt geprüft | `expired` beziehungsweise `not_yet_valid` |
| Gültigkeitsfenster über 24 Stunden oder rückwärts | `invalid_envelope` |

Die API enthält **keine** Datenbank, keinen File-Zugriff,
keine Netzwerkabfragen, keinen MQTT-Publisher und keine
API-Route. Keine Laufzeitdatei `backend/server.js`,
kein Compose-/Broker-Setup und keine DJI-Synchronisation
werden verändert.

## Offline-Tests

```sh
node --check backend/dji-flight-area-signed-review.js
node --test backend/test/dji-flight-area-signed-review.test.js
npm test --prefix backend
```

Getestet werden Ed25519-Verifikation, Signer-Sperre/Falsche Schlüssel,
fremde Workspaces/Gateways, geänderte SHA256, Revisionswechsel,
Zeitablauf, Replay-Grenzen, Fremdfelder, Metadaten-Datenschutz und
das unveränderliche `flightReady=false`.

## Weitere Freigabe-Gates

1. Echte Firmware-/Modellkompatibilität und mindestens einen
   unabhängig kontrollierbaren Geräte-Readback-Nachweis ermitteln.
2. Vertrauenswürdige Workspace-/Device-Bindung, Schlüsselverwaltung,
   Signer-Rollen und Revocation entwerfen.
3. Ursprung, SHA256, Zugriffsschutz, Speicherfristen und
   Manipulationsschutz der Prüfartefakte unabhängig validieren.
4. Signatur, Geräteattestation und Flugfreigabe **als drei voneinander
   getrennte Zustände** modellieren.
5. Erst danach einen getrennten, authentifizierten
   Read-only-API-/UI-Adapter prüfen; keine automatische Missions-
   oder Fluggebietsübertragung.

[Flight-Area-Ereignisadapter](dji-flight-area-integration.md) ·
[Offline-Synchronisationsmonitor](dji-flight-area-sync-monitor.md) ·
[Integrations-/Merge-Gates](integration-priorities-2026-10-23.md)
