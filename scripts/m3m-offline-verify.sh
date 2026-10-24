#!/usr/bin/env bash
# Offline acceptance for experimental M3M artifacts in a disposable worktree.
# Never downloads dependencies, starts workers, reads camera data or touches Pi services.
set -euo pipefail

if [[ "${SKYHUB_M3M_OFFLINE_LAB:-}" != "1" ]]; then
  echo "ERROR: set SKYHUB_M3M_OFFLINE_LAB=1 in an isolated worktree" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd -- "$script_dir/.." && pwd -P)"
cd -- "$root"

python_bin="${SKYHUB_M3M_TEST_PYTHON:-python3}"
node_bin="${SKYHUB_M3M_TEST_NODE:-node}"

if ! "$python_bin" -c 'import numpy, rasterio, tifffile, defusedxml' >/dev/null 2>&1; then
  echo "ERROR: optional raster packages missing; install in an isolated venv first" >&2
  exit 2
fi
if [[ ! -d backend/node_modules ]]; then
  echo "ERROR: isolated backend/node_modules missing; run npm ci --prefix backend --ignore-scripts in worktree" >&2
  exit 2
fi
command -v "$node_bin" >/dev/null 2>&1 || { echo "ERROR: Node.js missing" >&2; exit 2; }

# Environment's Python and Node are used, never the live docker-compose stack.
"$python_bin" -m unittest discover -s tests -p 'test_m3m_*.py' -v
"$node_bin" --check backend/smart-farming-catalog.js
"$node_bin" --check frontend/public/smart-farming-ui.js
"$node_bin" --test \
  backend/test/smart-farming-catalog.test.js \
  backend/test/smart-farming-catalog-http.test.js \
  frontend/test/smart-farming-ui.test.js

# Fail-closed readiness flags must remain written as false in the candidate worker.
grep -Fq "'operationalUseAllowed': False" backend/workers/m3m_smart_farming_candidate.py
grep -Fq "'prescriptionExportAllowed': False" backend/workers/m3m_smart_farming_candidate.py
grep -Fq "'flightMissionAllowed': False" backend/workers/m3m_smart_farming_candidate.py
echo "M3M synthetic offline review: PASS (not scientific calibration or hardware acceptance)"
