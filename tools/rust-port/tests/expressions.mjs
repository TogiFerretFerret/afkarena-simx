import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
import {compileSource} from '../compile.mjs';
const root=resolve(import.meta.dirname,'../../..'),work=resolve(root,'work/rust-port-expression-tests'),sha=b=>createHash('sha256').update(b).digest('hex');
const cases=[
 ['computed-simple-rhs-before-coercion','var log="";var k={toString:function(){log+="K";return "x"}};var o={};o[k]=(log+="R",3);var result=log+":"+o.x;'],
 ['computed-compound-coerces-twice','var log="",n=0;var k={toString:function(){log+="K";n++;return n===1?"x":"y"}};var o={x:1};o[k]+=(log+="R",2);var result=log+":"+o.x+":"+o.y;'],
 ['null-assignment-rhs-prefix','var log="";var k={toString:function(){log+="K";return"x"}};try{null[k]=(log+="R",3)}catch(e){log+="T"}var result=log;'],
 ['null-compound-stops-before-rhs','var log="";var k={toString:function(){log+="K";return"x"}};try{null[k]+=(log+="R",3)}catch(e){log+="T"}var result=log;'],
 ['method-receiver-survives-argument-mutation','var o={x:3,m:function(v){return this.x+v}},old=o;var a=o.m((o={x:100},2));var result=a+":"+old.m(4);'],
 ['callee-read-before-arguments','var log="";var f=function(v){log+="F";return v};var o={get m(){log+="G";return f}};var result=o.m((log+="A",2))+":"+log;'],
 ['method-and-sequence-this','var x=9;var o={x:3,m:function(){return this.x}};var result=o.m()+":"+(0,o.m)();'],
 ['postfix-converts-old-value','var log="",n=0;var k={toString:function(){log+="K";n++;return n===1?"x":"y"}};var o={x:{valueOf:function(){log+="V";return 4}}};var old=o[k]++;var result=log+":"+old+":"+o.y;'],
 ['logical-short-circuit-values','var log="";var a=0&&(log+="bad"),b=""||(log+="B",4),c=0??(log+="bad"),d=null??(log+="D",5);var result=log+":"+a+":"+b+":"+c+":"+d;'],
 ['logical-assignment-store-order','var log="",n=0;var k={toString:function(){log+="K";n++;return n===1?"x":"y"}};var o={x:0};o[k]||=(log+="R",7);var result=log+":"+o.y;'],
 ['object-getter-setter-merge','var log="";var o={get x(){log+="G";return 2},set x(v){log+="S"+v}};o.x+=3;var result=log;'],
 ['object-computed-key-coerces-before-value','var log="";var k={toString:function(){log+="K";return"x"}};var o={[k]:(log+="V",2)};var result=log+":"+o.x;'],
 ['array-holes-and-length','var a=[,3,,];var result=a.length+":"+(0 in a)+":"+(1 in a)+":"+(2 in a);'],
 ['typeof-unbound','var result=typeof never_declared_expression_test;'],
 ['delete-binding-and-property','var x=2,o={a:1};var result=(delete x)+":"+(delete o.a)+":"+("a" in o)+":"+(delete never_declared_expression_test);'],
 ['lone-surrogate-string-length','var s="\\ud800x";var result=s.length+":"+s[0].length;'],
 ['template-coercion-before-next-expression','var log="";var o={toString:function(){log+="S";return"x"}};var s=`a${o}${(log+="N",3)}`;var result=log+":"+s;'],
 ['anonymous-assignment-name','var f;f=function(){};var result=f.name;'],
 ['object-computed-function-name','var o={["f"]:function(){}};var result=o.f.name;'],
 ['proto-literal-anonymous-function-no-name','var o={__proto__:function(){}};var result=o.name;'],
 ['object-method-not-constructible','var o={m(){}};var result="prototype" in o.m;'],
 ['strict-function-this','function f(){"use strict";return this===void 0}var result=f();'],
 ['constructor-prototype-and-this','function F(v){this.x=v}F.prototype.y=3;var o=new F(7);var result=o.x+":"+o.y;'],
 ['negative-zero-result','var result=-0;'],
 ['division-nan-bits','var result=0/0;'],
 ['dynamic-division-nan-bits','var z=0;var result=z/z;'],
 ['literal-negative-zero-division','var result=-0/0;'],
 ['literal-remainder-nan','var result=0%0;'],
 ['literal-infinity-subtraction','var result=1e999-1e999;'],
 ['dynamic-infinity-subtraction','var a=1e999;var result=a-a;'],
 ['literal-pow-invalid','var result=(-1)**0.5;'],
 ['literal-overflow','var result=1e308*1e308;'],
 ['strict-literal-fold','"use strict";var result=(0/0)+1;'],
 ['sequence-order','var log="";var result=(log+="A",log+="B",log);'],
 ['optional-member-skips-computed-chain','var n=0,a=null;var v=a?.[n++].x;var result=n+":"+typeof v;'],
 ['optional-call-skips-arguments','var log="",a=null;a?.m((log+="A",2));var result=log;'],
 ['grouped-optional-callee-evaluates-arguments','var log="",a=null;try{(a?.m)((log+="A",2))}catch(e){log+="T"}var result=log;'],
 ['grouped-optional-member-breaks-chain','var log="",a=null;try{(a?.b)[(log+="K","c")]}catch(e){log+="T"}var result=log;'],
 ['optional-delete-does-not-read-getter','var log="",o={get x(){log+="G";return 2}};var r=delete o?.x;var result=log+":"+r+":"+("x" in o);'],
 ['optional-delete-chain-shortcircuits','var o=null;var result=delete o?.x.y;'],
 ['optional-method-receiver-captured','var o={x:3,m(v){return this.x+v}};var result=o?.m((o={x:100},2));'],
 ['optional-null-method-getter-prefix','var log="",o={get m(){log+="G";return null}};o.m?.((log+="A",2));var result=log;'],
 ['new-target-constructor','function F(){this.x=new.target===F}var o=new F;var result=o.x;'],
 ['new-target-nested-ordinary-function','var log="";function F(){log=(function(){return new.target===void 0})()+":"+(new.target===F)}new F;var result=log;'],
 ['new-target-arrow-capture','function F(){this.test=()=>new.target===F}var o=new F;var result=o.test();'],
 ['new-target-arrow-ordinary-call','function f(){return ()=>new.target}var g=f();var result=g()===void 0;'],
 ['array-length-object-coerces-twice','var n=0,a=[],v={valueOf:function(){n++;return 2}};a.length=v;var result=n*10+a.length;'],
 ['array-shrink-nonconfig-retains-prefix','var a=[0,1,2,3];Object.defineProperty(a,"2",{configurable:false});a.length=0;var result=a.length*10+("3" in a?1:0);'],
 ['object-keys-boxes-string','var result=Object.keys("ab").length;'],
 ['array-own-names-holes','var result=Object.getOwnPropertyNames([,1]).join(",");'],
 ['array-cyclic-join','var a=[];a[0]=a;var result=a.join(",");'],
 ['array-sort-holes-and-undefined','var a=[3,,void 0,1];a.sort();var result=a.join(",")+":"+("2" in a)+":"+("3" in a);'],
 ['argument-spread-live-array-length','var a=[1,,];Object.defineProperty(a,"1",{get:function(){a[2]=4;return 3}});function f(){return arguments.length+":"+arguments[0]+":"+arguments[1]+":"+arguments[2]}var result=f(...a);'],
 ['argument-spread-order-and-arguments-object','var log="";function f(){log+="F";return arguments.length}function g(){return f((log+="A",1),...arguments,(log+="B",4))}var result=g(2,3)+":"+log;'],
 ['array-spread-holes-become-own-undefined','var a=[,...[,2],,];var result=a.length+":"+("0" in a)+":"+("1" in a)+":"+("2" in a)+":"+("3" in a);'],
 ['string-spread-code-points','var a=[..."💩"];var result=a.length+":"+a[0].length;'],
 ['compound-left-coercion-after-rhs','var log="",o={x:{valueOf:function(){log+="V";return 1}}};o.x+=(log+="R",2);var result=log+":"+o.x;'],
 ['computed-key-method-replaced-by-rhs','var k={toString:function(){return"x"}},o={x:1};o[k]+=(k.toString=function(){return"y"},2);var result=o.x+":"+o.y;'],
 ['regexp-literal-captures-and-index','var r=/(a+)/i,m=r.exec("AAA");var result=m[0]+":"+m[1]+":"+m.index;'],
 ['regexp-global-last-index-reset','var r=/a/g;var result=r.test("a")+":"+r.lastIndex+":"+r.test("a")+":"+r.lastIndex;'],
 ['regexp-dot-without-unicode','var r=/./g,m=r.exec("💩");var result=m[0].length+":"+r.lastIndex;'],
 ['regexp-dot-with-unicode','var r=/./gu,m=r.exec("💩");var result=m[0].length+":"+r.lastIndex;'],
 ['regexp-literal-fresh-per-call','function f(){return /a/g}var result=f()===f();'],
 ['regexp-literal-source-and-flags','var r=/a(b+)/gim;var result=r.source+":"+r.flags;'],



];
await mkdir(work,{recursive:true});
const files=['tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/compile.mjs','tools/rust-port/tests/expressions.mjs'];
async function collect(directory){const out=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+row.name;if(row.isDirectory())out.push(...await collect(file));else if(file.endsWith('.rs'))out.push(file);}return out;}
files.push(...await collect('crates/js-runtime/src'),'crates/js-runtime/Cargo.toml','crates/battle-core/src/js_math.rs','config/source-oracle-runtime.json');
const before={};for(const f of files)before[f]=sha(await readFile(resolve(root,f)));
const modules=[],manifests=[];
for(let i=0;i<cases.length;i++){const [name,source]=cases[i],out=compileSource(source,{filename:name+'.js',allowUnsupported:false});manifests.push(out.manifest);await writeFile(resolve(work,'case_'+i+'.rs'),out.rust);modules.push(`#[path="case_${i}.rs"] mod case_${i};`);}
const runCases=cases.map((_,i)=>`{ let mut rt=Runtime::new(); let env=rt.global_env; case_${i}::run(&mut rt,env,Value::Undefined)?; let value=rt.lookup(env,"result")?; println!("{}",encode(&rt,value)); }`).join('\n');
await writeFile(resolve(work,'main.rs'),modules.join('\n')+'\nuse js_runtime::{Runtime,Value,JsResult};\nfn encode(rt:&Runtime,v:Value)->String{match v{Value::Undefined=>"u".into(),Value::Null=>"n".into(),Value::Bool(v)=>format!("b:{v}"),Value::Number(v)=>format!("d:{:016x}",v.to_bits()),Value::String(id)=>format!("s:{}",rt.string_units(id).iter().map(|n|format!("{n:04x}")).collect::<String>()),_=>"object".into()}}\nfn main()->JsResult<()>{\n'+runCases+'\nOk(())}\n');
await writeFile(resolve(work,'Cargo.toml'),'[package]\nname="rust-port-expression-tests"\nversion="0.1.0"\nedition="2024"\n[workspace]\n[dependencies]\njs-runtime={path="../../crates/js-runtime"}\n[[bin]]\nname="expression-tests"\npath="main.rs"\n');
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),args=['build','--release','--manifest-path',resolve(work,'Cargo.toml')],built=spawnSync(resolve(rustBin,'cargo'),args,{cwd:root,env:{...process.env,PATH:rustBin+':'+process.env.PATH},encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(built.status,0,built.stderr);
const binary=resolve(work,'target/release/expression-tests'),actualRun=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(actualRun.status,0,actualRun.stderr);const actual=actualRun.stdout.trimEnd().split('\n');assert.equal(actual.length,cases.length);
function encode(v){if(v===undefined)return'u';if(v===null)return'n';if(typeof v==='boolean')return'b:'+v;if(typeof v==='number'){const b=new ArrayBuffer(8),d=new DataView(b);d.setFloat64(0,v,false);return'd:'+d.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof v==='string')return's:'+Array.from({length:v.length},(_,i)=>v.charCodeAt(i).toString(16).padStart(4,'0')).join('');return'object';}
const results=cases.map(([name,source],i)=>{const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source,realm);const expected=encode(realm.result);return{name,source,expected,actual:actual[i],passed:expected===actual[i]};});
const failure=results.find(r=>!r.passed);if(failure){await writeFile(resolve(root,'benchmarks/validation/rust-port-expression-failure.json'),JSON.stringify(failure,null,2)+'\n');throw Error('Expression differential first failure '+JSON.stringify(failure));}
for(const[f,expected]of Object.entries(before))assert.equal(sha(await readFile(resolve(root,f))),expected,'Compiler source changed during gate '+f);
const report={version:1,passed:true,cases:results.length,results,compilerInputs:before,binary:{file:binary,sha256:sha(await readFile(binary))},buildArgs:args,scope:'Actual generated Rust executed against source JS expression programs. Ordered observable effects and primitive results compare exactly; Number results use raw f64 bits and strings use UTF-16 units. This is a language-expression gate, not battle fidelity or throughput.',qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/rust-port-expressions.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:results.length}));
