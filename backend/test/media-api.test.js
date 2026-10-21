'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createMediaRouter}=require('../media-api');

async function withServer(storage,callback){
  const app=express();
  app.use('/api/media',createMediaRouter(storage));
  const server=app.listen(0,'127.0.0.1');
  try{
    await new Promise(resolve=>server.once('listening',resolve));
    const address=server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  }finally{
    await new Promise((resolve,reject)=>
      server.close(err=>err?reject(err):resolve())
    );
  }
}

test('media status reports read-only availability',async()=>{
  await withServer({
    buckets:async()=>['dji-cloud'],
    objects:async()=>({objects:[]})
  },async base=>{
    const response=await fetch(base+'/api/media/status');
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.readOnly,true);
    assert.equal(body.bucketCount,1);
  });
});

test('invalid object queries return HTTP 400',async()=>{
  await withServer({
    buckets:async()=>[],
    objects:async()=>{throw Object.assign(
      new Error('Invalid bucket'),{status:400}
    );}
  },async base=>{
    for(const query of [
      '?bucket=private',
      '?bucket=dji-cloud&limit=201',
      '?bucket=dji-cloud&limit=0',
      '?bucket=dji-cloud&limit=abc'
    ]){
      const response=await fetch(
        base+'/api/media/objects'+query
      );
      assert.equal(response.status,400);
    }
  });
});

test('S3 failures do not expose internal errors',async()=>{
  await withServer({
    buckets:async()=>{
      throw new Error('Internal storage credential detail');
    }
  },async base=>{
    const response=await fetch(base+'/api/media/buckets');
    assert.equal(response.status,503);
    const body=await response.text();
    assert.ok(!body.includes('credential detail'));
  });
});

test('media router has no write endpoints',async()=>{
  await withServer({
    buckets:async()=>[],
    objects:async()=>({objects:[]})
  },async base=>{
    const response=await fetch(
      base+'/api/media/objects',
      {method:'DELETE'}
    );
    assert.equal(response.status,404);
  });
});
