---
version: alpha
name: SkyHub Next
description: Dunkle, kompakte Einsatzoberfläche für lesende DJI-Telemetrie auf dem Raspberry Pi.
colors:
  background: "#07111e"
  panel: "#101f30"
  edge: "#2c4054"
  muted: "#94abc1"
  primary: "#47c3e7"
  warning: "#f0b84a"
  critical: "#ff6b5b"
typography:
  body:
    fontFamily: "system-ui, sans-serif"
rounded:
  control: "8px"
  card: "10px"
omitted:
  - section: spacing
    reason: "Der bestehende statische Dashboard-Stil hat noch keine gemeinsame Abstands-Skala."
components:
  map: {}
  device-card: {}
  button: {}
---

# SkyHub Next Design System

## Overview

Die Leitstellenansicht ist ein **Produktwerkzeug** für Personen, die auf einem Bildschirm Gerätezustand, letzte Position und Warnungen erfassen. Die visuelle Referenz ist eine ruhige Einsatzkarte mit danebenliegendem Instrumentenfeld. Die Karte ist der räumliche Anker; die Geräteliste liefert die vollständigen Textdaten und bedienbare Alternativen. Das Produkt verwendet derzeit Deutsch und eine kompakte dunkle Oberfläche. Es gibt keine bestätigte zweite Sprache oder einen hellen Modus.

Die bestehenden Runtime-Werte in `frontend/public/index.html` sind die Quelle für Farbtokens und Layout. Diese Datei hält die Gestaltungsentscheidung fest und muss bei Änderungen an den CSS-Werten mit angepasst werden. Die Pilot-2-Webview unter `frontend/public/pilot-login.html` nutzt derzeit verwandte, aber nicht identische Werte; eine spätere Angleichung braucht einen eigenen visuellen Abgleich.

## Colors

`background`, `panel` und `edge` staffeln Karte, Seitenleiste und Karten. `primary` markiert gültige frische Positionen und die Auswahl. Gelb und Rot stehen nur für fachliche Warnstufen; Text benennt Status immer zusätzlich. Veraltete Positionen bleiben gedämpft. Der sichtbare Tastaturfokus ist heller als die normale Akzentfarbe.

## Typography

Die ausgelieferte Oberfläche nutzt Systemschriften. Kurze Labels und Zahlen sind kompakt; Gerätemodelle, Kennungen und Warntexte dürfen umbrechen. Zustände werden als klare deutsche Sätze statt als bloße Farbpunkte erklärt.

## Layout

Auf großen Ansichten stehen Karte und 355-Pixel-Infospalte nebeneinander. Unter 850 Pixeln folgt die Liste unter der Karte. Kartenaktionen liegen über der Karte, bleiben aber auch über die Geräteliste erreichbar. Die Informationsdichte bleibt höher als bei einer Marketingseite.

## Elevation & Depth

Flächen sind überwiegend durch Tonwerte und Linien getrennt. Nur über der Karte liegende Bedienelemente erhalten einen Schatten, damit sie auf hellen Kacheln lesbar bleiben.

## Shapes

Bedienelemente haben 8-Pixel-Radius, Geräte- und Kennzahlkarten 10 Pixel. Die Auswahl verwendet eine klare Kontur und einen seitlichen Akzent statt einer großen Farbfläche.

## Components

Primäre Aktionen sind beschriftete Buttons mit Hover-, deaktiviertem und sichtbarem Tastaturfokus. Geräteaktionen erklären, dass die **letzte** Position gezeigt wird. Fehlende oder ungültige Positionen erzeugen keine Kartenaktion. Lade-, Fehler- und Leerzustände werden in Text benannt. Kartenmarker sind zusätzliche Zeiger; die Liste bleibt die Tastaturalternative. Bewegung dient nur Kartenpositionierung durch eine bewusste Nutzeraktion.

## Do's and Don'ts

- Position und Frische immer getrennt angeben.
- Kartenelemente und Live-Telemetrie begrifflich unterscheiden.
- Keine aktive Flugsteuerung durch dekorative Buttons oder vermeintliche Missionsaktionen suggerieren.
- Farbe nicht als einzigen Träger von Warnungen oder Auswahl verwenden.
