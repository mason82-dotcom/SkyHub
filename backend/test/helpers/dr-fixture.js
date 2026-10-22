'use strict';

// Synthetic MinIO DR evidence for tests. The real evidence lives in the
// git-ignored dr-status/ directory and must never be required by CI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const RUN_ID = '20261022T032308';
const HISTORIC = 'minio-dr-' + RUN_ID + '.json';
const IAM = 'sdk-iam-20261022T044017-d23f34fb.json';

function writeEvidence(filename, value) {
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600
  });
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filename)).digest('hex');
}

// Times are relative to now so the "not in the future" check holds on any clock.
function createDrFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyhub-dr-fixture-'));
  const status = path.join(root, 'dr-status');
  const iamDirectory = path.join(status, 'iam');
  fs.mkdirSync(iamDirectory, {recursive: true, mode: 0o700});

  const now = Date.now();
  const iso = offsetMs => new Date(now + offsetMs).toISOString();

  const historic = path.join(status, HISTORIC);
  const sha256 = writeEvidence(historic, {
    schema: 'skyhub-minio-dr-v1',
    runId: RUN_ID,
    completedAt: iso(-2 * 3600000),
    checks: {
      archiveIntegrity: 'passed',
      fileIntegrity: 'passed',
      s3Read: 'passed',
      isolation: 'passed',
      iamReadOnly: 'unknown'
    },
    metrics: {verifiedFiles: 54887, s3BucketsChecked: 5, s3ObjectsRead: 4}
  });

  const iam = path.join(iamDirectory, IAM);
  const denied = {denied: true, httpStatus: 403, s3Code: 'AccessDenied'};
  writeEvidence(iam, {
    schema: 'skyhub-minio-dr-iam-attestation-v1',
    runId: 'sdk-iam-fixture',
    startedAt: iso(-3600000),
    completedAt: iso(-3540000),
    status: 'passed',
    sdkExitCode: 0,
    checks: {
      adminCreate: true,
      get: true,
      put: {...denied},
      preservedAfterPut: true,
      delete: {...denied},
      preservedAfterDelete: true,
      cleanup: true
    },
    sdkScriptSha256: crypto.createHash('sha256').update('fixture').digest('hex'),
    relatedHistoricalReport: {
      runId: RUN_ID,
      sha256,
      relationship: 'historical-reference-only'
    }
  });

  return {
    root,
    status,
    historic,
    iam,
    cleanup() {
      fs.rmSync(root, {recursive: true, force: true});
    }
  };
}

module.exports = {createDrFixture, HISTORIC, IAM};
