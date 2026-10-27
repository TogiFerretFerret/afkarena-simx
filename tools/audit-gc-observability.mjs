import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parse} from '@babel/parser';

const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
async function list(directory){
 const rows=await readdir(resolve(root,directory),{withFileTypes:true}),files=[];
 for(const row of rows){const path=directory+'/'+row.name;if(row.isDirectory())files.push(...await list(path));else if(path.endsWith('.js'))files.push(path);}
 return files.sort();
}
const files=await list('src');assert.equal(files.length,18,'Review changed original JavaScript source inventory');
const exactNames=['WeakRef','FinalizationRegistry','WeakMap','WeakSet','gc','collectGarbage','garbageCollect','getJSBindingObjectCount','releaseJSBindingObject','__jsc__','HermesInternal','getHeapInfo','getInstrumentedStats','getRuntimeProperties','getGCStats','gczeal','gcparam','FinalizationGroup','WeakCell','WeakReference','onGC','onGarbageCollect','onGarbageCollection','memoryUsage','usedJSHeapSize','totalJSHeapSize'];
const totals=Object.fromEntries(exactNames.map(name=>[name,0]));
const inputs={},occurrences=[],ownership=[],finalization=[];
let boot;
for(const file of files){
 const bytes=await readFile(resolve(root,file)),source=bytes.toString('utf8');inputs[file]={sha256:sha(bytes),bytes:bytes.length};
 const context=match=>({file,offsetUTF16:match.index,token:match[0],context:source.slice(Math.max(0,match.index-120),Math.min(source.length,match.index+match[0].length+160))});
 for(const match of source.matchAll(new RegExp('\\b(?:'+exactNames.join('|')+')\\b','g'))){
  totals[match[0]]++;occurrences.push(context(match));
 }
 for(const match of source.matchAll(/\b[A-Za-z_$]*(?:[Ff]inali[sz])[A-Za-z_$]*\b/g))finalization.push(context(match));
 const retains=[...source.matchAll(/\.retain\s*\(/g)],releases=[...source.matchAll(/\.(?:release|autorelease)\s*\(/g)];
 if(retains.length||releases.length)ownership.push({file,retainCalls:retains.length,releaseOrAutoreleaseCalls:releases.length,samples:[...retains.slice(0,3),...releases.slice(0,3)].map(context)});
 if(file==='src/script/jsb_boot.js')boot=source;
}
assert.ok(boot);
function member(node){if(node?.type==='Identifier')return node.name;if(node?.type==='MemberExpression'){const object=member(node.object);const name=node.computed&&node.property.type==='StringLiteral'?node.property.value:!node.computed&&node.property.type==='Identifier'?node.property.name:null;return object&&name?object+'.'+name:null;}return null;}
const noOpDefinitions=[];
function walk(node){
 if(!node||typeof node!=='object')return;
 if(node.type==='AssignmentExpression'&&['cc.garbageCollect','sys.garbageCollect'].includes(member(node.left))){
  const fn=node.right;assert.equal(fn.type,'FunctionExpression');
  const statements=fn.body.body;
  const unconditionalReturn=statements[0]?.type==='ReturnStatement'&&statements[0].argument===null;
  const empty=statements.length===0;
  assert.ok(empty||unconditionalReturn,'GC binding now contains reachable work');
  noOpDefinitions.push({binding:member(node.left),offsetUTF16:node.start,sourceSha256:sha(boot.slice(node.start,node.end)),emptyBody:empty,unconditionalFirstReturn:unconditionalReturn,source:boot.slice(node.start,node.end)});
 }
 for(const [key,value] of Object.entries(node))if(key!=='loc'&&key!=='extra'&&key!=='comments'){
  if(Array.isArray(value)){for(const child of value)walk(child);}else if(value&&typeof value==='object')walk(value);
 }
}
walk(parse(boot,{sourceType:'script'}));assert.equal(noOpDefinitions.length,2);
for(const file of files)assert.equal(sha(await readFile(resolve(root,file))),inputs[file].sha256,'Source changed during audit');
const report={version:1,scope:'Bounded textual source inventory plus AST proof of two no-op explicit GC bindings. This is evidence for runtime GC experiments, not proof of GC-timing non-observability or new battle equivalence.',qualifiesFor10000Target:false,sourceCount:files.length,inputs,exactNameTotals:totals,occurrences,noOpDefinitions,finalizationNameOccurrences:finalization,explicitOwnership:ownership,
 findings:[
  'No literal WeakRef, FinalizationRegistry, WeakMap, WeakSet, gc or collectGarbage identifier spelling occurs in the 18 supplied original scripts. Matching includes comments and strings, so this bounded absence is deliberately conservative.',
  'The only garbageCollect spelling appears in jsb_boot. cc.garbageCollect begins with unconditional return; sys.garbageCollect has an empty AST body. The native __jsc__.garbageCollect call is commented out.',
  'The retained finalize/finalized spelling contexts in game_util concern CryptoJS and MD5 digest/cipher processing; game_ui_5 finalizeLoveLevelUpFlow is an explicit application flow method. They do not name a standard GC finalizer registration API.',
  'Native JS binding count and explicit releaseJSBindingObject entry points are present in jsb_boot, and retain/release methods occur in original code. Their native implementation and finalization behavior are not supplied by this textual audit.'
 ],limitations:[
  'Text matches do not establish lexical binding identity or reachability. No claim follows solely from substring absence: constructed names, aliases, eval/Function-generated code, downloaded scripts and native injected APIs are not resolved.',
  'The audit does not establish absence of native finalizers or GC-visible Cocos lifetime effects. Explicit native ownership calls are inventoried separately, not removed or normalized.',
  'Harness WeakMaps and VM collector implementation are outside these18 originals. WeakMap has no standard iteration, but this audit does not prove every external weak consumer is unobservable.',
  'Each heap/young-generation/GC runtime configuration still requires the unchanged strict battle report and input-consumption gate; broad ordered trace and full-scene/random-roster qualification remain separate.'
 ],tool:{file:'tools/audit-gc-observability.mjs',sha256:sha(await readFile(import.meta.filename))}};
const output='benchmarks/validation/gc-observability.json';await writeFile(resolve(root,output),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,sources:files.length,exactNameTotals:totals,finalizationMentions:finalization.length,noOpBindings:noOpDefinitions.map(row=>row.binding)}));
