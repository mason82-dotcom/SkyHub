'use strict';

// Persists DJI topology (roles, gateway edges, models) in Redis so that device
// names and gateway relations survive a backend restart. Telemetry is never
// stored here: a restart must not make old readings look current.
const KEY='skyhub:topology';
const TTL_SECONDS=7*24*3600;

function createTopologyStore(redis,key=KEY){
  return {
    async save(records){
      if(!records.length)return;
      const fields=records.flatMap(record=>[record.sn,JSON.stringify(record)]);
      await redis.multi().hset(key,...fields).expire(key,TTL_SECONDS).exec();
    },
    // Unparseable entries are skipped; the registry validates every field.
    async load(){
      const all=await redis.hgetall(key)||{};
      return Object.values(all).map(raw=>{try{return JSON.parse(raw);}catch{return null;}}).filter(Boolean);
    }
  };
}
module.exports={createTopologyStore,KEY,TTL_SECONDS};
