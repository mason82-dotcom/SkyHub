'use strict';

// Serial-free catalog of DJI payload shapes: channel, method and top-level field names.
// Lets a hardware test compare real Pilot 2 firmware output with the parser
// without storing values, coordinates, serial numbers or raw MQTT payloads.
function createShapeCatalog(limit = 64) {
  const shapes = new Map();
  function record(message, at = Date.now()) {
    if (!message || typeof message.channel !== 'string') return;
    const method = typeof message.method === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(message.method)
      ? message.method : null;
    const keys = Array.isArray(message.dataKeys) ? message.dataKeys : [];
    const id = message.channel + '|' + (method || '') + '|' + keys.join(',');
    let shape = shapes.get(id);
    if (!shape) {
      if (shapes.size >= limit) return;
      shape = {channel: message.channel, method, dataKeys: [...keys],
        count: 0, needReply: 0, firstAt: at, lastAt: at};
      shapes.set(id, shape);
    }
    shape.count++;
    if (message.needReply === true) shape.needReply++;
    shape.lastAt = at;
  }
  function snapshot() {
    return [...shapes.values()]
      .map(shape => ({...shape, dataKeys: [...shape.dataKeys]}))
      .sort((a, b) => b.lastAt - a.lastAt);
  }
  return {record, snapshot};
}

module.exports = {createShapeCatalog};
