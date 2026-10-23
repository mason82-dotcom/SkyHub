'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {staleLinks,verify}=require('../../scripts/check-repository-identity');

test('renamed SkyHub-Next origin is canonical and legacy Pi directory is not mistaken for repository link',()=>{
  for(const s of [
    'https://github.com/mason82-dotcom/SkyHub-Next',
    'https://github.com/mason82-dotcom/SkyHub-Next.git',
    'git@github.com:mason82-dotcom/SkyHub-Next.git',
    'https://api.github.com/repos/mason82-dotcom/SkyHub-Next',
    '~/Projekte/SkyHub',
    'stacks/legacy-skyhub/'
  ])assert.deepEqual(staleLinks(s),[],s);
});
test('obsolete full GitHub origin links are rejected, not historical bare repository mentions',()=>{
  const old=[
    'https://github.com/mason82-dotcom/SkyHub.git',
    'https://github.com/mason82-dotcom/SkyHub/pull/57',
    'git@github.com:mason82-dotcom/SkyHub.git',
    'https://api.github.com/repos/mason82-dotcom/SkyHub/actions/runs/42'
  ];
  for(const url of old)assert.equal(staleLinks(url).length,1,url);
  assert.equal(staleLinks('mason82-dotcom/SkyHub'),[].length===0?0:1);
});
test('checked-in project documentation never reintroduces the deprecated URL',()=>{
  const result=verify(path.resolve(__dirname,'../..'));
  assert.deepEqual(result,[]);
});
