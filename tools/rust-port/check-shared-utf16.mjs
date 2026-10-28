import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
const cacheLocalBindings=!process.argv.includes('--no-local-cache');
const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'work/rust-port-shared-utf16-tests'+(cacheLocalBindings?'':'-uncached')),sha=b=>createHash('sha256').update(b).digest('hex');
const cases=[
 [
  "utf16-split-corpus",
  "var strings=['','a','ab',';a;;b;','\\u0000;a\\u0000','\\ud800;\\udc00;\\ud83d\\udca9','aaaa'],separators=['',';','aa',void 0,null],limits=[0,1,2,3,void 0,-1,NaN],out=[];for(var i=0;i<strings.length;i++)for(var j=0;j<separators.length;j++)for(var k=0;k<limits.length;k++)out.push(strings[i].split(separators[j],limits[k]));var result=JSON.stringify(out);"
 ],
 [
  "receiver-limit-separator-mutation",
  "var log=[],sep={toString:function(){log.push('oldS');return'x'}},receiver={toString:function(){log.push('R');return'a;b'}},limit={valueOf:function(){log.push('L');sep.toString=function(){log.push('S');return';'};return 3;}};var output=String.prototype.split.call(receiver,sep,limit);var result=JSON.stringify([log,output]);"
 ],
 [
  "receiver-throw-before-argument-casts",
  "var log=[],receiver={toString:function(){log.push('R');throw 7}},sep={toString:function(){log.push('S');return';'}},limit={valueOf:function(){log.push('L');return 2}},caught;try{String.prototype.split.call(receiver,sep,limit)}catch(e){caught=e}var result=JSON.stringify([log,caught]);"
 ],
 [
  "limit-throw-before-separator-cast",
  "var log=[],receiver={toString:function(){log.push('R');return'a;b'}},sep={toString:function(){log.push('S');return';'}},limit={valueOf:function(){log.push('L');throw 8}},caught;try{String.prototype.split.call(receiver,sep,limit)}catch(e){caught=e}var result=JSON.stringify([log,caught]);"
 ],
 [
  "separator-throw-after-limit",
  "var log=[],sep={toString:function(){log.push('S');throw 9}},limit={valueOf:function(){log.push('L');return 2}},caught;try{'a;b'.split(sep,limit)}catch(e){caught=e}var result=JSON.stringify([log,caught]);"
 ],
 [
  "intern-growth-during-limit-cast",
  "var saved=[],sep={toString:function(){return';'}},limit={valueOf:function(){for(var i=0;i<1000;i++)saved.push('unrelated-'+i);return 3}};var result=JSON.stringify(['\\ud800;a;\\udc00'.split(sep,limit),saved.length]);"
 ],
 [
  "intern-growth-during-separator-cast",
  "var saved=[],sep={toString:function(){for(var i=0;i<1000;i++)saved.push('other-'+i);return';'}};var result=JSON.stringify(['\\ud800;a;\\udc00'.split(sep),saved.length]);"
 ],
 [
  "captured-split-method-survives-prototype-mutation",
  "var original=String.prototype.split,limit={valueOf:function(){String.prototype.split=function(){return['changed']};return 2}};var output=original.call('a;b', ';',limit);var result=JSON.stringify([output,'a;b'.split(';')]);"
 ],
 [
  "string-receiver-mutation-does-not-alter-converted-input",
  "var receiver={value:'a;b',toString:function(){return this.value}},limit={valueOf:function(){receiver.value='changed';return 3}};var result=JSON.stringify([String.prototype.split.call(receiver,';',limit),receiver.value]);"
 ],
 [
  "regex-flags-getter-call-order",
  "var log=[],r=/;/,receiver={toString:function(){log.push('R');return'a;b'}};Object.defineProperty(r,'flags',{get:function(){log.push('F');return''}});var limit={valueOf:function(){log.push('L');return 3}};var result=JSON.stringify([String.prototype.split.call(receiver,r,limit),log]);"
 ],
 [
  "regex-surrogate-captures",
  "var result=JSON.stringify(['\\ud800;\\udc00'.split(/(;)/),'\\ud83d\\udca9x'.split(/(?:)/),'\\ud83d\\udca9x'.split(/(?:)/u)]);"
 ],
 [
  "json-and-property-key-canonical-units",
  "var o={};o['\\ud800']=1;o['\\udc00']=2;o['a\\u0000b']=3;var a='\\ud800;\\udc00;a\\u0000b'.split(';'),out=[];for(var i=0;i<a.length;i++)out.push([a[i],o[a[i]],JSON.parse(JSON.stringify(a[i]))===a[i]]);var result=JSON.stringify([out,Object.keys(o)]);"
 ],
 [
  "fresh-result-arrays-and-string-canonical-equality",
  "var a='a;a;'.split(';'),b='a;a;'.split(';');a[0]='changed';var result=JSON.stringify([a,b,a!==b,b[0]===b[1],b[0]==='a']);"
 ],
 [
  "zero-limit-still-converts-separator",
  "var log='',sep={toString:function(){log+='S';return';'}},limit={valueOf:function(){log+='L';return -0}};var result=JSON.stringify(['a;b'.split(sep,limit),log]);"
 ]
];
await mkdir(work,{recursive:true});
const files=['tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/compile.mjs','tools/rust-port/bindings.mjs','tools/rust-port/check-shared-utf16.mjs'];
async function collect(directory){const out=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+row.name;if(row.isDirectory())out.push(...await collect(file));else if(file.endsWith('.rs'))out.push(file);}return out;}
files.push(...await collect('crates/js-runtime/src'),'crates/js-runtime/Cargo.toml','crates/battle-core/src/js_math.rs','config/source-oracle-runtime.json');
const before={};for(const f of files)before[f]=sha(await readFile(resolve(root,f)));
const modules=[],manifests=[];
for(let i=0;i<cases.length;i++){const [name,source]=cases[i],out=compileSource(source,{filename:name+'.js',allowUnsupported:false,cacheLocalBindings});manifests.push(out.manifest);await writeFile(resolve(work,'case_'+i+'.rs'),out.rust);modules.push(`#[path="case_${i}.rs"] mod case_${i};`);}
const runCases=cases.map((_,i)=>`{ let mut rt=Runtime::new(); let env=rt.global_env; case_${i}::run(&mut rt,env,Value::Undefined)?; let value=rt.lookup(env,"result")?; println!("{}",encode(&rt,value)); }`).join('\n');
await writeFile(resolve(work,'main.rs'),modules.join('\n')+'\nuse js_runtime::{Runtime,Value,JsResult};\nfn encode(rt:&Runtime,v:Value)->String{match v{Value::Undefined=>"u".into(),Value::Null=>"n".into(),Value::Bool(v)=>format!("b:{v}"),Value::Number(v)=>format!("d:{:016x}",v.to_bits()),Value::String(id)=>format!("s:{}",rt.string_units(id).iter().map(|n|format!("{n:04x}")).collect::<String>()),_=>"object".into()}}\nfn main()->JsResult<()>{\n'+runCases+'\nOk(())}\n');
await writeFile(resolve(work,'Cargo.toml'),'[package]\nname="rust-port-shared-utf16-tests"\nversion="0.1.0"\nedition="2024"\n[workspace]\n[dependencies]\njs-runtime={path="../../crates/js-runtime"}\n[[bin]]\nname="shared-utf16-tests"\npath="main.rs"\n');
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),args=['build','--release','--manifest-path',resolve(work,'Cargo.toml')],built=spawnSync(resolve(rustBin,'cargo'),args,{cwd:root,env:{...process.env,PATH:rustBin+':'+process.env.PATH,CARGO_TARGET_DIR:resolve(root,'work/rust-port-shared-target')},encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(built.status,0,built.stderr);
const binary=resolve(root,'work/rust-port-shared-target/release/shared-utf16-tests'),actualRun=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(actualRun.status,0,actualRun.stderr);const actual=actualRun.stdout.trimEnd().split('\n');assert.equal(actual.length,cases.length);
function encode(v){if(v===undefined)return'u';if(v===null)return'n';if(typeof v==='boolean')return'b:'+v;if(typeof v==='number'){const b=new ArrayBuffer(8),d=new DataView(b);d.setFloat64(0,v,false);return'd:'+d.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof v==='string')return's:'+Array.from({length:v.length},(_,i)=>v.charCodeAt(i).toString(16).padStart(4,'0')).join('');return'object';}
const results=cases.map(([name,source],i)=>{const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source,realm);const expected=encode(realm.result);return{name,source,expected,actual:actual[i],passed:expected===actual[i]};});
const failure=results.find(r=>!r.passed);if(failure){await writeFile(resolve(root,'benchmarks/validation/rust-port-shared-utf16-failure.json'),JSON.stringify(failure,null,2)+'\n');throw Error('SharedUTF16 differential first failure '+JSON.stringify(failure));}
for(const[f,expected]of Object.entries(before))assert.equal(sha(await readFile(resolve(root,f))),expected,'Compiler source changed during gate '+f);
const report={version:1,passed:true,cacheLocalBindings,cachedBindingDeclarations:manifests.reduce((n,m)=>n+m.functions.reduce((a,f)=>a+(f.cachedBindings??0),0),0),cases:results.length,results,compilerInputs:before,binary:{file:binary,sha256:sha(await readFile(binary))},buildArgs:args,scope:'Actual generated Rust executed against source JS UTF16 ownership and String.split mutation programs. Ordered observable effects and primitive results compare exactly; Number results use raw f64 bits and strings use UTF-16 units. This is a UTF16/split gate, not battle fidelity or throughput.',qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/rust-port-shared-utf16'+(cacheLocalBindings?'':'-uncached')+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:results.length}));
