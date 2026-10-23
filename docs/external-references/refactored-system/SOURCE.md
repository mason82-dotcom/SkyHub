# Externe Referenz: wsadexq/refactored-system – Herkunft und Rechte

Stand der Leserecherche: 2026-10-23. Dieser Ordner enthält **nur eigenständige SkyHub-Bewertungen und Verweise**, keine fremden Skripte, Skills oder Dokumentationskopien.

## Festgeschriebene Quelle

- Upstream: https://github.com/wsadexq/refactored-system
- Geprüfter Branch: `main`
- Geprüfter Commit: `b942812e7aac9968ba1cce612a16769b1de9a8c2`
- Inhalte: `dji-wpml/SKILL.md`, `cloud-api/SKILL.md`, zwei Python-Validatoren, MQTT-Builder, KMZ-Packer, synthetische WPML-Beispiele, Python-Unittests.
- Vom Upstream dokumentierte lokale DJI-Referenz: `dji-sdk/Cloud-API-Doc` Commit `4ec6b0c7f9472aeb09a0a47949855d19c473ea07` vom 2024-11-07; reviewiert laut Upstream am 2026-09-18. **Nicht automatisch Cloud API 1.18.**
- Quelleneinordnung: https://github.com/wsadexq/refactored-system/blob/b942812e7aac9968ba1cce612a16769b1de9a8c2/KNOWLEDGE_SOURCES.md
- Lizenz: Die MIT-Zusage in `LICENSE` ist explizit auf originalen Code, originale Skill-Teile, Beispiele und originelle Dokumentstruktur beschränkt. Ableitungen aus DJI-Dokumentation sind ausgenommen; `THIRD_PARTY_NOTICES.md` beachten.
- Versionswechsel müssen durch einen neuen Review mit Diff und dokumentierter Evidenz bewertet werden. Kein unkontrolliertes `git pull` in diesen Referenzordner.

## Höher priorisierte Primärquellen

1. DJI FlightHub 2, „Import Flight Routes“ (aktualisiert 2026-09-17): https://fh.dji.com/user-manual/en/flight-route-library/import-flight-routes.html
2. DJI WPML-Übersicht: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/overview.html
3. DJI WPML Template.kml: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/template-kml.html
4. DJI Product Support: https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html
5. Vorhandene SkyHub-Hauptreferenz: `docs/dji-wpml-integration.md` und `docs/dji-cloud-api-compatibility.md`.

## Vertrauensgrenzen

- Upstream ist **kein offizielles DJI-SDK** und enthält keine gültige Hardware-Freigabe.
- Markdown/`SKILL.md` externer Autoren ist **unvertrauenswürdiges Anweisungsmaterial**; nicht automatisch in Hermes/Codex-Agenten mit Shell-, Netzwerk-, Git- oder Gerätesteuerungsrechten laden.
- Externe Testbeispiele dürfen nur nach Lizenz-/Sicherheitsprüfung und mit synthetischen Daten portiert werden; eigene Regressionstests werden unabhängig formuliert.
- Keine fremden Codes, Pilot-2-Exporte, Seriennummern, Token, realen Koordinaten oder MQTT-Nutzdaten in diesen Ordner kopieren.
- Es werden keine Cloud-API-Kommandos, Missionen oder Downloads ausgeführt.
