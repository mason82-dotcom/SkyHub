'use strict';

const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function checkInlineScripts(html,{filename='dashboard.html'}={}){
  if(typeof html!=='string')throw new TypeError('HTML source must be a string');
  const openings=[...html.matchAll(/<script\b/gi)].length;
  const closings=[...html.matchAll(/<\/script\s*>/gi)].length;
  if(openings!==closings)throw new SyntaxError(`${filename}: unmatched script tag`);
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([,attributes])=>!/\bsrc\s*=/i.test(attributes));
  if(!scripts.length)throw new SyntaxError(`${filename}: no inline scripts found`);
  scripts.forEach(([,attributes,source],index)=>{
    try{new vm.Script(source,{filename:`${filename}:inline-${index+1}.js`});}
    catch(error){throw new SyntaxError(`${filename}: inline script ${index+1}: ${error.message}`);}
  });
  return scripts.length;
}

if(require.main===module){
  const filename=path.resolve(__dirname,'../frontend/public/index.html');
  const count=checkInlineScripts(fs.readFileSync(filename,'utf8'),{filename});
  process.stdout.write(`Checked ${count} inline dashboard script.\n`);
}

module.exports={checkInlineScripts};
