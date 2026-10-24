# SkyHub Next · Light UI (2026-10-24)

Branch: `feature/webui-light-redesign-20261024`

## Scope
The live read-only Operations dashboard, the separate TAK / CoT tab, Smart Farming's experimental index catalog, WPML waypoint editor, WPML route library, 2D Survey, and the compact DJI Pilot 2 pairing page share `frontend/public/skyhub-light.css`. The legacy SkyHub stack is intentionally untouched.

## Foundations
- Light-only, accessible UI: canvas `#f3f6fb`, surfaces `#ffffff`, text `#1b2b42`, blue action `#2458d3`, teal/success, amber warnings, red incidents.
- Semantic CSS design tokens with aliases for the legacy static pages; old embedded CSS remains for layout compatibility, while the shared stylesheet (loaded after each page's embedded styles) controls the visual skin.
- Consistent cross-module navigation on standalone operator pages. DJI Pilot 2 pairing remains compact and does **not** receive extra navigation.
- Breakpoints at 1320/900/660px, focus-visible outlines, minimum 42px input/button height (44px menu links on smaller displays), reduced motion, map-first operations layout and card-based status.
- No new external dependencies, runtime state, browser storage, API actions or flight controls. Existing read-only, experimental, and safety warnings are preserved.

## Validation
```bash
node scripts/check-dashboard-inline.js
npm --prefix backend test
node --test backend/test/webui-light-theme.test.js
# Requires isolated Playwright/Leaflet/Socket.IO dependencies as configured in:
# .github/workflows/tak-ui-browser.yml
```
The Chromium TAK acceptance now **serves the actual skyhub-light.css**, asserts successful stylesheet loading, computed light canvas and white device cards, and checks mobile/desktop viewport overflow. WPML Chromium offline smoke and M3M isolated acceptance remain independent workflows. All GitHub runs must pass on the **final merged branch head**, not merely on an earlier commit.
Verify manually on 390px, 768px and desktop widths, both tabs, disconnected and connected telemetry states, map controls and all individual editor pages. Review in DJI Pilot 2 webview before promotion to production.

## Rollout and compatibility
This is a separate presentation-only branch; merge only after functional and hardware-independent UI review. The old inline per-page CSS can be retired in a later controlled refactor after checking all dynamically rendered HTML. The HTML pages continue to load locally served assets through the existing Express static serving path; no new build step is needed.
