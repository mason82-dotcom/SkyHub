'use strict';

// Source: DJI Cloud API Product Support enumeration (verified against official docs).
// IMPORTANT: resolve by (domain, type, sub_type), never by type alone.
const MODELS = Object.freeze({
  '0:60:0':'Matrice 300 RTK',
  '0:67:0':'Matrice 30',
  '0:67:1':'Matrice 30T',
  '0:77:0':'Mavic 3E',
  '0:77:1':'Mavic 3T',
  '0:77:3':'Mavic 3TA',
  '0:89:0':'Matrice 350 RTK',
  '0:91:0':'Matrice 3D',
  '0:91:1':'Matrice 3TD',
  '0:99:0':'Matrice 4E',
  '0:99:1':'Matrice 4T',
  '0:100:0':'Matrice 4D',
  '0:100:1':'Matrice 4TD',
  '0:103:0':'Matrice 400',
  '1:66:0':'Mavic 3E Camera',
  '1:67:0':'Mavic 3T Camera',
  '1:88:0':'Matrice 4E Camera',
  '1:89:0':'Matrice 4T Camera',
  '2:56:0':'DJI Smart Controller Enterprise',
  '2:119:0':'DJI RC Plus',
  '2:144:0':'DJI RC Pro Enterprise',
  '2:174:0':'DJI RC Plus 2 Enterprise',
  '3:1:0':'DJI Dock',
  '3:2:0':'DJI Dock 2',
  '3:3:0':'DJI Dock 3'
});
function resolveDeviceModel(input) {
  if (!input || typeof input !== 'object') return null;
  const { domain, type, subType } = input;
  if (!['0','1','2','3'].includes(String(domain)) ||
      !Number.isInteger(type) || !Number.isInteger(subType)) return null;
  return MODELS[String(domain)+':'+type+':'+subType] || null;
}
function category(domain) {
  return {'0':'aircraft','1':'payload','2':'controller','3':'dock'}[String(domain)] || 'unknown';
}
module.exports = { resolveDeviceModel, category, MODELS };
