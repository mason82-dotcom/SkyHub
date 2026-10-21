#!/usr/bin/env bash
# PREPARED ONLY. Mutates the Pi only with explicit --execute-backup.
set +x
set -Eeuo pipefail
umask 077
[[ "${1:-}" == --execute-backup && $# == 1 ]] || {
  echo 'NOT EXECUTED. Usage after separate approval: sudo bash backup.sh --execute-backup'
  exit 2
}
[[ $EUID == 0 ]] || { echo 'ERROR: root required'; exit 2; }
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE=/mnt/hc4backup/skyhub-next/minio
PROJECT=/home/mason/Projekte/SkyHub-Next
IMAGE=sha256:117cf7edd050e6acd4a2d06be79b15eaecd5af76ad73e8927a4bf67528f19d10
for tool in python3 docker tar zstd gpg sha256sum findmnt; do command -v "$tool" >/dev/null; done
[[ -f "$HERE/manifest.py" ]]
[[ "$(findmnt -nr --mountpoint /mnt/hc4backup -o UUID)" == ad583d3f-9bfe-4792-829c-1cc2b6738358 ]]
[[ "$(findmnt -nr --mountpoint /mnt/benz -o SOURCE)" == /dev/nvme1n1p1 ]]
[[ "$(findmnt -nr -T "$SOURCE" -o TARGET)" == /mnt/hc4backup ]]
[[ -d "$SOURCE/.minio.sys" && ! -L "$SOURCE" ]]
[[ "$(docker inspect -f '{{.State.Running}}' skyhub-next-minio-1)" == true ]]
[[ "$(docker inspect -f '{{.Image}}' skyhub-next-minio-1)" == "$IMAGE" ]]
[[ "$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' skyhub-next-minio-1)" == "$SOURCE" ]]
for old in aeronexusadvanced-cloud-minio-1 aeronexus-edge-minio-1; do
  [[ "$(docker inspect -f '{{.State.Running}}' "$old")" == false ]]
done
python3 - "$SOURCE" "$IMAGE" <<'PY'
import json, os, shutil, subprocess, sys
total = entries = 0
def fail(_):
    raise SystemExit('ERROR: directory traversal failed')
for current, dirs, files in os.walk(sys.argv[1], onerror=fail):
    entries += 1 + len(files)
    for name in dirs + files:
        p = os.path.join(current, name)
        if os.path.islink(p):
            raise SystemExit('ERROR: symlink found; manual review required')
    total += sum(os.lstat(os.path.join(current, n)).st_size for n in files)
image = json.loads(subprocess.check_output(['docker', 'image', 'inspect', sys.argv[2]]))[0]
required = total + image['Size'] + 48*1024**3 + 10*1024**3 + entries*4096
if shutil.disk_usage('/mnt/benz').free < required:
    raise SystemExit('ERROR: insufficient capacity including restore and reserve')
print('Capacity preflight passed; no compression savings assumed.')
PY
python3 - "$SOURCE" <<'PY'
import json, pathlib, subprocess, sys
source = pathlib.Path(sys.argv[1]).resolve()
ids = subprocess.check_output(['docker', 'ps', '-q'], text=True).split()
for obj in json.loads(subprocess.check_output(['docker', 'inspect', *ids])) if ids else []:
    if obj['Name'] == '/skyhub-next-minio-1':
        continue
    for mount in obj.get('Mounts', []):
        if mount.get('Type') != 'bind' or not mount.get('RW'):
            continue
        p = pathlib.Path(mount['Source']).resolve()
        if p == source or p in source.parents or source in p.parents:
            raise SystemExit('ERROR: another running container has overlapping writable storage')
print('No other running container has an overlapping writable bind mount.')
PY
read -r -p 'All S3 users accounted for; maintenance interruption approved? Type BACKUP: ' answer </dev/tty
[[ "$answer" == BACKUP ]] || exit 2
read -r -s -p 'New archive passphrase (store separately): ' PASS </dev/tty; echo
read -r -s -p 'Repeat passphrase: ' REPEAT </dev/tty; echo
[[ -n "$PASS" && "$PASS" == "$REPEAT" ]] || { echo 'ERROR: passphrases differ'; exit 2; }
unset REPEAT
[[ "$(findmnt -nr -T /run -o FSTYPE)" == tmpfs ]] || { echo 'ERROR: /run must be tmpfs'; exit 2; }
STAGE="$(mktemp -d /run/skyhub-backup.XXXXXXXX)"
OUT="$(mktemp -d /mnt/benz/skyhub-backup-$(date +%Y%m%dT%H%M%S)-XXXXXXXX)"
STOPPED=0
source_ready() {
  [[ "$(findmnt -nr --mountpoint /mnt/hc4backup -o UUID)" == ad583d3f-9bfe-4792-829c-1cc2b6738358 &&
     "$(findmnt -nr -T "$SOURCE" -o TARGET)" == /mnt/hc4backup &&
     -d "$SOURCE/.minio.sys" && ! -L "$SOURCE" ]]
}
finish() {
  local result=$?
  trap - EXIT
  unset PASS
  if (( STOPPED )); then
    if ! source_ready || ! docker start skyhub-next-minio-1 >/dev/null; then
      echo 'CRITICAL: existing MinIO could not restart; manual recovery required.' >&2
      result=1
    fi
  fi
  rm -rf -- "$STAGE"
  (( result == 0 )) || echo "FAILED: keep incomplete backup directory for review: $OUT" >&2
  exit "$result"
}
trap finish EXIT
mkdir -m 700 "$STAGE/gnupg" "$STAGE/evidence" "$STAGE/evidence/config"
# Capture runtime secrets only on tmpfs; archive them encrypted, never print them.
docker inspect skyhub-next-minio-1 skyhub-next-backend-1 > "$STAGE/evidence/runtime.json"
docker image inspect "$IMAGE" > "$STAGE/evidence/image.json"
for f in "$PROJECT/docker-compose.yml" "$PROJECT/docker-compose.minio.yml" \
         "$PROJECT/.env" /home/mason/.config/skyhub/minio-shared.env; do
  [[ -f "$f" && ! -L "$f" ]] || { echo 'ERROR: expected regular config file missing'; exit 2; }
  cp --parents --preserve=all "$f" "$STAGE/evidence/config/"
done
python3 - "$STAGE/evidence" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
runtime = json.loads((p/'runtime.json').read_text())
server = next(x for x in runtime if x['Name'] == '/skyhub-next-minio-1')
values = server['Config']['Env']
if any('\n' in x or '\r' in x for x in values):
    raise SystemExit('ERROR: multiline Docker env requires manual review')
(p/'minio.env').write_text('\n'.join(values)+'\n')
(p/'image-id').write_text(server['Image']+'\n')
PY
encrypt() {
  gpg --homedir "$STAGE/gnupg" --batch --pinentry-mode loopback \
    --no-symkey-cache --passphrase-fd 3 --symmetric --cipher-algo AES256 \
    --output "$1" 3<<<"$PASS"
}
decrypt() {
  gpg --homedir "$STAGE/gnupg" --batch --pinentry-mode loopback \
    --no-symkey-cache --passphrase-fd 3 --decrypt "$1" 3<<<"$PASS"
}
# Image backup can be made while the existing server is still running.
docker image save "$IMAGE" | zstd -T1 -3 | encrypt "$OUT/image.tar.zst.gpg.partial"
decrypt "$OUT/image.tar.zst.gpg.partial" | zstd -d | tar -tf - >/dev/null
mv "$OUT/image.tar.zst.gpg.partial" "$OUT/image.tar.zst.gpg"
# The EXIT trap restarts the same existing container if stop times out/interruption occurs.
STOPPED=1
docker stop --time 120 skyhub-next-minio-1 >/dev/null
[[ "$(docker inspect -f '{{.State.Running}}' skyhub-next-minio-1)" == false ]]
[[ "$(docker inspect -f '{{.State.ExitCode}}' skyhub-next-minio-1)" == 0 ]] || {
  echo 'ERROR: MinIO did not stop cleanly; no data archive created'; exit 2;
}
python3 "$HERE/manifest.py" create "$SOURCE" "$STAGE/evidence/files.jsonl"
tar --format=pax --numeric-owner --acls --xattrs --xattrs-include='*' --sparse \
  --one-file-system -cpf - -C /mnt/hc4backup/skyhub-next minio -C "$STAGE" evidence \
  | zstd -T1 -3 | encrypt "$OUT/data.tar.zst.gpg.partial"
decrypt "$OUT/data.tar.zst.gpg.partial" | zstd -d | tar -tf - >/dev/null
mv "$OUT/data.tar.zst.gpg.partial" "$OUT/data.tar.zst.gpg"
python3 "$HERE/manifest.py" verify "$SOURCE" "$STAGE/evidence/files.jsonl"
(cd "$OUT"; sha256sum data.tar.zst.gpg image.tar.zst.gpg > SHA256SUMS)
sync -f "$OUT/data.tar.zst.gpg"
sync -f "$OUT/image.tar.zst.gpg"
sync -f "$OUT/SHA256SUMS"
source_ready || { echo 'CRITICAL: source mount no longer valid; restart refused'; exit 2; }
docker start skyhub-next-minio-1 >/dev/null
STOPPED=0
printf '%s\n' 'Archive verified; source manifest matched; existing container restarted.' \
  'S3 readiness and isolated restore are NOT yet accepted.' > "$OUT/ARCHIVE-COMPLETE.txt"
echo "Backup directory: $OUT"
echo 'NEXT: existing-backend readiness check in README; then isolated restore.'
