'use strict';

// Tracks confirmed writes separately from policy skips and database failures.
function createTrackRecorder({store,policy,enabled=false,clock=Date.now,onWriteError=()=>{}}){
  let ready=false,migrating=null,stored=0,skipped=0,unavailable=0,pending=0;
  let writeErrors=0,lastWriteAt=null,lastWriteErrorAt=null;
  async function migrate(){
    if(!enabled || ready)return ready;
    if(migrating)return migrating;
    migrating=Promise.resolve().then(()=>store.migrate()).then(()=>{ready=true;return true;})
      .finally(()=>{migrating=null;});
    return migrating;
  }
  function record(point,at,fields){
    if(!enabled || !point)return Promise.resolve(false);
    if(!ready){unavailable++;return Promise.resolve(false);}
    if(!policy.shouldStore(point,at)){skipped++;return Promise.resolve(false);}
    pending++;
    return Promise.resolve().then(()=>store.insert({...point,...fields}))
      .then(()=>{stored++;lastWriteAt=clock();return true;})
      .catch(err=>{
        writeErrors++;lastWriteErrorAt=clock();policy.rollback(point,at);
        onWriteError(err);
        return false;
      })
      .finally(()=>{pending--;});
  }
  return {
    migrate,record,
    prune:days=>ready?store.prune(days):Promise.resolve(0),
    snapshot:()=>({
      postgresConfigured:enabled,postgresMigrationReady:ready,
      trackPointsStored:stored,trackPointsSkipped:skipped,
      trackPointsUnavailable:unavailable,trackWritesPending:pending,
      trackWriteErrors:writeErrors,trackLastWriteAt:lastWriteAt,
      trackLastWriteErrorAt:lastWriteErrorAt
    })
  };
}
module.exports={createTrackRecorder};
