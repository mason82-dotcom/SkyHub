#!/usr/bin/env node
'use strict';

// Explicit offline Python -> Node bridge. No backend service, storage,
// networking or job scheduling is activated by this program.
const {
  parseVisionPreviewReport,MAX_BYTES,SCHEMA
}=require('../backend/vision-preview-contract');

async function readPreview(stream){
  let bytes=0;
  const chunks=[];
  for await(const chunk of stream){
    bytes+=chunk.length;
    if(bytes>MAX_BYTES)throw new TypeError('Invalid vision report');
    chunks.push(chunk);
  }
  if(!bytes)throw new TypeError('Invalid vision report');
  // The parser rejects all unknown fields, private data and readiness claims.
  return parseVisionPreviewReport(JSON.parse(
    Buffer.concat(chunks,bytes).toString('utf8')
  ));
}
if(require.main===module){
  readPreview(process.stdin).then(
    report=>{process.stdout.write(JSON.stringify(report)+'\n');},
    _err=>{
      // Do not print stderr from the model loader, local paths, images, etc.
      process.stdout.write(JSON.stringify({schema:SCHEMA,status:'unavailable'})+'\n');
      process.exitCode=2;
    }
  );
}
module.exports={readPreview};
