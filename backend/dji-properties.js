'use strict';

// Metadata extracted from pinned DJI Cloud-API-Doc property tables.
// Only whitelisted, bounded read-only property values are accepted.
// Neither DJI command/set topics nor raw MQTT envelopes are exposed.
const catalog = require('./data/dji-cloud-api-118-fields.json');

function makeTree(fields) {
  const root = {children: Object.create(null)};
  for (const field of fields) {
    const parts = field.path.split('.');
    let node = root;
    for (const part of parts) {
      if (!Object.hasOwn(node.children, part))
        node.children[part] = {children: Object.create(null)};
      node = node.children[part];
    }
    node.type = field.type;
    node.push = field.push;
    node.min = field.min;
    node.max = field.max;
    node.length = field.length;
    node.enum = field.enum;
  }
  // A nested property's pushMode column may be 0 even when its
  // containing top-level struct/array is reported on state.
  return root;
}
const trees = Object.fromEntries(Object.entries(catalog.profiles)
  .map(([key, value]) => [key, makeTree(value.fields)]));

function deviceProfile(model) {
  if (!model || typeof model !== 'object') return null;
  const key = [model.domain, model.type, model.subType].join(':');
  const mapping = catalog.devices[key];
  return mapping ? {name:mapping.profile, confidence:mapping.confidence} : null;
}
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function cleanText(value, path, length) {
  if (typeof value !== 'string') return undefined;
  const limit = Math.min(Number.isInteger(length) ? length : 64, 64);
  if (value.length > limit) return undefined;
  if (path.endsWith('firmware_version') && /^[A-Za-z0-9_.-]{1,64}$/.test(value)) return value;
  if (path === 'country' && /^[A-Za-z]{2,3}$/.test(value)) return value;
  if ((path.endsWith('payload_index') || path.endsWith('camera_index')) &&
      /^\d{1,4}-\d{1,4}-\d{1,2}$/.test(value)) return value;
  if (path.endsWith('.video_index') && /^\\d{1,3}$/.test(value)) return value;
  // DJI documents video lens types as finite labels, not user-supplied strings.
  if ((path.endsWith('.video_type') || path.endsWith('.switchable_video_types')) &&
      ['normal','wide','zoom','ir','infrared','thermal','visible','narrow_band','fpv'].includes(value))
    return value;
  // All other text fields can contain SNs, IMEIs, video URLs, arbitrary
  // operator text, network configuration or account identifiers.
  return undefined;
}
const MAX_ARRAY_ITEMS = 8;
const MAX_DEPTH = 7;

function cleanValue(value, node, path, depth) {
  if (depth > MAX_DEPTH) return undefined;
  const type = node.type;
  if (type === 'struct') {
    if (!isObject(value)) return undefined;
    const result = Object.create(null);
    for (const [key, child] of Object.entries(node.children)) {
      if (!Object.hasOwn(value, key)) continue;
      const cleaned = cleanValue(value[key], child, path+'.'+key, depth+1);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return Object.keys(result).length ? result : undefined;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return undefined;
    // DJI's documented switchable_video_types array consists of lens labels.
    // Do not enable arbitrary primitive arrays in other schema locations.
    if (path.endsWith('.switchable_video_types')) {
      const labels = value.slice(0, MAX_ARRAY_ITEMS)
        .map(item => cleanText(item, path, 24))
        .filter(item => item !== undefined);
      return labels.length ? labels : undefined;
    }
    if (!Object.keys(node.children).length) return undefined;
    const items = value.slice(0, MAX_ARRAY_ITEMS)
      .map(item => cleanValue(item, {type:'struct',children:node.children}, path, depth+1))
      .filter(item => item !== undefined);
    return items.length ? items : undefined;
  }
  if (type === 'bool') {
    if (typeof value === 'boolean') return value;
    return value === 0 ? false : value === 1 ? true : undefined;
  }
  if (type === 'text') return cleanText(value, path, node.length);
  if (type === 'enum_string') {
    return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value) ? value : undefined;
  }
  if (['int','enum_int','enum','date','float','double'].includes(type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    if (['int','enum_int','enum','date'].includes(type) && !Number.isSafeInteger(value)) return undefined;
    if (Number.isFinite(node.min) && value < node.min) return undefined;
    if (Number.isFinite(node.max) && value > node.max) return undefined;
    // Do not apply enum constraints to future firmware revisions: a new,
    // finite code is still an observable device value, not permission to act.
    if (Math.abs(value) > 1e15) return undefined;
    return value;
  }
  return undefined;
}
function sanitizeProfile(data, tree, channel) {
  if (!isObject(data) || !['osd','state'].includes(channel)) return {};
  const result = Object.create(null);
  for (const [key, node] of Object.entries(tree.children)) {
    if (node.push !== (channel === 'state' ? 1 : 0) || !Object.hasOwn(data, key)) continue;
    const cleaned = cleanValue(data[key], node, key, 0);
    if (cleaned !== undefined) result[key] = cleaned;
  }
  return result;
}
// Preserve distinct documented children when two official aircraft families
// share the same top-level struct/array. Never merge unsanitized raw objects.
function mergeKnown(target, source) {
  for (const [key, value] of Object.entries(source)) {
    const prior = target[key];
    if (Array.isArray(value) && Array.isArray(prior)) {
      value.forEach((item,index) => {
        if (isObject(item) && isObject(prior[index])) mergeKnown(prior[index],item);
        else if (prior[index] === undefined) prior[index] = item;
      });
    } else if (isObject(value) && isObject(prior)) {
      mergeKnown(prior,value);
    } else if (prior === undefined) target[key] = value;
  }
  return target;
}
// Superset is built before lookup because update_topo and OSD may arrive
// in different orders. All unrecognized keys and untrusted strings are discarded.
function sanitizeKnownProperties(data, channel) {
  const out = Object.create(null);
  for (const tree of Object.values(trees))
    mergeKnown(out, sanitizeProfile(data, tree, channel));
  return out;
}
function sanitizeDeviceProperties(known, channel, model) {
  const profile = deviceProfile(model);
  if (!profile) return {};
  return sanitizeProfile(known, trees[profile.name], channel);
}
function fieldDefinitions(model) {
  const profile = deviceProfile(model);
  if (!profile) return null;
  const source = catalog.profiles[profile.name];
  return {profile:profile.name,confidence:profile.confidence,
    source:source.source,fields:source.fields};
}
module.exports = {deviceProfile,fieldDefinitions,sanitizeKnownProperties,
  sanitizeDeviceProperties,MAX_ARRAY_ITEMS};
