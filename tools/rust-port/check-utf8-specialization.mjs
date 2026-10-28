import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
const root=resolve(import.meta.dirname,'../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}});process.stdout.write(child.stdout??'');process.stderr.write(child.stderr??'');process.exit(child.status??1);}
const decodeBody="function __nativeDecodeUTF8(bytes){\n    var parts=[],units=[],i=0;\n    while(i<bytes.length){var a=bytes[i++],code;\n      if(a<128)code=a;\n      else if(a>=194&&a<224){if(i>=bytes.length)throw new Error('Truncated UTF8');code=((a&31)<<6)|(bytes[i++]&63);}\n      else if(a<240){if(i+1>=bytes.length)throw new Error('Truncated UTF8');code=((a&15)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63);}\n      else{if(i+2>=bytes.length)throw new Error('Truncated UTF8');code=((a&7)<<18)|((bytes[i++]&63)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63);code-=65536;units.push(55296+(code>>10));code=56320+(code&1023);}\n      units.push(code);if(units.length>=4096){parts.push(String.fromCharCode.apply(null,units));units=[];}\n    }\n    if(units.length)parts.push(String.fromCharCode.apply(null,units));return parts.join('');\n  }";
const cases=[
  [
    "pristine",
    "function(){return __nativeDecodeUTF8(new Uint8Array([65,240,159,152,128,0]));}"
  ],
  [
    "fromcharcode-observer",
    "function(){var s=\"\",old=String.fromCharCode;String.fromCharCode=function(){s+=\"F\";return old.apply(this,arguments);};var out=__nativeDecodeUTF8(new Uint8Array([65]));return s+\":\"+out;}"
  ],
  [
    "apply-observer",
    "function(){var s=\"\",old=Function.prototype.apply;Function.prototype.apply=function(t,a){s+=\"A\";return old.call(this,t,a);};var out=__nativeDecodeUTF8(new Uint8Array([65]));return s+\":\"+out;}"
  ],
  [
    "push-observer",
    "function(){var s=\"\",old=Array.prototype.push;Array.prototype.push=function(){s+=\"P\";return old.apply(this,arguments);};var out=__nativeDecodeUTF8(new Uint8Array([65]));return s+\":\"+out;}"
  ],
  [
    "join-observer",
    "function(){var s=\"\",old=Array.prototype.join;Array.prototype.join=function(){s+=\"J\";return old.apply(this,arguments);};var out=__nativeDecodeUTF8(new Uint8Array([65]));return s+\":\"+out;}"
  ],
  [
    "String-global-getter",
    "function(){var s=\"\",old=String;Object.defineProperty(globalThis,\"String\",{get:function(){s+=\"S\";return old;}});var out=__nativeDecodeUTF8(new Uint8Array([65]));return s+\":\"+out;}"
  ],
  [
    "Error-global-getter",
    "function(){var s=\"\",old=Error;Object.defineProperty(globalThis,\"Error\",{get:function(){s+=\"E\";return old;}});try{__nativeDecodeUTF8(new Uint8Array([194]));}catch(e){return s+\":\"+e.name+\":\"+e.message;}}"
  ],
  [
    "own-bytes-length-getter",
    "function(){var s=\"\",a=new Uint8Array([65]);Object.defineProperty(a,\"length\",{get:function(){s+=\"L\";return 1;}});return __nativeDecodeUTF8(a)+\":\"+s;}"
  ],
  [
    "array-input-fallback",
    "function(){return __nativeDecodeUTF8([65,66]);}"
  ],
  [
    "subarray-offset",
    "function(){return __nativeDecodeUTF8(new Uint8Array([0,65,66,0]).subarray(1,3));}"
  ],
  [
    "local-String-shadow",
    "function(){var String={fromCharCode:function(){return \"LOCAL\";}};function __nativeDecodeUTF8(bytes){\n    var parts=[],units=[],i=0;\n    while(i<bytes.length){var a=bytes[i++],code;\n      if(a<128)code=a;\n      else if(a>=194&&a<224){if(i>=bytes.length)throw new Error('Truncated UTF8');code=((a&31)<<6)|(bytes[i++]&63);}\n      else if(a<240){if(i+1>=bytes.length)throw new Error('Truncated UTF8');code=((a&15)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63);}\n      else{if(i+2>=bytes.length)throw new Error('Truncated UTF8');code=((a&7)<<18)|((bytes[i++]&63)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63);code-=65536;units.push(55296+(code>>10));code=56320+(code&1023);}\n      units.push(code);if(units.length>=4096){parts.push(String.fromCharCode.apply(null,units));units=[];}\n    }\n    if(units.length)parts.push(String.fromCharCode.apply(null,units));return parts.join('');\n  }return __nativeDecodeUTF8(new Uint8Array([65]));}"
  ],
  [
    "source-text-unchanged",
    "function(){return __nativeDecodeUTF8.toString()===\"function __nativeDecodeUTF8(bytes){\\n    var parts=[],units=[],i=0;\\n    while(i<bytes.length){var a=bytes[i++],code;\\n      if(a<128)code=a;\\n      else if(a>=194&&a<224){if(i>=bytes.length)throw new Error('Truncated UTF8');code=((a&31)<<6)|(bytes[i++]&63);}\\n      else if(a<240){if(i+1>=bytes.length)throw new Error('Truncated UTF8');code=((a&15)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63);}\\n      else{if(i+2>=bytes.length)throw new Error('Truncated UTF8');code=((a&7)<<18)|((bytes[i++]&63)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63);code-=65536;units.push(55296+(code>>10));code=56320+(code&1023);}\\n      units.push(code);if(units.length>=4096){parts.push(String.fromCharCode.apply(null,units));units=[];}\\n    }\\n    if(units.length)parts.push(String.fromCharCode.apply(null,units));return parts.join('');\\n  }\";}"
  ],
  [
    "array-indexed-setter",
    "function(){var count=0,a=new Uint8Array([65]);Object.defineProperty(Array.prototype,\"0\",{set:function(v){count++;},configurable:true});var out=__nativeDecodeUTF8(a);return count+\":\"+out.length;}"
  ],
  [
    "own-apply-getter",
    "function(){var s=\"\",old=Function.prototype.apply;Object.defineProperty(String.fromCharCode,\"apply\",{get:function(){s+=\"G\";return old;}});return __nativeDecodeUTF8(new Uint8Array([65]))+\":\"+s;}"
  ]
];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-utf8-specialization.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-utf8-specialization');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(decodeBody+'\nvar result=('+source+')();',{mode:'script',filename:'utf8-specialization:'+name,allowUnsupported:false})}));
const encode=`fn encode(rt:&Runtime,value:Value)->String{match value{Value::Undefined=>"undefined".into(),Value::Null=>"null".into(),Value::Bool(value)=>format!("bool:{}",value),Value::Number(value)=>format!("number:{:016x}",value.to_bits()),Value::String(id)=>format!("string:{}",rt.string_units(id).iter().map(|v|format!("{:04x}",v)).collect::<String>()),other=>format!("unexpected:{:?}",other)}}`;
let rust='use js_runtime::{Runtime,Value,JsError};\n'+encode+'\n'+modules.map(item=>'mod case_'+item.index+' {\n'+item.rust+'\n}').join('\n')+'\nfn main(){\n';
for(const item of modules)rust+=`{let mut rt=Runtime::new();let env=rt.global_env;let value=case_${item.index}::run(&mut rt,env,Value::Undefined).and_then(|_|rt.lookup(env,"result"));match value{Ok(v)=>println!("ok:{}",encode(&rt,v)),Err(JsError::Throw(v))=>println!("throw:{}",encode(&rt,v)),Err(e)=>println!("runtime-error:{:?}",e)}}\n`;
rust+='}\n';await writeFile(resolve(directory,'main.rs'),rust);
const rustbin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),environment={...process.env,PATH:rustbin+':'+process.env.PATH};
const build=spawnSync(resolve(rustbin,'cargo'),['build','--release','-p','js-runtime'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stderr);
const binary=resolve(directory,'check'),rustc=resolve(rustbin,'rustc'),compileArgs=['--edition=2024','-O',resolve(directory,'main.rs'),'-L','dependency='+resolve(root,'target/release/deps'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-o',binary];
const compiled=spawnSync(rustc,compileArgs,{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n');assert.equal(actual.length,cases.length);
const view=new DataView(new ArrayBuffer(8));function encodeValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='boolean')return'bool:'+value;if(typeof value==='number'){view.setFloat64(0,value,false);return'number:'+view.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof value==='string')return'string:'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('Unsupported fixture return type '+typeof value);}
const observations=[];for(let index=0;index<cases.length;index++){const[name,source]=cases[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;runInContext(decodeBody,realm);try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}observations.push({name,source,expected,actual:actual[index],matched:expected===actual[index]});}
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'UTF8 specialization source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-utf8-specialization.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Guarded exact-source UTF8 decoder with observed mutable intrinsics, getter counts, argument prototype/offset, lexical shadowing and source text. This is a loader component gate, not battle qualification. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-utf8-specialization.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
