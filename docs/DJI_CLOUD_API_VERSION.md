# DJI Cloud API version baseline

SkyHub's normative protocol baseline is **DJI Cloud API v1.16.1**.

- DJI release: v1.16.1
- release date: 2025-12-17
- project baseline updated: 2026-10-02
- official documentation:
  https://developer.dji.com/doc/cloud-api-tutorial/
- supported-product reference:
  https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html

## Source precedence

When protocol sources disagree, SkyHub uses this order:

1. current official DJI Cloud API documentation;
2. DJI Cloud API v1.16.1 release/API reference;
3. real-hardware evidence captured in FH-Clone;
4. retired DJI Cloud API Demo as a historical compatibility reference.

Real-hardware evidence can confirm observed behavior but does not override the
official support matrix or create an official support claim.

## Version policy

- New MQTT methods, HTTP endpoints, WebSocket contracts, device/property enums,
  WPML fields and response DTOs must be checked against v1.16.1 or a newer
  official DJI release before being added.
- A newer official DJI release supersedes this baseline after a documented
  compatibility review.
- SkyHub does not automatically expose new aircraft-control capabilities merely
  because a newer Cloud API version documents them.
- Existing flight/DRC/takeoff/RTH guards remain fail-closed unless explicitly
  approved for this project.

## v1.15 -> v1.16.1 applicability

DJI's release history shows:

- v1.15 added Pilot-cloud support for DJI Matrice 400 and MOP data transport;
- v1.16 added DJI Dock 3 AI target recognition/tracking features;
- v1.16.1 added Dock 2/3 capabilities including configurable return-home reserve
  power and Dock 3 DLT-664 infrared-photo support.

SkyHub currently targets Pilot 2 / RC-based operation plus the existing
on-premise services. Therefore the v1.16/v1.16.1 Dock-specific control
capabilities are not enabled simply by advancing the protocol baseline.

## Current implementation status

The following SkyHub areas are already checked against current DJI contracts:

- MQTT status/OSD/state/events/requests/services-reply topic shapes;
- product config reply and storage_config_get response separation;
- HTTP STS response structure;
- Media upload/fast-upload callbacks;
- TSA topology DTO structure;
- Map group/element contracts;
- Livestream video_id/payload_index/quality contracts;
- WPML/KMZ parsing (combined with FH-Clone validation rules).

The remaining real-hardware acceptance tests are tracked in PR #1.
