import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
const cacheLocalBindings=!process.argv.includes('--no-local-cache');
const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'work/rust-port-regexp-tests'+(cacheLocalBindings?'':'-uncached')),sha=b=>createHash('sha256').update(b).digest('hex');
const cases=[
 [
  "captures-and-undefined",
  "var r=/(a+)(b)?/i,m=r.exec(\"AAA\");var result=JSON.stringify([m[0],m[1],m[2],m.index,m.input,m.groups===void 0,r.lastIndex]);"
 ],
 [
  "global-state-reset",
  "var r=/a/g,a=r.exec(\"aa\"),i=r.lastIndex,b=r.exec(\"aa\"),j=r.lastIndex,c=r.exec(\"aa\");var result=JSON.stringify([a.index,i,b.index,j,c,r.lastIndex]);"
 ],
 [
  "unicode-dot",
  "var result=JSON.stringify([\"💩a\".match(/./g),\"💩a\".match(/./gu)]);"
 ],
 [
  "named-captures-and-indices",
  "var m=/(?<x>a)(b)?/d.exec(\"a\");var result=JSON.stringify([m.groups,m.indices,m.indices.groups]);"
 ],
 [
  "global-replacement",
  "var result=\"a1b22\".replace(/\\d+/g,\"<$&>\");"
 ],
 [
  "replacement-dollar-patterns",
  "var result=\"abc\".replace(/b/,\"$$:$&:$`:$\\'\");"
 ],
 [
  "replacement-capture-digit-fallback",
  "var result=\"ab\".replace(/(a)(b)/,\"$12:$23:$0:$99\");"
 ],
 [
  "replacement-optional-named",
  "var result=\"a\".replace(/(?<x>a)(?<y>b)?/,\"$<x>:$<y>:$<z>\");"
 ],
 [
  "replacement-callback-after-all-exec",
  "var r=/a/g,log=\"\";var out=\"aa\".replace(r,function(m,i,s){log+=r.lastIndex;return i});var result=out+\":\"+log;"
 ],
 [
  "replacement-custom-exec-schedule",
  "var r=/a/g,n=0,log=\"\";r.exec=function(){n++;return n<3?{0:\"a\",index:n-1,length:1,groups:void 0}:null};var out=\"aa\".replace(r,function(){log+=n;return\"x\"});var result=out+\":\"+log;"
 ],
 [
  "regex-split-captures",
  "var result=JSON.stringify(\"a,b;c\".split(/([,;])/));"
 ],
 [
  "regex-split-empty-unicode",
  "var result=JSON.stringify([\"💩x\".split(/(?:)/),\"💩x\".split(/(?:)/u)]);"
 ],
 [
  "regex-split-limit",
  "var result=JSON.stringify(\"a,b,c\".split(/(,)/,3));"
 ],
 [
  "regex-split-preserves-original-index",
  "var r=/,/g;r.lastIndex=22;var a=\"a,b\".split(r);var result=JSON.stringify([a,r.lastIndex]);"
 ],
 [
  "replace-string-coercion-order",
  "var log=\"\";var a={toString:function(){log+=\"S\";return\"x\"}},b={toString:function(){log+=\"R\";return\"y\"}};var out=\"x\".replace(a,b);var result=log+\":\"+out;"
 ],
 [
  "split-zero-limit-coercion-order",
  "var log=\"\";var a={toString:function(){log+=\"S\";return\",\"}},b={valueOf:function(){log+=\"L\";return 0}};var out=\"x\".split(a,b);var result=log+\":\"+out.length;"
 ],
 [
  "readonly-last-index-error",
  "var r=/a/g;Object.defineProperty(r,\"lastIndex\",{writable:false});var result=\"bad\";try{r.exec(\"a\")}catch(e){result=e.name+\":\"+(e instanceof TypeError)}"
 ],
 [
  "sticky-last-index",
  "var r=/a/y;var a=r.exec(\"ba\");r.lastIndex=1;var b=r.exec(\"ba\");var result=JSON.stringify([a,b[0],b.index,r.lastIndex]);"
 ],
 [
  "regexp-constructor-identity",
  "var r=/a/g;var result=(RegExp(r)===r)+\":\"+(new RegExp(r)===r)+\":\"+new RegExp(r,\"i\").flags;"
 ],
 [
  "regexp-source-to-string",
  "var result=/a(b+)/gim.toString()+\":\"+RegExp(\"\").source;"
 ],
 [
  "search-restores-negative-zero",
  "var r=/a/g;r.lastIndex=-0;var i=\"ba\".search(r);var result=i+\":\"+(1/r.lastIndex);"
 ],
 [
  "zero-length-global-replace",
  "var result=\"aa\".replace(/(?=a)/g,\"x\");"
 ],
 [
  "empty-string-split",
  "var result=JSON.stringify([\"\".split(/(?:)/),\"\".split(/a/),\"\".split(\"\"),\"\".split(\",\")]);"
 ],
 [
  "plain-string-split",
  "var result=JSON.stringify([\"a,b,c\".split(\",\",2),\"ab\".split(void 0),\"💩\".split(\"\")]);"
 ],
 [
  "custom-invalid-exec-throws",
  "var r=/a/;r.exec=function(){return true};var result=\"bad\";try{r.test(\"a\")}catch(e){result=e.name}"
 ]
];
await mkdir(work,{recursive:true});
const files=['tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/compile.mjs','tools/rust-port/bindings.mjs','tools/rust-port/check-regexp.mjs'];
async function collect(directory){const out=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+row.name;if(row.isDirectory())out.push(...await collect(file));else if(file.endsWith('.rs'))out.push(file);}return out;}
files.push(...await collect('crates/js-runtime/src'),'crates/js-runtime/Cargo.toml','crates/battle-core/src/js_math.rs','config/source-oracle-runtime.json');
const before={};for(const f of files)before[f]=sha(await readFile(resolve(root,f)));
const modules=[],manifests=[];
for(let i=0;i<cases.length;i++){const [name,source]=cases[i],out=compileSource(source,{filename:name+'.js',allowUnsupported:false,cacheLocalBindings});manifests.push(out.manifest);await writeFile(resolve(work,'case_'+i+'.rs'),out.rust);modules.push(`#[path="case_${i}.rs"] mod case_${i};`);}
const runCases=cases.map((_,i)=>`{ let mut rt=Runtime::new(); let env=rt.global_env; case_${i}::run(&mut rt,env,Value::Undefined)?; let value=rt.lookup(env,"result")?; println!("{}",encode(&rt,value)); }`).join('\n');
await writeFile(resolve(work,'main.rs'),modules.join('\n')+'\nuse js_runtime::{Runtime,Value,JsResult};\nfn encode(rt:&Runtime,v:Value)->String{match v{Value::Undefined=>"u".into(),Value::Null=>"n".into(),Value::Bool(v)=>format!("b:{v}"),Value::Number(v)=>format!("d:{:016x}",v.to_bits()),Value::String(id)=>format!("s:{}",rt.string_units(id).iter().map(|n|format!("{n:04x}")).collect::<String>()),_=>"object".into()}}\nfn main()->JsResult<()>{\n'+runCases+'\nOk(())}\n');
await writeFile(resolve(work,'Cargo.toml'),'[package]\nname="rust-port-regexp-tests"\nversion="0.1.0"\nedition="2024"\n[workspace]\n[dependencies]\njs-runtime={path="../../crates/js-runtime"}\n[[bin]]\nname="regexp-tests"\npath="main.rs"\n');
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),args=['build','--release','--manifest-path',resolve(work,'Cargo.toml')],built=spawnSync(resolve(rustBin,'cargo'),args,{cwd:root,env:{...process.env,PATH:rustBin+':'+process.env.PATH,CARGO_TARGET_DIR:resolve(root,'work/rust-port-shared-target')},encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(built.status,0,built.stderr);
const binary=resolve(root,'work/rust-port-shared-target/release/regexp-tests'),actualRun=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(actualRun.status,0,actualRun.stderr);const actual=actualRun.stdout.trimEnd().split('\n');assert.equal(actual.length,cases.length);
function encode(v){if(v===undefined)return'u';if(v===null)return'n';if(typeof v==='boolean')return'b:'+v;if(typeof v==='number'){const b=new ArrayBuffer(8),d=new DataView(b);d.setFloat64(0,v,false);return'd:'+d.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof v==='string')return's:'+Array.from({length:v.length},(_,i)=>v.charCodeAt(i).toString(16).padStart(4,'0')).join('');return'object';}
const results=cases.map(([name,source],i)=>{const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source,realm);const expected=encode(realm.result);return{name,source,expected,actual:actual[i],passed:expected===actual[i]};});
const failure=results.find(r=>!r.passed);if(failure){await writeFile(resolve(root,'benchmarks/validation/rust-port-regexp-failure.json'),JSON.stringify(failure,null,2)+'\n');throw Error('RegExp differential first failure '+JSON.stringify(failure));}
for(const[f,expected]of Object.entries(before))assert.equal(sha(await readFile(resolve(root,f))),expected,'Compiler source changed during gate '+f);
const report={version:1,passed:true,cacheLocalBindings,cachedBindingDeclarations:manifests.reduce((n,m)=>n+m.functions.reduce((a,f)=>a+(f.cachedBindings??0),0),0),cases:results.length,results,compilerInputs:before,binary:{file:binary,sha256:sha(await readFile(binary))},buildArgs:args,scope:'Actual generated Rust executed against source JS RegExp programs. Ordered observable effects and primitive results compare exactly; Number results use raw f64 bits and strings use UTF-16 units. This is a language-RegExp gate, not battle fidelity or throughput.',qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/rust-port-regexp'+(cacheLocalBindings?'':'-uncached')+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:results.length}));
