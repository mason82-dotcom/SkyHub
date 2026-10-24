# SkyHub-Next · SKY//PULSE GFX UI (experimenteller Branch)

Branch: \`feature/hyperframes-gfx-ui-rework-20261024\`

## Ziel
Die bestehende read-only Einsatzoberfläche erhält einen kontrastreichen, futuristischen Instrumenten-Look. Der Stil ist bewusst experimentell, aber **keine Simulation von DJI-Gerätezuständen oder Flugfreigaben**.

## Implementierung
- Kanonischer GFX-Stylesheet-Owner: \`frontend/public/hyperframes-gfx.css\`; wird **nach** dem Legacy-Stil der fünf HTML-Oberflächen geladen und ist auf \`body.skyhub-gfx\` begrenzt.
- Motion-Progressive-Enhancement: \`frontend/public/hyperframes-gfx.js\`, keine Cookies, keine Speicherung, keine Netzaufrufe, keine Tokenberührung.
- Motion-Opt-in automatisch gemäß OS-Einstellung, zusätzlich manuell umschaltbar. \`prefers-reduced-motion\` erzwingt bei Bedarf die statische Darstellung; \`forced-colors\` reduziert Dekoration.
- Keine fremden Font-CDNs, kein Framework-/Build-Schritt, keine zusätzlichen Produktionsabhängigkeiten.
- Tokens: Deep \`#07101c\`; Panel \`#101e30\`; Signal Cyan \`#67e8f9\`; Ion Lime \`#c9fa79\` (Bedienauswahl); Warnfarbe \`#ffc37c\`. Warnstufen des Backends bleiben in ihrer bisherigen Bedeutung erhalten.
- Typografie: Bahnschrift für technische Anzeige, Segoe UI/System für Fließtext, Cascadia Code/Consolas für optionale Statusdetails.
- Das Kartenfenster erhält ein dekoratives, transparentes Koordinatennetz mit \`pointer-events: none\` und besitzt keine zusätzlichen Interaktionsflächen.
- Originale IDs, Formularfelder, API-Aufrufe, DJI-Livezustände, Authentifizierung, WPML-Erstelllogik und TA K/CoT Export-Sperren bleiben unverändert.
- Die lokale \`DESIGN.md\` im Motion-Ordner beschreibt bewusst **nur** die eigenständige HyperFrames-Animation; das bestehende projektweite \`DESIGN.md\` bleibt für den Standard-Branch kanonisch.

## Motion-Graphics
\`motion/hyperframes/skyhub-gfx/index.html\` ist eine eigenständige, deterministische HyperFrames-Komposition mit GSAP-Timeline (8 s, 1920×1080). Sie enthält **nur konzeptionelle Demo-Werte** und wird nicht ins produktive Dashboard eingebettet. Die HTML-Bildschirmoberfläche benötigt HyperFrames daher **nicht** zur Laufzeit.

## Prüfung vor Merge
1. \`cd backend && npm test\` (einschließlich \`hyperframes-gfx-ui.test.js\`)
2. Am Desktop und auf 320 px Smartphone die fünf Seiten mit Tastatur prüfen: Tab-Fokus, Motion-Schalter, Suche, Karten-Zoom, Marker, TAK-Tab, Formulare.
3. Besonders beachten: Kartennetz darf keine Marker/Leaflet-Attribution verdecken; Kartenaktionen bleiben auf 44px-Touch-Zielen erreichbar.
4. Bei realem DJI-Gerät verifizieren, dass Telemetrie- und Frische-Beschriftungen unverändert und keine animierten Status-Fälschungen sichtbar sind.
5. \`cd motion/hyperframes/skyhub-gfx && npx hyperframes lint && npx hyperframes validate && npx hyperframes inspect\` — diese Render- und Browserprüfungen sind erst nach lokaler Ausführung bestätigt.
6. Ein eigenständiger visueller Review des bestehenden hellen UI-Branches bleibt erforderlich. **Diesen experimentellen Branch nicht automatisch nach main mergen.**

## Sicherheitsgrenzen
Kein automatisierter Flug, kein neuer HTTP-Endpunkt, kein geänderter Docker-Stack. Smart Farming bleibt unkalibriert; TAK/CoT bleibt ohne Export; WPML weiterhin Offline-Entwurf. Animation ist eine rein visuelle Eigenschaft.
