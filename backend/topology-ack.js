'use strict';

// DJI Cloud API Pilot-to-Cloud: acknowledge accepted update_topo only.
// No DJI commands, arbitrary MQTT topic publishing, or secret forwarding.
const {serial}=require('./dji');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createStatusReply(message, raw, now=Date.now()) {
  if (!message || message.source!=='sys' || message.channel!=='status' ||
      message.method!=='update_topo' || !message.topology ||
      !serial(message.sn) || !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(message.timestamp)) return null;
  if (!Buffer.isBuffer(raw) || raw.length===0 || raw.length>131072) return null;
  let envelope;
  try { envelope=JSON.parse(raw.toString('utf8')); }
  catch { return null; }
  if (!envelope || Array.isArray(envelope) || typeof envelope!=='object' ||
      envelope.method!=='update_topo' ||
      !uuid.test(envelope.tid||'') || !uuid.test(envelope.bid||'') ||
      envelope.timestamp!==message.timestamp ||
      !envelope.data || !Array.isArray(envelope.data.sub_devices)) return null;

  return {
    topic:'sys/product/'+message.sn+'/status_reply',
    payload:JSON.stringify({
      tid:envelope.tid,bid:envelope.bid,timestamp:now,
      method:'update_topo',data:{result:0}
    })
  };
}
module.exports={createStatusReply};
