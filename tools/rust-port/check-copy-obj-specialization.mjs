import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
import {sourceCopyFunction} from '../flat-numeric-copy.mjs';
const root=resolve(import.meta.dirname,'../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}});process.stdout.write(child.stdout??'');process.stderr.write(child.stderr??'');process.exit(child.status??1);}
const setup=`var ed={};ed.copyObj=${sourceCopyFunction};function bits(x){var d=new DataView(new ArrayBuffer(8));d.setFloat64(0,x,false);return d.getUint32(0,false).toString(16).padStart(8,'0')+d.getUint32(4,false).toString(16).padStart(8,'0');}`;
const cases=[
 ["mixed-primitive-leaves","function(){var o={'12':null,'1':-0,z:'hello',empty:'',yes:true,no:false,missing:void 0},c=ed.copyObj(o);o.z='changed';return JSON.stringify([c!==o,Object.keys(c),bits(c['1']),c['12']===null,c.z,c.empty,c.yes,c.no,c.hasOwnProperty('missing'),c.missing===void 0]);}"],
 ["utf16-lone-surrogates","function(){var o={x:'\\ud800A\\udfff',y:'💩'},c=ed.copyObj(o);return JSON.stringify([c!==o,c.x===o.x,c.y===o.y,c.x.charCodeAt(0),c.x.charCodeAt(2),Object.keys(c)]);}"],
 ["function-identity-no-call","function(){var events=[],f=function(x){events.push('call:'+x);return x;},o={f:f,x:null},c=ed.copyObj(o);events.push('copied');var equal=c.f===f;var r=c.f(7);return JSON.stringify([c!==o,equal,r,events,Object.keys(c)]);}"],
 ["primitive-getter-mutation-fallback","function(){var events=[],o={a:'before'};Object.defineProperty(o,'x',{enumerable:true,configurable:true,get:function(){events.push('get');o.a='after';return null;}});var c=ed.copyObj(o);return JSON.stringify([c.a,c.x===null,o.a,events,Object.keys(c)]);}"],
 ["mixed-nested-object-fallback","function(){var o={s:'text',inner:{x:null,b:true}},c=ed.copyObj(o);return JSON.stringify([c!==o,c.inner!==o.inner,c.inner.x===null,c.inner.b,Object.keys(c)]);}"],
 ["small-dense-finite-bits","function(){return JSON.stringify([1,2,3,4].map(function(n){var a=[-0,1e-320,1.7976931348623157e308,-17.25].slice(0,n),c=ed.copyObj(a);return [c!==a,c.length,Object.keys(c),c.map(bits),Object.getPrototypeOf(c)===Array.prototype];}));}"],
 ["small-array-extra-nonenumerable","function(){var a=[-0,2];Object.defineProperty(a,'extra',{value:9});var c=ed.copyObj(a);return JSON.stringify([c.length,Object.keys(c),bits(c[0]),c.extra]);}"],
 ["small-array-readonly-length","function(){var a=[-0,2];Object.defineProperty(a,'length',{writable:false});var c=ed.copyObj(a);return JSON.stringify([c.length,bits(c[0]),Object.getOwnPropertyDescriptor(c,'length').writable]);}"],
 ["small-array-index-getter","function(){var events=[],a=[1,2];Object.defineProperty(a,'0',{get:function(){events.push('get0');return -0;},enumerable:true,configurable:true});var c=ed.copyObj(a);return JSON.stringify([events,c.length,bits(c[0]),c[1]]);}"],
 ["small-array-inherited-setter","function(){var events='',a=[1,2];Object.defineProperty(Array.prototype,'0',{set:function(v){events+='set:'+v+';';},configurable:true});var c=ed.copyObj(a);delete Array.prototype[0];return JSON.stringify([events,c.length,Object.keys(c),c[1]]);}"],
 ["small-array-own-constructor-getter","function(){var events=[],a=[-0,2];Object.defineProperty(a,'constructor',{get:function(){events.push('ctorGet');return Array;}});var c=ed.copyObj(a);return JSON.stringify([events,c.length,bits(c[0])]);}"],
 ["small-array-nondefault-index","function(){var a=[-0,2];Object.defineProperty(a,'0',{writable:false,enumerable:false,configurable:false});var c=ed.copyObj(a);return JSON.stringify([c.length,Object.keys(c),c[0],c[1]]);}"],
  [
    "flat-order-bits",
    "function(){var o={'12':3,'1':-0,z:4.5};var c=ed.copyObj(o);return JSON.stringify([c!==o,Object.keys(c),bits(c['1']),c.z,Object.getPrototypeOf(c)===Object.prototype]);}"
  ],
  [
    "empty-array",
    "function(){var a=[],c=ed.copyObj(a);return JSON.stringify([a!==c,Array.isArray(c),c.length,Object.keys(c),Object.getPrototypeOf(c)===Array.prototype]);}"
  ],
  [
    "hole-array",
    "function(){var a=new Array(5),c=ed.copyObj(a);return JSON.stringify([c.length,Object.keys(c)]);}"
  ],
  [
    "trailing-holes",
    "function(){var a=new Array(5);a[1]=3;var c=ed.copyObj(a);return JSON.stringify([c.length,Object.keys(c),c[1]]);}"
  ],
  [
    "factory-parent",
    `function(){ed.copyObj=(function(){return ${sourceCopyFunction};})();var c=ed.copyObj({x:-0});return bits(c.x);}`
  ],
  [
    "factory-Object-shadow",
    "function(){var events=[];ed.copyObj=(function(Object){return ${sourceCopyFunction};})({keys:function(o){events.push('keys');return globalThis.Object.keys(o);}});var c=ed.copyObj({x:3});return JSON.stringify([events,c.x]);}"
  ],
  [
    "constructor-getter-twice",
    "function(){var events=[],o={x:3};Object.defineProperty(o,'constructor',{get:function(){events.push('get');return function(){events.push('ctor');this.y=2;};}});var c=ed.copyObj(o);return JSON.stringify([events,Object.keys(c),c.x,c.y]);}"
  ],
  [
    "constructor-getter-falsy",
    "function(){var events=[],o={x:3};Object.defineProperty(o,'constructor',{get:function(){events.push('get');return null;}});return JSON.stringify([ed.copyObj(o).x,events]);}"
  ],
  [
    "constructor-throw-prefix",
    "function(){var events=[],sentinel={},o={x:3};Object.defineProperty(o,'constructor',{get:function(){events.push('get');throw sentinel;}});try{ed.copyObj(o);}catch(e){return JSON.stringify([events,e===sentinel]);}}"
  ],
  [
    "own-constructor-falsy",
    "function(){var c=ed.copyObj({constructor:0,x:3});return JSON.stringify([Object.keys(c),c.constructor,c.x]);}"
  ],
  [
    "input-getter",
    "function(){var events=[],o={};Object.defineProperty(o,'x',{enumerable:true,get:function(){events.push('get');return 3;}});return JSON.stringify([ed.copyObj(o).x,events]);}"
  ],
  [
    "Object-keys-observer",
    "function(){var events=[],old=Object.keys;Object.keys=function(o){events.push('keys');return old(o);};var c=ed.copyObj({x:3});return JSON.stringify([events,c.x]);}"
  ],
  [
    "Object-global-getter",
    "function(){var events=[],old=Object;Object.defineProperty(globalThis,'Object',{get:function(){events.push('Object');return old;}});var c=ed.copyObj({x:3});return JSON.stringify([events,c.x]);}"
  ],
  [
    "Array-global-getter",
    "function(){var events=[],old=Array;Object.defineProperty(globalThis,'Array',{get:function(){events.push('Array');return old;}});var c=ed.copyObj([]);return JSON.stringify([events,c.length]);}"
  ],
  [
    "object-prototype-constructor",
    "function(){var events=[];Object.prototype.constructor=function(){events.push('ctor');this.y=2;};var c=ed.copyObj({x:3});return JSON.stringify([events,Object.keys(c),c.x,c.y]);}"
  ],
  [
    "array-prototype-constructor",
    "function(){var events=[];Array.prototype.constructor=function(){events.push('ctor');this.y=2;};var c=ed.copyObj([]);return JSON.stringify([events,Object.keys(c),c.y]);}"
  ],
  [
    "inherited-output-setter",
    "function(){var events=[],o={x:3};Object.defineProperty(Object.prototype,'x',{configurable:true,set:function(v){events.push(v);}});var c=ed.copyObj(o);return JSON.stringify([events,Object.keys(c)]);}"
  ],
  [
    "proto-assignment",
    "function(){var o={};Object.defineProperty(o,'__proto__',{value:3,enumerable:true,writable:true,configurable:true});var c=ed.copyObj(o);return JSON.stringify([Object.keys(c),Object.getPrototypeOf(c)===Object.prototype]);}"
  ],
  [
    "nonenumerable-field",
    "function(){var o={x:3};Object.defineProperty(o,'hidden',{value:4});return JSON.stringify(ed.copyObj(o));}"
  ],
  [
    "frozen-input",
    "function(){return JSON.stringify(ed.copyObj(Object.freeze({x:3})));}"
  ],
  [
    "nested-alias",
    "function(){var child={x:3},c=ed.copyObj({a:child,b:child});return JSON.stringify([c.a!==c.b,c.a.x,c.b.x]);}"
  ],
  [
    "recursion-observer",
    "function(){var events=[],old=ed.copyObj;ed.copyObj=function(o){events.push(Object.keys(o).join(','));return old(o);};var c=old({a:{x:3}});return JSON.stringify([events,c.a.x]);}"
  ],
  [
    "source-text",
    "function(){return ed.copyObj.toString();}"
  ]
];
cases.push(
 ['array-constructor-getter','function(){var events=[];Object.defineProperty(Array.prototype,"constructor",{get:function(){events.push("get");return function(){events.push("ctor");this.x=3;};}});var c=ed.copyObj([]);return JSON.stringify([events,Object.keys(c),c.x]);}'],
 ['inherited-readonly-output','function(){var o={x:3};Object.defineProperty(Object.prototype,"x",{value:9,writable:false,configurable:true});var c=ed.copyObj(o);return JSON.stringify([Object.keys(c),c.x]);}'],
 ['inherited-enumerable-ignored','function(){Object.prototype.extra=9;var c=ed.copyObj({x:3});return JSON.stringify([Object.keys(c),c.x,c.extra]);}'],
);
for(const row of cases)row[1]=row[1].replaceAll('${sourceCopyFunction}',sourceCopyFunction);
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-copy-obj-specialization.mjs','tools/flat-numeric-copy.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-copy-obj-specialization');await mkdir(directory,{recursive:true});
const expanded=cases.flatMap(([name,source])=>[false,true].map(specialized=>({name,source,specialized})));const modules=expanded.map(({name,source,specialized},index)=>({name,source,specialized,index,...compileSource(setup+'\nvar result=('+source+')();',{mode:'script',filename:'copy-obj-specialization:'+name,allowUnsupported:false,sourceSpecializations:specialized})}));
for(const item of modules){const copies=item.manifest.functions.filter(fn=>fn.sourceSha256===sha(sourceCopyFunction));assert.ok(copies.length);assert.ok(copies.every(fn=>Boolean(fn.sourceSpecialization)===item.specialized),'Copy specialization switch must be exercised');}
const encode=`fn encode(rt:&Runtime,value:Value)->String{match value{Value::Undefined=>"undefined".into(),Value::Null=>"null".into(),Value::Bool(value)=>format!("bool:{}",value),Value::Number(value)=>format!("number:{:016x}",value.to_bits()),Value::String(id)=>format!("string:{}",rt.string_units(id).iter().map(|v|format!("{:04x}",v)).collect::<String>()),other=>format!("unexpected:{:?}",other)}}`;
let rust='use js_runtime::{Runtime,Value,JsError};\n'+encode+'\n'+modules.map(item=>'mod case_'+item.index+' {\n'+item.rust+'\n}').join('\n')+'\nfn main(){\n';
for(const item of modules)rust+=`{let mut rt=Runtime::new();let env=rt.global_env;let value=case_${item.index}::run(&mut rt,env,Value::Undefined).and_then(|_|rt.lookup(env,"result"));match value{Ok(v)=>println!("ok:{}",encode(&rt,v)),Err(JsError::Throw(v))=>println!("throw:{}",encode(&rt,v)),Err(e)=>println!("runtime-error:{:?}",e)}}\n`;
rust+='}\n';await writeFile(resolve(directory,'main.rs'),rust);
const rustbin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),environment={...process.env,PATH:rustbin+':'+process.env.PATH};
const build=spawnSync(resolve(rustbin,'cargo'),['build','--release','-p','js-runtime'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stderr);
const binary=resolve(directory,'check'),rustc=resolve(rustbin,'rustc'),compileArgs=['--edition=2024','-O',resolve(directory,'main.rs'),'-L','dependency='+resolve(root,'target/release/deps'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-o',binary];
const compiled=spawnSync(rustc,compileArgs,{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n');assert.equal(actual.length,expanded.length);
const view=new DataView(new ArrayBuffer(8));function encodeValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='boolean')return'bool:'+value;if(typeof value==='number'){view.setFloat64(0,value,false);return'number:'+view.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof value==='string')return'string:'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('Unsupported fixture return type '+typeof value);}
const observations=[];for(let index=0;index<expanded.length;index++){const{name,source,specialized}=expanded[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;runInContext(setup,realm);try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}observations.push({name,specialized,source,expected,actual:actual[index],matched:expected===actual[index]});}
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'copyObj specialization source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-copy-obj-specialization.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:expanded.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Guarded exact-source ed.copyObj with constructor/getter/order, mutable intrinsic, output setter, array holes, alias and source-text cases. This is a copy component gate, not battle qualification. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-copy-obj-specialization.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:expanded.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
