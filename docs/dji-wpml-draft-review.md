# FlightHub-inspirierte Missionsprüfung – reiner Offline-Entwurf

**Stand 23.10.2026. Entwicklungszweig:** `feature/wpml-mission-draft-review-20261023`, gestapelt auf [Waylines-Referenz #57](https://github.com/mason82-dotcom/SkyHub/pull/57), die auf dem noch nicht in Main gemergten [WPML-Editor #16](https://github.com/mason82-dotcom/SkyHub/pull/16) basiert.

## Umfang

Die DJI-FlightHub-2-Frontend-Demo ([DJI-Handbuch](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html), [offizielle Demo](https://github.com/dji-sdk/FlightHub-2-Frontend-Standalone-Component)) dient ausschließlich als UX-Referenz für die Übersichtlichkeit eines Missionseditors. Der Entwicklerzweig implementiert **keine** DJI-FH2-Komponente, lädt keine `paas.js`, nutzt keine DJI-On-Premises-Tokens und ist kein FH2-Integrationstest.

Zusätzlicher lokaler Prüfabschnitt in `/wpml-editor.html`:
- Wegpunktanzahl, 2D-Luftliniensegmentstrecke nach Haversine und größte Segmentlänge (gerundet, keine Vermessungsdaten).
- Reine nominale horizontale Strecke / Sollgeschwindigkeit (gerundete Untergrenzen-artige Kennzahl ohne Start, RTH, Wenden, Wind, Beschleunigung, Steig-/Sinkflüge, Batterie oder Flugsteuerungsprofil). **Keine Flugzeitprognose.**
- Gedoppelte aufeinanderfolgende Punkte, ungültige GPS-/Geschwindigkeit-/Höhenwerte, fehlende explizite WGS84-Ellipsoidhöhen im Expertenmodus.
- Manuelle Prüfhinweise für mehr als 2 km zwischen Wegpunkten (**kein DJI-Hardwarelimit**), Datumsgrenze und Breiten >=85°. Die Karte könnte über der Datumsgrenze eine unpassende Darstellungsgeometrie zeigen.
- Getrennte Anzeige von individuellen Wegpunkt-Fotoaktionen und periodischen Triggern, **keine erfundene Zahl periodischer Fotos**.

Das browser-/Node-kompatible `frontend/public/wpml-mission-review.js` gibt nur aggregierte Zahlen und eine Whitelist bekannter Warncodes zurück. Keine Koordinaten, Seriennummern, Dateiinhalte, Cloud-Tokens oder importierten Objektattribute werden angezeigt oder aus diesem Modul zurückgegeben. Die Oberfläche verwendet ausschließlich `textContent`.

`status` kann nur `incomplete`, `invalid` oder `review-only` sein. **Es gibt weder `ready` noch `flightReady:true`.** Alle Rückgabestatus setzen `flightReady:false`, `hardwareVerified:false`, `flightTimeEstimated:false`, `missionDispatchEnabled:false`. Dieses Anzeigeelement aktiviert oder deaktiviert keine DJI-Steuerung. Der bestehende lokale WPML/KMZ-Export bleibt getrennt und unterliegt weiterhin der Prüfung in DJI Pilot 2.

## Regression / Abnahme

```sh
node --check frontend/public/wpml-mission-review.js
node --check frontend/public/wpml-editor.js
node --test backend/test/wpml-mission-review.test.js
node --test backend/test/wpml-reference-editor-ui.test.js
```

Tests: fehlende Punkte, ungültige Zahlen/Koordinaten, doppelter Wegpunkt, WGS84-Höhen, langer Sprung, Antimeridian, keine erfundenen Fotoanzahlen, keine Payload-Weitergabe, keine HTTP-/DJI-Steuerung.

**Bewusst offen:** 3D-Terrain, AGL/Geoid, Kollisionsprüfung, behördliche Luftraumprüfung, Wayline-Mission-Simulation, reale Geräte-/Payload-Fähigkeiten, Pilot-2-Import und FlightHub 2 On-Premises. Nicht als Freigabe- oder Ready-Check verwenden. Kein Raspberry-Pi-Deployment.
