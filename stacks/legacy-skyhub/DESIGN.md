---
version: "1.0"
name: "SkyHub Flight Console"
description: "Ruhiger, technischer Flugleitstand für verifizierte DJI-Live-Telemetrie."
colors:
  background: "#081018"
  surface: "#111b24"
  surface-raised: "#17232d"
  border: "#293844"
  text: "#e7edf1"
  muted: "#8ea0ad"
  live: "#54d69a"
  warning: "#e4b75f"
  danger: "#ed7478"
  signal: "#65b6ff"
typography:
  sans:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
rounded:
  DEFAULT: "14px"
  control: "10px"
  pill: "999px"
spacing:
  panel-gap: "12px"
  content-max: "1240px"
components:
  status-pill: {}
  instrument: {}
  panel: {}
---

# SkyHub Flight Console

## Overview

Die Oberfläche ist ein Instrumentenbrett für technische Betreiber, kein Flugfreigabe- oder Marketingbildschirm. Ihre Signatur ist ein zurückhaltendes Radar-Raster neben präzisen Messwerten. Der Status „live“ ist ausschließlich tatsächlich empfangener, validierter Telemetrie vorbehalten.

## Colors

Dunkle Blauschwarz-Flächen bilden die Ebenen. Grün bedeutet frische Live-Daten, Gelb Warten oder Verzögerung und Rot eine Trennung beziehungsweise sicherheitsrelevante Sperre. Jeder Farbstatus benötigt zusätzlich ein Textlabel.

## Typography

System-Sans dient Navigation und Erklärtexten. Seriennummern, Koordinaten, Eyebrows und technische Statuswerte verwenden den Mono-Stack. Messwerte nutzen tabellarische Ziffern.

## Layout

Die Konsole ist auf 1240 px begrenzt. Vier Instrumente bilden auf Desktop die primäre Reihe, auf Tablet zwei Spalten und auf kleinen Geräten eine Spalte. Inhalte bleiben dokumentbasiert scrollbar; kein Panel übernimmt den gesamten Viewport.

## Elevation & Depth

Tiefe entsteht durch drei Tonflächen und dünne Konturen. Schatten und dekorative Glows bleiben dem Positionssignal vorbehalten.

## Shapes

Panels verwenden 14 px, kompakte Bedienelemente 10 px und Statusanzeigen Pillen. Kreise werden ausschließlich für Signalpunkte und Radar-Geometrie verwendet.

## Components

Status-Pills kombinieren Farbe, Punkt und Text. Instrumente reservieren feste Flächen für Messwert, Einheit und Quelle. Leere, wartende, veraltete und getrennte Zustände bleiben deutlich unterscheidbar. Laufzeit-Tokens sind in `frontend/public/app.css` kanonisch abgebildet.

## Do's and Don'ts

- Live nur nach einer validierten OSD-Nachricht anzeigen.
- Fehlende Werte mit `–` darstellen.
- MQTT-Verbindung und Flugbereitschaft sprachlich trennen.
- Keine animierte oder farbliche Freigabe ohne Textnachweis verwenden.
