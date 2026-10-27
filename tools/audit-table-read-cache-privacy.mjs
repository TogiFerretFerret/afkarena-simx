// Negative proof for a tempting diagnostic optimization. Never injected into
// production: the candidate below intentionally lacks a private-loader proof.
import {readFile,writeFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const source=await readFile(new URL('./qualification-table-membrane.js',import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
let candidate=source.replace('function register(root,name){','function register(root,name,privateParse){')
 .replace('metadata:null};','metadata:null,readCache:privateParse?Object.create(null):null};')
 .replace('counters.gets++;return child(Reflect.get(t,key,receiver),key);','counters.gets++;if(record.readCache){var cached=record.readCache[key];if(cached!==undefined)return cached;var own=descriptor(t,key);if(own&&("value" in own)){var result=child(Reflect.get(t,key,receiver),key);record.readCache[key]=result;return result;}}return child(Reflect.get(t,key,receiver),key);')
 .replace('register(jsonParse(text),info&&info.name);','register(jsonParse(text),info&&info.name,true);');
assert.notEqual(candidate,source);
const scenarios=[
 {name:'JSON.parse replaced before installation leaks the fresh raw root',setup:'var nativeParse=JSON.parse,raw;JSON.parse=function(text){raw=nativeParse(text);return raw;};',options:'',body:'var table=membrane.parse(\'{"x":1}\',{name:"T"});var first=table.x;raw.x=9;return[first,table.x];'},
 {name:'isProxy callback receives the fresh raw root',setup:'var raw;',options:',isProxy:function(value){if(!raw)raw=value;return false;}',body:'var table=membrane.parse(\'{"x":1}\',{name:"T"});var first=table.x;raw.x=9;return[first,table.x];'},
 {name:'WeakMap.prototype.set replaced after installation receives raw keys',setup:'var raw;',options:'',afterInstall:'var originalSet=WeakMap.prototype.set;WeakMap.prototype.set=function(key,value){if(!raw&&key&&key.x===1)raw=key;return originalSet.call(this,key,value);};',body:'var table=membrane.parse(\'{"x":1}\',{name:"T"});var first=table.x;raw.x=9;return[first,table.x];'},
 {name:'Reflect.get replaced after the first read must still run for own properties',setup:'',options:'',body:'var table=membrane.parse(\'{"x":1}\',{name:"T"});var first=table.x,nativeGet=Reflect.get,events=[];Reflect.get=function(target,key,receiver){events.push(key);return nativeGet(target,key,receiver);};var second=table.x;return[first,second,events];'},
 {name:'wrap(raw) remains uncached and observes host aliases',setup:'',options:'',body:'var raw={x:1},table=membrane.wrap(raw,{name:"T"});var first=table.x;raw.x=9;return[first,table.x];',mustMatch:true},
 {name:'inherited getters and missing values remain dynamic',setup:'',options:'',body:'var table=membrane.parse(\'{"x":-0,"__proto__":{"safe":true}}\',{name:"T"}),n=0;Object.defineProperty(Object.prototype,"dynamic",{configurable:true,get:function(){return[this===table,++n];}});var a=table.dynamic,b=table.dynamic;Object.prototype.missing=4;var c=table.missing;delete Object.prototype.missing;return[a,b,c,table.missing===undefined,Object.is(table.x,-0),table.__proto__.safe];',mustMatch:true},
 {name:'canonical children descriptors symbols and write-failure stickiness remain equal on this fixture',setup:'',options:'',body:'var table=membrane.parse(\'{"a":{"n":-0},"array":[1]}\',{name:"T"}),a=table.a,b=table.a,d=Object.getOwnPropertyDescriptor(table,"a"),s=Symbol("inherited");Object.prototype[s]=7;var value=table[s];delete Object.prototype[s];var denied=false,sticky=false;try{table.a.n=3;}catch(e){denied=!!e.tableMembraneFailure;}try{membrane.assertClean();}catch(e){sticky=!!e.tableMembraneFailure;}return[a===b,a===d.value,Object.is(a.n,-0),value,denied,sticky];',mustMatch:true}
];
function run(program,scenario){const context=createContext({digest:text=>sha(text)});runInContext(scenario.setup,context);runInContext(program,context);runInContext('var membrane=installQualificationTableMembrane({digest:digest'+scenario.options+'});',context);if(scenario.afterInstall)runInContext(scenario.afterInstall,context);return JSON.parse(runInContext('JSON.stringify((function(){'+scenario.body+'})())',context));}
const results=[];
for(const scenario of scenarios){const baseline=run(source,scenario),cached=run(candidate,scenario),equal=JSON.stringify(baseline)===JSON.stringify(cached);assert.equal(equal,!!scenario.mustMatch,scenario.name);results.push({name:scenario.name,baseline,cached,equal,expectedEqual:!!scenario.mustMatch});}
const report={version:1,passed:true,candidateAccepted:false,activeAdapterChanged:false,qualifiesFor10000Target:false,scope:'Negative privacy and observable-call proof for a proposed parse-only own-property read cache. The candidate exists only as an in-memory transformation and is never enabled in a battle runner.',sourceSha256:sha(source),candidateSha256:sha(candidate),auditToolSha256:sha(await readFile(import.meta.filename)),results,conclusions:[
 'Capturing JSON.parse during installation does not prove it is the pristine native parser or that raw roots never escape.',
 'Even a pristine parser can leak raw roots through options.isProxy or replaceable raw-receiving WeakMap methods.',
 'Caching skips post-install Reflect.get replacements and their observable effects; capturing an intrinsic changes that existing boundary behavior unless excluded by a proven domain.',
 'Active source and emitted battle loaders call wrap(raw), not membrane.parse, so a parse-only cache does not accelerate the current workload.',
 'No performance benchmark is reported for a candidate rejected by these correctness checks. A future optimization requires a source-backed private-loader boundary and explicit pristine-intrinsic capabilities; host attestation is not inferred.'
]};
await writeFile(new URL('../benchmarks/validation/table-read-cache-privacy.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
