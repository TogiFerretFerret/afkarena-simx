import{readFile,writeFile,mkdir}from'node:fs/promises';
import{resolve}from'node:path';
import{spawnSync}from'node:child_process';
import{runInNewContext}from'node:vm';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
import{sourceCopyFunction}from'./flat-numeric-copy.mjs';
import{firstDifference}from'./native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/proxy-builtins');await mkdir(directory,{recursive:true});
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const r=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(r.status??1);}
const script=`var ed={};ed.copyObj=${sourceCopyFunction};
var cases=[],events=[],own=[],has=[],outputs=[];
function key(k){if(k===Symbol.iterator)return '@@iterator';if(k===Symbol.toStringTag)return '@@toStringTag';if(k===Symbol.toPrimitive)return '@@toPrimitive';if(k===Symbol.isConcatSpreadable)return '@@isConcatSpreadable';return String(k);}
function wrap(value){return new Proxy(value,{get:function(t,k,r){events.push(key(k));return Reflect.get(t,k,r);},getOwnPropertyDescriptor:function(t,k){own.push(key(k));return Object.getOwnPropertyDescriptor(t,k);},has:function(t,k){has.push(key(k));return Reflect.has(t,k);}});}
function check(label,fn,array){events=[];own=[];has=[];var p=wrap(array),error=null;try{fn(p);}catch(e){error=e.name;}outputs.push({label:label,gets:events,descriptors:own,has:has,error:error});}
for(var length=0;length<10;length++){
 var values=[];for(var i=0;i<length;i++)values.push(i%2===0?i:'a'+i);
 var operations={
  copyObj:function(p){ed.copyObj(p);},
  keys:function(p){Object.keys(p);},values:function(p){Object.values(p);},entries:function(p){Object.entries(p);},
  assign:function(p){Object.assign({},p);},descriptors:function(p){Object.getOwnPropertyDescriptors(p);},
  json:function(p){JSON.stringify(p);},arrayIsArray:function(p){Array.isArray(p);},
  string:function(p){String(p);},number:function(p){Number(p);},isNaN:function(p){isNaN(p);},objectString:function(p){Object.prototype.toString.call(p);},
  slice:function(p){p.slice();},concat:function(p){p.concat([7]);},concatOther:function(p){[].concat(p);},
  join:function(p){p.join(',');},toString:function(p){p.toString();},
  indexOf:function(p){p.indexOf(3);},lastIndexOf:function(p){p.lastIndexOf(3);},includes:function(p){p.includes(3);},
  map:function(p){p.map(function(x){return x;});},filter:function(p){p.filter(function(x){return true;});},
  every:function(p){p.every(function(x){return true;});},some:function(p){p.some(function(x){return false;});},
  find:function(p){p.find(function(x){return false;});},findIndex:function(p){p.findIndex(function(x){return false;});},
  forEach:function(p){p.forEach(function(x){});},reduce:function(p){p.reduce(function(a,x){return a;},0);},reduceRight:function(p){p.reduceRight(function(a,x){return a;},0);},
  from:function(p){Array.from(p);},forOf:function(p){for(var x of p){}},forIn:function(p){for(var k in p){}},
  apply:function(p){(function(){}).apply(null,p);},reflectApply:function(p){Reflect.apply(function(){},null,p);},
  mathMaxApply:function(p){Math.max.apply(Math,p);},bindApply:function(p){Function.prototype.bind.apply(function(){},p);},
  iterator:function(p){var it=p[Symbol.iterator]();while(!it.next().done){}},
  arrayKeys:function(p){var it=p.keys();while(!it.next().done){}},arrayValues:function(p){var it=p.values();while(!it.next().done){}},arrayEntries:function(p){var it=p.entries();while(!it.next().done){}}
 };
 for(var label in operations)check(length+':'+label,operations[label],values.slice());
}
var objects={a:1,b:2};
for(var label of ['copyObj','keys','values','entries','assign','descriptors','json','arrayIsArray','string','number','isNaN','objectString','forIn'])check('object:'+label,operations[label],objects);
print(JSON.stringify(outputs));`;
const input=resolve(directory,'probe.js'),binary=resolve(directory,'probe');await writeFile(input,script);
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes');
const c=spawnSync(compiler,['-O','-Wc,-O1,-g0,-ffp-contract=off',input,'-o',binary],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(c.status,0,c.stderr);
const result=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(result.status,0,result.stderr);
const actual=JSON.parse(result.stdout);let expected;runInNewContext(script,{print:s=>{expected=JSON.parse(s);}});
const differences=actual.flatMap((row,index)=>{const d=firstDifference(row,expected[index]);return d?[{label:row.label,difference:d,native:row,node:expected[index]}]:[];});
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={version:1,cases:actual.length,differences,sourceSha256:sha(script),compilerSha256:sha(await readFile(compiler)),vmSha256:sha(await readFile(resolve(root,'work/downloads/hermes-build/lib/libhermesvm.so'))),oracleProfile:profile,scope:'Read-only builtins over proxies with exact get/descriptor/has trap histories. Engine differences are preserved, not normalized.'};
await writeFile(resolve(root,'benchmarks/validation/proxy-builtin-gets.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
