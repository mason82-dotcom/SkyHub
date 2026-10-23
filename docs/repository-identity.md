# SkyHub-Next – kanonische Repository-Identität (23.10.2026)

## Aktuelles Repository

- **GitHub:** https://github.com/mason82-dotcom/SkyHub-Next
- **HTTPS-Clone-URL:** `https://github.com/mason82-dotcom/SkyHub-Next.git`
- **Standardbranch:** `main`
- **Aktive WPML-Entwicklung:** `feature/wpml-motecshine-reference-20261023`
- **WPML-Referenz-PR:** https://github.com/mason82-dotcom/SkyHub-Next/pull/57 — Draft, Basis `feature/dji-wpml-offline-20261021`.

Das Repository wurde am 23.10.2026 von `mason82-dotcom/SkyHub` umbenannt.
**Alle neuen Links, CI-Hinweise, Issues, Pull Requests und Clone-Befehle
müssen `mason82-dotcom/SkyHub-Next` verwenden.**
GitHubs Weiterleitung alter URLs ist **kein** Ersatz für die Pflege von
Dokumentation, Automatisierungen und lokaler Git-Konfiguration.

**Nicht verwechseln:**
- `~/Projekte/SkyHub-Next`: die neue Projekt-Arbeitskopie des umbenannten GitHub-Repositorys.
- `~/Projekte/SkyHub`: der bisherige **separate produktive Legacy-Pfad** auf dem Pi.
- `stacks/legacy-skyhub/`: historischer Code-Snapshot, **nicht deployen**.
- Docker-Compose-Projektname `skyhub-next`, Host-Ports und Tailscale-URLs: eigenständige
  Betriebsbezeichner, die durch die GitHub-Umbenennung **nicht** verändert werden.

## Bestehende Entwickler-Arbeitskopie gefahrlos umstellen

```bash
cd ~/Projekte/SkyHub-Next
git status --short
git remote -v

# Erst nach Prüfung, dass "origin" wirklich die SkyHub-Next-Arbeitskopie meint:
git remote set-url origin https://github.com/mason82-dotcom/SkyHub-Next.git
git remote -v
git fetch origin --prune
git branch --show-current
```

`git fetch` holt Referenzen, merged **nicht** automatisch. Insbesondere keinen
`git reset --hard`, kein `git clean -fd`, keinen automatischen Branchwechsel
und keinen produktiven Rollout aus der Repository-Umbenennung ableiten.
Ist die Arbeitskopie ungeprüft oder `git status` nicht sauber, lokale Arbeiten
zuerst separat sichern. Es ist **keine** neue Installation auf dem Pi erforderlich.

## Neue Arbeitskopie

```bash
git clone https://github.com/mason82-dotcom/SkyHub-Next.git
cd SkyHub-Next
git remote -v
```

Ein Standard-Checkout von `main` enthält nicht zwangsläufig die jüngsten WPML-
Entwicklungen: Diese liegen bis zur formalen Prüfung im isolierten Feature-Branch
und in Draft-PR #57. Nicht ungeprüft Feature-Branches in `main` oder
in einen Raspberry-Pi-Produktivstack mergen.

## Stand der Flight-Route-Library-Entwicklung

| Teil | Implementierung | Grenze |
|---|---|---|
| P0 lokaler Browser-MVP | `/wpml-route-library.html`; explicit save, Versionen, Vorlagen | Browser-`localStorage` speichert Koordinaten im Klartext |
| P0 zentrale Datenbank | `backend/db/migrations/003_wpml_route_library_draft.sql` | Draft, Default-Deny-RLS, nicht im Produktivbetrieb angewendet |
| P1 Wegpunktaktionen | `frontend/public/wpml-action-draft.js`, Offline-WPML | Keine DJI-Hardwarefreigabe |
| Aktionsvorlagen / Umkehr | Explizite Batch-Änderungen, fail-closed-Umkehr | Neuprüfung von RTH/Heading/Kamera zwingend |

`flightReady:false` und `dispatchAllowed:false` bleiben in sämtlichen
Offline-Snapshots unverändert. Die Repository-Umbenennung hat **keine**
zusätzliche Berechtigung zur DJI-Flugausführung geschaffen.

## Prüfungen

Der CI-Workflow `.github/workflows/ci.yml` und die technischen Tests bleiben
an derselben relativen Projektstruktur. Der automatische
`node scripts/check-repository-identity.js`-Check verhindert künftig
veraltete offizielle GitHub-Verweise in den gepflegten Projekt-Dokumenten;
historische Legacy-Pfadnamen werden ausdrücklich **nicht** ersetzt.
