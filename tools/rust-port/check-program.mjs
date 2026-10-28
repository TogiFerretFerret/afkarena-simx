import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse as parseSource} from '@babel/parser';
import assert from 'node:assert/strict';
import {compareNativeReports,firstDifference} from '../native-report-compare.mjs';

const root=resolve(import.meta.dirname,'../..');
const args=process.argv.slice(2);
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const manifestFile=resolve(root,option('--manifest','work/rust-battle-full/program-manifest.json'));
const manifestBytes=await readFile(manifestFile);
const manifest=JSON.parse(manifestBytes);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
if(args.includes('--oracle')){
 assert.equal(process.version,profile.node);
 assert.equal(process.versions.v8,profile.v8);
 assert.deepEqual(process.execArgv,profile.rawBitReferenceFlags);
 const context=vm.createContext(vm.constants.DONT_CONTEXTIFY);
 Object.assign(context,{
  print:(...values)=>process.stdout.write(values.join(' ')+'\n'),
  hermescli:{loadFile:path=>new Uint8Array(readFileSync(path))},
  __nativeDiagnosticDigest:text=>sha(text)
 });
 for(const unit of manifest.units){
  const bytes=await readFile(unit.file);
  assert.equal(sha(bytes),unit.sourceSha256,'Frozen source changed');
  vm.runInContext(bytes.toString('utf8'),context,{filename:unit.file});
 }
 await new Promise(resolve=>process.stdout.write('',resolve));
 process.exit(0);
}
assert.equal(manifest.units.length,7,'A whole-program gate requires all seven modules');
const binary=resolve(root,option('--binary','work/rust-port-shared-target/debug/rust-battle-program'));
const output=resolve(root,option('--output','benchmarks/validation/rust-full-program.json'));
await mkdir(dirname(output),{recursive:true});
const artifactPrefix=output.replace(/\.json$/,'');
const binaryBefore=sha(await readFile(binary));
for(const unit of manifest.units)assert.equal(sha(await readFile(unit.file)),unit.sourceSha256);
const tracked=new Map([[manifestFile,sha(manifestBytes)]]);
async function track(file){const absolute=resolve(root,file);tracked.set(absolute,sha(await readFile(absolute)));}
async function trackTree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await trackTree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await track(file);}}
for(const unit of manifest.units)await track(unit.file);
// The fixed harness loads its immutable table bundle through this binding.
// Extract its literal path without executing source or guessing a workspace path.
const externalInputs=new Set();
const sourceTree=parseSource((await readFile(manifest.units[0].file)).toString('utf8'),{sourceType:'script'});
const pending=[sourceTree];
while(pending.length){const node=pending.pop();
 if(node.type==='AssignmentExpression'&&node.left?.type==='Identifier'&&node.left.name==='__nativeTablePath'){
  assert.equal(node.operator,'=','External table path must be a simple literal assignment');
  assert.equal(node.right?.type,'StringLiteral','External table path must remain literal');
  externalInputs.add(resolve(root,node.right.value));
 }
 for(const [key,value] of Object.entries(node)){if(key==='loc'||key==='extra'||key==='comments'||key==='tokens')continue;if(Array.isArray(value)){for(const child of value)if(child&&typeof child.type==='string')pending.push(child);}else if(value&&typeof value.type==='string')pending.push(value);}
}
assert.equal(externalInputs.size,1,'The fixed harness must have exactly one external table bundle');
for(const file of externalInputs)await track(file);
for(const directory of ['crates/js-runtime','crates/battle-core','third-party'])await trackTree(directory);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/check-program.mjs','tools/native-report-compare.mjs','tools/rust-port/generate-program.mjs','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/bindings.mjs'])await track(file);
const timeout=Number(option('--timeout-ms','600000'));
const run=(command,argv,env)=>{
 const begin=performance.now();
 const result=spawnSync(command,argv,{cwd:root,env,encoding:'utf8',timeout,maxBuffer:128*1024*1024});
 return{status:result.status,signal:result.signal,error:result.error?.message??null,
  wallMs:performance.now()-begin,stdout:result.stdout??'',stderr:result.stderr??''};
};
const oracle=run(process.execPath,[...profile.rawBitReferenceFlags,import.meta.filename,'--oracle','--manifest',manifestFile],{...process.env,NODE_OPTIONS:profile.rawBitReferenceNodeOptions});
const native=run(binary,[],{...process.env,RUST_PORT_TRACE:'0'});
for(const [name,result] of [['oracle',oracle],['native',native]]){
 await writeFile(artifactPrefix+'.'+name+'.stdout.gz',gzipSync(result.stdout));
 await writeFile(artifactPrefix+'.'+name+'.stderr.gz',gzipSync(result.stderr));
}
function parse(text){
 for(const line of text.trim().split('\n').reverse()){
  try{const value=JSON.parse(line);if(value&&typeof value==='object'&&'completed' in value)return value;}catch{}
 }
 return null;
}
const expected=parse(oracle.stdout),actual=parse(native.stdout);
const difference=expected&&actual?compareNativeReports(actual,expected):{reason:'Missing complete battle report'};
const hostDifference=expected&&actual?firstDifference(actual.hostInputConsumption,expected.hostInputConsumption,'$.hostInputConsumption'):null;
const binaryUnchanged=sha(await readFile(binary))===binaryBefore;
const changedInputs=[];for(const [file,before] of tracked){let after=null;try{after=sha(await readFile(file));}catch{}if(after!==before)changedInputs.push({file,before,after});}
const expectedBattles=20;
const completedWorkload=expected?.completed===expectedBattles&&actual?.completed===expectedBattles&&expected.results?.length===expectedBattles&&actual.results?.length===expectedBattles;
const validTiming=[expected,actual].every(report=>Number.isFinite(report?.elapsedMs)&&report.elapsedMs>0&&Number.isFinite(report?.battlesPerSecond)&&report.battlesPerSecond>0);
const passed=oracle.status===0&&native.status===0&&!!actual&&!!expected&&!difference&&!hostDifference&&binaryUnchanged&&changedInputs.length===0&&completedWorkload&&validTiming;
const compact=result=>({status:result.status,signal:result.signal,error:result.error,wallMs:result.wallMs});
const report={version:1,passed,qualifiesFor10000Target:false,
 scope:'Seven frozen source modules executed as generated native Rust and pinned Node. Exact non-timing report and host consumption comparison. This fixed callback fixture does not qualify full-scene random battles or 20k battle coverage.',
 buildProfile:option('--profile','debug'),traceEnabled:false,
 manifest:{file:manifestFile,sha256:sha(manifestBytes)},
 binary:{file:binary,sha256:binaryBefore,unchanged:binaryUnchanged},
 provenance:{inputs:Object.fromEntries(tracked),externalInputs:[...externalInputs],unchanged:changedInputs.length===0,changedInputs,binaryBoundToManifest:false},
 expectedBattles,completedWorkload,validTiming,
 producer:{file:'tools/rust-port/check-program.mjs',sha256:sha(await readFile(import.meta.filename))},
 oracle:compact(oracle),native:compact(native),firstDifference:difference,hostDifference,
 completed:actual?.completed??0,battlesPerSecond:passed?actual.battlesPerSecond:null,
 nativeReport:actual,referenceReport:expected};
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,passed,completed:report.completed,battlesPerSecond:report.battlesPerSecond,firstDifference:difference,hostDifference,native:report.native}));
if(!passed)process.exitCode=1;
