'use strict';

// S3 name-only aggregation over an independently approved, injected reader.
// Never serializes keys, prefixes, timestamps, coordinates, ETags or secrets.
// The existing offline parser is the ONLY producer of public statistics.
const {inventoryMediaNames,MAX_ENTRIES}=require('./m3m-media-inventory');
const {BUCKET,PAGE_SIZE,validatePrefix}=require('./m3m-s3-read-contract');
const MAX_PAGES=101;
const MAX_TOKEN_LENGTH=4096;

async function inventoryM3MFromS3(storage,prefix){
  validatePrefix(prefix);
  if(!storage||typeof storage.objects!=='function')
    throw new TypeError('Scoped S3 reader required');
  const names=[];
  const cursors=new Set(),keys=new Set();
  let cursor;
  for(let pageNo=0;pageNo<MAX_PAGES;pageNo++){
    const result=await storage.objects(BUCKET,{
      prefix,limit:PAGE_SIZE,...(cursor?{cursor}:{})
    });
    if(!result||!Array.isArray(result.objects)||
       result.objects.length>PAGE_SIZE||
       typeof result.truncated!=='boolean')
      throw new Error('Invalid scoped inventory response');
    for(const entry of result.objects){
      const key=entry?.key;
      if(typeof key!=='string'||key.length>1024||!key.startsWith(prefix)||
         /[\x00-\x1f\x7f]/.test(key))
        throw new Error('Invalid scoped inventory object');
      // Repeated keys are not distinct captures: a moving/paginated source
      // can produce ambiguous snapshots. Never call that a complete set.
      if(keys.has(key))throw new Error('Duplicate S3 key across pages');
      keys.add(key);
      const relative=key.slice(prefix.length);
      // Nested keys and prefix directory markers are not capture files.
      if(!relative||relative.includes('/'))continue;
      names.push(relative);
      if(names.length>MAX_ENTRIES)
        throw new RangeError('Inventory entry limit exceeded');
    }
    if(!result.truncated)return inventoryMediaNames(names);
    const next=result.nextCursor;
    if(typeof next!=='string'||!next||next.length>MAX_TOKEN_LENGTH||
       /[\x00-\x1f\x7f]/.test(next)||
       next===cursor||cursors.has(next))
      throw new Error('Invalid inventory cursor');
    cursors.add(next);
    cursor=next;
  }
  throw new RangeError('Inventory page limit exceeded');
}

module.exports={inventoryM3MFromS3,MAX_PAGES};
