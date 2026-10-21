'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {identify,inventoryMediaNames}=require('../m3m-media-inventory');
const CLI=path.resolve(__dirname,'../../scripts/pi-m3m-media-inventory.js');

const key='DJI_20261021190530_0001';
const full=[
  key+'_D.JPG',
  ...['G','R','RE','NIR'].map(b=>key+'_MS_'+b+'.TIF')
];
test('realistic five-channel DJI image filenames group without claiming reflectance',()=>{
  const report=inventoryMediaNames(full);
  assert.equal(report.totalEntries,5);
  assert.equal(report.classified,5);
  assert.equal(report.captureGroups,1);
  assert.equal(report.spectralSets,1);
  assert.equal(report.fiveChannelSets,1);
  assert.equal(report.duplicateSets,0);
  assert.equal(report.partialSets,0);
  assert.equal(report.missingBands.RGB,0);
  for(const b of ['RGB','G','R','RE','NIR'])assert.equal(report.bandCounts[b],1);
  assert.equal(report.radiometricCalibrationVerified,false);
  assert.equal(report.bandCoregistrationVerified,false);
  assert.equal(report.reflectanceReady,false);
  assert.equal(report.ndviReady,false);
  assert.equal(report.ndreReady,false);
  assert.doesNotMatch(JSON.stringify(report),/20261021190530|0001|home_latitude|SECRET/);
});
test('partial spectral group remains unavailable for index calculations',()=>{
  const r=inventoryMediaNames([key+'_MS_NIR.TIF',key+'_MS_R.TIF']);
  assert.equal(r.spectralSets,0);
  assert.equal(r.fiveChannelSets,0);
  assert.equal(r.partialSets,1);
  assert.equal(r.missingBands.R,0);
  assert.equal(r.missingBands.NIR,0);
  assert.equal(r.missingBands.RE,1);
  assert.equal(r.ndviReady,false);
});
test('duplicate channel does not inflate complete sets or expose capture IDs',()=>{
  const r=inventoryMediaNames([...full,full[3]]);
  assert.equal(r.classified,6);
  assert.equal(r.duplicateSets,1);
  assert.equal(r.fiveChannelSets,0);
  assert.equal(r.spectralSets,0);
  assert.equal(r.partialSets,1);
  assert.equal(r.bandCounts.RE,2);
  assert.doesNotMatch(JSON.stringify(r),/20261021190530|0001/);
});
test('mixed captures do not join across different sequence or time keys',()=>{
  const r=inventoryMediaNames([...full,full[4].replace('_0001_','_0002_'),
    'DJI_20261021190531_0001_MS_NIR.TIF']);
  assert.equal(r.captureGroups,3);
  assert.equal(r.fiveChannelSets,1);
  assert.equal(r.spectralSets,1);
  assert.equal(r.partialSets,2);
});
test('unknown names, geographic metadata and path traversal are never reflected',()=>{
  assert.equal(identify('DJI_0001_MS_NIR.TIF'),null);
  assert.equal(identify('../DJI_20261021190530_0001_MS_G.TIF'),null);
  assert.equal(identify('DJI_20261021190530_0001_MS_BLUE.TIF'),null);
  assert.equal(identify('DJI_20261021190530_0001_MS_NIR.JPG'),null);
  assert.equal(identify('DJI_20261021190530_0001_NDVI.JPG'),null);
  const r=inventoryMediaNames(['SECRET_SERIAL_1234.jpg','../PRIVATE_COORDS',
    'DJI_20261021190530_0001_MS_G.TIF','API_TOKEN.TXT']);
  assert.equal(r.classified,1);
  assert.equal(r.unrecognized,2);
  assert.equal(r.invalid,1);
  assert.doesNotMatch(JSON.stringify(r),/SECRET|SERIAL|PRIVATE|API_TOKEN|20261021190530/);
});
test('oversized inputs and malformed values fail safe',()=>{
  assert.throws(()=>inventoryMediaNames(Array(20001).fill(key+'_MS_G.TIF')),RangeError);
  assert.throws(()=>inventoryMediaNames('SECRET_SERIAL'),RangeError);
  assert.equal(inventoryMediaNames([null,5,undefined]).invalid,3);
});
test('optional Pi CLI reads directory entries only, ignores symlinks, redacts path',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'m3m-secret-name-'));
  try{
    for(const name of full)fs.writeFileSync(path.join(dir,name),'not a real image');
    fs.symlinkSync(path.join(dir,full[0]),path.join(dir,'SECRET_LINK'));
    fs.mkdirSync(path.join(dir,'PRIVATE_SUBDIRECTORY'));
    const child=spawnSync(process.execPath,[CLI,'--directory',dir],{encoding:'utf8',timeout:5000});
    assert.equal(child.status,0,child.stderr);
    const data=JSON.parse(child.stdout);
    assert.equal(data.fiveChannelSets,1);
    assert.equal(data.ignoredNonregularEntries,2);
    assert.doesNotMatch(child.stdout,(/SECRET|PRIVATE|m3m-secret-name|20261021/));
    const fail=spawnSync(process.execPath,[CLI,'--directory','../SECRET'],{encoding:'utf8',timeout:5000});
    assert.equal(fail.status,2);
    assert.doesNotMatch(fail.stderr,/SECRET/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('unrecognized S3 image/other formats are tallied using fixed privacy-safe categories',()=>{
  const names=[
    'DJI_20261021190530_0001_MS_G.TIF',
    'DJI_20261021190530_0001_D.JPG',
    'DJI_20261021190530_0001_F.JPG',
    'DJI_RENAMED_128_MS_NIR.TIFF',
    'SECRET_CUSTOM_CAMERA_SERIAL.JPG',
    'MASKED_ORTHO.TIF',
    'RAW_IMAGE.DNG',
    'MASKED_CHART.PNG',
    'VIDEO.MP4',
    'VIDEO.MOV',
    'AUXILIARY.LRF',
    'GPS_OVERLAY.SRT',
    'PRIVATE_DATA.JSON',
    'LAYERS.XML',
    'FLIGHT.KMZ',
    'TOKEN.ABC',
    'NOEXT',
    '../PRIVATE.JPG'
  ];
  const report=inventoryMediaNames(names);
  assert.equal(report.classified,2);
  assert.equal(report.unrecognized,15);
  assert.equal(report.invalid,1);
  assert.deepEqual(report.unrecognizedFormats,{
    JPEG:2,TIFF:2,DNG:1,PNG:1,MP4:1,MOV:1,LRF:1,
    SRT:1,JSON:1,XML:1,KMZ:1,OTHER_EXTENSION:1,NO_EXTENSION:1
  });
  assert.equal(report.unrecognizedDjiPrefixedImages,2);
  assert.equal(report.unrecognizedOtherImages,4);
  assert.equal(Object.values(report.unrecognizedFormats).reduce((n,x)=>n+x,0),
    report.unrecognized);
  assert.doesNotMatch(JSON.stringify(report),
    /SECRET|PRIVATE|TOKEN|MASKED|DJI_RENAMED|VIDEO|CUSTOM_CAMERA_SERIAL|20261021/);
});

test('unknown format histogram reports only bounded labels, never attacker-defined extensions',()=>{
  const report=inventoryMediaNames([
    'PRIVATE_ONE.HIDDENPAYLOAD',
    'DJI_PRIVATE_SN.XYZ',
    'noext-PII'
  ]);
  assert.equal(report.unrecognizedFormats.OTHER_EXTENSION,2);
  assert.equal(report.unrecognizedFormats.NO_EXTENSION,1);
  assert.equal(report.unrecognizedDjiPrefixedImages,0);
  assert.doesNotMatch(JSON.stringify(report),/HIDDENPAYLOAD|XYZ|noext-PII|PRIVATE/);
});
