# SkyHub-Next – Thermal-Person-Geolocation (Offline-Preview)

**Status: research / not field-ready.** Independent Python-stdlib worker; not imported, deployed, enabled, or connected to SkyHub backend, DJI MQTT, HTTP, frontend map, Redis, PostGIS, MinIO or flight control. The existing YOLO11 worker is RGB-only and is NOT a thermal person detector.

## Origin and limitations

Architecture inspired by [Gruzver/uav-thermal-person-geolocation](https://github.com/Gruzver/uav-thermal-person-geolocation) (MIT; exact third-party copyright/license notice: [thermal-person-geolocation-MIT.txt](thermal-person-geolocation-MIT.txt)). The reference is ROS2 Humble + YOLOv8x + DJI **Mavic 3T** with video/SRT and live DJI MQTT inputs. No upstream ROS2 nodes, MQTT credentials, trained weights, datasets, pretrained detectors or camera assumptions were copied. The implementation here is a restricted pinhole-camera ground-plane projection independently authored for SkyHub.

**Accuracy:** The upstream paper's selected-pass sub-meter results are not a SkyHub performance claim. The reported nadir result excludes some flights; field accuracy is unknown. The upstream OSD telemetry interval is coarse (~0.5 Hz), so moving-aircraft live image-to-telemetry alignment is not solved by this module. Matrice 4T has a different thermal optical field of view from Mavic 3T. There is no tested M4T calibration, no GNSS/terrain uncertainty propagation and no reliable search-and-rescue positioning yet.

## Input requirements (fail closed)

- Frame and pose timestamps must be **verified UTC epoch milliseconds**, at most **250 ms** apart. No pose interpolation, extrapolation, or re-use of old gimbal values.
- Camera FOV (horizontal AND vertical) must be externally calibrated, mapped to the same undistorted and uncropped bounding-box coordinate space as the frame; calibrated profile identifier required, zoom ratio exactly 1.
- A real ground-relative height **AGL** must be measured or derived against local terrain. DJI 'elevation' above takeoff and DJI 'height' above other references must **not** be passed directly as AGL.
- Gimbal yaw must be absolute true-north clockwise, not unchecked aircraft-relative yaw; pitch negative down; roll must be exactly zero. Nonzero roll is deliberately rejected pending a verified extrinsic rotation implementation.
- Coherent position pair; reject DJI sentinel (0,0), missing flags, non-finite numbers, extra JSON keys, invalid coordinates or bounding boxes, duplicate track IDs.
- Only a 'person' label with confidence >= 0.5 produces an estimate. Max 64 detections, ray down component >= 0.15, ground offset <= 1000 m. Outputs are **unverified candidates** with fixed false readiness/verification flags.
- Verification flags are only caller assertions: the worker cannot independently certify calibration, GNSS, location, clock or a person's identity.

## Example synthetic payload – TEST DATA, NOT M3T/M4T CALIBRATION

~~~json
{
  "schema": "skyhub-thermal-person-geolocation-input-v1",
  "timestampMs": 1800000000000,
  "frame": {
    "width": 640,
    "height": 512,
    "coordinateSpace": "undistorted_uncropped"
  },
  "camera": {
    "calibrationId": "CALIBRATED_EXTERNAL_TEST_PROFILE",
    "horizontalFovDeg": 50,
    "verticalFovDeg": 40,
    "verified": true,
    "zoomRatio": 1
  },
  "telemetry": {
    "timestampMs": 1800000000100,
    "timeVerified": true,
    "latitude": 49,
    "longitude": 8,
    "positionVerified": true,
    "altitudeAglM": 100,
    "altitudeAglVerified": true,
    "gimbalYawDeg": 0,
    "gimbalPitchDeg": -90,
    "gimbalRollDeg": 0,
    "gimbalVerified": true,
    "yawReference": "true_north_clockwise"
  },
  "detections": [
    {
      "trackId": 1,
      "className": "person",
      "confidence": 0.95,
      "bboxXYXY": [
        310,
        246,
        330,
        266
      ]
    }
  ]
}
~~~

## Explicit local execution

~~~bash
python3 -m unittest discover -s tests -p 'test_thermal_person_geolocation.py'
python3 backend/workers/thermal_person_geolocation.py --input /ABSOLUTE/PRIVATE/input.json --output /ABSOLUTE/PRIVATE/new-output.json --allow-sensitive-location-output
~~~

The worker never opens sockets or loads ML libraries. It refuses missing opt-in, relative paths, symlink inputs, duplicate JSON keys, oversized input, existing output and unsafe/unverified fields; output is an exclusive new local JSON file with mode 0600. Candidate GPS data is sensitive: never commit inputs/outputs or print raw source telemetry in CI logs.

The output schema is skyhub-thermal-person-geolocation-preview-v1 with status, detection counters and estimates. Each estimate is marked unverified_candidate; the top-level flags geolocationVerified, accuracyMetersVerified, flightControlReady and searchAndRescueReady are always false.

## Bounded offline batch alignment

An independent optional adapter `backend/workers/thermal_person_batch_offline.py` consumes previously produced, trusted thermal-frame detections and independently verified telemetry. It does **not** run a detector, inspect video, subscribe to DJI topics or expose HTTP.

- Input schema: `skyhub-thermal-geolocation-batch-input-v1` with only `schema`, `frames` and `telemetry`.
- Each frame has `timestampMs`, the already-calibrated `frame`, `camera` and `detections` objects documented above. Each telemetry record uses the single-frame `telemetry` contract.
- Both arrays must have strictly increasing timestamps; at most 128 frames and 256 telemetry states. Every state, frame, calibration and box is validated (including frames with no valid pose).
- Nearest-neighbour matching uses a 250 ms verified-source-time cutoff with earlier-sample tie-breaking; there is **no** interpolation, extrapolation, Kalman smoothing or promise that 250 ms implies accurate moving-aircraft positioning.
- Out-of-window frames return `pose_unavailable` with no candidate coordinates; invalid geometry or unverified calibration fails the batch. Output includes only frame indexes, unverified candidates, counts and fixed false readiness flags, never raw telemetry or original timestamps.
- An optional JSON file CLI requires explicit `--allow-sensitive-location-output`, absolute local input/output paths and exclusive private output (0600). No model weights or camera data are bundled.

```bash
python3 -m unittest discover -s tests -p 'test_thermal_person_batch_offline.py'
python3 backend/workers/thermal_person_batch_offline.py --input /ABSOLUTE/PRIVATE/batch.json --output /ABSOLUTE/PRIVATE/new-candidates.json --allow-sensitive-location-output
```

**Hard limitation:** This is the offline **synchronizer and geometry half only**, not a complete thermal computer-vision pipeline. The YOLOv8x trained weights from the reference repository are not integrated; no conversion/normalization of raw DJI thermal video, SRT metadata, M3T/M4T runtime sensor payload mapping or hardware-based accuracy test has been done. Default deny/no deployment remains mandatory.

## Optional 8-bit thermal person detector (new, NOT deployed)

`backend/workers/thermal_person_detector_offline.py` provides a **manual local-only YOLO inference stage** for 8-bit rendered JPEG/PNG thermal frames. This is not a raw radiometric decoder, DJI live image adapter, or a guarantee that the image was genuinely recorded by a thermal sensor. It requires separately reviewed local model weights, plus the optional Ultralytics/Pillow runtime installed outside the standard SkyHub backend. Neither dependencies nor weights are installed by Compose/CI.

**Security:** `--trust-local-model` is required even for ONNX, and PyTorch `.pt` additionally requires `--allow-trusted-pt`; PT deserialization can execute code, so use only audited local model weights, never arbitrary downloads. No automatic weights or frame downloads. There is a 30 MiB image cap, 512 MiB model cap, 8192 px axis/12 Mpixel bound, 64 result cap, exact model-reported image size validation, and metadata-bearing EXIF/XMP input rejection. The worker fails closed and does not log paths or raw image content. A lowercase SHA-256 digest of the exact independently reviewed model bytes is **mandatory**; the worker verifies it before loading any model library. A hash proves file integrity against the supplied digest, **not** model safety, suitability or provenance. Store reviewed weights in a private read-only directory to prevent replacement between digest verification and inference. Animated or multi-frame images are rejected. Local output JSON must be a **new** absolute private path; it is created with `0600` and never overwritten.

```bash
# Only after manually installing reviewed Pillow/Ultralytics runtime and obtaining
# model weights with checked origin, license, training data and format:
python3 backend/workers/thermal_person_detector_offline.py \
  --image /ABSOLUTE/PRIVATE/8bit-thermal-frame.png \
  --model /ABSOLUTE/REVIEWED/person-model.onnx \
  --model-sha256 LOWERCASE_SHA256_OF_REVIEWED_MODEL_FILE \
  --output /ABSOLUTE/PRIVATE/new-detection-result.json \
  --trust-local-model
# A reviewed .pt model needs --allow-trusted-pt too.
python3 -m unittest discover -s tests -p 'test_thermal_person_detector_offline.py'
```

Only the literal model label `person` is accepted. Reported `detectionIndex` is a **single-frame index, not a persistent trackId**. `coordinateSpace=decoded_image_unverified` deliberately prevents direct ingestion into the calibrated geolocation batch contract; before that is possible, a separately authenticated, reviewed adapter must establish corrected pixel geometry and stable track IDs. All readiness, presence, geolocation and radiometric verification flags remain false. Without a trained thermal person model, no real detection functionality can be validated.

## Manual single-frame detector → geolocation handoff (optional, disabled by default)

`backend/workers/thermal_person_manual_handoff.py` is a **local-only manual research adapter** that couples a previously obtained thermal detector preview with an explicitly approved camera/pose record. There is no automatic detector→GPS connection or live service.

Input schema: `skyhub-thermal-person-manual-handoff-input-v1` with exact top-level keys `schema`, `detectionReport` and `review`.

- `detectionReport` must be the exact redacted `skyhub-thermal-person-detection-preview-v1` contract (with `personPresenceVerified=false`, `trackingVerified=false`, `thermalRadiometryVerified=false`, `geolocationVerified=false`, `flightControlReady=false`, `searchAndRescueReady=false`). Unknown fields, malformed boxes, non-person labels, inconsistent dimensions/indexes/counts are rejected.
- `review` must specify exact `timestampMs`, `frame`, `camera`, `telemetry`, `pixelTransform`, `sourceFrameReviewed`, `modelReviewed`, `opticalGeometryReviewed`, `detectionsReviewed`, and `trackAssignments`.
- All four review flags must be true, `pixelTransform` exactly `identity-undistorted-full-frame`; externally established full-frame calibration must match the detector frame's width and height. This **does not perform undistortion**. Inputs that are cropped, resized, letterboxed, zoomed or not externally characterized must be refused; NEVER set approval flags to bypass this requirement.
- `trackAssignments` must contain one exact ordered mapping of `detectionIndex` to externally assigned `trackId` for each detection, with no duplicates. This module does **not** derive track persistence, nor certify the track IDs across video frames.
- Telemetry pose must meet the existing true-north yaw, verified AGL, zero-roll, source timestamp (≤250 ms skew), and camera-calibration constraints; otherwise **no** GPS candidate is emitted.
- The module cannot independently prove that the source thermal image matches the detector preview or that human-review flags are truthful. Its output is always `skyhub-thermal-person-manual-handoff-preview-v1` with `geolocationVerified=false`, `accuracyMetersVerified=false`, `personPresenceVerified=false`, `trackingVerified=false`, `searchAndRescueReady=false`, and `flightControlReady=false`. No accuracy guarantees.
- Optional CLI requires **both** `--accept-reviewed-handoff` and `--allow-sensitive-location-output`. Input must be an absolute private local JSON file; output is a new exclusive `0600` JSON file, never printed with location data.

```bash
python3 -m unittest discover -s tests -p 'test_thermal_person_manual_handoff.py'
python3 backend/workers/thermal_person_manual_handoff.py \
  --input /ABSOLUTE/PRIVATE/manual-review.json \
  --output /ABSOLUTE/PRIVATE/new-unverified-locations.json \
  --accept-reviewed-handoff --allow-sensitive-location-output
```

**Critical missing chain-of-custody requirement:** The redacted detector preview intentionally has no image hash, source ID, frame timestamp, or signed attestation. Therefore no software proof currently binds the approved review to the exact source frame. This adapter is limited to offline, manually supervised research and cannot be wired to automatic workflows or public maps without a trusted, privacy-reviewed frame-binding mechanism and hardware ground-truth validation.

## Private frame-to-report integrity envelope (separate opt-in, NOT live)

`backend/workers/thermal_person_provenance_offline.py` offers a new **explicit two-phase, local-only** research workflow: `seal` runs a reviewed model on a local rendered thermal frame, validates the existing `thermal_person_manual_handoff` contract, and writes an HMAC-SHA256-protected private envelope. `verify` refuses a changed envelope/image/model and runs the manual candidate projection only after checking the signature.

The sealed envelope contains exact detector preview and full private review object plus lowercase SHA-256 digests for the **actual image and model file bytes**. A domain-separated HMAC authenticates their association using a pre-provisioned **private 32-byte issuer key**. No path, secret, or raw thermal image bytes are embedded. **The envelope contains sensitive camera/telemetry data** and must never be committed, logged, sent to the browser, shared, or uploaded.

The image and model are hashed **before and after** model execution; changed content is refused. Verification rehashes both files and requires the external, independently approved model digest again. This limits post-hoc substitution, but cannot eliminate an adversarial file-replacement race or independently attest which bytes a third-party model loader actually opened. The frame and model MUST reside in private read-only storage through inference and verification. Any actor who controls the issuer key can forge an envelope; this is a *local integrity assertion*, not camera/flight authenticity or a trusted timestamp attestation.

```bash
# Create and protect a dedicated, per-environment HMAC key outside Git.
umask 077
head -c 32 /dev/urandom > /ABSOLUTE/PRIVATE/thermal-issuer.key
chmod 600 /ABSOLUTE/PRIVATE/thermal-issuer.key

# After independent approval of model weights, exact frame optics,
# the calibration profile and per-frame measured pose:
python3 backend/workers/thermal_person_provenance_offline.py seal \
  --image /ABSOLUTE/READONLY/thermal-frame.png \
  --model /ABSOLUTE/READONLY/reviewed-thermal-person.onnx \
  --model-sha256 LOWERCASE_SHA256_OF_APPROVED_MODEL \
  --key-file /ABSOLUTE/PRIVATE/thermal-issuer.key \
  --review /ABSOLUTE/PRIVATE/manual-review.json \
  --output /ABSOLUTE/PRIVATE/new-sealed-envelope.json \
  --trust-local-model --accept-reviewed-handoff --allow-sensitive-location-output

# Separate offline verification of immutable input bytes and HMAC:
python3 backend/workers/thermal_person_provenance_offline.py verify \
  --envelope /ABSOLUTE/PRIVATE/new-sealed-envelope.json \
  --image /ABSOLUTE/READONLY/thermal-frame.png \
  --model /ABSOLUTE/READONLY/reviewed-thermal-person.onnx \
  --model-sha256 LOWERCASE_SHA256_OF_APPROVED_MODEL \
  --key-file /ABSOLUTE/PRIVATE/thermal-issuer.key \
  --output /ABSOLUTE/PRIVATE/new-unverified-candidates.json \
  --accept-reviewed-handoff --allow-sensitive-location-output
```

The secret must be owned by the current process user, with no group/other permission bits, a regular non-symlink file, and **exactly 32 raw bytes**. Do not put it into environment variables, command arguments, URLs, Docker images or Git. The CLI never prints coordinates or private file paths, refuses existing output files, and writes exclusive `0600` JSON files.

The verification result uses `skyhub-thermal-integrity-geolocation-preview-v1`, explicitly distinguishes `envelopeIntegrityVerified=true` from `geolocationVerified=false`, and keeps person presence, source/sensor authenticity, review independence, SAR readiness, tracking and positional accuracy **false**.

**Not solved:** A manually issued review assertion is not a verifiable human identity or external camera-calibration certificate. An HMAC signed by the same local process is not a hardware-origin signature or absolute proof that a detector processed these pixels; an independent, authenticated capture attestation and externally checked M3T/M4T camera calibration remain necessary. No backend HTTP route, DJI topic, live map, or model deployment has been added.

Tests: `python3 -m unittest discover -s tests -p 'test_thermal_person_provenance_offline.py'`. These use deterministic synthetic files and mock inference only.

## Necessary future gates (NOT implemented)

1. Use the existing read-only SkyHub DJI telemetry path with verified **source** clock, per-field age and camera payload mapping; never add a second unbounded broker subscription.
2. Validate per-model Mavic 3T/Matrice 4T thermal optics, zoom, sensor distortion and optical axis, yaw convention and pitch/roll extrinsics. Verify true AGL against terrain / DEM.
3. Connect a properly licensed and independently evaluated **thermal** person model with bounded inference. RGB YOLO11 weights do not qualify.
4. Compare against independently measured ground-truth landmarks over altitudes, gimbal angles, flight speed and topography; build uncertainty propagation and manual-review workflow.
5. Only then consider a privacy- and RBAC-gated optional candidate layer; never automatic alarms, flight operations, emergency dispatch, or claims of sub-meter performance.

Tests cover geometry (nadir, oblique, yaw, image offsets), horizon/distance gates, telemetry skew, unsupported calibration/zoom/roll, non-finite and malformed inputs, and secure CLI output. No hardware, ROS2, video, thermal inference, real AGL measurement, or DJI end-to-end test has been performed.
