#!/usr/bin/env bash
# Copy-free retirement of a historic AeroNexus MinIO into SkyHub ownership.
# PLAN only by default; split MOVE (atomic same-NVMe rename) and UP (new
# lightweight Compose container, reusing local image layers and data).
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="/mnt/hc4backup/aeronexus-data/minio"
TARGET="/mnt/hc4backup/skyhub-next/minio"
TARGET_PARENT="${TARGET%/*}"
MOUNT="/mnt/hc4backup"
PROJECT_DIR="${SKYHUB_PROJECT_DIR:-$ROOT}"
[[ "$PROJECT_DIR" = /* && -d "$PROJECT_DIR/storage" ]] || {
  echo "ERROR: SKYHUB_PROJECT_DIR must be an absolute SkyHub checkout containing storage/" >&2
  exit 2
}
LINK="$PROJECT_DIR/storage/minio-data"
OLD_IMAGE="aeronexus/minio:RELEASE.2025-10-15T17-29-55Z-an1"
NEW_IMAGE="skyhub/minio:RELEASE.2025-10-15T17-29-55Z-an1"
EXPECTED_IMAGE_ID="sha256:117cf7edd050e6acd4a2d06be79b15eaecd5af76ad73e8927a4bf67528f19d10"
CREDENTIALS="$HOME/.config/skyhub/minio-shared.env"
COMPOSE_FILE="$ROOT/docker-compose.minio-shared.yml"
NETWORK="skyhub-storage-net"
LEGACY=(aeronexusadvanced-cloud-minio-1 aeronexus-edge-minio-1)

die() { echo "ERROR: $*" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: bash scripts/pi-minio-migrate-from-aeronexus.sh [plan|move|up|status]
  plan    READ ONLY: validate stopped old containers, NVMe, source, image,
          secret env keys, target vacancy and Docker state.
  move    OPT IN: export old MinIO env to local 0600 file; atomically RENAME
          data directory on the SAME NVMe, add Symlink in SkyHub checkout.
          Does not start Docker containers. No recursive copy.
  up      OPT IN: tag existing ARM64 image as skyhub/minio (zero layer copy),
          bring up ONE new skyhub-shared-minio service with NO host ports,
          attach running SkyHub backend to shared storage bridge.
  status  READ ONLY: show source/destination mount status and container states.
NEVER use 'docker start' on historic AeroNexus containers: they expose port 9000.
Do not run with sudo; private credentials must belong to the invoking user.
EOF
}

require() {
  command -v "$1" >/dev/null 2>&1 || die "$1 command missing"
}

check_mount() {
  [[ -d "$MOUNT" && ! -L "$MOUNT" ]] || die "NVMe mountpoint unavailable"
  local mounted source fstype
  mounted="$(findmnt --target "$MOUNT" --noheadings --output TARGET)"
  source="$(findmnt --target "$MOUNT" --noheadings --output SOURCE)"
  fstype="$(findmnt --target "$MOUNT" --noheadings --output FSTYPE)"
  [[ "$mounted" == "$MOUNT" && "$fstype" == ext4 &&
     "$source" == /dev/nvme0n1p1 ]] ||
    die "Expected ext4 NVMe mounted on $MOUNT; got $source $mounted $fstype"
}

verify_old_stopped() {
  local name status image mount
  for name in "${LEGACY[@]}"; do
    status="$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null)" ||
      die "Old container missing: $name"
    [[ "$status" == false ]] || die "Old MinIO still RUNNING: $name"
    image="$(docker inspect --format '{{.Config.Image}}' "$name")"
    mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$name")"
    [[ "$image" == "$OLD_IMAGE" && "$mount" == "$SOURCE" ]] ||
      die "Unexpected original image or /data source for $name"
  done
}

verify_image() {
  local id arch
  id="$(docker image inspect --format '{{.Id}}' "$OLD_IMAGE" 2>/dev/null)" ||
    die "Existing local ARM64 MinIO image missing; refuse remote pull"
  arch="$(docker image inspect --format '{{.Architecture}}' "$OLD_IMAGE")"
  [[ "$id" == "$EXPECTED_IMAGE_ID" && "$arch" == arm64 ]] ||
    die "Image does not match audited SHA256/arm64; manual review required"
}

verify_no_other_running() {
  local other
  other="$(docker ps --format '{{.Names}} {{.Image}}' |
    awk 'tolower($0) ~ /minio|aistor/ {print}')"
  [[ -z "$other" ]] || die "A MinIO-like container is running: $other"
}

verify_clean_destination() {
  [[ -d "$SOURCE" && ! -L "$SOURCE" ]] || die "Original data source missing"
  [[ -d "$SOURCE/.minio.sys" ]] || die "Original MinIO system metadata missing"
  [[ ! -e "$TARGET" && ! -L "$TARGET" ]] ||
    die "New destination already exists; refusing overwrite"
  [[ ! -e "$LINK" && ! -L "$LINK" ]] ||
    die "Project data link exists; refusing overwrite"
  if [[ -e "$TARGET_PARENT" ]]; then
    [[ -d "$TARGET_PARENT" && ! -L "$TARGET_PARENT" ]] ||
      die "Destination parent not a normal directory"
    [[ "$(stat -c %d "$SOURCE")" == "$(stat -c %d "$TARGET_PARENT")" ]] ||
      die "Destination is on different filesystem; cross-device copying forbidden"
  else
    [[ "$(stat -c %d "$SOURCE")" == "$(stat -c %d "$MOUNT")" ]] ||
      die "Storage source unexpectedly on a different filesystem"
  fi
}

verify_new_state() {
  [[ ! -e "$SOURCE" && ! -L "$SOURCE" ]] ||
    die "Legacy /data directory still exists; move not verified"
  [[ -d "$TARGET" && ! -L "$TARGET" && -d "$TARGET/.minio.sys" ]] ||
    die "Renamed MinIO directory or metadata is missing"
  [[ -L "$LINK" && "$(readlink -- "$LINK")" == "$TARGET" ]] ||
    die "SkyHub project storage symlink not pointing to expected target"
  [[ -f "$CREDENTIALS" && ! -L "$CREDENTIALS" ]] ||
    die "Private MinIO env file missing"
  [[ "$(stat -c %a "$CREDENTIALS")" == "600" ]] ||
    die "MinIO env file must have mode 0600"
}

verify_compose_version() {
  local ver
  ver="$(docker compose version --short 2>/dev/null)" ||
    die "Docker Compose plugin missing"
  python3 - "$ver" <<'PY'
import sys
parts = sys.argv[1].lstrip("v").split("-")[0].split(".")
if not len(parts) >= 2 or not all(part.isdigit() for part in parts[:2]):
    raise SystemExit("ERROR: cannot parse Docker Compose version.")
version = tuple(int(p) for p in (parts + ["0"])[:3])
if version < (2, 30, 0):
    raise SystemExit("ERROR: Compose 2.30+ required for raw env_file format.")
PY
}

preflight() {
  require docker;require findmnt;require python3;require stat
  verify_compose_version
  check_mount
  verify_old_stopped
  verify_image
}

status() {
  require docker;require findmnt
  echo "=== Copy-free SkyHub storage status ==="
  findmnt -T "$MOUNT" -o SOURCE,TARGET,FSTYPE
  for p in "$SOURCE" "$TARGET" "$LINK"; do
    if [[ -L "$p" ]]; then echo "Link: $p -> $(readlink -- "$p")"
    elif [[ -d "$p" ]]; then echo "Directory: $p"
    else echo "Absent: $p"; fi
  done
  for name in "${LEGACY[@]}" skyhub-shared-minio; do
    state="$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)"
    echo "Container: $name ${state:-not-created}"
  done
}

plan() {
  preflight;verify_no_other_running;verify_clean_destination
  python3 "$ROOT/scripts/pi-minio-credentials.py" check
  docker container inspect skyhub-shared-minio >/dev/null 2>&1 &&
    die "skyhub-shared-minio already exists; check its identity first"
  echo "READY: source and target reside on one NVMe; only atomic directory rename needed."
  echo "READY: image ID is the original audited ARM64 image; no layers copied."
  echo "READY: no legacy MinIO running; data source preserved until 'move'."
  echo "Project link: $LINK -> $TARGET"
}

move() {
  plan
  [[ ! -e "$CREDENTIALS" && ! -L "$CREDENTIALS" ]] ||
    die "Credentials file already exists; refuse overwrite"
  python3 "$ROOT/scripts/pi-minio-credentials.py" export
  # Create only the parent directory; never create the data destination.
  mkdir -p -- "$TARGET_PARENT"
  [[ "$(stat -c %d "$SOURCE")" == "$(stat -c %d "$TARGET_PARENT")" ]] ||
    die "Cross-filesystem move would copy data; abort"
  python3 - "$SOURCE" "$TARGET" <<'PY'
import os, pathlib, sys
src, dst = map(pathlib.Path, sys.argv[1:])
if os.stat(src).st_dev != os.stat(dst.parent).st_dev:
    raise SystemExit("ERROR: EXDEV would copy. No data moved.")
if os.path.lexists(dst):
    raise SystemExit("ERROR: destination already exists")
os.rename(src, dst)  # Metadata-only move within the same ext4 filesystem
PY
  ln -s -- "$TARGET" "$LINK"
  echo "MOVED WITHOUT COPY: $SOURCE -> $TARGET"
  echo "SkyHub project link created: $LINK"
  echo "Both historical Docker containers were left untouched and stopped."
  echo "NEXT: review status; only then run 'up'."
}

up() {
  preflight
  verify_no_other_running
  verify_new_state
  docker container inspect skyhub-shared-minio >/dev/null 2>&1 &&
    die "skyhub-shared-minio exists; will not recreate it"
  [[ -f "$COMPOSE_FILE" ]] || die "SkyHub standalone Compose file missing"
  require readlink
  docker image tag "$OLD_IMAGE" "$NEW_IMAGE"
  [[ "$(docker image inspect --format '{{.Id}}' "$NEW_IMAGE")" == "$EXPECTED_IMAGE_ID" ]] ||
    die "SkyHub image tag references unexpected image"
  if docker network inspect "$NETWORK" >/dev/null 2>&1; then
    [[ "$(docker network inspect --format '{{.Driver}}' "$NETWORK")" == bridge ]] ||
      die "Storage Docker network exists with non-bridge driver"
  else
    docker network create --driver bridge "$NETWORK" >/dev/null
  fi
  export SKYHUB_SHARED_MINIO_CREDENTIALS_FILE="$CREDENTIALS"
  # Aborts if Compose version does not support raw env_file or syntax.
  docker compose -f "$COMPOSE_FILE" config --quiet
  docker compose -f "$COMPOSE_FILE" up -d --no-build --no-deps minio
  # The existing backend is network-attached without restart.
  SKYHUB_MINIO_EXPECTED_DATA_SOURCE="$TARGET" \
    bash "$ROOT/scripts/pi-minio-network.sh" adopt skyhub-shared-minio
  echo "Storage endpoint: http://skyhub-minio:9000 (Docker network only)."
  echo "NEXT (read-only): bash scripts/pi-minio-network.sh verify"
  echo "No data, images/layers or secrets copied to the project directory."
}

mode="${1:-plan}"
[[ $# -le 1 ]] || { usage;exit 2; }
case "$mode" in
  plan) plan ;;
  move) move ;;
  up) up ;;
  status) status ;;
  help|-h|--help) usage ;;
  *) usage >&2;exit 2;;
esac
