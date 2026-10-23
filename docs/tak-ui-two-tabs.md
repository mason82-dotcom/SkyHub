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
