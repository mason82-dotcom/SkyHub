#!/usr/bin/env node
'use strict';
// Opt-in, read-only structural probe. Two capped byte-range reads per TIFF.
// No pixels are intentionally decoded, no linked TIFF offsets followed,
// no object keys, source bytes, metadata values or credentials printed.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {firstIfdOffset,inspectClassicIfd,summarizeIfd}
  =require('../backend/m3m-tiff-ifd');
const {createApiStorage,discoverFirstPagePrefix,piInvoker}
  =require('./pi-m3m-s3-inventory-check');
const {collectUnknownTiffs,MAX_TIFF}
  =require('../backend/m3m-s3-tiff-candidates');

const CHILD=[
  "'use strict';",
  "const fs=require('node:fs');",
  "const {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');",
  firstIfdOffset.toString()+';',
  inspectClassicIfd.toString()+';',
  String.raw