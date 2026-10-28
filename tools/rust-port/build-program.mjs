import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {finished} from 'node:stream/promises';
import {gzipSync} from 'node:zlib';
import {parse} from '@babel/parser';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);
if(args.includes('--help')){console.log('node tools/rust-port/build-program.mjs [--manifest work/rust-battle-full/program-manifest.json] [--profile release|debug] [--jobs 2] [--target-dir work/rust-port-shared-target] [--output PATH/build-proof.json] [--snapshot-only]');process.exit(0);}
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const manifestFile=resolve(root,option('--manifest','work/rust-battle-full/program-manifest.json'));
const workspace=dirname(manifestFile),manifestBytes=await readFile(manifestFile),manifest=JSON.parse(manifestBytes);
const profile=option('--profile','release'),jobs=Number(option('--jobs','2'));
assert.ok(['debug','release'].includes(profile),'Profile must be debug or release');
assert.ok(Number.isInteger(jobs)&&jobs>0,'Jobs must be a positive integer');
const targetDir=resolve(root,option('--target-dir','work/rust-port-shared-target'));
const output=resolve(root,option('--output',relative(root,resolve(workspace,'build-proof.json'))));
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin');
const cargo=resolve(rustBin,'cargo'),rustc=resolve(rustBin,'rustc');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputs=new Map([[manifestFile,sha(manifestBytes)]]);
async function track(file){const absolute=resolve(root,file);inputs.set(absolute,sha(await readFile(absolute)));}
async function tree(directory,generated=false){
 for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.isDirectory()){if(entry.name!=='target'&&entry.name!=='.git')await tree(resolve(directory,entry.name),generated);}
  else if(entry.name.endsWith('.rs')||entry.name.endsWith('.utf16le')||entry.name==='Cargo.toml'||entry.name==='Cargo.lock'||generated&&entry.name==='manifest.json')await track(resolve(directory,entry.name));
 }
}
async function snapshot(){
 inputs.clear();inputs.set(manifestFile,sha(await readFile(manifestFile)));
 await tree(workspace,true);
 for(const directory of ['crates/js-runtime','crates/battle-core','third-party'])await tree(resolve(root,directory));
 for(const file of ['Cargo.toml','Cargo.lock','rust-toolchain.toml','package.json','package-lock.json','config/source-oracle-runtime.json','tools/rust-port/build-program.mjs','tools/rust-port/program-host.rs','tools/rust-port/generate-program.mjs','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/bindings.mjs'])await track(file);
 for(const file of [cargo,rustc])await track(file);
 for(const unit of manifest.units)await track(unit.file);
 for(const file of externalInputs)await track(file);
 return Object.fromEntries(inputs);
}
const externalInputs=new Set(),pending=[parse((await readFile(manifest.units[0].file)).toString('utf8'),{sourceType:'script'})];
while(pending.length){const node=pending.pop();
 if(node.type==='AssignmentExpression'&&node.left?.type==='Identifier'&&node.left.name==='__nativeTablePath'){
  assert.equal(node.operator,'=');assert.equal(node.right?.type,'StringLiteral','External table path must remain literal');externalInputs.add(resolve(root,node.right.value));
 }
 for(const [key,value] of Object.entries(node)){if(['loc','extra','comments','tokens'].includes(key))continue;if(Array.isArray(value)){for(const child of value)if(child&&typeof child.type==='string')pending.push(child);}else if(value&&typeof value.type==='string')pending.push(value);}
}
assert.equal(externalInputs.size,1,'Expected exactly one source-declared external table bundle');
const before=await snapshot();
const frozenSourceMismatches=manifest.units.filter(unit=>before[resolve(unit.file)]!==unit.sourceSha256).map(unit=>unit.file);
assert.equal(frozenSourceMismatches.length,0,'Frozen source differs from manifest');
const compilerManifestMismatches=Object.entries(manifest.sources??{}).filter(([file,digest])=>before[resolve(root,file)]!==digest).map(([file,expected])=>({file,expected,actual:before[resolve(root,file)]??null}));
const command=[cargo,'build','--locked','--manifest-path',resolve(workspace,'Cargo.toml'),'-p','rust-battle-program','-j',String(jobs),...(profile==='release'?['--release']:[])];
const env={...process.env,PATH:rustBin+':'+(process.env.PATH??''),CARGO_TARGET_DIR:targetDir,RUSTC:rustc,RUSTC_WRAPPER:'',RUSTC_WORKSPACE_WRAPPER:''};
const binary=resolve(targetDir,profile,'rust-battle-program');
const toolVersion=tool=>{const result=spawnSync(tool,['--version','--verbose'],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
const buildEnvironment=Object.fromEntries(Object.entries(env).filter(([key])=>key==='RUSTC'||key==='RUSTC_WRAPPER'||key==='RUSTC_WORKSPACE_WRAPPER'||key==='RUSTFLAGS'||key==='CARGO_ENCODED_RUSTFLAGS'||key==='CARGO_TARGET_DIR'||key.startsWith('CARGO_PROFILE_')||key.startsWith('CARGO_BUILD_')));
const report={version:1,prepared:true,completed:false,passed:false,qualifiesFor10000Target:false,scope:'Binds an actual Cargo-produced binary to the unchanged generated Rust workspace, manifest, runtime, compiler inputs, frozen JavaScript, host adapter and external table snapshot. Does not establish battle semantics or throughput.',startedAt:new Date().toISOString(),manifest:{file:manifestFile,sha256:sha(manifestBytes)},buildProfile:profile,command,cwd:root,environment:buildEnvironment,toolchain:{cargo:toolVersion(cargo),rustc:toolVersion(rustc)},inputs:before,externalInputs:[...externalInputs],compilerManifestMismatches,binaryBoundToManifest:false};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
if(args.includes('--snapshot-only')){console.log(JSON.stringify({output,snapshotOnly:true,inputs:Object.keys(before).length,compilerManifestMismatches}));process.exit(0);}
const prefix=output.replace(/\.json$/,''),stdoutFile=prefix+'.cargo.stdout',stderrFile=prefix+'.cargo.stderr';
const stdout=createWriteStream(stdoutFile),stderr=createWriteStream(stderrFile),begin=performance.now();
const result=await new Promise(resolveResult=>{
 const child=spawn(command[0],command.slice(1),{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let error=null;child.on('error',value=>{error=value.message;});
 child.stdout.pipe(stdout);child.stderr.pipe(stderr);
 child.on('close',(status,signal)=>resolveResult({status,signal,error}));
});
await Promise.all([finished(stdout),finished(stderr)]);
let after={},snapshotError=null;try{after=await snapshot();}catch(error){snapshotError=String(error.stack??error);after=Object.fromEntries(inputs);}
const changedInputs=[];
for(const file of new Set([...Object.keys(before),...Object.keys(after)]))if(before[file]!==after[file])changedInputs.push({file,before:before[file]??null,after:after[file]??null});
let binarySha=null;try{binarySha=sha(await readFile(binary));}catch{}
for(const file of [stdoutFile,stderrFile])await writeFile(file+'.gz',gzipSync(await readFile(file)));
Object.assign(report,{completed:true,finishedAt:new Date().toISOString(),wallMs:performance.now()-begin,process:result,inputsAfter:after,snapshotError,changedInputs,unchanged:changedInputs.length===0&&snapshotError===null,binary:{file:binary,sha256:binarySha},logs:{stdout:stdoutFile+'.gz',stderr:stderrFile+'.gz'}});
report.binaryBoundToManifest=result.status===0&&binarySha!==null&&report.unchanged;
report.passed=report.binaryBoundToManifest&&compilerManifestMismatches.length===0;
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,passed:report.passed,binaryBoundToManifest:report.binaryBoundToManifest,buildStatus:result.status,changedInputs,compilerManifestMismatches,binary:report.binary}));
if(!report.passed)process.exitCode=1;
