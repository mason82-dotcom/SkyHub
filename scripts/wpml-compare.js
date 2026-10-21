#!/usr/bin/env node
'use strict';
// Local read-only inspection of two bounded DJI WPML KMZ files.
// Output never contains XML/mission coordinates, mission names or user filenames.
const fs=require('node:fs');
const {compareKmz}=require('../backend/wpml-compare');
function main(argv){
  if(argv.length!==2){
    process.stderr.write('Usage: node scripts/wpml-compare.js original.kmz skyhub.kmz\n');
    process.exitCode=2;return;
  }
  const [a,b]=argv;
  const max=12*1024*1024;
  const leftStat=fs.statSync(a),rightStat=fs.statSync(b);
  if(!leftStat.isFile()||!rightStat.isFile()||
     leftStat.size<22||rightStat.size<22||
     leftStat.size>max||rightStat.size>max)throw Error('invalid file size');
  const report=compareKmz(fs.readFileSync(a),fs.readFileSync(b));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(!report.left.valid||!report.right.valid)process.exitCode=2;
  else if(report.summary.structuralDifferences>0||
          !report.summary.resourceCountMatches)process.exitCode=1;
}
try{main(process.argv.slice(2));}
catch(_error){
  // Archive data, filenames, GPS positions and filesystem paths remain private.
  process.stderr.write('WPML comparison failed: inspect both local KMZ archives and their permissions.\n');
  process.exitCode=2;
}
