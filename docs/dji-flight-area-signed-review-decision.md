# Architekturentscheidung: Signierte DJI-Flight-Area-Review-Prototypen

**Stand: 24.10.2026. Nur Offline-Draft; nicht für den Produktivbetrieb.**

Die parallele Arbeit auf diesem Branch hat zwei eigenständige und teilweise
überlappende Implementierungen hervorgebracht. Sie sind NICHT kompatibel
und sollen bis zu einer eigenen Konsolidierungsentscheidung nicht als
alternative produktive APIs angeboten oder zur Flugfreigabe verknüpft werden.

## Gegenüberstellung

| Kriterium | Lab Review | Signed Artifact Review |
| --- | --- | --- |
| Datei | backend/dji-flight-area-lab-review.js | backend/dji-flight-area-signed-review.js |
| Signatur | Detached Ed25519, signierte streng kanonische JSON-Bytes | Ed25519 über festes Feld-Tupel |
| Vertrauensanker | Gepinnter öffentlicher SPKI-Schlüssel-Fingerprint | Explizite Key-ID zu öffentlichem Ed25519-KeyObject |
| Zielbindung | Workspace, Gateway, Revision, SHA-256 | Workspace, Gateway, Revision, SHA-256 |
| Belegzusatz | Einmalige 128-Bit-Challenge, extern zu verbrauchen | Review-ID und signierter Artefakt-Hash, kein Artefaktabruf |
| Maximale Laufzeit | 5 Minuten | 24 Stunden |
| Unabhängige Hardwareprüfung | Nein | Nein |
| Nachweis der installierten Datei | Nein | Nein |
| Flugfreigabe | Immer false | Immer false |

## Sicherheitsbewertung

Lab Review prüft die Canonical-JSON-Darstellung, verlangt eine
vertrauenswürdig vorgegebene Challenge und einen gepinnten
Schlüsselfingerprint. Der Prototyp verwaltet weder einmalige
Challenge-Verwendung noch einen beweisbaren DJI-Geräte-Readback.

Signed Artifact Review bindet den SHA-256-Wert eines unabhängigen
Prüfartefakts in die Signatur ein. Das Artefakt wird jedoch nicht
geladen, kryptografisch attestiert oder auf seine Herkunft geprüft.
Die Review-ID wird nicht durch einen persistenten Replay-Speicher
entwertet; die 24-Stunden-Frist ist für einen produktiven Nachweis
als zusätzliche Grenze erneut zu bewerten.

**Die erfolgreiche Prüfung einer Reviewer-Signatur beweist nur,
dass der freigegebene Schlüssel die deklarierten Daten signiert hat.
Sie beweist keine Installation auf einem DJI-Gerät.**

## Verbindliches Gate vor Runtime-Integration

Eine einzige konsolidierte Vertragsversion muss streng kanonische,
domain-separierte Ed25519-Signaturen, eine persistente und atomar
verbrauchte Challenge, Workspace-/Gateway-/Revisionsbindung, eine
nachprüfbar authentische Herkunft des Artefakts, Rollen/Rechte,
Schlüsselrotation/Widerruf und eine hardwaregebundene,
unabhängige Geräte-Readback-Quelle verbinden.

Die Zustände Signatur gültig, Reviewer-Aussage passend,
Geräte-Readback unabhängig bestätigt, Synchronisation bestätigt
und Flugfreigabe müssen separate Felder bleiben und dürfen
sich niemals implizit gegenseitig aktivieren.

Bis zur Entscheidung: keine neuen MQTT-Abonnements, Gerätebefehle,
Backend-HTTP-Routen, UI-Produktionsanzeigen oder Pi-Deployments.
CI-Erfolg belegt nur die synthetischen Offline-Tests.

Abhängigkeiten: PR #70 -> PR #75 -> PR #110.
Dokumente: dji-flight-area-lab-review.md und
dji-flight-area-signed-review.md.
