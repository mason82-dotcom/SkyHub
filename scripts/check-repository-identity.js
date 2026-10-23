#!/usr/bin/env node
'use strict';
// CI guard only for canonical GitHub URLs. Do NOT rewrite separate legacy paths.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const DEPRECATED='mason82-dotcom/'+'SkyHub';
const CANONICAL=DEPRECATED+'-Next';
const pattern=new RegExp(
  '(?:https?:\\/\\/(?:www\\.)?github\\.com\\/|git@github\\.com:|'+
  'https?:\\/\\/api\\.github\\.com\\/repos\\/)'+
  DEPRECATED.replace('/','\\/')+'(?!-Next)(?=\\.git|[\\/#?]|$)','g');
function staleLinks(value){
  pattern.lastIndex=0;
  return [...value.matchAll(pattern)].map(m=>m[0]);
}
function files(root){
  const choices=['README.md','docs','scripts','.github/workflows','stacks/README.md'];
  const targets=[];
  function visit(p){
    if(!fs.existsSync(p))return;
    const stat=fs.lstatSync(p);
    if(stat.isSymbolicLink())return;
    if(stat.isDirectory()){
      for(const f of fs.readdirSync(p))visit(path.join(p,f));
    }else if(stat.isFile()&&/\.(md|js|sh|yml|yaml|py)$/.test(p))
      targets.push(p);
  }
  for(const chosen of choices)visit(path.join(root,chosen));
  return targets.sort();
}
function verify(root=ROOT){
  const violations=[];
  for(const filename of files(root)){
    const raw=fs.readFileSync(filename,'utf8');
    if(!staleLinks(raw).length)continue;
    violations.push(path.relative(root,filename));
  }
  return violations;
}
if(require.main===module){
  const issues=verify();
  if(issues.length){
    console.error('Deprecated GitHub repository URLs in: '+issues.join(', '));
    process.exitCode=1;
  }else process.stdout.write('Canonical repository identity verified: '+CANONICAL+'\n');
}
module.exports={staleLinks,verify,files};
