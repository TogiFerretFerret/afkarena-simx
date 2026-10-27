import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createContext,runInContext,constants} from 'node:vm';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const profile=JSON.parse(await readFile(new URL('config/source-oracle-runtime.json',root)));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);assert.deepEqual(process.execArgv,profile.rawBitReferenceFlags,'Run with pinned --jitless oracle flag');
const addon=createRequire(import.meta.url)('../work/node-trace-observer/trace-code-only.node');
const source=await readFile(new URL('tools/battle-trace-portable.js',root),'utf8');
const buildFile='benchmarks/validation/native-trace-code-only-build.json',buildBytes=await readFile(new URL(buildFile,root)),build=JSON.parse(buildBytes);
assert.equal(build.passed,true);assert.equal(build.source.sha256,sha(await readFile(new URL(build.source.file,root))));assert.equal(build.output.sha256,sha(await readFile(build.output.file)));
const needle='        function codeOnly(fn) {\n            var keys = ownKeys(fn);';assert.equal(source.split(needle).length,2);
const candidate=source.replace('var standardFunctions = ["length", "name", "arguments", "caller"];','var standardFunctions = ["length", "name", "arguments", "caller"];\n        var nativeCodeOnly=host.__nativeTraceCodeOnlyFactory();').replace(needle,'        function codeOnly(fn) {\n            var fast=nativeCodeOnly(fn,standardFunctions,ownKeys,descriptor,prototypeOf);\n            if(fast!==undefined)return typeof fast==="boolean"?fast:intrinsics.get(fast)==="Object.prototype";\n            var keys = ownKeys(fn);');
function realm(text){const c=createContext(constants.DONT_CONTEXTIFY),seed=runInContext('globalThis',c);const inspectors=Array.from({length:4},()=>addon.createInspectorFor(seed));c.__nativeTraceCodeOnlyFactory=()=>{assert.ok(inspectors.length);return inspectors.shift();};runInContext(text,c);return c;}
const realms=[realm(source),realm(candidate)];
const initial=`var calls=0,s=Symbol('x');function F(){};function G(){};var root={fn:F,other:G,arr:[1,,undefined],number:-0};root.self=root;Object.defineProperty(root,'accessor',{get:function(){calls++;throw Error('observed getter')},configurable:true});var cap=installGraphCapture(),trace=installPortableBattleTrace({compact:true});`;
for(const c of realms)runInContext(initial,c);
const mutations=['','F.extra={n:1};','F.extra.n=2;','delete F.extra;','F.prototype.x=1;','delete F.prototype.x;','Object.defineProperty(F.prototype,"constructor",{writable:false});','Object.defineProperty(F.prototype,"constructor",{writable:true});','Object.defineProperty(F,"prototype",{writable:false});','F.prototype={constructor:F};','root.arrow=()=>1;','root.bound=F.bind(null);','F[s]=2;','delete F[s];','Object.defineProperty(G.prototype,"constructor",{get:function(){calls++;throw Error("constructor getter")},configurable:true});','Object.defineProperty(G.prototype,"constructor",{value:G,writable:true,configurable:true});','Object.setPrototypeOf(G.prototype,null);','Object.setPrototypeOf(G.prototype,Object.prototype);','root.number=NaN;','root.number=0;'];
const hashes=[];
for(let n=0;n<mutations.length;n++){
 const graphs=realms.map(c=>{runInContext(mutations[n],c);return runInContext('JSON.stringify(cap.snapshot({state:root}))',c);});assert.equal(graphs[1],graphs[0],'Entire graph mutation '+n);
 const events=realms.map(c=>runInContext(`trace.record('mutation',{n:${n}},{state:root}).stateHash`,c));assert.equal(events[1],events[0]);hashes.push(sha(graphs[0]));for(const c of realms)assert.equal(c.calls,0);
}
// A test-only export of the original private predicate makes exact fallback
// trap order and callback identity observable without capturing Proxy graphs.
const seam='            snapshot: snapshot,';
assert.equal(source.split(seam).length,2);assert.equal(candidate.split(seam).length,2);
const predicateSources=[source,candidate].map(s=>s.replace(seam,seam+'\n            testCodeOnly: codeOnly,'));
const fallbackCases=[
 `var events=[];function F(){};F.prototype=new Proxy(F.prototype,{ownKeys:function(t){events.push('keys');return Reflect.ownKeys(t)},getOwnPropertyDescriptor:function(t,k){events.push('descriptor:'+String(k));return Reflect.getOwnPropertyDescriptor(t,k)},getPrototypeOf:function(t){events.push('parent');return Reflect.getPrototypeOf(t)}});var cap=installGraphCapture();JSON.stringify({answer:cap.testCodeOnly(F),events:events});`,
 `var events=[],sentinel={};function F(){};var p=new Proxy(F,{ownKeys:function(){events.push('throw');throw sentinel}});var cap=installGraphCapture();try{cap.testCodeOnly(p);throw Error('missing exception')}catch(e){JSON.stringify({identity:e===sentinel,events:events})}`,
 `var calls=0;function F(){};var index=Array.prototype.indexOf;Array.prototype.indexOf=function(v){calls++;this[0]='changed';return Reflect.apply(index,this,[v])};var cap=installGraphCapture(),first=cap.testCodeOnly(F);Array.prototype.indexOf=index;JSON.stringify({first:first,afterRestore:cap.testCodeOnly(F),calls:calls});`,
 `var calls=0;function F(){};Object.defineProperty(F.prototype,'constructor',{get:function(){throw Error('constructor invoked')},configurable:true});Object.defineProperty(Object.prototype,'value',{get:function(){calls++;return F},configurable:true});var cap=installGraphCapture();JSON.stringify({answer:cap.testCodeOnly(F),calls:calls});`,
 `var calls=0;function F(){};var original=Object.getOwnPropertyDescriptor;Object.getOwnPropertyDescriptor=function(o,k){calls++;return original(o,k)};var cap=installGraphCapture();JSON.stringify({answer:cap.testCodeOnly(F),calls:calls});`
];
const fallbackResults=[];
for(let n=0;n<fallbackCases.length;n++){
 const results=predicateSources.map(s=>runInContext(fallbackCases[n],realm(s)));
 assert.equal(results[1],results[0],'Exact fallback behavior '+n);fallbackResults.push(JSON.parse(results[0]));
}
// Snapshot format, traversal and exact number bits are compared, not normalized.
const size=3000,samples=[];const benches=[realm(source),realm(candidate)];
for(const c of benches)runInContext(`var root={};for(var n=0;n<${size};n++){var f=function F(){};root['f'+n]=f;}var cap=installGraphCapture();cap.snapshot({state:root});`,c);
for(let n=0;n<8;n++){
 const order=n%2?[1,0]:[0,1],times=[],graphs=[];
 for(const side of order){const start=performance.now();graphs[side]=runInContext('JSON.stringify(cap.snapshot({state:root}))',benches[side]);times[side]=performance.now()-start;}
 assert.equal(graphs[0],graphs[1]);samples.push({referenceMs:times[0],candidateMs:times[1],graphSha256:sha(graphs[0])});
}
const sum=k=>samples.reduce((a,b)=>a+b[k],0),report={version:1,passed:true,scope:'Diagnostic exact-graph codeOnly native predicate experiment. Captured original realm intrinsics required; factory is created before source program code. No game function source or active collector changes. No full battle or throughput qualification.',qualifiesFor10000Target:false,node:process.version,v8:process.versions.v8,execArgv:process.execArgv,buildProof:{file:buildFile,sha256:sha(buildBytes)},producer:{file:'tools/check-native-trace-code-only.mjs',sha256:sha(await readFile(import.meta.filename))},originalCollectorSha256:sha(source),candidateCollectorSha256:sha(candidate),nativeSourceSha256:sha(await readFile(new URL('tools/native-trace-code-only.cc',root))),nativeBinarySha256:sha(await readFile(new URL('work/node-trace-observer/trace-code-only.node',root))),directedMutations:mutations.length,directedGraphHashes:hashes,fallbackCases:fallbackCases.length,fallbackResults,functionCount:size,samples,referenceMs:sum('referenceMs'),candidateMs:sum('candidateMs'),ratio:sum('referenceMs')/sum('candidateMs'),limitations:['Observer only; no battle mechanics changed','Single ordinary-function-heavy microbenchmark, not representative full-program performance','Native inspector conservatively and permanently falls back after unsupported shapes or intrinsic mutation','Factory must capture original realm intrinsics before untrusted program execution','Shared trace closure/weak-content coverage boundaries remain unchanged']};
await mkdir(new URL('benchmarks/validation/',root),{recursive:true});
await mkdir(new URL('benchmarks/results/',root),{recursive:true});
report.resultFile='benchmarks/results/'+new Date().toISOString().replaceAll(':','-')+'-native-trace-code-only.json';
const bytes=JSON.stringify(report,null,2)+'\n';
await writeFile(new URL(report.resultFile,root),bytes);
await writeFile(new URL('benchmarks/validation/native-trace-code-only.json',root),bytes);
console.log(JSON.stringify(report,null,2));
