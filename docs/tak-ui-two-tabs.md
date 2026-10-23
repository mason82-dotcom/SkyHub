# SkyHub Next – zwei Haupttabs (isolierter UI-Branch)

**Branch:** `feature/skyhub-next-tak-second-tab-20261023`

Die Bedienoberfläche trennt die bisherige rein lesende Operations-Leitstelle von der TAK-/CoT-Interoperabilität. Die Trennung ist **eine echte Browser-Tab-Navigation**, aber **keine TAK-Backend-Integration**.

## Tab 01 · Operations

Enthält unverändert den bisherigen Karten-, Geräte-, Telemetrie-, HMS-, PostGIS-Flugspur- und Systemdiagnosebereich. Die vorhandenen Authentifizierungs-, Socket.IO-, DJI-MQTT- und Kartenzustände werden bei einem Tabwechsel nicht neu aufgebaut. Beim Zurückwechseln wird nur Leaflets sichtbare Kartengröße korrigiert.

## Tab 02 · TAK / CoT

Eigene, standardmäßig verborgene Hauptansicht mit ausschließlich statischen, nicht vertraulichen Statusfeldern: Export aus, Ziel nicht konfiguriert, keine Workspace- oder Gerätefreigabe und kein angeschlossenes TAK-Audit. Es gibt **keinen aktiven Netzwerkaufruf, Exportbutton, Backend-Endpunkt oder Schreibpfad**. Die im Verlauf entwickelten Stage-1–4-Pakete wurden nicht in den GitHub-Hauptbranch integriert und dürfen durch die UI nicht als aktiv dargestellt werden.

Die zwei Schaltflächen verwenden `role=tablist/tab`, `aria-selected`, `aria-controls`, `role=tabpanel`, roving `tabindex` und Pfeiltasten sowie Home/End. Der Tabzustand verbleibt nur im Browserseitenspeicher (keine Kennung in URL, LocalStorage oder Telemetrie).

## Sicherheitsgrenzen

- Kein DJI-Flugkommando, kein MQTT-Publish, kein zusätzlicher Broker und keine Änderung von Pi-, Caddy- oder EMQX-Konfigurationen.
- Keine TAK-Token-Eingabe oder Veröffentlichung von Seriennummern und Koordinaten über das neue Panel.
- Die TAK-Ansicht zeigt explizit „nicht integriert“, bis reale, gesondert geprüfte serverseitige Berechtigungen und sichere Netzwerkverbindungen vorhanden sind.
- Die Navigation ist rein clientseitig, **kein** Ersatz für serverseitige Rechteprüfung.

## Prüfkommandos

```sh
node --test backend/test/workspace-tabs.test.js
node --test backend/test/*.test.js
node scripts/check-dashboard-inline.js frontend/public/index.html
```

Tests prüfen die Panel-Zuordnung, Klick/Pfeiltasten/Home/End, Rückkehr zur Karte, Fehler bei unvollständigem DOM und den nicht sendenden TAK-Platzhalter. Browser-QA auf Desktop, Smartphone und DJI Pilot 2 ist zusätzlich erforderlich. Der hier geprüfte GitHub-Branch wurde nicht automatisch auf den Raspberry Pi übertragen oder produktiv gestartet.

## Responsive Abnahme und Browser-Fixture (23.10.2026)

Die eigenständige TAK-Statusansicht nutzt ein kompaktes responsives Raster:

- unter 600 px: eine Spalte,
- 600 bis einschließlich 1100 px: zwei Spalten,
- über 1100 px: drei Spalten.

Ein **lokaler Chromium/Playwright-Layouttest mit nachgebauter UI-Fixture** hat 320, 360, 390, 599, 600, 601, 768, 834, 850, 851, 1024, 1100, 1101 und 1440 px gegen horizontalen Überlauf geprüft. Darüber hinaus wurden Klick, ArrowRight-Fokuswechsel und Rückkehr zum Operations-Panel geprüft. Die Test-Fansicht nutzt die Tab-Markup-/CSS-Struktur und statusbezogene Inhalte dieses PR, aber **nicht die vollständige SkyHub-Laufzeit**. Sie bestätigt deshalb weder Leaflet-Rendering noch Socket.IO/MQTT-Zustände, Browserkompatibilität auf Pilot-2-Hardware oder einen echten TAK-API-Vertrag.

Hinweis auf den weiterhin nötigen Freigabetest: Der angepasste Backend-Hook darf erst nach gesonderter Hardware-, Security- und Browser-Abnahme einen TAK-Netzwerkpfad erhalten. Dieser Branch ändert keine produktiven Export-Flags.
