'use strict';
// Offline-only: selects a journal key, never executes or publishes a flight command.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_.:@-]{1,128}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const invalid=()=>new Error('Flighttask correlation refused');
function resolveFlighttaskObservation(candidates,report){
  if(!Array.isArray(candidates)||candidates.length>1000||!object(report)||
    typeof report.workspaceId!=='string'||!UUID.test(report.workspaceId)||
    typeof report.gatewaySn!=='string'||!ID.test(report.gatewaySn)||
    typeof report.flightId!=='string'||!ID.test(report.flightId)||
    !['service_reply','flighttask_progress'].includes(report.kind))throw invalid();
  if(report.kind==='service_reply'&&
    (typeof report.tid!=='string'||!ID.test(report.tid)||
     typeof report.bid!=='string'||!ID.test(report.bid)))throw invalid();
  const matches=[];
  for(const c of candidates){
    if(!object(c)||typeof c.workspaceId!=='string'||!UUID.test(c.workspaceId)||
      typeof c.observationId!=='string'||!UUID.test(c.observationId)||
      typeof c.gatewaySn!=='string'||!ID.test(c.gatewaySn)||
      typeof c.flightId!=='string'||!ID.test(c.flightId)||
      typeof c.tid!=='string'||!ID.test(c.tid)||
      typeof c.bid!=='string'||!ID.test(c.bid))throw invalid();
    if(c.workspaceId!==report.workspaceId||c.gatewaySn!==report.gatewaySn||
       c.flightId!==report.flightId)continue;
    if(report.kind==='service_reply'&&(c.tid!==report.tid||c.bid!==report.bid))continue;
    matches.push(c);
    if(matches.length>1)throw invalid(); // Ambiguity must not be guessed.
  }
  if(matches.length!==1)throw invalid();
  return Object.freeze({workspaceId:matches[0].workspaceId,
    observationId:matches[0].observationId});
}
module.exports={resolveFlighttaskObservation};
