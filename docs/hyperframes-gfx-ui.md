# SkyHub-Next · SKY//PULSE GFX UI (experimenteller Branch)

Branch: `feature/hyperframes-gfx-ui-rework-20261024`

## Ziel
Die bestehende read-only Einsatzoberfläche erhält einen kontrastreichen, futuristischen Instrumenten-Look. Der Stil ist bewusst experimentell, aber **keine Simulation von DJI-Gerätezuständen oder Flugfreigaben**.

## Implementierung
- Kanonischer GFX-Stylesheet-Owner: `frontend/public/hyperframes-gfx.css`; wird **nach** dem Legacy-Stil der fünf HTML-Oberflächen geladen und ist auf `body.skyhub-gfx` begrenzt.
- Motion-Progressive-Enhancement: `frontend/public/hyperframes-gfx.js`, keine Cookies, keine Speicherung, keine Netzaufrufe, keine Tokenberührung.
- Animationen initial gemäß OS-Einstellung, zusätzlich manuell umschaltbar. `prefers-reduced-motion` erzwingt bei Bedarf die statische Darstellung; `forced-colors` reduziert Dekoration.
- Keine fremden Font-CDNs, kein Framework-/Build-Schritt, keine zusätzlichen Produktionsabhängigkeiten.
- Tokens: Deep `#07101c`; Panel `#101e30`; Signal Cyan `#67e8f9`; Ion Lime `#c9fa79` (Bedienauswahl); Warnfarbe `#ffc37c`. Warnstufen des Backends bleiben in ihrer bisherigen Bedeutung erhalten.
- Typografie: Bahnschrift für technische Anzeige, Segoe UI/System für Fließtext, Cascadia Code/Consolas für optionale Statusdetails.
- Das Kartenfenster erhält ein dekoratives, transparentes Koordinatennetz mit `pointer-events: none` und besitzt keine zusätzlichen Interaktionsflächen.
- Originale IDs, Formularfelder, API-Aufrufe, DJI-Livezustände, Authentifizierung, WPML-Erstelllogik und TAK/CoT Export-Sperren bleiben unverändert.
- Die lokale `DESIGN.md` im Motion-Ordner beschreibt bewusst **nur** die eigenständige HyperFrames-Animation; das bestehende projektweite `DESIGN.md` bleibt für den Standard-Branch kanonisch.

## Motion-Graphics
`motion/hyperframes/skyhub-gfx/index.html` ist eine eigenständige, deterministische HyperFrames-Komposition mit GSAP-Timeline (8 s, 1920×1080). Sie enthält **nur konzeptionelle Demo-Werte** und wird nicht ins produktive Dashboard eingebettet. Die HTML-Bildschirmoberfläche benötigt HyperFrames daher **nicht** zur Laufzeit.

## Prüfung vor Merge
1. `cd backend && npm test` (einschließlich `hyperframes-gfx-ui.test.js`)
2. Am Desktop und auf 320 px Smartphone die fünf Seiten mit Tastatur prüfen: Tab-Fokus, Motion-Schalter, Suche, Karten-Zoom, Marker, TAK-Tab, Formulare.
3. Besonders beachten: Kartennetz darf keine Marker/Leaflet-Attribution verdecken; Kartenaktionen bleiben auf 44px-Touch-Zielen erreichbar.
4. Bei realem DJI-Gerät verifizieren, dass Telemetrie- und Frische-Beschriftungen unverändert und keine animierten Status-Fälschungen sichtbar sind.
5. `cd motion/hyperframes/skyhub-gfx && npx hyperframes lint && npx hyperframes check --snapshots` — die eigenständige HyperFrames-Browser-/Motion-/Kontrastprüfung ist erst nach tatsächlicher CLI-Ausführung bestätigt. `validate` und `inspect` sind inzwischen veraltete CLI-Aliase.
6. Ein eigenständiger visueller Review des bestehenden hellen UI-Branches bleibt erforderlich. **Diesen experimentellen Branch nicht automatisch nach main mergen.**

## Sicherheitsgrenzen
Kein automatisierter Flug, kein neuer HTTP-Endpunkt, kein geänderter Docker-Stack. Smart Farming bleibt unkalibriert; TAK/CoT bleibt ohne Export; WPML weiterhin Offline-Entwurf. Animation ist eine rein visuelle Eigenschaft.

## Phase 2: Unified Command Rail und Karten-Fokus

Implementiert im selben experimentellen Branch:

- Das Modulmenü wird als semantisches `nav` mit fünf festen internen Links aufgebaut; der aktuelle Pfad wird mit `aria-current="page"` benannt. Die vorhandene HTML-Navigation bleibt ohne JavaScript sichtbar.
- Jede Seite bietet einen Tastatur-Sprunglink zum Hauptinhalt; der Zielcontainer ist mit `tabindex="-1"` programmatisch fokussierbar.
- Dashboard: Die verfügbare Desktop-Höhe wird über vier CSS-Grid-Zeilen aufgeteilt (Header, Modulmenü, Operations/TAK-Tabs, Hauptansicht). Das alte starre Pixel-Offset wird nicht mehr verwendet.
- Der zusätzliche Button `Karte priorisieren` verschmälert die weiter sichtbare Info-Spalte auf 314 px. Der Button hat `aria-pressed` und wird unter 961 px ausgeblendet. Die Kartenansicht wird nach der Änderung neu vermessen.
- Die Kartenbeschriftung unten links ist rein dekorativ/informativ, hat `aria-hidden` und `pointer-events: none`. Sie stellt keine Live-Verbindung oder Flugfreigabe dar.
- Mit der Tastaturtaste `/` wird bei aktivem Operations-Panel das vorhandene Suchfeld fokussiert. In Textfeldern, bei Modifier-Tasten und im TAK-Panel greift die Kurzform nicht.
- `prefers-reduced-motion` und `forced-colors` blockieren Animationen explizit; ein bisheriger manueller Ausschaltwunsch bleibt bis zum Seitenwechsel im Seitenspeicher.
- Alle fünf GFX-Seiten nutzen dasselbe lokale JavaScript und CSS. Authentifizierung, Geräte-Zeitstempel, DJI-Protokollpfad und Datenaustausch werden nicht verändert.

### Erweiterte Abnahme

- Desktop-Breite 1024/1440 und Höhe 600/900 prüfen, außerdem 320/375/768 px und tatsächliche Tastaturbedienung.
- Eine Seite einmal ohne JavaScript laden: die ursprünglichen Modullinks bleiben verfügbar.
- Leaflet-Marker, Attribution, Scrollen der Geräteliste und Wechsel Operations/TAK bei aktiviertem Karten-Fokus testen.
- Farbkontrast, Fokus und `forced-colors` kontrollieren. Motion darf keinen Datenstatus vortäuschen.
- Alle neuen Regressionstests sowie HyperFrames-`lint` und `check --snapshots` getrennt ausführen.


## Phase 3 · Field-provenance OSD-Cockpit

- Neuer Owner `frontend/public/gfx-cockpit.js`. Ausschließlich browserlokale Aufbereitung derselben Geräte-Snapshots, die bereits `index.html` rendert; **kein** separater Netzabruf und keine Kopie des View-Tokens.
- Enthält sechs Instrumente: Akku, relative Höhe, Horizontalgeschwindigkeit, Heading, Vertikalgeschwindigkeit und SDR-Funkqualität. Fehlende optionale DJI-Felder werden als „Nicht empfangen“ angezeigt; Nullwerte bleiben gültige Zahlen.
- `telemetry-freshness.js` liefert die per-Feld-Kategorien `current`, `unverified`, `stale`, `missing` und `unknown`. Aggregat-OSD-Zeit ist kein Ersatz für Einzelwert-Zeitpunkte.
- Füllstandsbalken sind **nur** bei aktuellem, zeitverifiziertem Einzelwert gefüllt; für alte, fehlende und unbestätigte Werte werden sie geleert. Balken sind dekorativ; Status bleibt Text.
- Die Geräteauswahl ist alphabetisch nach Serienkennung sortiert und wird bei unverändertem Bestand nicht neu aufgebaut. Nutzerwahl bleibt bei OSD-Updates bestehen. Eine bewusste Kartenmarker-Auswahl kann das Cockpitgerät wechseln.
- Der Button „Letzten Kartenstandort zeigen“ ist nur aktiv, wenn eine Karte existiert und eine gültige WGS84-Position inklusive Positionstimestamp vorliegt. `0/0` und explizit `positionUnavailable` sind ausgeschlossen. Dies ist eine reine Karten-Navigation.
- Der Instrumentenstatus ist ausdrücklich `Nur lesend`, ohne DJI-Befehl, Start-/Stopp- oder Missionsfreigabe.
- Regressionstests: `backend/test/gfx-cockpit.test.js` und die bisherigen Dashboard-/TAK-/WPML-Tests. GPU/GSAP ist für die Instrumente nicht erforderlich.

## Phase 4 · Isolierte Chromium-Abnahme (24.10.2026)

Der experimentelle Branch besitzt mit `.github/workflows/gfx-browser-acceptance.yml` einen dedizierten GitHub-Actions-Workflow, der bei relevanten Frontend- oder Teständerungen läuft und auch manuell ausgelöst werden kann.

`tests/gfx_browser_acceptance.py` nutzt echtes Chromium und Leaflet 1.9.4, aber ausschließlich synthetische DJI-Gerätesnapshots, lokal ausgelieferte 1×1-Kartenkacheln und einen simulierten Socket.IO-Client. Alle anderen Netzwerkadressen werden blockiert; es gibt keine Produktiv-API-, Raspberry-Pi- oder DJI-Verbindung.

**Abgedeckte Browserfälle:**
- Desktop 1365 × 850, Mobilansichten 375 × 812 und 320 × 640, horizontaler Dokumentüberlauf
- Feldfrische und Telemetriewerte inklusive veralteter Höhe, Nullwerten und inkrementellen OSD-Updates
- Manuelle Geräteauswahl, Karten-Fokus, Leaflet, Operations/TAK-Tabs und `/`-Tastaturkürzel
- Nur einmal vorhandene Modulnavigation und die No-JS-Headerlinks als Fallback
- `prefers-reduced-motion`, `forced-colors: active`, JavaScript-Laufzeitfehler und Netzwerksperre

Die drei Screenshots werden unter dem GitHub-Actions-Artefaktnamen `gfx-browser-synthetic-screenshots` mit einer ausdrücklichen SYNTHETIC-Kennzeichnung gespeichert. Sie enthalten keine echten DJI-Flüge und sind ausschließlich für eine separate visuelle Beurteilung gedacht.

**Lokale Reproduktion:** Playwright 1.56.0 und Chromium installieren, Leaflet 1.9.4 lokal bereitstellen, `SKYHUB_TEST_LEAFLET_DIST` auf dessen `dist`-Ordner setzen, dann `python tests/gfx_browser_acceptance.py` starten.

**Abnahmegrenzen:** Die CI prüft Chromium auf Ubuntu, nicht die echten Android-WebView-Versionen, keine Hardwareintegration, keinen HyperFrames-Render und keine Flugfreigabe. Ein grüner automatisierter Test ersetzt keinen manuellen visuellen Review.

## Phase 5 · Provenienzgebundene Kursrose (24.10.2026)

- In der Operations-Fluginstrumentenkarte besitzt das Heading-Feld eine rein dekorative, kleine Kursrose mit Nordmarke. Der dynamische Zeiger folgt ausschließlich dem tatsächlich im bestehenden Gerätesnapshot gemeldeten DJI-Wert. Die sichtbare Zahl bleibt die primäre barrierefreie Information.
- `frontend/public/gfx-cockpit.js` berechnet den Bearing via `bearingFor(device, SkyHubTelemetryFreshness, now)`. Ein Zeiger wird nur bei `kind=current` gezeigt – zeitverifiziert, jünger als 15 Sekunden, kein ausdrücklich getrenntes Fluggerät.
- Die akzeptierte Heading-Eingabe liegt im dokumentierten Rundlauf `[-360,360]`. Negative Winkel werden für die Darstellung modulo 360 normalisiert (z. B. −90° → 270°); 360° → 0°. Nichtfinite oder außerhalb liegende Werte erzeugen weder aktive Kursrose noch scheinbaren Kurs.
- Bei fehlendem, unbestätigtem, in der Zukunft datiertem oder veraltetem Wert wird `#gfxCockpitCompass` per `hidden` aus der visuellen Anzeige genommen. Das numerische Feld und sein vorhandener Frischehinweis bleiben getrennt sichtbar, auch wenn die Quelle veraltet ist.
- `aria-hidden=true` für die Grafik: keine doppelten Screenreader-Ansagen und kein behaupteter Flugmodus. Zeigerrotation hat ausdrücklich **keine CSS-Animation**, um Richtungswechsel und Datenalter nicht als simulierte Bewegung erscheinen zu lassen.
- `forced-colors` erzwingt klare Systemfarben für Kursrose, Zeiger und Nordmarkierung. Die grafische Anzeige fügt keine neue Datenquelle oder Netzwerkverbindung hinzu.
- Abnahme: `backend/test/gfx-cockpit.test.js` testet negative Heading-Werte, 360°-Wrap, veraltete/ungeprüfte und getrennte Verbindungen; `tests/gfx_browser_acceptance.py` prüft echten Renderingzustand und Zeigerwinkel im isolierten Chromium. CI 5/5 am Implementierungscommit `348945aef82a` bestanden.


## Phase 6 · Künstlicher Horizont mit zweifacher Einzelwert-Prüfung (24.10.2026)

- `frontend/public/gfx-cockpit.js` stellt zwei weitere tatsächliche DJI-Felder dar: `attitudePitch` (Nickwinkel) und `attitudeRoll` (Rollwinkel), mit unabhängigen Zeitangaben aus `telemetryFieldAt` und `telemetryFieldTimeVerified`.
- Die Grafik `#gfxCockpitAttitude` ist ausschließlich eine **schematische** Lagendarstellung und **kein** zertifiziertes Fluglageinstrument. Pitch ist auf ±90°, Roll auf ±180° begrenzt; die reine CSS-Geometrie verwendet `rotate(-roll)` und `translateY(pitch × 0.8 px)`.
- Der künstliche Horizont erscheint **nur dann**, wenn **beide** Felder den Status `current` aus `SkyHubTelemetryFreshness.evaluateField` erhalten. Fehlende, zeitlich ungeprüfte, veraltete, unzulässige oder von einem getrennten Fluggerät gemeldete Daten unterdrücken die Szene.
- Die numerischen Nick-/Rollwerte und ihre eigenständige Frischekennzeichnung bleiben unabhängig vom Szenenstatus sichtbar. Die Szene besitzt `aria-hidden="true"` und weder CSS-Animation noch Interpolation – keine künstliche Echtzeitbewegung.
- Ehemals doppelt verwendetes `gfxCockpitHeading` wurde eindeutig getrennt: `gfxCockpitTitle` bezeichnet den Instrumentenbereich, `gfxCockpitHeading` ausschließlich den numerischen Kurswert. Die Änderung verhindert falsches Überschreiben der Überschrift und verbessert die Screenreader-Beschriftung.
- Unit-Tests sichern gültige Winkel, Grenzen, fehlende Felder, unbestätigte Zeitpunkte und einseitige Veraltung ab. Der isolierte Chromium-Test verifiziert die gerenderte Lagegeometrie mit **synthetischen** Werten sowie das Ausblenden bei veraltetem Rollwert.
- DJI-Protokoll, Authentisierung, Datenspeicherung, Flugkommandos, TAK-Sperre und produktive Raspberry-Pi-Dienste bleiben unverändert.


## Phase 7 · Manuelle Screenshot-Abnahme und Mobile-Karten-Überlagerung

Die realen Chromium-Screenshots mit ausschließlich synthetischen DJI-Gerätedaten vom Commit `733fae8558d1` wurden visuell geprüft. Bei 320 und 375 Pixeln überlappten Leaflets Zoomtasten die Kartenwerkzeugleiste. Die GFX-CSS-Ansicht setzt auf Viewports bis 640px die Kartenwerkzeuge auf `top:96px` und trennt diese von Leaflet.

Der isolierte Browser-Test prüft die tatsächlichen `getBoundingClientRect()`-Rechtecke auf Überlappung. Zusätzlich werden Desktop- und Mobil-Screenshots eines nach Einzelwert-Zeitprüfung gültigen künstlichen Horizonts aufgenommen. Die bereits vorhandenen Screenshots des veralteten Rollwinkels bleiben erhalten, sodass beide Zustände beurteilt werden können. Alle Artefakte tragen ausdrücklich die Kennzeichnung `SYNTHETIC / OFFLINE BROWSER TEST`.

Kein produktiver Backend-, DJI- oder Raspberry-Pi-Test und keine Android-WebView-Hardwareabnahme.


## Phase 8 · Einzelwert-Datenqualitätsanzeige (24.10.2026)

Die SKY//PULSE-Cockpitkarte zeigt unter der ausgewählten Drohne einen **Textstatus für genau acht dargestellte Instrumentenfelder**: Akku, relative Höhe, horizontale Geschwindigkeit, Heading, vertikale Geschwindigkeit, Pitch, Roll und SDR-Funkqualität. Die Anzeige zählt `current`, `stale`, `unverified`, `unknown` und `missing` anhand **derselben** feldbezogenen DJI-Zeitprüfung wie die Einzelwerte. Bei invaliden, nichtfiniten oder außerhalb definierter Darstellungsgrenzen liegenden Messwerten zählt das Feld als nicht empfangen.

`qualityFor(device, freshness, now)` arbeitet rein lokal, fügt weder persistierte Nutzerdaten noch Netzwerkzugriffe hinzu und verwendet keinen aggregierten MQTT-, Flug- oder Positionsstatus. Die Summe der fünf Kategorien entspricht genau der Anzahl der acht Spezifikationen. Fehlt ein ausgewähltes Gerät, stehen Striche statt irreführender Nullen. Bei getrenntem Fluggerät wird kein gemessener Feldwert als `current` ausgewiesen. Die Zahlen sind eine **begrenzte Instrumentenprüfung**, ausdrücklich **kein DJI-Flugbereitschaftsscore**.

Die separate Datenqualitätstafel verwendet einfache Textzähler und läuft auch unter `forced-colors`. In der Chromium-Abnahme wird die Kategorisierung beim Gerätewechsel und nach inkrementellen Socket.IO-Snapshots sowie bei einem veralteten Rollwinkel geprüft. Weitere Unit-Tests decken fehlende, ungeprüfte, zeitlich unbekannte und ungültige Werte sowie die Summeninvariante ab.


## Phase 9 · Browserlokale Telemetrie-Beobachtungen (24.10.2026)

Der ausklappbare Abschnitt `Feldverlauf · lokale Beobachtungen` zeichnet **ausschließlich im aktuell geöffneten Browsertab** bis zu 24 erkannte Änderungen der acht im Cockpit sichtbaren Felder auf. Es werden weder historische DJI-Telemetrie noch Paketankünfte aus MQTT, WebSocket oder dem FlightHub-System rückwirkend behauptet. Der eigentliche Gerätesnapshot dient beim erstmaligen Öffnen und jedem Gerätewechsel nur als Baseline; es wird **kein Ereignis** für bloß erstmals vorhandene Daten erfunden.

`observeFields` extrahiert nur die pro Feld geprüfte Qualitätsklasse und den numerischen Quellzeitstempel sowie das Verifikationsflag. `timelineChanges` erzeugt beim nächsten normalen Dashboard-Update nur für tatsächliche UI-beobachtete Statuswechsel Ereignisse wie `Aktuell → Veraltet` oder für zeitlich fortgeschriebene **verifizierte** Einzelwert-Zeitstempel ohne gleichzeitigen Statuswechsel einen Marker `Verifizierter Feldzeitpunkt fortgeschrieben`. Ein bloßes erneutes Zeichnen mit identischem Stand erzeugt kein neues Ereignis. Vorwärtslaufender Feldzeitstempel ist ausdrücklich **kein Beweis** für ein einziges neues Paket; `Veraltet` oder Frischewechsel sind **kein Beweis** für einen Verbindungsausfall.

Die Zeit auf jedem Eintrag ist die **lokale Beobachtungszeit des Dashboards**, nicht DJI-Quellzeit und nicht der genaue Moment des Frischeübergangs. Der Abschnitt nimmt weder andere Felder noch GPS-Koordinaten, Werte, Tokens oder Seriennummern in den Verlauf auf. Die Ereignisliste wird beim Gerätewechsel sowie bei Verbindungsreset geleert, ist per Knopfdruck löschbar und wird niemals in Browser-Speicher, Server-API oder Download geschrieben. Der bestehende Fünf-Sekunden-Updatezyklus genügt; kein zusätzlicher Timer, Netzwerkzugang oder Flugsteuerpfad.


## Phase 10 · Diagnosezusammenfassung der beobachteten Frischewechsel (24.10.2026)

Unter dem bereits rein browserlokalen Feldverlauf werden die **maximal 24 tatsächlich gespeicherten UI-Beobachtungen** ausgewertet. `summarizeTimeline(entries)` zählt innerhalb genau dieses Fensters getrennt: 1) Statusübergänge **zu** `stale`, 2) fortgeschriebene und verifizierte Quellzeitstempel sowie 3) sonstige Statusübergänge. Für die maximal drei am häufigsten innerhalb dieses kleinen Fensters zu `stale` wechselnden Felder werden ihre Anzeigenamen und Anzahlen dargestellt. Gleichstände sind durch die feste Reihenfolge der acht bekannten Instrumente deterministisch.

Die Ereignisstruktur erhält intern einen ausschließlich whitelisted `key` (`battery`, `altitude`, `horizontalSpeed`, `heading`, `verticalSpeed`, `attitudePitch`, `attitudeRoll`, `linkQuality`); die UI rendert ausschließlich vertrauenswürdige Anzeigebezeichnungen und Ganzzahlen. Unbekannte Felder werden bei der Aggregation nicht gezählt. Kein Zugriff auf Rohwerte, GPS-Positionen, Gerätekennungen, Token oder Serverdaten; keine neue Datenquelle, kein Timer oder Archiv.

**Wichtige Grenzen:** Die Tabelle bezeichnet niemals eine Fehlerquote, eine Häufigkeit aller historischen DJI-Meldungen, eine tatsächliche Empfangslücke, einen Funkverbindungsabbruch oder Flugbereitschaft. Sie umfasst nur die 24 jüngsten bereits festgehaltenen Status-/Zeitstempel-Beobachtungen, nicht verstrichene Zeit oder DJI-Pakete. Beim Gerätewechsel oder expliziten Leeren wird die Zusammenfassung mit der Liste gleichzeitig zurückgesetzt. Ein initialer Gerätesnapshot erzeugt keine Ereignisse. Für die Abnahme existieren Node-Tests zu Whitelist, Fenstergrenze und deterministischem Ranking sowie Chromium-Tests für Zeitstempel-Fortschreibungen, zwei veraltende Felder, Löschfunktion und Gerätewechsel.


## Phase 11 · Frischegrenzen je Instrument und synthetischer Reconnect-Test (24.10.2026)

Der ausklappbare Abschnitt `Einzelwert · Zeitgrenze prüfen` erlaubt die Auswahl eines **der genau acht Cockpitinstrumente** ohne neue DJI-API-Aufrufe. `inspectField(device,key,freshness,now)` verwendet den existierenden `valueFor`-/`telemetry-freshness.js.evaluateField`-Validator; der Status entspricht damit exakt dem sichtbaren Instrument. Angezeigt werden Messwert, per-Feld-Status, lesbarer Feldzeitstempel in der Browser-Ortszeit und eine Erklärung der Frischegrenze.

**15 000 ms (exklusiv)** gelten als aktuell: bei 14 999 ms ist der Einzelwert mit verifizierter Feldzeit noch `current`, ab genau 15 000 ms `stale`. Ein Restzeit-Hinweis wird nur bei **aktuellen UND zeitverifizierten** Werten berechnet (`ceil((CURRENT_MS-age)/1000)`); die vorhandene Dashboard-Aktualisierung aktualisiert ihn, es gibt bewusst **keine sekündlich suggerierte Liveuhr**. Fehlender/unplausibler Messwert, nicht bestätigter/Future-Feldzeitpunkt oder getrenntes Fluggerät unterdrücken jeden aktuellen Countdown. Ein nicht auswertbarer Zeitstempel wird nicht als gültiges Datum ausgegeben. Status-, Zeit- und Countdown-Aussagen sind keine Bewertung der Link- oder Flugbereitschaft.

Unit-Tests schützen diese Grenze sowie `missing`, `unknown`, `unverified`, `stale` und ungültige Instrumentenkeys. Die isolierte Chromium-Abnahme ergänzt synthetische Fluggerät-Trennung → aktuelle Feldzeit nach Wiederverbindung → leeren Gerätesnapshot → erneuten Vollsnapshot. Nach dem leeren Snapshot werden Instrumentenanzeige und Verlauf zurückgesetzt, der neue Snapshot ist wieder eine Baseline. Das testet ausschließlich das Web-UI-Verhalten, **keinen echten DJI-Verbindungszyklus**.


## Phase 12 · Unverändernde Raspberry-Pi-Hardware-Prüfmatrix (24.10.2026)

Der neue Host-Prüfer `scripts/pi-gfx-readonly-audit.js` führt **kein Deployment** aus. Er sendet den eigenständigen, geprüften Quelltext `scripts/lib/pi-gfx-audit-worker.js` als **stdin** in `docker compose -p skyhub-next exec -T backend node -`. Der Worker nutzt ausschließlich `GET /api/devices` via `127.0.0.1:4000` innerhalb des laufenden Containers; `SKYHUB_VIEW_TOKEN` wird ausschließlich dort aus der bestehenden Container-Umgebung gelesen. Raw-Snapshots und Tokens überschreiten nicht die Container-zu-Host-Grenze. Nach außen gehen nur begrenzte, auf acht OSD-Feldschlüssel und fünf Statusklassen reduzierte Ergebnisse, feste Modellklassen und Aussagen zur rein dekorativen Zeichenbarkeit von Kursrose und künstlichem Horizont.

- **Voraussetzungen:** Laufender SkyHub-Next-Backend-Container enthält bereits die kompatiblen `frontend/public/gfx-cockpit.js` und `telemetry-freshness.js` mit acht Spezifikationen und 15-s-Grenze. Ein noch älteres Backend-Image meldet **nicht nachgewiesen**, nicht automatisch bestanden. Das Ausführen aus dem isolierten Worktree aktualisiert den Container **nicht**.
- **Hardware sicher am Boden:** RC Plus 2 Enterprise und Matrice 4T in Pilot 2 verbunden. Keine Rotation, Starts, Flugaufträge, Piloten-Loginwechsel, Pairings oder Brokerkonfigurationsänderung durch dieses Skript.
- **Prüfbefehl:** Im Worktree `node scripts/pi-gfx-readonly-audit.js --help`, anschließend `node scripts/pi-gfx-readonly-audit.js`. Bei abweichendem produktivem Compose-Ordner vorher nur `SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next"` als Prozessumgebung setzen.
- **Kontrollfälle:** (A) Gerät wird erstmals beobachtet: acht Zustände protokollieren; nicht empfangene Felder ausdrücklich als fehlend, nicht als Hardwaredefekt werten. (B) M4T länger als 15 s ohne bestätigten Feldzeitpunkt: entsprechende Einzelwerte veraltet und Kursrose/Horizont ausgeblendet. (C) `aircraftConnected=false`: keine aktuellen Instrumentenfelder behaupten. (D) Nach Wiederverbindung und erneutem, verifiziertem Feldzeitpunkt erscheinen ausschließlich tatsächlich aktuelle Werte. (E) RC Plus 2 und M4T nicht nach Seriennummern oder anhand bloßer Gesamt-OSD-Zeit verwechseln. (F) Keine gespeicherten Rohdaten, GPS, Seriennummern oder Tokens im Bericht.
- **Exitcodes:** 0 = mindestens ein Fluggerät-Snapshot mit auswertbarer Struktur beobachtet (NICHT vollständige Hardware-Abnahme); 3 = nicht nachgewiesen (zum Beispiel keine Fluggeräte oder inkompatibles Backend-Image); 1 = API-/Infrastruktur-/Berichtsproblem; 2 = falsche Argumente. Alle Zustände benötigen manuelle Interpretation.
- **Sicherheit:** Maximal 16 Gerätestände, nur acht erlaubte Feldnamen, vollständige Summeninvariante je Gerät. Der Host verwirft unerwartete Berichtsformen, statt Roh-Container-Ausgaben durchzureichen. Keine MQTT-Publishs, keine POSTs, kein Refresh der Dienste. Offline-Unit-Tests prüfen echten Frontend-Freshness-Code mit synthetischen Samples sowie Disconnection, 25-s-Überalterung, leeren Geräten und Redaktion privater Strings.

**Abgrenzung:** Die bereits existierenden Hardware-Profile für RC Plus 2/M4T und RC Pro/M3M prüfen weiterhin den dokumentierten DJI-Transport. Der neue GFX-Prüfer bescheinigt ausschließlich, was **der aktuell laufende Backend-Container** an bereits normalisierten Cockpit-Einzelwerten zu diesem lokalen Abfragezeitpunkt als aktuell/veraltet/fehlend bewertet. Er ersetzt keine Pilot-2-Kopplung, keinen Hardwaretest und keinen echten Android-WebView-Review.

**HyperFrames Motion:** Laut aktueller CLI-Dokumentation sind `validate` und `inspect` veraltete Aliase. Verbindlicher Browser-/Layout-/Motion-/Kontrast-Gate für den separaten Intro-Film ist `npx hyperframes check --snapshots` nach `lint`; echte CLI-Abnahme und Video-Render sind weiterhin **nicht durchgeführt**.

## Phase 13 · Separater HyperFrames-Motion-CLI-Gate (24.10.2026)

Der Workflow `.github/workflows/gfx-hyperframes-motion.yml` prüft ausschließlich die eigenständige, als fiktional gekennzeichnete 8-Sekunden-Komposition unter `motion/hyperframes/skyhub-gfx/`. Er verwendet Node.js 22, FFmpeg und die **festgehaltene HyperFrames-CLI-Version 0.8.192**. Nach `browser ensure` läuft `check --json --snapshots` mit Browser-/Runtime-, Layout-, Motion- und Kontrastdiagnostik. JSON-Bericht und Prüf-Screenshots werden nur als auf sieben Tage befristete, ausdrücklich synthetische GitHub-Actions-Artefakte gespeichert.

Der Motion-Workflow ist von der vorhandenen GFX-Dashboard-Chromium-Abnahme getrennt. Die CLI-Prüfung behauptet weder den Erfolg eines MP4-Exports noch eine DJI-Telemetrie-/Hardware-Abnahme. Die Version wird für reproduzierbare Ergebnisse bewusst fixiert und bei Bedarf separat aktualisiert. Der Workflow enthält weder `publish` noch `render` oder Cloud-Uploads und verändert keinen Raspberry-Pi-Dienst.
