// Scoped proposal only: do not rewrite the active qualification adapter.
import {readFile,writeFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=value=>createHash('sha256').update(value).digest('hex');
const files=['tools/qualification-table-membrane.js','tools/bootstrap-runtime.mjs','tools/emit-native-oracle.mjs'],inputs={};
for(const file of files){const bytes=await readFile(new URL('../'+file,import.meta.url));inputs[file]={sha256:sha(bytes),text:bytes.toString('utf8')};}
const source=inputs[files[0]].text;
for(const anchor of ['var local=new WeakMap(),pending=[],nodes=[]','local.set(value,record);pending.push(record);','return makeProxy(local.get(root));'])assert.ok(source.includes(anchor));
const localMap=source.replace('var local=new WeakMap(),pending=[],nodes=[]','var local=new Map(),pending=[],nodes=[]');
// LIMITED intrinsic capture: fixes the focused cases below, not all possible
// private-container/prototype hooks. It is deliberately never activated.
const captures=[
 'var privateApply=Reflect.apply,privateGet=Reflect.get,privateProxy=Proxy,privateArrayIsArray=Array.isArray,privateIsExtensible=Object.isExtensible;',
 'var privateWeakGet=WeakMap.prototype.get,privateWeakSet=WeakMap.prototype.set,privateWeakHas=WeakMap.prototype.has;',
 'function privateGetWeak(map,key){return privateApply(privateWeakGet,map,[key]);}',
 'function privateSetWeak(map,key,value){return privateApply(privateWeakSet,map,[key,value]);}',
 'function privateHasWeak(map,key){return privateApply(privateWeakHas,map,[key]);}'
].join('\n');
let hardened=source.replace('"use strict";','"use strict";\n'+captures)
 .replaceAll('Reflect.get(t,key,receiver)','privateGet(t,key,receiver)')
 .replaceAll('new Proxy(target,','new privateProxy(target,')
 .replaceAll('Array.isArray(value)','privateArrayIsArray(value)')
 .replaceAll('Object.isExtensible(value)','privateIsExtensible(value)');
for(const [method,replacement] of [['get','privateGetWeak'],['set','privateSetWeak'],['has','privateHasWeak']])hardened=hardened.replace(new RegExp('\\b(records|proxies|local)\\.'+method+'\\(','g'),replacement+'($1,');
const fixtureCode="(function(){var m=installQualificationTableMembrane({digest:digest}),raw={a:{n:-0},array:[1,{x:2}]};raw.b=raw.a;var t=m.wrap(raw,{name:'T'}),a=t.a,d=Object.getOwnPropertyDescriptor(t,'a');return{values:[a===t.b,a===d.value,Object.is(a.n,-0),t.array[1].x,m.immutableMetadata(a).sha256],stats:m.stats()};})()";
function evaluate(program,code){const context=createContext({digest:sha});if(program)runInContext(program,context);return JSON.parse(runInContext('JSON.stringify('+code+')',context));}
const fixture=evaluate(source,fixtureCode);assert.deepEqual(evaluate(localMap,fixtureCode),fixture);assert.deepEqual(evaluate(hardened,fixtureCode),fixture);
const hooks=[
 ['Reflect.get','var original=Reflect.get;Reflect.get=function(t,k,r){events+="get;";return original(t,k,r);};'],
 ['WeakMap.prototype.set','var original=WeakMap.prototype.set;WeakMap.prototype.set=function(k,v){events+="weakSet;";return original.call(this,k,v);};'],
 ['Proxy constructor','var original=Proxy;Proxy=function(t,h){events+="proxy;";return new original(t,h);};'],
 ['Array.isArray','var original=Array.isArray;Array.isArray=function(value){events+="arrayIsArray;";return original(value);};'],
 ['Object.isExtensible','var original=Object.isExtensible;Object.isExtensible=function(value){events+="isExtensible;";return original(value);};']
];
function observe(program,hook,before=false){
 const c=createContext({digest:sha});runInContext('var events="";',c);if(before)runInContext(hook,c);
 if(program){runInContext(program,c);runInContext('var membrane=installQualificationTableMembrane({digest:digest});',c);}
 if(!before)runInContext(hook,c);
 const load=program?"membrane.parse('{\"x\":1}',{name:'T'})":"JSON.parse('{\"x\":1}')";
 return JSON.parse(runInContext('JSON.stringify((function(){var table='+load+';return{value:table.x,events:events};})())',c));
}
const transparency=[];
for(const [name,hook] of hooks){const raw=observe(null,hook),old=observe(source,hook),fixed=observe(hardened,hook);assert.deepEqual(fixed,raw,name);assert.notDeepEqual(old,raw,name);transparency.push({name,raw,old,limitedFixed:fixed});}
const tooLate=observe(hardened,hooks[0][1],true),rawEarly=observe(null,hooks[0][1],true);assert.notDeepEqual(tooLate,rawEarly);
const leakCode="(function(){var m=installQualificationTableMembrane({digest:digest}),leaked=false,error=null;Object.defineProperty(Array.prototype,'0',{configurable:true,get:function(){return undefined;},set:function(value){if(value&&value.raw&&value.raw.x===1)leaked=true;}});try{m.parse('{\"x\":1}',{name:'T'});}catch(e){error=e.name;}delete Array.prototype[0];return{leakedRawRecord:leaked,error:error};})()";
const containerLeak=evaluate(source,leakCode);assert.equal(containerLeak.leakedRawRecord,true);
const report={
 version:1,passed:true,activeAdapterChanged:false,qualifiesFor10000Target:false,
 scope:'Source ownership argument and focused raw/old/limited-fixed transparency checks. No hardened adapter or cache is activated.',
 inputs:Object.fromEntries(Object.entries(inputs).map(([file,value])=>[file,{sha256:value.sha256}])),
 toolSha256:sha(await readFile(import.meta.filename)),candidateHashes:{localMap:sha(localMap),limitedCapturedIntrinsics:sha(hardened)},fixture,transparency,
 lateInstallation:{raw:rawEarly,limitedFixed:tooLate,transparent:false},privateArrayPrototypeCounterexample:containerLeak,
 ownership:{
  localMap:{
   candidate:'Replace only register-local graph-validation WeakMap with Map.',
   argument:[
    'Every successful scalar object visit appends its record to pending; record.raw strongly references its key.',
    'External digest/isProxy callbacks occur while pending is still needed for publication and retains every validated raw key.',
    'With callback-free trusted private intrinsics, no outside observer runs between final pending publication and register returning.',
    'Neither local nor scalar escapes into a published record or makeProxy closure. Final local.get(root) only obtains the returned root proxy; the local Map dies with registration.'
   ],
   conditions:[
    'Map/WeakMap constructors and methods must be trusted native captures; swapping user-hookable global container types is not a general semantic proof.',
    'The small fixture matches all raw counters and metadata, but full20 report parity and native GC/performance evidence remain required before activation.'
   ]
  },
  persistentMaps:{
   genericAPIEligible:false,
   reason:'A caller may release wrapped roots while retaining the boundary. Persistent Map records would pin otherwise unreachable graphs; WeakMap ephemerons do not.',
   workerLoaderArgument:'Current source tables Map and emitted __nativeTables/__nativeWrappedTables caches have no eviction. Eligibility requires this exact worker lifecycle, immutable graph edges and absence of aliases that detach nodes to be proved and enforced.',
   privacyWarning:'The emitted __nativeTables binding is top-level state; privacy against arbitrary global reflection has not been established.'
  }
 },
 requiredHardening:[
  'Capture trusted intrinsics before any original/game code or extension can mutate them. Comparing already-mutated globals cannot recover pristine natives.',
  'Protect private raw-record containers against inherited numeric setters. Capturing Array.push alone still invokes inherited setters.',
  'Treat options.isProxy as an explicit trusted raw-receiving host capability.',
  'Audit private serialization, path and metadata operations for inherited hooks before claiming complete raw-table transparency.',
  'Establish a source-backed private loader and lifetime boundary before read caching or persistent strong-map substitution.'
 ],
 fullNode20:{executed:false,requiredBeforeActivation:true,reason:'Only scoped proposals were exercised. The active adapter stays frozen and concurrent native GC/RSS trials take priority.'},
 correction:'Callbacks caused only by diagnostic lookups of replaced Reflect.get/private WeakMap methods are instrumentation-induced effects, not original raw-table read semantics that fidelity should preserve.'
};
await writeFile(new URL('../benchmarks/validation/table-boundary-ownership.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
