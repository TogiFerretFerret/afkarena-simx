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
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags))throw Error('Use pinned oracle: node --jitless tools/rust-port/check-generated-resources.mjs');
const at=process.argv.indexOf('--cases'),count=at<0?20000:Number(process.argv[at+1]);assert.ok(Number.isSafeInteger(count)&&count>=1);
const meta=JSON.parse(await readFile(resolve(root,'config/unit-resources-translation.json'))),original=await readFile(resolve(root,meta.source),'utf8');const bodies=meta.functions.map(pin=>{const body=original.slice(pin.start,pin.end);assert.equal(sha(body),pin.sha256);return body;});
// All fixture methods below also pass through Babel -> Rust. The four game
// methods are injected byte-for-byte, not manually reimplemented by this gate.
const source=`function(op,flags,fail,ta,tb,desired,hp,mp,maximum,lastTick,tick,secondMaximum){
 var events=[],sentinel={},last=lastTick,reads=0,targetReads=0,u={id:0,hp:hp,mp:mp},other={id:1};
 function event(kind,detail){events[events.length]=[kind,u.hp,u.mp,last,detail];if(events.length===fail)throw sentinel;}
 function log(kind){event(kind);if(flags&16){u.hp=66;u.mp=77;}}
 function max(kind){reads++;event(kind+':'+reads);if(flags&2)u.mp=5;if(flags&4)u.hp=-9;return(flags&8)&&reads>1?secondMaximum:maximum;}
 function target(kind){targetReads++;event(kind+':'+targetReads);return[null,other,void 0,u][targetReads>1?tb:ta];}
 var ed={btLog:{setMP:function(){log('log-mp');},setHp:function(){log('log-hp');}},battleEngine:{get ticks(){event('ticks');if(flags&128)u.hp=13;return tick;}}};
 u.info={get MP(){return max('max-mp');}};u.attribs={get HP(){return max('max-hp');}};
 u.buff_effects={get noAddMp(){event('no-add');if(flags&256)u.mp=42;return!!(flags&1);},get transferHeal(){event('enable-heal');return!!(flags&32);},get transferMp(){event('enable-mp');return!!(flags&32);}};
 u.buffEffectsRelated={get transferHeal(){return target('target-heal');},get transferMp(){return target('target-mp');}};
 var lastObject={get value(){return last;},set value(v){event('last',v);last=v;if(flags&512)u.hp=14;}};
 // The source setHp writes this property. Accessors are ordinary compiled JS
 // syntax too; no Rust test hook implements the property behavior.
 u={id:0,hp:hp,mp:mp,info:u.info,attribs:u.attribs,buff_effects:u.buff_effects,buffEffectsRelated:u.buffEffectsRelated,get lastHpChangeTick(){return lastObject.value;},set lastHpChangeTick(v){lastObject.value=v;}};
 var methods=[${bodies.join(',')}],result=null,error=null;
 try{var value=methods[op].call(u,desired,u);result=value===null?'null':value===void 0?'undefined':'value:'+value.id;}catch(e){if(e!==sentinel)throw e;error='sentinel';}
 return[events,[u.hp,u.mp,last],result,error];
}`;
const compiled=compileSource(source,{filename:'source-resource-fixture.js',mode:'function',allowUnsupported:false});
const work=resolve(root,'work/rust-port-resources');await mkdir(work,{recursive:true});await writeFile(resolve(work,'generated.rs'),compiled.rust);await writeFile(resolve(work,'source.js'),source);await writeFile(resolve(work,'manifest.json'),JSON.stringify(compiled.manifest,null,2)+'\n');
const harness=`use js_runtime::{Runtime,Value,EnvId,JsError,JsResult};
use std::io::{self,BufRead,Write};
#[path=${rustString(resolve(work,'generated.rs'))}]mod generated;
fn encode(rt:&mut Runtime,value:Value,depth:usize)->JsResult<String>{if depth>32{return Err(JsError::Unsupported("fixture encoding depth".into()))}Ok(match value{
 Value::Undefined=>"[\\\"undefined\\\"]".into(),Value::Null=>"[\\\"null\\\"]".into(),Value::Bool(v)=>format!("[\\\"bool\\\",{}]",v),Value::Number(v)=>format!("[\\\"number\\\",\\\"{:016x}\\\"]",v.to_bits()),Value::String(id)=>format!("[\\\"string\\\",[{}]]",rt.string_units(id).iter().map(|v|v.to_string()).collect::<Vec<_>>().join(",")),Value::Object(_)=>{let key=rt.string("length");let n=rt.get(value,key)?;let Value::Number(n)=n else{return Err(JsError::Unsupported("fixture result must be dense array".into()))};let mut values=vec![];for i in 0..n as usize{let key=rt.string(&i.to_string());let item=rt.get(value,key)?;values.push(encode(rt,item,depth+1)?)}format!("[\\\"array\\\",[{}]]",values.join(","))},_=>return Err(JsError::Unsupported("fixture result cannot contain functions".into()))})}
fn main()->io::Result<()>{let stdin=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());for line in stdin.lock().lines(){let line=line?;let mut words=line.split_whitespace();let mut args=vec![];for _ in 0..5{args.push(Value::Number(words.next().unwrap().parse::<usize>().unwrap()as f64))}for _ in 0..7{args.push(Value::Number(f64::from_bits(u64::from_str_radix(words.next().unwrap(),16).unwrap())))}assert!(words.next().is_none());let mut rt=Runtime::new();rt.install_function_builtins().unwrap();let env=rt.global_env;let function=generated::create_function(&mut rt,env).unwrap();let result=rt.call(function,Value::Undefined,&args);match result{Ok(value)=>writeln!(out,"{}",encode(&mut rt,value,0).unwrap())?,Err(error)=>{eprintln!("generated error: {:?}",error);std::process::exit(2)}}}out.flush()}
`;
await writeFile(resolve(work,'main.rs'),harness);
async function rustFiles(directory){const files=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+row.name;if(row.isDirectory())files.push(...await rustFiles(file));else if(file.endsWith('.rs'))files.push(file);}return files;}
const tracked=[...await rustFiles('crates/js-runtime/src'),...await rustFiles('crates/battle-core/src'),'tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-generated-resources.mjs','Cargo.toml','Cargo.lock','crates/js-runtime/Cargo.toml','config/unit-resources-translation.json','config/source-oracle-runtime.json',meta.source],sources={};for(const file of tracked)sources[file]=sha(await readFile(resolve(root,file)));
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),cargo=resolve(rustBin,'cargo'),rustc=resolve(rustBin,'rustc');
function run(command,args,options={}){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,env:{...process.env,PATH:rustBin+':'+process.env.PATH,RUSTC:rustc},...options});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result;}
const buildArgs=['build','--release','-p','js-runtime','--locked','--offline'],build=run(cargo,buildArgs);await writeFile(resolve(work,'cargo.stderr'),build.stderr);
const binary=resolve(work,'check'),compileArgs=['--edition=2024','-O',resolve(work,'main.rs'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-L','dependency='+resolve(root,'target/release/deps'),'-o',binary],native=run(rustc,compileArgs);await writeFile(resolve(work,'rustc.stderr'),native.stderr);
const buffer=new ArrayBuffer(8),view=new DataView(buffer),bits=value=>{view.setFloat64(0,value,false);return view.getBigUint64(0,false).toString(16).padStart(16,'0');},number=text=>{view.setBigUint64(0,BigInt('0x'+text),false);return view.getFloat64(0,false);};
let seed=0x8930b7e1;const next=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)%n;};const values=[0,-0,1,-1,100,-100,.125,.1,1000,Infinity,-Infinity,number('7ff8000000000000'),number('fff8000000000000'),number('7ff8000000001234')].map(bits);
const cases=Array.from({length:count},()=>({op:next(4),flags:next(1024),fail:next(7),ta:next(4),tb:next(4),n:Array.from({length:7},()=>values[next(values.length)])}));
const input=cases.map(c=>[c.op,c.flags,c.fail,c.ta,c.tb,...c.n].join(' ')).join('\n')+'\n',execution=run(binary,[],{input});await writeFile(resolve(work,'actual.stdout'),execution.stdout);const actual=execution.stdout.trim().split('\n').map(line=>JSON.parse(line));assert.equal(actual.length,cases.length);
const realm=createContext(constants.DONT_CONTEXTIFY),oracle=runInContext('('+source+')',realm);function encode(value){if(value===undefined)return['undefined'];if(value===null)return['null'];if(typeof value==='boolean')return['bool',value];if(typeof value==='number')return['number',bits(value)];if(typeof value==='string')return['string',Array.from({length:value.length},(_,i)=>value.charCodeAt(i))];if(Array.isArray(value))return['array',Array.from(value,encode)];throw Error('Unsupported oracle fixture result');}
const expected=[];for(let i=0;i<cases.length;i++){const c=cases[i],value=encode(oracle(c.op,c.flags,c.fail,c.ta,c.tb,...c.n.map(number)));if(JSON.stringify(value)!==JSON.stringify(actual[i])){await writeFile(resolve(root,'benchmarks/validation/generated-rust-resources-failure.json'),JSON.stringify({passed:false,index:i,input:c,expected:value,actual:actual[i]},null,2)+'\n');throw Error('Generated Rust resource first difference case '+i);}expected.push(value);}
for(const[file,hash]of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),hash,'Source changed during build/run: '+file);
const artifacts=[];for(const[name,bytes]of[['input',Buffer.from(input)],['actual',Buffer.from(execution.stdout)],['expected',Buffer.from(expected.map(v=>JSON.stringify(v)).join('\n')+'\n')],['generated',Buffer.from(compiled.rust)],['harness',Buffer.from(harness)],['source',Buffer.from(source)],['manifest',Buffer.from(JSON.stringify(compiled.manifest))]]){const file='benchmarks/validation/generated-rust-resources.'+name+'.gz';await writeFile(resolve(root,file),gzipSync(bytes,{level:9}));artifacts.push({file,sha256:sha(await readFile(resolve(root,file))),uncompressedSha256:sha(bytes)});}
const report={version:1,passed:true,cases:count,originalSourceFunctions:meta.functions,compileManifest:compiled.manifest,sources,sourcesUnchangedThroughoutBuildAndRun:true,oracleProfile:profile,rustc:{path:rustc,sha256:sha(await readFile(rustc)),args:compileArgs},cargo:{path:cargo,sha256:sha(await readFile(cargo)),args:buildArgs},binarySha256:sha(await readFile(binary)),artifacts,scope:'Actual source base Unit setMp/setHp/transfer methods and all fixture callbacks compiled by Babel into pure Rust and executed without any JS backend. Cases compare exact returned snapshots, numeric bits, getter/log order and thrown sentinel identity through source catches. This is a generated-code component gate, not whole-battle equivalence or throughput.',qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/generated-rust-resources.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:count,compiledFunctions:compiled.manifest.compiledFunctions}));
