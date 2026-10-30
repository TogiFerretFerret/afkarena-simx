import {readFile,writeFile as rawWriteFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
import {proveBattleGcProfile} from './battle-gc-proof.mjs';

const root=resolve(import.meta.dirname,'../..');
const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const through=Number(option('--through','0'));
const chunkSize=Number(option('--chunk-size','100'));
const nativeBattleGcCadence=Number(option('--gc-cadence','1'));
assert.ok(Number.isSafeInteger(nativeBattleGcCadence)&&nativeBattleGcCadence>0,'--gc-cadence must be a positive safe integer');
assert.ok(Number.isInteger(through)&&through>=0&&through<=6);
assert.ok(Number.isInteger(chunkSize)&&chunkSize>0);
const output=resolve(root,option('--out','work/rust-battle-program'));
const coverage=JSON.parse(await readFile(resolve(root,'benchmarks/validation/rust-battle-compile-coverage.json')));
const gcProof=through===6&&!args.includes('--no-battle-gc')
 ?proveBattleGcProfile(coverage,await Promise.all(coverage.units.map(unit=>readFile(unit.file))))
 :{passed:false,reason:'Collection is disabled for partial or explicitly uncollected programs'};
const nativeBattleGc=through===6&&!args.includes('--no-battle-gc')&&gcProof.passed;
const sha=b=>createHash('sha256').update(b).digest('hex');
async function writeFile(file,contents){
 const bytes=Buffer.isBuffer(contents)?contents:Buffer.from(contents);
 try{if((await readFile(file)).equals(bytes))return;}catch(error){if(error.code!=='ENOENT')throw error;}
 await rawWriteFile(file,bytes);
}
const runtimePath=relative(output,resolve(root,'crates/js-runtime')).replaceAll('\\','/');
const members=['app'];
const reports=[];
// Group strongly connected native helpers, then form small dependency-ordered
// crates. Splitting files inside one crate does not bound rustc frontend memory.
function partition(functions,maxCount,maxBytes=384*1024){
 const nodes=functions.map(row=>({...row,name:row.name??/^pub fn (\w+)\(/m.exec(row.rust)?.[1]}));
 assert.ok(nodes.every(n=>n.name));const byName=new Map(nodes.map(n=>[n.name,n]));
 for(const node of nodes)node.refs=[...new Set((node.rust.match(/\b[A-Za-z_][A-Za-z_0-9]*\b/g)??[]).filter(name=>name!==node.name&&byName.has(name)))];
 let index=0;const stack=[],components=[];
 function visit(node){node.index=index;node.low=index++;node.onStack=true;stack.push(node);
  for(const name of node.refs){const child=byName.get(name);if(child.index===undefined){visit(child);node.low=Math.min(node.low,child.low);}else if(child.onStack)node.low=Math.min(node.low,child.index);}
  if(node.low===node.index){const component=[];let child;do{child=stack.pop();child.onStack=false;component.push(child);}while(child!==node);components.push(component);}
 }
 for(const node of nodes)if(node.index===undefined)visit(node);
 const groups=[];let current=[],bytes=0;
 for(const component of components){const size=component.reduce((n,row)=>n+Buffer.byteLength(row.rust),0);if(current.length&&(current.length+component.length>maxCount||bytes+size>maxBytes)){groups.push(current);current=[];bytes=0;}current.push(...component);bytes+=size;}
 if(current.length)groups.push(current);
 const owner=new Map();groups.forEach((group,id)=>group.forEach(node=>owner.set(node.name,id)));
 return{groups,owner};
}
for(const unit of coverage.units.slice(0,through+1)){
 const sourceBytes=await readFile(unit.file);assert.equal(sha(sourceBytes),unit.sha256,'Frozen battle input changed');
 const name=`battle-unit-${unit.index}`,directory=resolve(output,name),src=resolve(directory,'src');
 await mkdir(src,{recursive:true});
 const result=compileSource(sourceBytes.toString('utf8'),{filename:unit.file,mode:'script',moduleName:`battle_unit_${unit.index}`,sourcePoolPath:'source.utf16le',nativeBattleGc,nativeBattleGcCadence,largeBody:{maxStatements:24,maxEstimatedNodes:600}});
 const poolName=`${name}-source`,pool=resolve(output,poolName);await mkdir(resolve(pool,'src'),{recursive:true});
 await writeFile(resolve(pool,'src/source.utf16le'),result.sourcePool);
 await writeFile(resolve(pool,'src/lib.rs'),'pub static __JS_SOURCE_POOL: &[u8] = include_bytes!("source.utf16le");\n');
 await writeFile(resolve(pool,'Cargo.toml'),`[package]\nname="${poolName}"\nversion="0.1.0"\nedition="2024"\n`);members.push(poolName);
 const lowered=[...result.functions,...(result.helpers??[])],{groups,owner}=partition(lowered,chunkSize);
 const groupName=id=>`${name}-part-${String(id).padStart(4,'0')}`;
 for(let id=0;id<groups.length;id++){
  const group=groups[id],part=groupName(id),partDir=resolve(output,part);await mkdir(resolve(partDir,'src'),{recursive:true});
  const references=new Map();for(const fn of group)for(const ref of fn.refs){const target=owner.get(ref);if(target!==id){if(!references.has(target))references.set(target,new Set());references.get(target).add(ref);}}
  const imports=[...references].map(([target,names])=>`use ${groupName(target).replaceAll('-','_')}::{${[...names].join(',')}};`).join('\n');
  const header='#![allow(unused_imports,unused_variables,unused_mut,unused_assignments,dead_code,unreachable_patterns)]\nuse js_runtime::{Runtime,Value,EnvId,JsResult,JsError,Completion,BinaryOp,UnaryOp};\n';
  await writeFile(resolve(partDir,'src/lib.rs'),header+`use ${poolName.replaceAll('-','_')}::__JS_SOURCE_POOL;\n`+imports+'\n'+group.map(row=>row.rust).join('\n\n')+'\n');
  const deps=[`js-runtime={path="${relative(partDir,resolve(root,'crates/js-runtime')).replaceAll('\\','/')}"}`,`${poolName}={path="../${poolName}"}`,...[...references.keys()].map(target=>`${groupName(target)}={path="../${groupName(target)}"}`)];
  await writeFile(resolve(partDir,'Cargo.toml'),`[package]\nname="${part}"\nversion="0.1.0"\nedition="2024"\n[dependencies]\n${deps.join('\n')}\n`);members.push(part);
 }
 const entryOwner=owner.get('js_function_0');assert.notEqual(entryOwner,undefined);
 await writeFile(resolve(src,'lib.rs'),'use js_runtime::{Runtime,Value,EnvId,JsResult};\n'+`use ${groupName(entryOwner).replaceAll('-','_')}::js_function_0;\n`+result.entry+'\n');
 await writeFile(resolve(directory,'Cargo.toml'),`[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\npublish = false\n[dependencies]\njs-runtime = { path = "${relative(directory,resolve(root,'crates/js-runtime')).replaceAll('\\','/')}" }\n${groupName(entryOwner)}={path="../${groupName(entryOwner)}"}\n`);
 await writeFile(resolve(directory,'manifest.json'),JSON.stringify(result.manifest,null,2)+'\n');
 members.push(name);
 reports.push({index:unit.index,file:unit.file,sourceSha256:unit.sha256,functions:result.manifest.functions.length,scalarLocalArrays:result.manifest.functions.reduce((n,f)=>n+(f.scalarLocalArrays?.length??0),0),scalarArrayFunctions:result.manifest.functions.filter(f=>f.scalarLocalArrays?.length).map(f=>({id:f.id,sourceSha256:f.sourceSha256,arrays:f.scalarLocalArrays})),compiledFunctions:result.manifest.compiledFunctions,unsupportedFunctions:result.manifest.unsupportedFunctions,helperFunctions:result.helpers?.length??0,crates:groups.length,rustBytes:lowered.reduce((n,f)=>n+Buffer.byteLength(f.rust),0),largestNativeFunctionBytes:Math.max(...lowered.map(f=>Buffer.byteLength(f.rust))),sourcePoolBytes:result.sourcePool.length});
 console.log(JSON.stringify(reports.at(-1)));
}
const app=resolve(output,'app');await mkdir(resolve(app,'src'),{recursive:true});
await writeFile(resolve(app,'src/program_host.rs'),await readFile(resolve(root,'tools/rust-port/program-host.rs')));
const dependencies=[`js-runtime = { path = "${relative(app,resolve(root,'crates/js-runtime')).replaceAll('\\','/')}" }`,...reports.map(r=>`battle-unit-${r.index} = { path = "../battle-unit-${r.index}" }`)];
await writeFile(resolve(app,'Cargo.toml'),'[package]\nname = "rust-battle-program"\nversion = "0.1.0"\nedition = "2024"\npublish = false\n[dependencies]\n'+dependencies.join('\n')+'\n');
const calls=reports.map(r=>`${r.index===6?'program_host::install_measured_copy_clock(&mut rt)?;\n':''}eprintln!("unit_start:${r.index}");\n let phase_start=std::time::Instant::now();\n battle_unit_${r.index}::run(&mut rt, env, global)?;\n eprintln!("unit_finished:${r.index}");\n eprintln!("unit_elapsed_ms:${r.index}:{}",phase_start.elapsed().as_secs_f64()*1000.0);`).join('\n');
await writeFile(resolve(app,'src/main.rs'),`mod program_host;
use js_runtime::{Runtime,Value,EnvId,JsResult};
fn print(rt:&mut Runtime,_this:Value,args:&[Value],_env:EnvId)->JsResult<Value>{
 let mut parts=Vec::new();for &arg in args{let id=rt.to_string(arg)?;parts.push(String::from_utf16_lossy(rt.string_units(id)));}
 println!("{}",parts.join(" "));Ok(Value::Undefined)
}
fn execute()->JsResult<Value>{
 let mut rt=Runtime::new();let env=rt.global_env;let global=Value::Object(rt.global_object);
 ${nativeBattleGc?'rt.enable_native_battle_gc();':''}
 program_host::install(&mut rt)?;
 let printer=rt.make_closure_with_flags(print,env,0,"print",true,None);
 rt.declare(env,"print",printer)?;
 ${calls}
 eprintln!("native_fastpath_admission:battle_mode_limit:{}:{}:buff_percent:{}:{}",rt.battle_mode_limit_attempts,rt.battle_mode_limit_hits,rt.buff_percent_loop_attempts,rt.buff_percent_loop_hits);
 eprintln!("native_domain_admission:battle_mode_limit:{}:getter_calls:{}",rt.battle_mode_limit_domain_hits,rt.battle_mode_limit_getter_calls);
 eprintln!("native_runtime_config:primary_numeric_access:{}:battle_mode_limit:{}",rt.primary_numeric_access_enabled,rt.native_battle_mode_limit_enabled);
 Ok(Value::Undefined)
}
fn main(){if let Err(error)=execute(){eprintln!("pure_rust_execution_error:{error:?}");std::process::exit(1);}}
`);
await writeFile(resolve(output,'Cargo.toml'),'[workspace]\nmembers = '+JSON.stringify(members)+'\nresolver = "2"\n[profile.dev]\ndebug = 0\ncodegen-units = 64\n[profile.release]\ncodegen-units = 64\nlto = false\n');
const sources={};for(const file of ['tools/rust-port/generate-program.mjs','tools/rust-port/battle-gc-proof.mjs','tools/rust-port/program-host.rs','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/bindings.mjs','tools/rust-port/scalar-arrays.mjs'])sources[file]=sha(await readFile(resolve(root,file)));
const manifest={version:1,prepared:true,executed:false,qualifiesFor10000Target:false,output,through,chunkSize,nativeBattleGc,nativeBattleGcCadence,gcProof,units:reports,sources,runtimePath,scope:'Actual frozen battle JavaScript modules lowered into native Rust functions with shared global environment and static UTF16 source pools. Preparation and compile coverage do not establish successful initialization, mechanics parity, or throughput.'};
await writeFile(resolve(output,'program-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,units:reports.length,functions:reports.reduce((n,u)=>n+u.functions,0),unsupported:reports.reduce((n,u)=>n+u.unsupportedFunctions,0),next:`cargo run --manifest-path ${relative(root,resolve(output,'Cargo.toml'))} -p rust-battle-program -j 2`}));
