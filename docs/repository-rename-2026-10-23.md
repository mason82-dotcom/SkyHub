# Repository-Umbenennung – SkyHub-Next (23.10.2026)

## Verifizierte Repository-Identität

Der aktuelle GitHub-Repositoryname lautet **`mason82-dotcom/SkyHub-Next`**:

- Repository: https://github.com/mason82-dotcom/SkyHub-Next
- Git-Remote (HTTPS): `https://github.com/mason82-dotcom/SkyHub-Next.git`
- Default-Branch: `main`
- Früher: `mason82-dotcom/SkyHub`

Die vorhandenen M3M-Entwicklungsbranches, insbesondere
`feature/m3m-auth-readonly-catalog-20261023`, waren nach der Umbenennung
unter dem neuen Namen erreichbar. Alte GitHub-Links leiten gegebenenfalls
weiter; Dokumentation, Remotes und CI sollen dennoch den aktuellen Namen
ausdrücklich verwenden.

## Sichere Aktualisierung bestehender Klone

```bash
cd ~/Projekte/SkyHub-Next
git status --short
git remote -v
git remote set-url origin https://github.com/mason82-dotcom/SkyHub-Next.git
git fetch origin
git remote -v
```

Vor Änderungen am lokalen Arbeitsverzeichnis auf uncommittete Anpassungen
achten. Ein Remote-Wechsel, `git fetch` oder ein neuer Draft-PR
bedeutet **keinen Merge, kein Deployment, keinen Pi-Cutover und keine
Änderung an MQTT, PostGIS, Redis, MinIO oder Docker**.

Für einen neuen Klon niemals den bereits genutzten Pi-Pfad überschreiben.
Zuerst SSD, Speicher, lokale Konfiguration und laufende Container prüfen.

## Entwicklungsstand und PR-Abhängigkeiten

Die M3M-Smart-Farming-Arbeiten sind **gestapelte Draft-PRs** und nicht
automatisch Teil des aktuellen `main`:

| PR | Umsetzung |
| --- | --- |
| [#48](https://github.com/mason82-dotcom/SkyHub-Next/pull/48) | Experimentelle Reflexionsindizes |
| [#51](https://github.com/mason82-dotcom/SkyHub-Next/pull/51) | Offline-TIFF-/XMP-Payload-Audit |
| [#55](https://github.com/mason82-dotcom/SkyHub-Next/pull/55) | DEDAL-/ODM-Orthomosaik-Übergabe |
| [#59](https://github.com/mason82-dotcom/SkyHub-Next/pull/59) | DEDAL-Preflight ohne Ausführung |
| [#64](https://github.com/mason82-dotcom/SkyHub-Next/pull/64) | Statische DEDAL-Archivanalyse |
| [#72](https://github.com/mason82-dotcom/SkyHub-Next/pull/72) | Offline-Rasterpipeline |
| [#77](https://github.com/mason82-dotcom/SkyHub-Next/pull/77) | Unabhängige Raster-QA |
| [#79](https://github.com/mason82-dotcom/SkyHub-Next/pull/79) | Raster-Integritätsbeleg |
| [#82](https://github.com/mason82-dotcom/SkyHub-Next/pull/82) | Privater Smart-Farming-Kandidat |
| [#84](https://github.com/mason82-dotcom/SkyHub-Next/pull/84) | Opt-in-authentifizierte Read-only-Katalog-API |

Der neue UI-Branch basiert auf #84 und enthält ausschließlich
eine experimentelle, lesende Smart-Farming-Darstellung,
Sicherheits-/Regressionstests und Dokumentationspflege.
Offene gestapelte Änderungen dürfen nicht ungeprüft nach `main`
gemergt werden. Selbst ein grüner GitHub-Test ersetzt keine reale
Mavic-3M-/DEDAL-/Reflexionspanel-Abnahme.

## Nicht freigegeben

Radiometrische DJI-M3M-Kalibrierung, Verifikation realer Bandregistrierung,
GIS-Kacheldienst, Dünge-/Spritzausbringkarten, Agras-Steuerung und
WPML-Missionsausführung bleiben ausgeschlossen. Ebenso wird kein
produktiver Raspberry-Pi-Dienst durch diese Repository-Arbeiten verändert.
