import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compileSource,rustString} from './compile.mjs';

const root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex'),profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags))throw Error('Use pinned oracle: node --jitless tools/rust-port/check-generated-binary.mjs');
const at=process.argv.indexOf('--cases'),count=at<0?20000:Number(process.argv[at+1]);assert.ok(Number.isSafeInteger(count)&&count>=1);
const split=process.argv.includes('--split');
const meta={source:'tools/emit-native-oracle.mjs',functions:[]},original=await readFile(resolve(root,meta.source),'utf8');
const start=original.indexOf('function __nativeBits('),end=original.indexOf('\nfunction __nativePrimitiveState',start);assert.ok(start>=0&&end>start);const bitsBody=original.slice(start,end);meta.functions.push({name:'__nativeBits',start,end,sha256:sha(bitsBody)});
const source=`function(op,kind,flags,fail,index,value){
 var events=[],sentinel={},buffer=new ArrayBuffer(24),full=new DataView(buffer),offset=((flags>>6)&1)*4,length=flags&128?8:16;
 for(var i=0;i<24;i++)full.setUint8(i,(i*17+31)&255);full.setFloat64(8,value,true);
 var view=new DataView(buffer,offset,length),error=null,result=null;
 ${bitsBody}
 function log(name){events[events.length]=name;}
 var ix={valueOf:function(){log('index');if(fail===1)throw sentinel;if(flags&2)full.setUint8(0,99);return index;}},number={valueOf:function(){log('value');if(fail===2)throw sentinel;if(flags&4)full.setUint8(1,77);return value;}};
 var little=flags&8?{valueOf:function(){log('little');return false;}}:!!(flags&1);
 var names=['Int8','Uint8','Int16','Uint16','Int32','Uint32','Float32','Float64'];
 try{
  if(op===0)result=__nativeBits(DataView.prototype['get'+names[kind]].call(flags&256?{}:view,ix,little));
  else if(op===1)DataView.prototype['set'+names[kind]].call(flags&256?{}:view,ix,number,little);
  else if(op===2){var made=new DataView(buffer,ix,number);result=[made.byteOffset,made.byteLength,made.buffer===buffer];}
  else if(op===3)result=(new ArrayBuffer(ix)).byteLength;
  else{var Target=(function(){}).bind(null);Object.defineProperty(Target,'prototype',{get:function(){log('prototype');if(flags&32)full.setUint8(2,55);return(op===4?DataView:ArrayBuffer).prototype;}});if(op===4){var made=Reflect.construct(DataView,[buffer,ix,number],Target);result=[made.byteOffset,made.byteLength,made.buffer===buffer];}else result=Reflect.construct(ArrayBuffer,[ix],Target).byteLength;}
 }catch(e){error=e===sentinel?'sentinel':e.name;}
 var bytes=[];for(var i=0;i<24;i++)bytes[i]=full.getUint8(i);return[events,bytes,result,error];
}`;
const compiled=compileSource(source,{largeBody:split?{minimumNodes:1,maxNodes:128,maxStatements:4,maxInitGroups:8}:false,filename:'source-binary-fixture.js',mode:'function',allowUnsupported:false,sourcePoolPath:'source.utf16le'});
const work=resolve(root,'work/rust-port-binary');await mkdir(work,{recursive:true});await writeFile(resolve(work,'generated.rs'),compiled.rust);await writeFile(resolve(work,'source.utf16le'),compiled.sourcePool);await writeFile(resolve(work,'source.js'),source);await writeFile(resolve(work,'manifest.json'),JSON.stringify(compiled.manifest,null,2)+'\n');
const harness=`use js_runtime::{Runtime,Value,EnvId,JsError,JsResult};
use std::io::{self,BufRead,Write};
#[path=${rustString(resolve(work,'generated.rs'))}]mod generated;
fn encode(rt:&mut Runtime,value:Value,depth:usize)->JsResult<String>{if depth>32{return Err(JsError::Unsupported("fixture encoding depth".into()))}Ok(match value{
 Value::Undefined=>"[\\\"undefined\\\"]".into(),Value::Null=>"[\\\"null\\\"]".into(),Value::Bool(v)=>format!("[\\\"bool\\\",{}]",v),Value::Number(v)=>format!("[\\\"number\\\",\\\"{:016x}\\\"]",v.to_bits()),Value::String(id)=>format!("[\\\"string\\\",[{}]]",rt.string_units(id).iter().map(|v|v.to_string()).collect::<Vec<_>>().join(",")),Value::Object(_)=>{let key=rt.string("length");let n=rt.get(value,key)?;let Value::Number(n)=n else{return Err(JsError::Unsupported("fixture result must be dense array".into()))};let mut values=vec![];for i in 0..n as usize{let key=rt.string(&i.to_string());let item=rt.get(value,key)?;values.push(encode(rt,item,depth+1)?)}format!("[\\\"array\\\",[{}]]",values.join(","))},_=>return Err(JsError::Unsupported("fixture result cannot contain functions".into()))})}
fn main()->io::Result<()>{let stdin=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());for line in stdin.lock().lines(){let line=line?;let mut words=line.split_whitespace();let mut args=vec![];for _ in 0..4{args.push(Value::Number(words.next().unwrap().parse::<usize>().unwrap()as f64))}for _ in 0..2{args.push(Value::Number(f64::from_bits(u64::from_str_radix(words.next().unwrap(),16).unwrap())))}assert!(words.next().is_none());let mut rt=Runtime::new();rt.install_function_builtins().unwrap();let env=rt.global_env;let function=generated::create_function(&mut rt,env).unwrap();let result=rt.call(function,Value::Undefined,&args);match result{Ok(value)=>writeln!(out,"{}",encode(&mut rt,value,0).unwrap())?,Err(error)=>{eprintln!("generated error: {:?}",error);std::process::exit(2)}}}out.flush()}
`;
await writeFile(resolve(work,'main.rs'),harness);
async function rustFiles(directory){const files=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+row.name;if(row.isDirectory())files.push(...await rustFiles(file));else if(file.endsWith('.rs')||row.name==='Cargo.toml')files.push(file);}return files;}
const tracked=[...await rustFiles('third-party'),...await rustFiles('crates/js-runtime/src'),...await rustFiles('crates/battle-core/src'),'tools/rust-port/compile.mjs','tools/rust-port/bindings.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-generated-binary.mjs','Cargo.toml','Cargo.lock','crates/js-runtime/Cargo.toml','config/source-oracle-runtime.json',meta.source],sources={};for(const file of tracked)sources[file]=sha(await readFile(resolve(root,file)));
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),cargo=resolve(rustBin,'cargo'),rustc=resolve(rustBin,'rustc'),cargoSha256=sha(await readFile(cargo)),rustcSha256=sha(await readFile(rustc));
function run(command,args,options={}){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,env:{...process.env,PATH:rustBin+':'+process.env.PATH,RUSTC:rustc},...options});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result;}
const buildArgs=['build','--release','-p','js-runtime','--locked','--offline'],build=run(cargo,buildArgs);await writeFile(resolve(work,'cargo.stderr'),build.stderr);
const binary=resolve(work,'check'),compileArgs=['--edition=2024','-O',resolve(work,'main.rs'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-L','dependency='+resolve(root,'target/release/deps'),'-o',binary],native=run(rustc,compileArgs);await writeFile(resolve(work,'rustc.stderr'),native.stderr);
const buffer=new ArrayBuffer(8),view=new DataView(buffer),bits=value=>{view.setFloat64(0,value,false);return view.getBigUint64(0,false).toString(16).padStart(16,'0');},number=text=>{view.setBigUint64(0,BigInt('0x'+text),false);return view.getFloat64(0,false);};
let seed=0x983a7e91;const next=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)%n;};
// Keep NaNs as raw hex strings: placing them in a packed Number array first
// would quiet signaling payloads inside the oracle before they reach the test.
const numbers=[0,-0,1,-1,.5,-.5,3,4,8,15,16,20,24,31,100,-100,.125,.1,Infinity,-Infinity].map(bits).concat(['7ff0000000000001','7ff4000000000000','fff0000000001234','7ff8000000000000','fff8000000000000','7ff8000000001234','fff8000000001234']);
const indices=[0,-0,1,3,4,8,15,16,24,-1,-.5,.5,Infinity,-Infinity,NaN].map(bits);
const cases=Array.from({length:count},()=>({op:next(6),kind:next(8),flags:next(512),fail:next(3),index:indices[next(indices.length)],value:numbers[next(numbers.length)]}));
const binarySha256=sha(await readFile(binary));
const input=cases.map(c=>[c.op,c.kind,c.flags,c.fail,c.index,c.value].join(' ')).join('\n')+'\n',execution=run(binary,[],{input});await writeFile(resolve(work,'actual.stdout'),execution.stdout);const actual=execution.stdout.trim().split('\n').map(line=>JSON.parse(line));assert.equal(actual.length,cases.length);
const realm=createContext(constants.DONT_CONTEXTIFY),oracle=runInContext('('+source+')',realm);function encode(value){if(value===undefined)return['undefined'];if(value===null)return['null'];if(typeof value==='boolean')return['bool',value];if(typeof value==='number')return['number',bits(value)];if(typeof value==='string')return['string',Array.from({length:value.length},(_,i)=>value.charCodeAt(i))];if(Array.isArray(value))return['array',Array.from(value,encode)];throw Error('Unsupported oracle fixture result');}
const expected=[];for(let i=0;i<cases.length;i++){const c=cases[i],value=encode(oracle(c.op,c.kind,c.flags,c.fail,number(c.index),number(c.value)));if(JSON.stringify(value)!==JSON.stringify(actual[i])){await writeFile(resolve(root,'benchmarks/validation/generated-rust-binary-failure.json'),JSON.stringify({passed:false,index:i,input:c,expected:value,actual:actual[i]},null,2)+'\n');throw Error('Generated Rust resource first difference case '+i);}expected.push(value);}
assert.equal(sha(await readFile(binary)),binarySha256,'Native binary changed during execution');assert.equal(sha(await readFile(cargo)),cargoSha256,'Cargo changed');assert.equal(sha(await readFile(rustc)),rustcSha256,'Rust compiler changed');assert.equal(sha(await readFile(resolve(work,'generated.rs'))),sha(compiled.rust),'Generated Rust changed');assert.equal(sha(await readFile(resolve(work,'source.utf16le'))),sha(compiled.sourcePool),'Source pool changed');assert.equal(sha(await readFile(resolve(work,'main.rs'))),sha(harness),'Native harness changed');
for(const[file,hash]of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),hash,'Source changed during build/run: '+file);
const artifacts=[];for(const[name,bytes]of[['input',Buffer.from(input)],['actual',Buffer.from(execution.stdout)],['expected',Buffer.from(expected.map(v=>JSON.stringify(v)).join('\n')+'\n')],['generated',Buffer.from(compiled.rust)],['source-pool',compiled.sourcePool],['harness',Buffer.from(harness)],['source',Buffer.from(source)],['manifest',Buffer.from(JSON.stringify(compiled.manifest))]]){const file='benchmarks/validation/generated-rust-binary.'+name+'.gz';await writeFile(resolve(root,file),gzipSync(bytes,{level:9}));artifacts.push({file,sha256:sha(await readFile(resolve(root,file))),uncompressedSha256:sha(bytes)});}
const report={version:2,passed:true,cases:count,numberBitsCorpus:numbers,nanCorpusConstruction:'Raw hexadecimal strings without prior numeric-array storage',splitNativeBodies:split,originalSourceFunctions:meta.functions,compileManifest:compiled.manifest,sources,sourcesUnchangedThroughoutBuildAndRun:true,oracleProfile:profile,rustc:{path:rustc,sha256:rustcSha256,args:compileArgs},cargo:{path:cargo,sha256:cargoSha256,args:buildArgs},binarySha256,artifacts,scope:'Actual copied oracle __nativeBits helper, DataView/ArrayBuffer constructors and all numeric endian get/set methods compiled through Babel into Rust without a JS execution backend. Compares byte snapshots, exact hexadecimal float bits, coercion/getter/derived-prototype order, view identity/windows and source sentinel exception prefixes. This is a binary-data component gate, not whole-battle or unrestricted JS qualification.',qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/generated-rust-binary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:count,compiledFunctions:compiled.manifest.compiledFunctions}));
