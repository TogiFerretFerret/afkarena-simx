import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';

const root=resolve(import.meta.dirname,'../..');
const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const through=Number(option('--through','0'));
const chunkSize=Number(option('--chunk-size','100'));
assert.ok(Number.isInteger(through)&&through>=0&&through<=6);
assert.ok(Number.isInteger(chunkSize)&&chunkSize>0);
const output=resolve(root,option('--out','work/rust-battle-program'));
const coverage=JSON.parse(await readFile(resolve(root,'benchmarks/validation/rust-battle-compile-coverage.json')));
const sha=b=>createHash('sha256').update(b).digest('hex');
const runtimePath=relative(output,resolve(root,'crates/js-runtime')).replaceAll('\\','/');
const members=['app'];
const reports=[];
for(const unit of coverage.units.slice(0,through+1)){
 const sourceBytes=await readFile(unit.file);assert.equal(sha(sourceBytes),unit.sha256,'Frozen battle input changed');
 const name=`battle-unit-${unit.index}`,directory=resolve(output,name),src=resolve(directory,'src');
 await mkdir(src,{recursive:true});
 const result=compileSource(sourceBytes.toString('utf8'),{filename:unit.file,mode:'script',moduleName:`battle_unit_${unit.index}`,sourcePoolPath:'source.utf16le'});
 await writeFile(resolve(src,'source.utf16le'),result.sourcePool);
 const modules=[];
 for(let index=0;index<result.functions.length;index+=chunkSize){
  const module=`chunk_${String(index/chunkSize).padStart(4,'0')}`;
  const text='use super::*;\n'+result.functions.slice(index,index+chunkSize).map(row=>row.rust).join('\n\n')+'\n';
  await writeFile(resolve(src,module+'.rs'),text);modules.push(module);
 }
 const lib=result.header+'\n'+modules.map(m=>`mod ${m};\npub use ${m}::*;`).join('\n')+'\n'+result.entry+'\n';
 await writeFile(resolve(src,'lib.rs'),lib);
 await writeFile(resolve(directory,'Cargo.toml'),`[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\npublish = false\n[dependencies]\njs-runtime = { path = "${relative(directory,resolve(root,'crates/js-runtime')).replaceAll('\\','/')}" }\n`);
 await writeFile(resolve(directory,'manifest.json'),JSON.stringify(result.manifest,null,2)+'\n');
 members.push(name);
 reports.push({index:unit.index,file:unit.file,sourceSha256:unit.sha256,functions:result.manifest.functions.length,compiledFunctions:result.manifest.compiledFunctions,unsupportedFunctions:result.manifest.unsupportedFunctions,chunks:modules.length,rustBytes:result.functions.reduce((n,f)=>n+Buffer.byteLength(f.rust),0),sourcePoolBytes:result.sourcePool.length});
 console.log(JSON.stringify(reports.at(-1)));
}
const app=resolve(output,'app');await mkdir(resolve(app,'src'),{recursive:true});
const dependencies=[`js-runtime = { path = "${relative(app,resolve(root,'crates/js-runtime')).replaceAll('\\','/')}" }`,...reports.map(r=>`battle-unit-${r.index} = { path = "../battle-unit-${r.index}" }`)];
await writeFile(resolve(app,'Cargo.toml'),'[package]\nname = "rust-battle-program"\nversion = "0.1.0"\nedition = "2024"\npublish = false\n[dependencies]\n'+dependencies.join('\n')+'\n');
const calls=reports.map(r=>`eprintln!("unit_start:${r.index}");\n battle_unit_${r.index}::run(&mut rt, env, global)?;\n eprintln!("unit_finished:${r.index}");`).join('\n');
await writeFile(resolve(app,'src/main.rs'),`use js_runtime::{Runtime,Value,EnvId,JsResult};
fn print(rt:&mut Runtime,_this:Value,args:&[Value],_env:EnvId)->JsResult<Value>{
 let mut parts=Vec::new();for &arg in args{let value=rt.to_string(arg)?;let Value::String(id)=value else{unreachable!()};parts.push(String::from_utf16_lossy(rt.string_units(id)));}
 println!("{}",parts.join(" "));Ok(Value::Undefined)
}
fn execute()->JsResult<Value>{
 let mut rt=Runtime::new();let env=rt.global_env;let global=Value::Object(rt.global_object);
 let printer=rt.make_closure_with_flags(print,env,0,"print",true,None);
 rt.declare(env,"print",printer)?;
 ${calls}
 Ok(Value::Undefined)
}
fn main(){if let Err(error)=execute(){eprintln!("pure_rust_execution_error:{error:?}");std::process::exit(1);}}
`);
await writeFile(resolve(output,'Cargo.toml'),'[workspace]\nmembers = '+JSON.stringify(members)+'\nresolver = "2"\n[profile.dev]\ndebug = 0\ncodegen-units = 64\n[profile.release]\ncodegen-units = 64\nlto = false\n');
const sources={};for(const file of ['tools/rust-port/generate-program.mjs','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs'])sources[file]=sha(await readFile(resolve(root,file)));
const manifest={version:1,prepared:true,executed:false,qualifiesFor10000Target:false,output,through,chunkSize,units:reports,sources,runtimePath,scope:'Actual frozen battle JavaScript modules lowered into native Rust functions with shared global environment and static UTF16 source pools. Preparation and compile coverage do not establish successful initialization, mechanics parity, or throughput.'};
await writeFile(resolve(output,'program-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,units:reports.length,functions:reports.reduce((n,u)=>n+u.functions,0),unsupported:reports.reduce((n,u)=>n+u.unsupportedFunctions,0),next:`cargo run --manifest-path ${relative(root,resolve(output,'Cargo.toml'))} -p rust-battle-program -j 2`}));
