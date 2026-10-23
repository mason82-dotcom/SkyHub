'use strict';
/**
 * Disposable PostgreSQL 16 concurrency probe for SkyHub PV job contracts.
 * This is NOT the complete PV job runner and does not activate any SkyHub API.
 * Run only on a dedicated ephemeral PostgreSQL service in GitHub Actions.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Pool} = require('pg');

const DSN = process.env.PV_CI_DATABASE_URL;
const OPT_IN = process.env.PV_CI_DISPOSABLE;
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' ||
    OPT_IN !== 'yes' || process.env.DATABASE_URL || process.env.SKYHUB_TEST_DATABASE_URL) {
  throw new Error('Disposable PostgreSQL CI opt-in required; refusing real SkyHub databases');
}
let parsed;
try { parsed = new URL(DSN); } catch { throw new Error('Invalid test database URL'); }
if (parsed.protocol !== 'postgresql:' || parsed.username !== 'pv_ci' || !parsed.password ||
    parsed.hostname !== '127.0.0.1' || parsed.port !== '55439' ||
    parsed.pathname !== '/skyhub_pv_ci' || parsed.search || parsed.hash) {
  throw new Error('Refusing unexpected database host, role or name');
}

const schema = 'pvci_' + crypto.randomBytes(8).toString('hex');
const quoted = '"' + schema + '"';
const rootPool = new Pool({connectionString: DSN, max: 2, connectionTimeoutMillis: 5000});
const pool = new Pool({connectionString: DSN, max: 8, connectionTimeoutMillis: 5000,
  options: '-c search_path=' + schema + ' -c statement_timeout=12000 -c lock_timeout=5000'});
let keeper, created = false;
const uuid = () => crypto.randomUUID();
const workspace = uuid(), asset = uuid(), otherAsset = uuid();
const insert = async (key = uuid(), requestedAsset = asset) => {
  const r = await pool.query(
    'INSERT INTO pv_jobs(workspace_id,asset_id,idempotency_key) VALUES($1,$2,$3) RETURNING job_id',
    [workspace, requestedAsset, key]);
  return r.rows[0].job_id;
};
async function claim() {
  const token = uuid();
  const r = await pool.query(`
    WITH selected AS (
      SELECT job_id FROM pv_jobs WHERE state='queued'
      ORDER BY created_at,job_id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE pv_jobs SET state='running',claim_token=$1,
      heartbeat_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '15 minutes'
    WHERE job_id IN (SELECT job_id FROM selected)
    RETURNING job_id,claim_token`, [token]);
  return r.rows[0] || null;
}
async function finish(row) {
  const r = await pool.query(`
    UPDATE pv_jobs SET state='candidate-ready',claim_token=NULL,lease_expires_at=NULL
    WHERE job_id=$1 AND claim_token=$2 AND state='running'
    AND lease_expires_at>clock_timestamp() RETURNING job_id`,
    [row.job_id,row.claim_token]);
  return r.rowCount;
}
test.before(async () => {
  keeper = await rootPool.connect();
  try {
    const identity = await keeper.query(`
      SELECT current_database() AS db, current_user AS name,
        (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS super,
        (SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user) AS createdb,
        (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) AS createrole`);
    assert.deepEqual(identity.rows[0],
      {db:'skyhub_pv_ci',name:'pv_ci',super:false,createdb:false,createrole:false});
    const lock = await keeper.query('SELECT pg_try_advisory_lock(83137,23010) AS ok');
    assert.equal(lock.rows[0].ok,true,'Another disposable PV run holds the lock');
    const existing = await keeper.query(`
      SELECT count(*)::integer AS n FROM pg_namespace
      WHERE nspname NOT IN ('public','pg_catalog','information_schema')
      AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'`);
    assert.equal(existing.rows[0].n,0,'The disposable cluster must have no user schemas');
    const relations = await keeper.query(`
      SELECT count(*)::integer AS n FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace=n.oid
      WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','S','f')`);
    assert.equal(relations.rows[0].n,0,'The public schema must have no relations');
    await keeper.query('CREATE SCHEMA ' + quoted);
    created = true;
    await pool.query(`
      CREATE TABLE pv_verified_media (
        workspace_id uuid NOT NULL, asset_id uuid NOT NULL,
        PRIMARY KEY(workspace_id,asset_id)
      );
      CREATE TABLE pv_jobs (
        job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL,
        asset_id uuid NOT NULL,
        idempotency_key uuid NOT NULL,
        state text NOT NULL DEFAULT 'queued'
          CHECK (state IN('queued','running','candidate-ready','failed')),
        created_at timestamptz NOT NULL DEFAULT now(),
        claim_token uuid,
        heartbeat_at timestamptz,
        lease_expires_at timestamptz,
        UNIQUE(workspace_id,idempotency_key),
        FOREIGN KEY(workspace_id,asset_id)
          REFERENCES pv_verified_media(workspace_id,asset_id)
      );
      CREATE TABLE pv_audit (
        seq bigserial PRIMARY KEY,
        job_id uuid NOT NULL REFERENCES pv_jobs(job_id),
        action text NOT NULL
      );
      INSERT INTO pv_verified_media VALUES ('${workspace}','${asset}'),
        ('${workspace}','${otherAsset}');
    `);
    assert.equal((await pool.query('SELECT current_schema() AS s')).rows[0].s,schema);
  } catch (err) {
    throw new Error('Disposable PostgreSQL setup rejected: ' + err.message);
  }
});
test.after(async () => {
  try {
    await pool.end();
    if (keeper && created) await keeper.query('DROP SCHEMA ' + quoted + ' CASCADE');
  } finally {
    if (keeper) {
      try { await keeper.query('SELECT pg_advisory_unlock(83137,23010)'); }
      catch { /* closing the physical connection also releases session locks */ }
      keeper.release();
    }
    await rootPool.end();
  }
});

test('two independent connections skip a row held by another transaction',async()=>{
  const first=await insert(), second=await insert();
  const locked=await pool.connect();
  const other=await pool.connect();
  try {
    const firstPid=(await locked.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const secondPid=(await other.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    assert.notEqual(firstPid,secondPid);
    await locked.query('BEGIN');
    await locked.query('SELECT job_id FROM pv_jobs WHERE job_id=$1 FOR UPDATE',[first]);
    const result=await claim();
    assert.equal(result.job_id,second);
    assert.equal(await finish(result),1);
  } finally {
    await locked.query('ROLLBACK');locked.release();other.release();
  }
  const result=await claim();assert.equal(result.job_id,first);
  assert.equal(await finish(result),1);
});
test('parallel claims never hand the same job to two workers',async()=>{
  const id=await insert();
  const [a,b]=await Promise.all([claim(),claim()]);
  assert.equal([a,b].filter(Boolean).length,1);
  assert.equal((a||b).job_id,id);
  assert.equal(await finish(a||b),1);
});
test('idempotent media job and verified-asset foreign key constraints',async()=>{
  const key=uuid();await insert(key);
  await assert.rejects(insert(key),e=>e.code==='23505');
  await assert.rejects(insert(uuid(),uuid()),e=>e.code==='23503');
});
test('audit failure rolls back an attempted job transition',async()=>{
  const id=await insert(), running=await claim();assert.equal(running.job_id,id);
  await pool.query(`CREATE FUNCTION reject_candidate_audit() RETURNS trigger
    LANGUAGE plpgsql AS $$BEGIN IF NEW.action='candidate' THEN
      RAISE EXCEPTION 'blocked'; END IF; RETURN NEW;END$$`);
  await pool.query(`CREATE TRIGGER reject_candidate BEFORE INSERT ON pv_audit
    FOR EACH ROW EXECUTE FUNCTION reject_candidate_audit()`);
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query(`UPDATE pv_jobs SET state='candidate-ready',claim_token=NULL,
      lease_expires_at=NULL WHERE job_id=$1`,[id]);
    await assert.rejects(c.query('INSERT INTO pv_audit(job_id,action) VALUES($1,$2)',[id,'candidate']));
    await c.query('ROLLBACK');
    const r=await pool.query('SELECT state,claim_token FROM pv_jobs WHERE job_id=$1',[id]);
    assert.equal(r.rows[0].state,'running');
    assert.equal(r.rows[0].claim_token,running.claim_token);
  }finally{c.release();await pool.query('DROP TRIGGER reject_candidate ON pv_audit');}
  assert.equal(await finish(running),1);
});
test('heartbeat and finish competition cannot revive a terminal job',async()=>{
  const id=await insert(), current=await claim();assert.equal(current.job_id,id);
  const [heartbeat,done]=await Promise.allSettled([
    pool.query(`UPDATE pv_jobs SET heartbeat_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+interval '15 minutes'
      WHERE job_id=$1 AND claim_token=$2 AND state='running'
      AND lease_expires_at>clock_timestamp() RETURNING job_id`,
      [id,current.claim_token]),
    finish(current)
  ]);
  assert.equal(done.status,'fulfilled');
  assert.equal(done.value,1);
  const state=await pool.query('SELECT state,claim_token FROM pv_jobs WHERE job_id=$1',[id]);
  assert.equal(state.rows[0].state,'candidate-ready');
  assert.equal(state.rows[0].claim_token,null);
  if(heartbeat.status==='fulfilled')assert.ok(heartbeat.value.rowCount===0||heartbeat.value.rowCount===1);
  assert.equal(await finish(current),0);
});
test('expired claims can be finalized once and cannot finish afterward',async()=>{
  const id=await insert(), token=await claim();assert.equal(token.job_id,id);
  await pool.query("UPDATE pv_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1",[id]);
  assert.equal(await finish(token),0);
  const reap=async()=>pool.query(`
    WITH stale AS (SELECT job_id FROM pv_jobs WHERE state='running'
      AND lease_expires_at<=clock_timestamp()
      FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE pv_jobs SET state='failed',claim_token=NULL,lease_expires_at=NULL
    WHERE job_id IN (SELECT job_id FROM stale) RETURNING job_id`);
  const [x,y]=await Promise.all([reap(),reap()]);
  assert.equal(x.rowCount+y.rowCount,1);
  assert.equal((await pool.query('SELECT state FROM pv_jobs WHERE job_id=$1',[id])).rows[0].state,'failed');
  assert.equal(await finish(token),0);
});
