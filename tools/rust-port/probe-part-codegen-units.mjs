import fs from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
import {unitSpeederProbeSource} from '../native-unit-speeder-cases.mjs';

// Run only while holding the repository's exclusive native-timing lease.
const arg=process.argv.slice(2),opt=(key,fallback)=>arg.includes(key)?arg[arg.indexOf(key)+1]:fallback;
const root=resolve(import.meta.dirname,'../..'),reference=resolve(opt('--reference-root','/workspace/afkarena-simx'));
const work=resolve(root,'work/part-codegen-units-probe'),world=resolve(reference,'work/rust-battle-full');
const deps=resolve(reference,'work/rust-port-shared-target/release/deps');
const rustc=resolve(reference,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc');
const sha=b=>createHash('sha256').update(b).digest('hex'),inputs=new Map();
async function pin(file){const b=await fs.readFile(file);inputs.set(file,sha(b));return b;}
await fs.mkdir(work,{recursive:true});
const version=await execute(rustc,['-vV']);assert.equal(version.status,0);
const helper=String.raw`use std::{process::{Command,exit},time::Instant,env,fs};
unsafe extern "C" {fn wait4(pid:i32,status:*mut i32,options:i32,usage:*mut i64)->i32;}
fn main(){let a:Vec<_>=env::args().collect();let start=Instant::now();let child=Command::new(&a[2]).args(&a[3..]).spawn().unwrap();let mut status=0;let mut usage=[0i64;18];assert_eq!(unsafe{wait4(child.id() as i32,&mut status,0,usage.as_mut_ptr())},child.id() as i32);let code=if status&127==0{(status>>8)&255}else{128+(status&127)};fs::write(&a[1],format!("{{\"wallMs\":{},\"userCpuMs\":{},\"systemCpuMs\":{},\"peakRssKiB\":{},\"status\":{}}}",start.elapsed().as_secs_f64()*1000.0,usage[0] as f64*1000.0+usage[1] as f64/1000.0,usage[2] as f64*1000.0+usage[3] as f64/1000.0,usage[4],code)).unwrap();exit(code);}`;
await fs.writeFile(resolve(work,'measure.rs'),helper);
assert.equal((await execute(rustc,[resolve(work,'measure.rs'),'-o',resolve(work,'measure')])).status,0);
const files=await fs.readdir(deps);
async function dependency(name){const prefix='lib'+name.replaceAll('-','_')+'-';const choices=await Promise.all(files.filter(n=>n.startsWith(prefix)&&n.endsWith('.rlib')).map(async n=>({file:resolve(deps,n),mtime:(await fs.stat(resolve(deps,n))).mtimeMs})));assert.ok(choices.length,'Missing dependency '+name);choices.sort((a,b)=>b.mtime-a.mtime);await pin(choices[0].file);return choices[0].file;}
const runtime=await dependency('js-runtime');
const census=await Promise.all((await fs.readdir(world)).filter(n=>/-part-\d+$/.test(n)).map(async name=>({name,bytes:(await fs.stat(resolve(world,name,'src/lib.rs'))).size})));
census.sort((a,b)=>a.bytes-b.bytes);
const selected=[{label:'small',...census[0]},{label:'large',...census.at(-1)}],rows=[];
for(const part of selected){
  const dir=resolve(world,part.name),source=await pin(resolve(dir,'src/lib.rs')),toml=(await pin(resolve(dir,'Cargo.toml'))).toString();
  const snapshot=resolve(work,part.label+'.rs');await fs.writeFile(snapshot,source);
  const external=[];for(const match of toml.matchAll(/^([\w-]+)=\{path=/gm)){external.push('--extern',match[1].replaceAll('-','_')+'='+await dependency(match[1]));}
  part.sourceSha256=sha(source);part.dependencies=external;
  for(let round=0;round<2;round++)for(const cgu of round?[1,4,64]:[64,4,1]){
    const output=resolve(work,part.label+'-'+round+'-cgu'+cgu);await fs.mkdir(output,{recursive:true});
    assert.equal((await fs.readdir(output)).length,0,'Cold output must be empty; choose a fresh worktree to repeat');
    const argv=['--crate-name',part.name.replaceAll('-','_'),snapshot,'--crate-type','rlib','--edition=2024','--emit=link','-C','opt-level=3','-C','codegen-units='+cgu,'-C','lto=off','-C','embed-bitcode=no','--out-dir',output,'-L','dependency='+deps,...external];
    const row=await measured(part.label+'-'+round+'-cgu'+cgu,argv);const artifact=resolve(output,'lib'+part.name.replaceAll('-','_')+'.rlib');
    const bytes=await fs.readFile(artifact);rows.push({...row,kind:'actual-generated-part',part:part.name,label:part.label,round,codegenUnits:cgu,artifactBytes:bytes.length,artifactSha256:sha(bytes)});
    await checkpoint();
  }
}

// Independent source oracle checks a real original Unit.update fixture under all
// three backend configurations. It does not establish whole-battle parity.
const donor=resolve(reference,'work/candidate-function-own-data-literals/work/rust-unit-update-function-own-literals');
let fixture=(await pin(resolve(donor,'fixture.rs'))).toString();
const pool=await pin(resolve(donor,'fixture.utf16le'));await fs.writeFile(resolve(work,'fixture.utf16le'),pool);
fixture=fixture.replace(/include_bytes!\("[^"]+"\)/,'include_bytes!('+JSON.stringify(resolve(work,'fixture.utf16le'))+')');await fs.writeFile(resolve(work,'fixture.rs'),fixture);
let main=(await pin(resolve(donor,'main.rs'))).toString().replace('Value::Number(10000.0)','Value::Number(64.0)').replace('for trial in 0..3','for trial in 0..1');await fs.writeFile(resolve(work,'main.rs'),main);
const pinning=JSON.parse(await pin(resolve(reference,'config/unit-translation.json'))),game=(await pin(resolve(reference,pinning.source))).toString(),body=game.slice(pinning.start,pinning.end);assert.equal(sha(body),pinning.sha256);
const original=unitSpeederProbeSource(body),cut=original.indexOf('function run(index,mutate,label)');assert.ok(cut>0);
const js=original.slice(0,cut)+'\nvar benchFixture;function resetBench(){events=[];benchFixture=make(123);}function benchmarkUnitUpdates(n){for(var i=0;i<n;i++)update.call(benchFixture.u,benchFixture.dt);}function snapshotBench(){return JSON.stringify({events:events,unit:primitive(benchFixture.u),attrs:primitive(benchFixture.attrs),effects:primitive(benchFixture.fx),config:primitive(benchFixture.config),skill:primitive(benchFixture.skill),info:primitive(benchFixture.skill.info),sameCurrent:benchFixture.u.current_skill===benchFixture.skill,sameBasic:benchFixture.u.basic_skill===benchFixture.skill});}resetBench();';
const context=createContext(constants.DONT_CONTEXTIFY);runInContext(js,context);context.benchmarkUnitUpdates(64);const expected=JSON.parse(context.snapshotBench());
await fs.writeFile(resolve(work,'oracle-source.js'),js);await fs.writeFile(resolve(work,'expected.json.gz'),gzipSync(Buffer.from(JSON.stringify(expected))));
const behavior=[];
for(const cgu of [64,4,1]){
  const binary=resolve(work,'unit-fixture-cgu'+cgu),argv=['--crate-name','part_cgu_fixture',resolve(work,'main.rs'),'--edition=2024','-C','opt-level=3','-C','codegen-units='+cgu,'-C','lto=off','-C','embed-bitcode=no','-L','dependency='+deps,'--extern','js_runtime='+runtime,'-o',binary];
  const compilation=await measured('fixture-cgu'+cgu,argv),run=await execute(binary,[]);assert.equal(run.status,0,run.stderr);
  const observations=run.stdout.trim().split('\n').map(line=>JSON.parse(line.split('\t').slice(3).join('\t')));assert.equal(observations.length,2);for(const observation of observations)assert.deepEqual(observation,expected);
  await fs.writeFile(resolve(work,'fixture-cgu'+cgu+'.observations.gz'),gzipSync(Buffer.from(run.stdout)));
  behavior.push({codegenUnits:cgu,...compilation,observationsMatchedNode:true,eventCount:expected.events.length,binarySha256:sha(await fs.readFile(binary))});
}
for(const[file,hash]of inputs)assert.equal(sha(await fs.readFile(file)),hash,'Shared input changed '+file);
await checkpoint(true);
async function checkpoint(passed=false){await fs.writeFile(resolve(work,'report.json'),JSON.stringify({version:1,passed,complete:passed,compiler:{file:rustc,sha256:sha(await fs.readFile(rustc)),version:version.stdout},flags:{optLevel:3,lto:false,incremental:false,embedBitcode:false,debugInfo:0,fastMath:false},selection:{candidates:census.length,rule:'Minimum and maximum generated part source bytes; all intervening sizes retained in census',selected,census},inputs:[...inputs].map(([file,sha256])=>({file,sha256})),rows,behavior:passed?behavior:[],oracle:passed?{node:process.version,v8:process.versions.v8,flags:process.execArgv}:null,scope:'Cold direct rustc leaf-crate builds with read-only reused exact compiled dependencies. Front-end, LLVM and object emission included; Cargo scheduling, dependency rebuilding and final full-program linking excluded. No production defaults changed. Fixture parity is not complete battle qualification.',qualifiesFor10000Target:false},null,2)+'\n');}
async function measured(label,argv){const metrics=resolve(work,label+'.metrics.json'),run=await execute(resolve(work,'measure'),[metrics,rustc,...argv]);await fs.writeFile(resolve(work,label+'.stderr.gz'),gzipSync(Buffer.from(run.stderr)));assert.equal(run.status,0,run.stderr.slice(-4000));return{argv,metrics:JSON.parse(await fs.readFile(metrics,'utf8'))};}
async function execute(command,argv){return await new Promise((yes,no)=>{const child=spawn(command,argv,{cwd:reference,env:{...process.env,CARGO_INCREMENTAL:'0'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',no);child.on('close',(status,signal)=>yes({status,signal,stdout,stderr}));});}
