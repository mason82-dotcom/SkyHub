'use strict';

// Opt-in MinIO STS AssumeRole client for DJI Pilot 2 HTTPS media.
// NOT imported by the running SkyHub server. Never use root/admin credentials.
// MinIO STS requires 900 seconds minimum. Session-policy permissions are the
// INTERSECTION with a separately-provisioned, dedicated built-in MinIO user's policy.
const crypto=require('node:crypto');
const https=require('node:https');
const {workspaceId}=require('./media-upload-contract');

const TTL_SECONDS=900;
const MAX_XML_BYTES=32768;
const SESSION_ID=/^[a-f0-9]{32}$/;
const REGION=/^[a-z0-9-]{1,64}$/;
const BUCKET='dji-cloud';
const IAM_ACTION='s3:PutObject';

function text(value,limit=4096){
  return typeof value==='string'&&value.length>0&&value.length<=limit?value:null;
}
function endpointOrigin(endpoint){
  if(!text(endpoint,300))return null;
  try{
    const url=new URL(endpoint);
    return url.protocol==='https:'&&url.username===''&&url.password===''&&
      url.pathname==='/'&&url.search===''&&url.hash===''&&
      url.origin===endpoint?url:null;
  }catch(_err){return null;}
}
function issuePolicy(workspace,session){
  if(!workspaceId(workspace)||!SESSION_ID.test(session))
    throw new TypeError('Invalid STS policy scope');
  const prefix=workspace+'/media/'+session;
  const policy={Version:'2012-10-17',Statement:[{
    Effect:'Allow',Action:[IAM_ACTION],
    Resource:['arn:aws:s3:::'+BUCKET+'/'+prefix+'/*']
  }]};
  if(Buffer.byteLength(JSON.stringify(policy))>2048)throw new Error('STS policy too large');
  return Object.freeze({prefix,policy:JSON.stringify(policy)});
}
function encode(value){
  return encodeURIComponent(value).replace(/[!'()*]/g,
    char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
}
function signature(key,message){
  return crypto.createHmac('sha256',key).update(message,'utf8').digest();
}
function signingKey(secret,date,region){
  const kDate=signature('AWS4'+secret,date);
  const kRegion=signature(kDate,region);
  return signature(signature(kRegion,'sts'),'aws4_request');
}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function signedRequest({url,accessKeyId,secretAccessKey,region,policy,at}){
  if(!endpointOrigin(url)||!text(accessKeyId,128)||!text(secretAccessKey,256)||
     !REGION.test(region)||!text(policy,2048)||!Number.isSafeInteger(at))
    throw new TypeError('Invalid STS request configuration');
  const amzDate=new Date(at).toISOString().replace(/[-:]|\.\d{3}/g,'');
  const day=amzDate.slice(0,8);
  const body=[
    ['Action','AssumeRole'],['DurationSeconds',String(TTL_SECONDS)],
    ['Policy',policy],['Version','2011-06-15']
  ].map(([k,v])=>encode(k)+'='+encode(v)).join('&');
  const bodyHash=sha256(body);
  const host=new URL(url).host;
  const headersToSign={
    'content-type':'application/x-www-form-urlencoded; charset=utf-8',
    host,
    'x-amz-content-sha256':bodyHash,
    'x-amz-date':amzDate
  };
  const signedHeaders=Object.keys(headersToSign).sort().join(';');
  const canonicalHeaders=Object.entries(headersToSign)
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([key,value])=>key+':'+value+'\n').join('');
  const canonical=['POST','/','',canonicalHeaders,signedHeaders,bodyHash].join('\n');
  const scope=day+'/'+region+'/sts/aws4_request';
  const stringToSign=['AWS4-HMAC-SHA256',amzDate,scope,sha256(canonical)].join('\n');
  const mac=crypto.createHmac('sha256',signingKey(secretAccessKey,day,region))
    .update(stringToSign).digest('hex');
  const authorization='AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+
    ', SignedHeaders='+signedHeaders+', Signature='+mac;
  return Object.freeze({method:'POST',url,body,headers:{
    ...headersToSign,authorization,'content-length':String(Buffer.byteLength(body))
  }});
}
function sendHttps(request){
  return new Promise((resolve,reject)=>{
    // Static origin only; never follow 30x and never disable TLS verification.
    const url=endpointOrigin(request.url);
    if(!url){reject(new Error('Invalid HTTPS STS endpoint'));return;}
    const req=https.request(url,{method:'POST',headers:request.headers,
      timeout:5000},res=>{
      let chunks=[],length=0;
      res.on('data',chunk=>{
        length+=chunk.length;
        if(length>MAX_XML_BYTES){req.destroy(new Error('STS response limit'));return;}
        chunks.push(chunk);
      });
      res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(new Error('STS timeout')));
    req.on('error',reject);
    req.end(request.body);
  });
}
function uniqueTag(xml,tag){
  const pattern=new RegExp('<'+tag+'(?:\\s[^<>]*)?>([\\s\\S]*?)<\\/'+tag+'>','g');
  const entries=[...xml.matchAll(pattern)];
  if(entries.length!==1)throw new Error('Invalid STS XML');
  return entries[0][1].trim();
}
function parseCredentialsXml(body){
  if(!text(body,MAX_XML_BYTES)||/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(body))
    throw new Error('Invalid STS XML');
  // MinIO returns a small XML response with a default namespace (unprefixed tags).
  // Do not allow extra top-level text, duplicate credentials, or entity expansion.
  const xml=body.replace(/^\s*<\?xml\s+[^?]*\?>\s*/i,'').trim();
  if(!/^<AssumeRoleResponse(?:\s[^<>]*)?>[\s\S]*<\/AssumeRoleResponse>$/.test(xml))
    throw new Error('Invalid STS XML');
  const root=uniqueTag(xml,'AssumeRoleResponse');
  const result=uniqueTag(root,'AssumeRoleResult');
  const credentials=uniqueTag(result,'Credentials');
  const accessKeyId=uniqueTag(credentials,'AccessKeyId');
  const accessKeySecret=uniqueTag(credentials,'SecretAccessKey');
  const securityToken=uniqueTag(credentials,'SessionToken');
  const expiration=uniqueTag(credentials,'Expiration');
  if(!/^[A-Za-z0-9_-]{8,128}$/.test(accessKeyId)||
     !/^[A-Za-z0-9+/=_-]{16,256}$/.test(accessKeySecret)||
     !/^[A-Za-z0-9._=+/-]{16,4096}$/.test(securityToken)||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(expiration))
    throw new Error('Invalid STS credentials');
  const expiresAt=Date.parse(expiration);
  if(!Number.isSafeInteger(expiresAt))throw new Error('Invalid STS expiration');
  return {accessKeyId,accessKeySecret,securityToken,expiresAt};
}
function createMinioStsIssuer({endpoint,accessKeyId,secretAccessKey,
  region='us-east-1',transport=sendHttps,
  clock=()=>Date.now(),sessionId=()=>crypto.randomBytes(16).toString('hex')}={}){
  if(!endpointOrigin(endpoint)||!text(accessKeyId,128)||!text(secretAccessKey,256)||
     !REGION.test(region)||typeof transport!=='function'||
     typeof clock!=='function'||typeof sessionId!=='function')
    throw new TypeError('MinIO STS issuer configuration required');
  return async function issueGrant({workspace,principal,maxSeconds}={}){
    if(!workspaceId(workspace)||!principal||typeof principal!=='object'||
       principal.role!=='pilot'||principal.workspaceId!==workspace||
       maxSeconds!==TTL_SECONDS)throw new TypeError('Invalid MinIO STS scope');
    const now=clock();
    if(!Number.isSafeInteger(now)||now<1e12)throw new TypeError('Invalid issuer clock');
    const id=sessionId();
    const {prefix,policy}=issuePolicy(workspace,id);
    const request=signedRequest({url:endpoint,accessKeyId,secretAccessKey,region,policy,at:now});
    const result=await transport(request);
    if(!result||result.status!==200||typeof result.body!=='string'||
       Buffer.byteLength(result.body)>MAX_XML_BYTES)
      throw new Error('STS exchange failed');
    const parsed=parseCredentialsXml(result.body);
    const remainingSeconds=Math.floor((parsed.expiresAt-clock())/1000);
    // A 900-second MinIO credential can be shortened by network delay, never extended.
    if(!Number.isSafeInteger(remainingSeconds)||remainingSeconds<60||
       remainingSeconds>TTL_SECONDS)
      throw new Error('Invalid STS lifetime');
    return Object.freeze({
      provider:'minio',bucket:BUCKET,endpoint,region,objectKeyPrefix:prefix,
      credentials:{
        accessKeyId:parsed.accessKeyId,accessKeySecret:parsed.accessKeySecret,
        securityToken:parsed.securityToken,expire:remainingSeconds
      }
    });
  };
}

module.exports={BUCKET,TTL_SECONDS,IAM_ACTION,issuePolicy,signedRequest,
  parseCredentialsXml,createMinioStsIssuer};
