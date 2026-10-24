# SkyHub-Next / HyperFrames-GFX

Standalone 8-second motion opener for concept/review video exports. Does not load the live dashboard, query any endpoints, consume tokens or command DJI devices.

- Root HTML: index.html (mounts one 8-second nested scene)
- Nested scene: compositions/hero.html (template, timeline `skyhub-gfx-hero`)
- Motion assertions: index.motion.json (6 declarative time/order/frame checks)
- Visual identity: DESIGN.md
- Tools (local Node + Chromium required):
  - npx --yes hyperframes@0.8.192 lint (iterative structural scan)
  - npx --yes hyperframes@0.8.192 check --json --snapshots (pinned browser/layout/motion/contrast gate)
  - npx --yes hyperframes@0.8.192 snapshot --at 0,2,5 (optional frame review)
  - npx --yes hyperframes@0.8.192 render (separate video export after review)

The composition contains deliberate fictional interface graphics only and declares "KEINE LIVE-TELEMETRIE". It is not embedded in the interactive product. Run the above validation before distribution.

Requires Node.js 22+ and FFmpeg. The current CLI supersedes the deprecated `validate`/`inspect` commands with a single `check` command. This project has not yet produced a verified real HyperFrames render; do not imply the motion opener is approved because the offline SkyHub GFX Chromium workflow passed. CLI reference: https://github.com/heygen-com/hyperframes/blob/main/packages/cli/README.md

CI: `.github/workflows/gfx-hyperframes-motion.yml` invokes the pinned CLI on the separate 8-second **fictional** motion opener only. Browser screenshots, a JSON report and failures are uploaded as short-lived artifacts. This acceptance is not the live DJI/GFX dashboard and never performs deployment, publish or a real flight-command flow.

The root timeline remains paused and does not manually nest the hero timeline. The scene host uses `data-composition-src` and owns the complete 8-second clip. The sidecar assertions are evaluated by the same real Chromium `check` used by CI; passing a snapshot-only check without motion assertions is not sufficient.
