import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
const cacheLocalBindings=!process.argv.includes('--no-local-cache');
const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'work/rust-port-strings-tests'+(cacheLocalBindings?'':'-uncached')),sha=b=>createHash('sha256').update(b).digest('hex');
const cases=[
  [
    "utf16-indexing",
    "var s='A💩Z';var result=JSON.stringify([s.length,s.charAt(1),s.charCodeAt(2),s.codePointAt(1),s.codePointAt(2),s.charAt(99),s.charCodeAt(-1),s.codePointAt(99)]);"
  ],
  [
    "slice-substring-substr",
    "var s='abcdef';var result=JSON.stringify([s.slice(-4,-1),s.slice(4,2),s.substring(4,2),s.substr(-3,2),s.substr(2,-1),s.slice(-Infinity,Infinity)]);"
  ],
  [
    "index-methods",
    "var s='ababa';var result=JSON.stringify([s.indexOf('ba',2),s.lastIndexOf('ba',2),s.indexOf('',99),s.lastIndexOf('',99),s.indexOf('zz'),s.includes('ba',3),s.startsWith('ba',1),s.endsWith('ba',3)]);"
  ],
  [
    "padding",
    "var result=JSON.stringify(['x'.padStart(5,'ab'),'x'.padEnd(4,'ab'),'abc'.padStart(2,{toString:function(){throw 7}}),'x'.padStart(3,''),'💩'.padStart(3,'z')]);"
  ],
  [
    "repeat",
    "var result=JSON.stringify(['ab'.repeat(2.9),''.repeat(20),'x'.repeat(NaN),'x'.repeat(-0)]);"
  ],
  [
    "repeat-range",
    "var result='';try{'a'.repeat(-1)}catch(e){result+=e.name}try{'a'.repeat(Infinity)}catch(e){result+=':'+e.name}"
  ],
  [
    "whitespace",
    "var s='﻿ \t abc  ';var result=JSON.stringify([s.trim(),s.trimStart(),s.trimEnd(),String.prototype.trimLeft===String.prototype.trimStart,String.prototype.trimRight===String.prototype.trimEnd]);"
  ],
  [
    "case-unicode",
    "var result=JSON.stringify(['straße'.toUpperCase(),'İΣΟΣ'.toLowerCase(),'A\ud800B'.toLowerCase(),'ﬃ'.toUpperCase()]);"
  ],
  [
    "construct-codepoints",
    "var result=JSON.stringify([String.fromCharCode(65,65536,-1,NaN),String.fromCodePoint(65,128169,0xd800)]);"
  ],
  [
    "invalid-codepoint",
    "var result='';try{String.fromCodePoint(1.5)}catch(e){result=e.name}try{String.fromCodePoint(Infinity)}catch(e){result+=':'+e.name}"
  ],
  [
    "coercion-order",
    "var log='';var o={toString:function(){log+='S';return'abcd'}},a={valueOf:function(){log+='A';return 1}},b={valueOf:function(){log+='B';return 3}};var out=String.prototype.slice.call(o,a,b);var result=log+':'+out;"
  ],
  [
    "search-coercion",
    "var log='';var n={toString:function(){log+='N';return'b'}},p={valueOf:function(){log+='P';return 1}};var out='abc'.includes(n,p);var result=log+':'+out;"
  ],
  [
    "null-receiver",
    "var result='';try{String.prototype.charAt.call(null,0)}catch(e){result=e.name}try{String.prototype.slice.call(void 0,0)}catch(e){result+=':'+e.name}"
  ],
  [
    "concat-coercion",
    "var log='';var a={toString:function(){log+='A';return'a'}},b={toString:function(){log+='B';return'b'}};var out='x'.concat(a,b);var result=log+':'+out;"
  ],
  [
    "strings-rejection",
    "var result='';try{'abc'.includes(/a/)}catch(e){result=e.name}try{'abc'.startsWith(/a/)}catch(e){result+=':'+e.name}try{'abc'.endsWith(/c/)}catch(e){result+=':'+e.name}"
  ]
];
await mkdir(work,{recursive:true});
const files=['tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/compile.mjs','tools/rust-port/bindings.mjs','tools/rust-port/check-strings.mjs'];
async function collect(directory){const out=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+row.name;if(row.isDirectory())out.push(...await collect(file));else if(file.endsWith('.rs'))out.push(file);}return out;}
files.push(...await collect('crates/js-runtime/src'),'crates/js-runtime/Cargo.toml','crates/battle-core/src/js_math.rs','config/source-oracle-runtime.json');
const before={};for(const f of files)before[f]=sha(await readFile(resolve(root,f)));
const modules=[],manifests=[];
for(let i=0;i<cases.length;i++){const [name,source]=cases[i],out=compileSource(source,{filename:name+'.js',allowUnsupported:false,cacheLocalBindings});manifests.push(out.manifest);await writeFile(resolve(work,'case_'+i+'.rs'),out.rust);modules.push(`#[path="case_${i}.rs"] mod case_${i};`);}
const runCases=cases.map((_,i)=>`{ let mut rt=Runtime::new(); let env=rt.global_env; case_${i}::run(&mut rt,env,Value::Undefined)?; let value=rt.lookup(env,"result")?; println!("{}",encode(&rt,value)); }`).join('\n');
await writeFile(resolve(work,'main.rs'),modules.join('\n')+'\nuse js_runtime::{Runtime,Value,JsResult};\nfn encode(rt:&Runtime,v:Value)->String{match v{Value::Undefined=>"u".into(),Value::Null=>"n".into(),Value::Bool(v)=>format!("b:{v}"),Value::Number(v)=>format!("d:{:016x}",v.to_bits()),Value::String(id)=>format!("s:{}",rt.string_units(id).iter().map(|n|format!("{n:04x}")).collect::<String>()),_=>"object".into()}}\nfn main()->JsResult<()>{\n'+runCases+'\nOk(())}\n');
await writeFile(resolve(work,'Cargo.toml'),'[package]\nname="rust-port-strings-tests"\nversion="0.1.0"\nedition="2024"\n[workspace]\n[dependencies]\njs-runtime={path="../../crates/js-runtime"}\n[[bin]]\nname="strings-tests"\npath="main.rs"\n');
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),args=['build','--release','--manifest-path',resolve(work,'Cargo.toml')],built=spawnSync(resolve(rustBin,'cargo'),args,{cwd:root,env:{...process.env,PATH:rustBin+':'+process.env.PATH,CARGO_TARGET_DIR:resolve(root,'work/rust-port-shared-target')},encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(built.status,0,built.stderr);
const binary=resolve(root,'work/rust-port-shared-target/release/strings-tests'),actualRun=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(actualRun.status,0,actualRun.stderr);const actual=actualRun.stdout.trimEnd().split('\n');assert.equal(actual.length,cases.length);
function encode(v){if(v===undefined)return'u';if(v===null)return'n';if(typeof v==='boolean')return'b:'+v;if(typeof v==='number'){const b=new ArrayBuffer(8),d=new DataView(b);d.setFloat64(0,v,false);return'd:'+d.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof v==='string')return's:'+Array.from({length:v.length},(_,i)=>v.charCodeAt(i).toString(16).padStart(4,'0')).join('');return'object';}
const results=cases.map(([name,source],i)=>{const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source,realm);const expected=encode(realm.result);return{name,source,expected,actual:actual[i],passed:expected===actual[i]};});
const failure=results.find(r=>!r.passed);if(failure){await writeFile(resolve(root,'benchmarks/validation/rust-port-strings-failure.json'),JSON.stringify(failure,null,2)+'\n');throw Error('String differential first failure '+JSON.stringify(failure));}
for(const[f,expected]of Object.entries(before))assert.equal(sha(await readFile(resolve(root,f))),expected,'Compiler source changed during gate '+f);
const report={version:1,passed:true,cacheLocalBindings,cachedBindingDeclarations:manifests.reduce((n,m)=>n+m.functions.reduce((a,f)=>a+(f.cachedBindings??0),0),0),cases:results.length,results,compilerInputs:before,binary:{file:binary,sha256:sha(await readFile(binary))},buildArgs:args,scope:'Actual generated Rust executed against source JS String programs. Ordered observable effects and primitive results compare exactly; Number results use raw f64 bits and strings use UTF-16 units. This is a language-String gate, not battle fidelity or throughput.',qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/rust-port-strings'+(cacheLocalBindings?'':'-uncached')+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:results.length}));
