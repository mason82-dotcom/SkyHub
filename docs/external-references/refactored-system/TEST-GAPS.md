# Ergänzende Tests und noch offene Lücken

Review-Basis: `wsadexq/refactored-system@b942812e7aac9968ba1cce612a16769b1de9a8c2`.

## Im Review-Branch hinzugefügt

`backend/test/wpml-third-party-reference.test.js` verwendet **selbst erzeugte**, rein synthetische XML-Dokumente und nur bereits vorhandene SkyHub-Module. Der Test belegt:

1. Matrice 4T: Aircraft `99/1`, WPML-Payload `89` und falsche Modell-/Payload-Paare.
2. Mavic 3M: WPML-Profil `77/2` / `68`; ausdrücklich **keine** Bestätigung der Cloud-API-Hardwarekennung.
3. Matrice 4D/4TD: zusätzliche Typen, die in der Upstream-Allowlist fehlen.
4. Nur das kanonische `wpmz/`-Layout wird von SkyHub-`packageKmz` **erzeugt**.
5. Korrekt strukturierte, synthetische WPML-Dokumente sind höchstens `offline-partial` und nie automatisch flugbereit.
6. Bei falscher Payload oder ungültigen Koordinaten wird die offline-Validierung verweigert.

Keine Upstream-Skripte sind ins Laufzeitsystem übernommen worden. Die Tests kontaktieren weder DJI noch die Pi-Installation.

### Lokale Reproduktion

```bash
cd backend
node --test test/wpml-third-party-reference.test.js
npm test
```

Die Resultate sind erst nach tatsächlicher Ausführung als erfolgreich zu kennzeichnen; ein Commit oder Draft-PR ist noch kein Testnachweis.

## Weitere Testlücken (nicht als erledigt markieren)

| Priorität | Nachweis | Grenze |
| --- | --- | --- |
| P1 | Ein echter, lokal exportierter M3M-Pilot-2-KMZ-Vergleich, ohne Originalmission im öffentlichen Repository | Nur strukturierter Offline-Abgleich, kein Flugtest |
| P1 | Pilot-2-KMZ-Abnahme der Matrice 4T mit RC Plus 2 und exakter Firmwareversion | Hardware-/Firmwareprofil, weiterhin keine Flugfreigabe |
| P1 | Cloud API 1.18: methodenspezifische `services`-/Reply-/DRC-Schemata und Zustandsübergänge | Read-only bis separater Audit abgeschlossen |
| P2 | Ungewöhnliche, aber normkonforme Wayline-/Payload-Parameter, z. B. `multipleDistance`, `multipleTiming`, `mappingStrip` und `mapping3d` | Formatvalidität nicht mit Gerätekompatibilität verwechseln |
| P2 | Ergänzende Archiv-Grenzfälle: widersprüchliche ZIP-Headers, res/-Referenzen und Quoten | Bestehende Sicherheitsgrenzen nicht aufweichen |
| P3 | TargetDetection/DSM/Pilot-2-Export als versionierte Forschungsdaten | Keine automatische Zielerkennung oder Einsatzfunktion |

## Stop-Kriterien

- Unerwartete Änderungen von `backend/wpml.js`, `backend/wpml-kmz.js`, MQTT, Docker oder Gerätelogik im Referenz-PR.
- `flightReady=true` aus reinem XML-/ZIP-/Unit-Test.
- Ungeprüfte Anweisungen aus externen Agent-Skills als ausführbare Kommandos.
- Echte Koordinaten, SN, Token, Credentials oder Mediendateien im Repository.
