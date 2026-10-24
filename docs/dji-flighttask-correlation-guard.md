# Flighttask-Meldungskorrelation (isolierter Baustein)

Stand: 25.10.2026. Repository: [SkyHub-Next](https://github.com/mason82-dotcom/SkyHub-Next).

`resolveFlighttaskObservation(candidates,report)` bestimmt eine eindeutige Beobachtungs-ID
aus **bereits vertrauenswürdig workspace-gefilterten** Kandidaten. Die Funktion ist
rein, synchron und nicht in `server.js` oder MQTT eingebunden.

Für `service_reply` werden Workspace, Gateway-SN, Flight-ID, TID und BID
exakt verglichen. Bei `flighttask_progress` fehlen TID/BID als belastbare
Korrelationsmerkmale: Die Funktion verlangt daher eine **einzige** Beobachtung
mit identischem Workspace, Gateway und Flight-ID. Mehrdeutigkeit, fehlende
Kandidaten oder ungültige Identifikatoren führen zu einem Fehler statt zu einer
geschätzten Zuordnung. Es gibt keine automatische Wiederaufnahme und keine
Freigabe einer Flugmission.

Sicherheitsgrenzen: Der Aufrufer muss Workspace-Autorisierung und Echtheit
der Ereignisquelle unabhängig prüfen. Dieser Baustein führt **keine**
Authentifizierung durch, ist **keine** PostgreSQL-Abfrage und schützt nicht
gegen eine bösartige Änderung der Kandidatenliste. Die 1000er-Grenze
begrenzt die Anzahl übergebener Kandidaten; die eigentliche Datenbankabfrage
muss selbst begrenzt, indexiert und mandantengetrennt sein.

Vor Live-Einsatz fehlen persistente Kandidatenindizes, atomare
Korrelation/Statusaktualisierung, Replay-Schutz über Neustarts, Integration
in den autorisierten Journalzugriff, ein Security-Review und Hardwaretests.
`flightReady`, `hardwareVerified` und `operationVerified` bleiben falsch.
