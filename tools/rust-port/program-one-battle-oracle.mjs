// Diagnostic counterpart to program-one-battle-probe.rs. Only harness counts
// change; source game functions and the supplied host input tape are unchanged.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url);
const profile=JSON.parse(fs.readFileSync(new URL('config/source-oracle-runtime.json',root)));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
assert.deepEqual(process.execArgv,profile.rawBitReferenceFlags);
const manifest=JSON.parse(fs.readFileSync(new URL('work/rust-battle-full/program-manifest.json',root)));
const sha=value=>createHash('sha256').update(value).digest('hex');
const context=vm.createContext(vm.constants.DONT_CONTEXTIFY);
Object.assign(context,{print:(...values)=>console.log(...values),
 hermescli:{loadFile:path=>new Uint8Array(fs.readFileSync(path))},
 __nativeDiagnosticDigest:value=>sha(value)});
function source(index){const unit=manifest.units[index],bytes=fs.readFileSync(unit.file);assert.equal(sha(bytes),unit.sourceSha256);return bytes.toString('utf8');}
for(let index=0;index<6;index++)vm.runInContext(source(index),context);
const original=context.__nativeRun;
context.__nativeRun=function(...args){
 args[2]=1;args[3]=0;
 const start=performance.now(),report=Reflect.apply(original,this,args);
 console.error('one_battle_oracle_elapsed_ms:'+(performance.now()-start));
 console.log('ONE_BATTLE_REPORT:'+JSON.stringify(report));
 throw new Error('intentional one-battle diagnostic stop before remaining host clock');
};
try{vm.runInContext(source(6),context);}catch(error){if(!String(error).includes('intentional one-battle diagnostic stop'))throw error;}
