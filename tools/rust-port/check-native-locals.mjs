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
const cases=[
  [
    "var-hoist-undefined",
    "function(){var s=typeof x;var x;return s+\":\"+x;}"
  ],
  [
    "prefix-postfix-compound",
    "function(){var x=1,a=x++,b=++x;x+=4;x*=2;return a+\":\"+b+\":\"+x;}"
  ],
  [
    "loop-continue-finally",
    "function(){var s=0;for(var i=0;i<4;i++){try{if(i===2)continue;s+=i;}finally{s+=10;}}return s+\":\"+i;}"
  ],
  [
    "catch-finally-throw-prefix",
    "function(){var x=1;try{x=3;throw 5;}catch(e){x+=e;}finally{x*=2;}return x;}"
  ],
  [
    "catch-shadow-var-initializer",
    "function(){var x=1;try{throw 2;}catch(x){var x=3;}return x;}"
  ],
  [
    "lexical-shadow-stays-cell",
    "function(){var x=1,s=x;{let x=7;s+=x;}return x+\":\"+s;}"
  ],
  [
    "closure-capture-stays-cell",
    "function(){var x=1,f=function(){return ++x;},y=9;f();return x+\":\"+f()+\":\"+y;}"
  ],
  [
    "arrow-capture-stays-cell",
    "function(){var x=1,f=()=>++x,y=9;f();return x+\":\"+f()+\":\"+y;}"
  ],
  [
    "parameter-arguments-alias",
    "function(){function f(x){var x=2,y=7;arguments[0]=3;return x+\":\"+y;}return f(1);}"
  ],
  [
    "anonymous-assignment-name",
    "function(){var f;f=function(){};return f.name;}"
  ],
  [
    "object-destructure-var",
    "function(){var {a,b=7}={a:3},s=a+b;return s;}"
  ],
  [
    "for-in-var",
    "function(){var s=\"\";for(var k in {a:1,b:2})s+=k;return s+\":\"+k;}"
  ],
  [
    "for-of-var",
    "function(){var s=0;for(var n of [2,3,4])s+=n;return s+\":\"+n;}"
  ],
  [
    "delete-local-var-false",
    "function(){var x=7;return (delete x)+\":\"+x;}"
  ],
  [
    "direct-eval-conservative-skip",
    "function(){var x=7;if(false)eval(\"x=8\");return x;}"
  ],
  [
    "returned-captured-closure",
    "function(){function f(){var x=7,y=9;return function(){return ++x+y;};}var g=f();return g()+\":\"+g();}"
  ],
  [
    "binary-left-snapshot",
    "function(){var x=1,y=x+(x=2);return y+\":\"+x;}"
  ],
  [
    "compound-old-snapshot",
    "function(){var x=1;x+=(x=2);return x;}"
  ],
  [
    "update-and-assignment-snapshot",
    "function(){var x=1,y=x+++(x=7);x=x++ + x;return y+\":\"+x;}"
  ]
].flatMap(([name,source])=>[[name+":native",source],[name+":cells",source]]);
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-native-locals.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-native-locals');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(source,{mode:'function',filename:'native-locals:'+name,allowUnsupported:false,nativeLocalBindings:name.endsWith(':native')})}));
const encode=`fn encode(rt:&Runtime,value:Value)->String{match value{Value::Undefined=>"undefined".into(),Value::Null=>"null".into(),Value::Bool(value)=>format!("bool:{}",value),Value::Number(value)=>format!("number:{:016x}",value.to_bits()),Value::String(id)=>format!("string:{}",rt.string_units(id).iter().map(|v|format!("{:04x}",v)).collect::<String>()),other=>format!("unexpected:{:?}",other)}}`;
let rust='use js_runtime::{Runtime,Value,JsError};\n'+encode+'\n'+modules.map(item=>'mod case_'+item.index+' {\n'+item.rust+'\n}').join('\n')+'\nfn main(){\n';
for(const item of modules)rust+=`{let mut rt=Runtime::new();let env=rt.global_env;let value=case_${item.index}::create_function(&mut rt,env).and_then(|f|rt.call_value(f,Value::Undefined,&[]));match value{Ok(v)=>println!("ok:{}",encode(&rt,v)),Err(JsError::Throw(v))=>println!("throw:{}",encode(&rt,v)),Err(e)=>println!("runtime-error:{:?}",e)}}\n`;
rust+='}\n';await writeFile(resolve(directory,'main.rs'),rust);
const rustbin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),environment={...process.env,PATH:rustbin+':'+process.env.PATH};
const build=spawnSync(resolve(rustbin,'cargo'),['build','--release','-p','js-runtime'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stderr);
const binary=resolve(directory,'check'),rustc=resolve(rustbin,'rustc'),compileArgs=['--edition=2024','-O',resolve(directory,'main.rs'),'-L','dependency='+resolve(root,'target/release/deps'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-o',binary];
const compiled=spawnSync(rustc,compileArgs,{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n');assert.equal(actual.length,cases.length);
const view=new DataView(new ArrayBuffer(8));function encodeValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='boolean')return'bool:'+value;if(typeof value==='number'){view.setFloat64(0,value,false);return'number:'+view.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof value==='string')return'string:'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('Unsupported fixture return type '+typeof value);}
const observations=[];for(let index=0;index<cases.length;index++){const[name,source]=cases[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}observations.push({name,source,expected,actual:actual[index],matched:expected===actual[index]});}
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'Native local source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-native-locals.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,nativeBindings:modules.map(m=>({name:m.name,bindings:m.manifest.functions.map(f=>f.nativeBindings)})),cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Native Rust var locals versus environment cells and pinned source JS, preserving hoisting, captures, shadows, arguments aliases, assignments and abrupt completions. No battle throughput qualification. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-native-locals.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
