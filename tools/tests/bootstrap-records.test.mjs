import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {loadSourceRecordCache} from '../bootstrap-records.mjs';
function fixture(source='ed.x=1;'){
 const record={file:'src/a.js',start:5,end:source.length-1,source:source.slice(5,-1)};
 return{sources:new Map([['src/a.js',source]]),ordered:['a.js'],keyMaterial:{extractor:'a',runtime:'a',parser:'8.0.8'},records:{definitions:[['ed.x',[record]]],globals:[],initializers:[],postInitializers:[],functionDeclarations:[]}};
}
async function directory(t){const dir=await mkdtemp(resolve(tmpdir(),'battle-source-records-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('cache hit preserves exact text/order but exposes immutable records and fresh map containers',async t=>{
 const cacheDirectory=await directory(t),f=fixture('ed.x=-0;');let calls=0;
 const load=()=>loadSourceRecordCache({...f,cacheDirectory,extract(){calls++;return structuredClone(f.records)}});
 const first=await load(),second=await load();
 assert.equal(first.cache.hit,false);assert.equal(second.cache.hit,true);assert.equal(calls,1);
 assert.deepEqual(first.definitions,second.definitions);assert.equal(second.definitions[0][1][0].source,'-0');
 assert.throws(()=>second.definitions[0][1][0].source='0',TypeError);
 const one=new Map(first.definitions),two=new Map(second.definitions);one.delete('ed.x');assert.equal(two.size,1);
});
test('every original source byte, module order and extraction dependency change invalidates cache',async t=>{
 const cacheDirectory=await directory(t),f=fixture();let calls=0;
 const load=overrides=>loadSourceRecordCache({...f,cacheDirectory,extract(){calls++;return structuredClone(f.records)},...overrides});
 const first=await load();
 for(const overrides of [{sources:new Map([['src/a.js','ed.x=1;\n']])},{ordered:['other.js','a.js']},{keyMaterial:{...f.keyMaterial,runtime:'changed'}},{keyMaterial:{...f.keyMaterial,parser:'next'}}]){
   const next=await load(overrides);assert.equal(next.cache.hit,false);assert.notEqual(next.cache.key,first.cache.key);
 }
 assert.equal(calls,5);
});
test('truncated cache and digest-valid records outside the source range rebuild',async t=>{
 const cacheDirectory=await directory(t),f=fixture();let calls=0;
 const load=()=>loadSourceRecordCache({...f,cacheDirectory,extract(){calls++;return structuredClone(f.records)}});
 const first=await load();await writeFile(first.cache.path,'{"schemaVersion":');
 assert.equal((await load()).cache.hit,false);assert.equal(calls,2);
 const envelope=JSON.parse(await readFile(first.cache.path));envelope.records.definitions[0][1][0].source='fabricated';
 const{createHash}=await import('node:crypto');envelope.payloadSha256=createHash('sha256').update(JSON.stringify(envelope.records)).digest('hex');
 await writeFile(first.cache.path,JSON.stringify(envelope));assert.equal((await load()).cache.hit,false);assert.equal(calls,3);
});
test('disabled caching still validates extraction and propagates extraction failures',async t=>{
 const cacheDirectory=await directory(t),f=fixture();
 await assert.rejects(loadSourceRecordCache({...f,cacheDirectory,enabled:false,extract(){throw new Error('original parse failure')}}),/original parse failure/);
 await assert.rejects(loadSourceRecordCache({...f,cacheDirectory,enabled:false,extract(){const bad=structuredClone(f.records);bad.definitions[0][1][0].start=99;return bad}}),/original source range/);
 const result=await loadSourceRecordCache({...f,cacheDirectory,enabled:false,extract:()=>structuredClone(f.records)});assert.equal(result.cache.path,null);
});
test('extraction keeps redeclarations, original function statements and side-effect order without evaluating RHS',async()=>{
 const{extractBootstrapSourceRecords}=await import('../bootstrap-records-extractor.mjs');
 const source='function foo(){return ed.inside;}var moder=3;ed.x=-0;ed.x=(()=>{throw new Error("must not execute")})();ed.state_to_string[1]="Birth";';
 const records=extractBootstrapSourceRecords(new Map([['src/srcmodule/game_util.js',source]]),['game_util.js']);
 const definitions=new Map(records.definitions);
 assert.deepEqual(definitions.get('ed.x').map(r=>r.source),['-0','(()=>{throw new Error("must not execute")})()']);
 assert.equal(definitions.has('ed.inside'),false);
 assert.equal(records.functionDeclarations[0].source,'function foo(){return ed.inside;}');
 assert.equal(records.initializers[0].source,'var moder=3;');
 assert.equal(records.postInitializers[0].source,'ed.state_to_string[1]="Birth"');
});
