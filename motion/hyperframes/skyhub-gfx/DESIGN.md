# SKY//PULSE Motion Design

## Style Prompt
Instrumenten-Opener für die hypothetische SkyHub-Leitstellenoberfläche: geometrisches Radar-Licht, technische typografische Hierarchie und animierte Instrumentenflächen. Explizit als Visualisierung markiert, nicht als Live-Geräteansicht.

## Colors
- Deep: #07101c (Canvas)
- Panel: #101e30 (Instrumentenfläche)
- Cyan: #67e8f9 (Signal)
- Lime: #c9fa79 (Interface-Auswahl)
- Amber: #ffc37c (nur dekorativer Akzent, kein Warnstatus)
- Ink: #f2f8ff (Beschriftung)

## Typography
- Display: Bahnschrift SemiCondensed, Arial Narrow, sans-serif
- Utility: Cascadia Code, Consolas, monospace

## What NOT to Do
- Keine erfundenen Live-Drohnen- oder MQTT-Werte, kein grüner Flugfreigabestatus.
- Keine animierten UI-Funktionen als echte DJI-Steuerung verkaufen.
- Keine endlosen GSAP-Timelines, zufälligen Daten oder asynchronen Timeline-Generatoren.
- Keine absoluten Positionen für Haupttextcontainer; nur für dekorative Ringe und Raster.

## Render-Schrift (reproduzierbarer Fallback)

Für die isolierte HyperFrames-Videokomposition ist die Hauptschrift bewusst auf das allgemeine `Arial, sans-serif`-Fallback reduziert, statt auf nicht eingebettete Bahnschrift-/Arial-Narrow-Installationen zu vertrauen. Dadurch wird kein Nutzer-/CI-Font installiert oder mit ausgeliefert. Die produktive WebUI bleibt typografisch unverändert.

## Gate-Findings und Desktop-Thumbnail

Der erste echte HyperFrames-Check meldete zwei Design-Hinweise: Ein komplett leeres Startbild und bei fünf informativen Textelementen weniger als 28px. Der Titel ist nun ab Sekunde 0 statisch lesbar, während Copy/Radar/Übergang weiterhin animiert bleiben. Die betroffenen informativen Hilfstexte verwenden mindestens 28px. Der zeitlich definierte Hero trägt eine echte `clip`-Klasse; die Subcomposition-Empfehlung des CLI-Linters wird gesondert geprüft und nicht stillschweigend unterdrückt.

## Scene / Subcomposition contract

`index.html` ist der reine 1920×1080-Host mit `skyhub-gfx-intro`-Timeline. Die achtsekündige Hero-Animation liegt isoliert in `compositions/hero.html`, deren `<template>` eigene Styles, das visuelle DOM und die pausierte Timeline `skyhub-gfx-hero` enthält. HyperFrames verschachtelt beide Timelines über `data-composition-src`, es findet **kein** doppeltes `timeline.add()` statt. `index.motion.json` definiert den sichtbaren Titel ab t=0, spätere gestaffelte Einblendungen und die vollständige Bildlage des Instruments; die CLI entscheidet erst beim Lauf, ob das erfüllt ist.
