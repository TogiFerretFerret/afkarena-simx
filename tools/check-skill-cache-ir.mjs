import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';
import { types } from 'node:util';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const policy=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
if(JSON.stringify(process.execArgv)!==JSON.stringify(policy.rawBitReferenceFlags)||(process.env.NODE_OPTIONS??'')!==''){
  const r=spawnSync(process.execPath,[...policy.rawBitReferenceFlags,process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(r.status??1);
}
assert.equal(process.version,policy.node);assert.equal(process.versions.v8,policy.v8);
const pin=JSON.parse(await readFile(resolve(root,'config/skill-cache-specialization.json'))).parser;
const parser=(await readFile(resolve(root,pin.file),'utf8')).slice(pin.start,pin.end);assert.equal(sha(parser),pin.sha256);
const rustc=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc');
const binary=resolve(root,'work/check-skill-cache-ir');
const build=spawnSync(rustc,['--edition=2024','-O','tools/check-skill-cache-ir.rs','-o',binary],{cwd:root,encoding:'utf8'});assert.equal(build.status,0,build.stderr);
const real=JSON.parse(await readFile(resolve(root,'config/skill-cache-specialization.json'))).input.value.split(';');
let rng=0xd125e99b;function random(){rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0;}
const records=[];
for(let i=0;i<16000;i++){
  let tokens=[];const groups=1+random()%5;
  for(let g=0;g<groups;g++){tokens.push(['stage','tower','raid','deep_stage','a','b','heroes_lore'][random()%7]);for(let j=0,n=1+random()%4;j<n;j++){tokens.push(String(random()%1000000000).padStart(1+random()%9,'0'),String(random()%1000000000).padStart(1+random()%9,'0'));}}
  if(i%8===0)tokens=real.slice(); // Repeated real input exercises immutable IR cache hits.
  records.push({id:i,kind:'strict',tokens});
}
const odd=['','0x10','1e3',' 1','1 ','-0','+1','Infinity','NaN','1.5','9007199254740993','9999999999','０','\ud800','__proto__','constructor','stage','999999999','000000000'];
for(let i=0;i<6000;i++){
  const tokens=[];for(let j=0,n=random()%14;j<n;j++)tokens.push(odd[random()%odd.length]);
  records.push({id:records.length,kind:'quirky',tokens});
}
const directed=[
 ['empty','[]'],['undefined','undefined'],['null','null'],['not-array','({0:"stage",1:"1",2:"2",length:3})'],
 ['sparse','["stage",,"2"]'],['range-number','["stage",1,2]'],['coercion','["stage",{valueOf(){events.push(["valueOf"]);return 1},toString(){events.push(["toString"]);return "1"}},"2"]'],
 ['symbol','["stage",Symbol("x"),"2"]'],['bigint','["stage",1n,"2"]'],
 ['throwing-coercion','["stage",{toString(){events.push(["throw"]);throw sentinel}},"2"]'],
 ['index-getter','(()=>{let a=["stage","1","2"];Object.defineProperty(a,"1",{get(){events.push(["get",1]);return "1"}});return a})()'],
 ['index-mutation','(()=>{let a=["stage","1","2"];Object.defineProperty(a,"1",{get(){events.push(["get",1]);a[2]="9";return "1"}});return a})()'],
 ['proxy','new Proxy(["stage","1","2"],{get(t,k,r){events.push(["get",String(k)]);return Reflect.get(t,k,r)}})'],
 ['revoked-proxy','(()=>{let p=Proxy.revocable([],{});p.revoke();return p.proxy})()'],
 ['proto-mode-array','["stage","1","2"]','Object.prototype.stage=[]'],
 ['proto-mode-getter','["stage","1","2"]','Object.defineProperty(Object.prototype,"stage",{get(){events.push(["proto:get"]);return []},configurable:true})'],
 ['proto-mode-setter','["stage","1","2"]','Object.defineProperty(Object.prototype,"stage",{set(v){events.push(["proto:set",v])},configurable:true})'],
 ['parseInt-override','["stage","1","2"]','parseInt=function(v){events.push(["parseInt",v]);return 7}'],
 ['parseInt-getter','["stage","1","2"]','Object.defineProperty(globalThis,"parseInt",{get(){events.push(["parseInt:get"]);return savedParseInt},configurable:true})'],
 ['isNaN-override','["stage","1","2"]','isNaN=function(v){events.push(["isNaN",String(v)]);return false}'],
 ['isFinite-override','["stage","1","2"]','isFinite=function(v){events.push(["isFinite",v]);return false}'],
 ['array-check-override','["stage","1","2"]','Array.isArray=function(v){events.push(["arrayCheck"]);return false}'],
 ['array-check-getter','["stage","1","2"]','Object.defineProperty(Array,"isArray",{get(){events.push(["arrayCheck:get"]);return savedArrayCheck},configurable:true})'],
 ['push-override','["stage","1","2"]','Array.prototype.push=function(v){events[events.length]=["push",v];return savedPush.call(this,v)}'],
 ['push-getter','["stage","1","2"]','Object.defineProperty(Array.prototype,"push",{get(){events[events.length]=["push:get"];return savedPush},configurable:true})'],
 ['array-global-getter','["stage","1","2"]','Object.defineProperty(globalThis,"Array",{get(){events.push(["Array:get"]);return savedArray},configurable:true})'],
 ['parser-override','["stage","1","2"]','ed.parseUseSkillCacheStageBattle=function(v){events.push(["replacement",this===ed]);return {changed:v}}'],
 ['frozen-input','Object.freeze(["stage","1","2"])'],
 ['custom-input-proto','(()=>{let a=["stage","1","2"];Object.setPrototypeOf(a,{get missing(){throw sentinel}});return a})()'],
 ['duplicate-modes','["stage","1","2","stage","3","4"]'],
 ['leading-zero','["stage","000000000","000000009"]'],
 ['inverted-range','["stage","999999999","0"]']
];
for(const[label,expression,setup='']of directed)records.push({id:records.length,kind:'directed',label,tokens:['stage','1','2'],expression,setup});
const hex=s=>Array.from({length:s.length},(_,i)=>s.charCodeAt(i).toString(16).padStart(4,'0')).join('');
const input=records.map(r=>r.tokens.length?r.tokens.map(hex).join(','):'~').join('\n')+'\n';
const execution=spawnSync(binary,[],{cwd:root,input,encoding:'utf8',maxBuffer:64*1024*1024});assert.equal(execution.status,0,execution.stderr);
const irs=execution.stdout.trim().split('\n').map(JSON.parse);assert.equal(irs.length,records.length);
const guardSource=`
var savedArray=Array,savedArrayCheck=Array.isArray,savedPush=Array.prototype.push,savedParseInt=parseInt;
var savedIsNaN=isNaN,savedIsFinite=isFinite,savedParser=ed.parseUseSkillCacheStageBattle;
var descriptor=Object.getOwnPropertyDescriptor,prototype=Object.getPrototypeOf,apply=Reflect.apply;
var arrayProto=prototype([]),objectProto=prototype({});
function sameData(object,key,value){var d=descriptor(object,key);return !!d&&('value'in d)&&d.value===value;}
function optimized(input,ir,tokens){
 var fn=ed.parseUseSkillCacheStageBattle;
 function fallback(){return apply(fn,ed,[input]);}
 if(!ir||fn!==savedParser||__isProxy(input)||!savedArrayCheck(input))return fallback();
 if(!sameData(globalThis,'Array',savedArray)||!sameData(savedArray,'isArray',savedArrayCheck)||
    !sameData(globalThis,'parseInt',savedParseInt)||!sameData(globalThis,'isNaN',savedIsNaN)||
    !sameData(globalThis,'isFinite',savedIsFinite)||!sameData(arrayProto,'push',savedPush)||prototype(objectProto)!==null)return fallback();
 var length=descriptor(input,'length');if(!length||length.value!==tokens.length)return fallback();
 for(var i=0;i<tokens.length;i++){var d=descriptor(input,String(i));if(!d||!('value'in d)||typeof d.value!=='string'||d.value!==tokens[i])return fallback();}
 for(i=0;i<ir.modes.length;i++)if(descriptor(objectProto,tokens[ir.modes[i]]))return fallback();
 __admitted++;
 var output={};for(i=0;i<ir.ranges.length;i++){var range=ir.ranges[i],mode=tokens[range[0]];output[mode]||(output[mode]=[]);output[mode].push([range[1],range[2]]);}return output;
}
`;
function fixture(){const context=createContext({__isProxy:types.isProxy});runInContext('var events=[],sentinel={tag:"sentinel"},__admitted=0;var cc={warn:function(){events.push(["warn",...arguments])}};var ed={};ed.parseUseSkillCacheStageBattle='+parser+';'+guardSource,context);return context;}
// Reuse realms for normal tokens; isolate every prototype/intrinsic mutation.
const normal=[fixture(),fixture()];
function pack(value,seen=new Map()){
 if(typeof value==='number'){const b=Buffer.allocUnsafe(8);b.writeDoubleBE(value);return{bits:b.toString('hex')};}
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='undefined')return{kind:'undefined'};
 if(typeof value==='bigint'||typeof value==='symbol')return{kind:typeof value,value:String(value)};
 if(typeof value==='function')return{kind:'function',source:Function.prototype.toString.call(value)};
 if(seen.has(value))return{ref:seen.get(value)};const id=seen.size;seen.set(value,id);
 return{id,kind:Array.isArray(value)?'array':'object',properties:Reflect.ownKeys(value).map(key=>{const d=Object.getOwnPropertyDescriptor(value,key);return[String(key),d.enumerable,d.configurable,'value'in d?{writable:d.writable,value:pack(d.value,seen)}:{accessor:true}];})};
}
let admitted=0,fallbacks=0,firstFailure=null;const gold=[];
for(let index=0;index<records.length;index++){
 const record=records[index],pair=record.kind==='directed'?[fixture(),fixture()]:normal;
 const observations=[];
 for(let side=0;side<2;side++){
  const context=pair[side];context.__tokens=record.tokens;context.__ir=irs[index];
  runInContext('events.length=0;__admitted=0;',context);
  if(record.setup)runInContext(record.setup,context);
  // Keep input arrays in the source realm; JSON preserves exact original UTF16 strings.
  runInContext('var input='+(record.expression??JSON.stringify(record.tokens))+';',context);
  let result,error=null;try{result=runInContext(side?'optimized(input,__ir,__tokens)':'ed.parseUseSkillCacheStageBattle(input)',context);}catch(e){error=e===context.sentinel?{sentinel:true}:{name:e.name,message:e.message};}
  const observation={error,output:error?null:pack(result),events:pack(context.events),inputAfter:types.isProxy(context.input)?{proxy:true}:pack(context.input)};
  // Mutate returned data, then repeat: cached IR must never become a shared result.
  if(!error&&side&&context.__admitted){
   context.__first=result;runInContext('var second=optimized(input,__ir,__tokens);if(second===__first)throw Error("shared root");for(var key in second){if(second[key]===__first[key])throw Error("shared mode");for(var j=0;j<second[key].length;j++)if(second[key][j]===__first[key][j])throw Error("shared range");}for(var key in __first){__first[key][0][0]=-777;break;}var third=optimized(input,__ir,__tokens);',context);
   assert.deepEqual(pack(context.third),observation.output,'mutation escaped immutable IR at '+index);
  }
  if(side){if(context.__admitted)admitted++;else fallbacks++;}
  observations.push(observation);
 }
 try{assert.deepEqual(observations[1],observations[0]);}catch(e){if(!firstFailure)firstFailure={id:index,label:record.label??record.kind,message:e.message,expected:observations[0],actual:observations[1]};}
 gold.push({...record,ir:irs[index],expected:observations[0]});
}
const artifact='benchmarks/validation/skill-cache-ir-gold.jsonl.gz',bytes=Buffer.from(gold.map(x=>JSON.stringify(x)).join('\n')+'\n'),compressed=gzipSync(bytes,{level:9});await writeFile(resolve(root,artifact),compressed);
const files=['tools/check-skill-cache-ir.mjs','tools/check-skill-cache-ir.rs','tools/native-skill-cache-ir.rs','config/skill-cache-specialization.json'];const hashes={};for(const file of files)hashes[file]=sha(await readFile(resolve(root,file)));
const report={version:1,passed:firstFailure===null,source:pin,oracle:policy,cases:records.length,strictCases:16000,quirkyCases:6000,directedCases:directed.length,admitted,fallbacks,rustCache:JSON.parse(execution.stderr.trim()),firstFailure,inputHashes:hashes,artifact:{file:artifact,sha256:sha(compressed),uncompressedSha256:sha(bytes),bytes:compressed.length},qualifiesFor10000Target:false,enabledInNativeBattle:false,
 scope:'Isolated Rust immutable parse IR plus guarded source-realm fresh materialization. Original public parser function stays untouched; this adapter is not a deployed function replacement.',
 proof:['IR contains only input token indices and exactly representable <=9-digit nonnegative integer values; no JS heap result is cached.','Each admitted call allocates fresh ordinary result/mode/range objects in original insertion order. Repeated modes share the correct per-call mode array only.','Source parser intrinsics, dense own primitive-string inputs and absence of mode keys on the intrinsic Object prototype are checked getter-free before admission. Proxy detection uses Node host capability here; a native VM adapter must use VM object kinds.','Unsupported arrays, strings, getters, proxies, prototype collisions, coercions and changed intrinsics execute the complete original source; warnings, exceptions, input mutations, read order, exact result descriptors, aliases and f64 bits are compared.','Return values are mutated between repeated admitted calls to test cache isolation. Original public parser identity and Function.toString are retained by leaving it untouched.'],
 limitations:['No C++/Rust canonical VM adapter or original generated-C body trampoline is implemented or enabled. Native lowering must preserve original function object/metadata and check every listed intrinsic/prototype guard.','These are parser cases, not battle cases. Full callback/state trace and raw table counter equality remain required for battle deployment.','No allocation-count equivalence is claimed for GC/heap telemetry; ordinary source Cocos ClassMgr counters are not called by either original parser or IR materialization.','The old opt-in helper-level specialization remains separate and is not enabled by this proof. No throughput or speedup is measured.']};
await writeFile(resolve(root,'benchmarks/validation/skill-cache-ir.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:records.length,admitted,fallbacks,passed:report.passed,firstFailure:report.firstFailure?.id??null,compressedBytes:compressed.length}));if(firstFailure)process.exitCode=1;
