# SkyHub-Next / HyperFrames-GFX

Standalone 8-second motion opener for concept/review video exports. Does not load the live dashboard, query any endpoints, consume tokens or command DJI devices.

- HTML source: index.html
- Visual identity: DESIGN.md
- Tools (local Node + Chromium required):
  - npx hyperframes lint (iterative structural scan)
  - npx hyperframes check --snapshots (current final browser/layout/motion/contrast gate)
  - npx hyperframes snapshot --at 0,2,5 (optional frame review)
  - npx hyperframes render (separate video export)

The composition contains deliberate fictional interface graphics only and declares "KEINE LIVE-TELEMETRIE". It is not embedded in the interactive product. Run the above validation before distribution.

Requires Node.js 22+ and FFmpeg. The current CLI supersedes the deprecated `validate`/`inspect` commands with a single `check` command. This project has not yet produced a verified real HyperFrames render; do not imply the motion opener is approved because the offline SkyHub GFX Chromium workflow passed. CLI reference: https://github.com/heygen-com/hyperframes/blob/main/packages/cli/README.md
