import { readFile,writeFile,mkdir,stat } from 'node:fs/promises';
import { openSync,closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve,basename } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2);
function option(key,fallback){const i=args.indexOf(key);return i<0?fallback:args[i+1];}
const input=resolve(root,option('--input','work/native-oracle.js'));
const compiler=resolve(root,option('--compiler','work/downloads/hermes-build/bin/shermes'));
const output=resolve(root,option('--output','work/native-oracle'));
const ccOpt=option('--cc-opt','O1');
const binaryPools=!args.includes('--text-pools');
const plumbing=args.includes('--plumbing');
assert.ok(['O0','Og','O1','O2','O3','Os'].includes(ccOpt),'--cc-opt must be a supported GCC optimization level');
const sha=contents=>createHash('sha256').update(contents).digest('hex');
const metadata=JSON.parse(await readFile(input+'.metadata.json','utf8'));
assert.equal(sha(await readFile(input)),metadata.outputSha256,'Emitted source changed after reference creation');
const compilerSha256=sha(await readFile(compiler));
async function dependencyStatus(){
 const adapters=metadata.adapterInputs?Object.entries(metadata.adapterInputs):[metadata.sourceRuntime,metadata.host,metadata.clock].filter(Boolean).map(item=>[item.file,item.sha256]);
 const entries=[...adapters,...Object.entries(metadata.sourceInputs??{})];
 const checks=[];
 for(const [file,expected]of entries){let actual=null;try{actual=sha(await readFile(resolve(root,file)))}catch{}checks.push({file,expected,actual,matched:actual===expected});}
 for(const item of [metadata.tableBundle,metadata.hostInputs,metadata.reference].filter(Boolean)){
  let actual=null;try{actual=sha(await readFile(item.file))}catch{}checks.push({file:item.file,expected:item.sha256,actual,matched:actual===item.sha256});
 }
 return{completeAdapterManifest:Boolean(metadata.adapterInputs),completeSourceManifest:Boolean(metadata.sourceInputs),current:checks.every(item=>item.matched),checks};
}
const dependenciesAtStart=await dependencyStatus();
assert.ok(dependenciesAtStart.current||plumbing,'Reference/helper inputs changed after emission; regenerate, or use --plumbing for explicitly unqualified compiler diagnosis');
const reference=JSON.parse(await readFile(metadata.reference.file,'utf8'));
// Do not spend a native compile on an emitter that has not passed its copied-source Node gate.
const nodeOutput=await readFile(input+'.node.stdout','utf8');
const nodeResult=JSON.parse(nodeOutput.trim().split('\n').at(-1));
assert.deepEqual(nodeResult.results,reference.results,'Copied-source versus emitted-Node gate is not satisfied');
assert.ok((await stat(input+'.node.stdout')).mtimeMs>=(await stat(input)).mtimeMs,'Node gate predates emitted source');
await mkdir(resolve(root,'work'),{recursive:true});
async function run(command,parameters,stdoutPath,stderrPath,env=process.env){
 const stdout=openSync(stdoutPath,'w'),stderr=openSync(stderrPath,'w');
 try{return await new Promise((resolve,reject)=>{const child=spawn(command,parameters,{cwd:root,env,stdio:['ignore',stdout,stderr]});child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});}
 finally{closeSync(stdout);closeSync(stderr);}
}
function firstDifference(actual,expected,path='$'){
 if(Object.is(actual,expected))return null;
 if(typeof actual!==typeof expected||actual===null||expected===null||typeof actual!=='object')return{path,expected,actual};
 if(Array.isArray(actual)!==Array.isArray(expected))return{path,reason:'array_type'};
 const ak=Object.keys(actual).sort(),ek=Object.keys(expected).sort();
 if(JSON.stringify(ak)!==JSON.stringify(ek))return{path,reason:'keys',expectedKeys:ek,actualKeys:ak};
 for(const key of ek){const result=firstDifference(actual[key],expected[key],`${path}.${key}`);if(result)return result;}
 return null;
}
const compileArgs=['-O',`-Wc,-${ccOpt},-g0,-ffp-contract=off`,'-keep-temp',input,'-o',output];
const poolDirectory=output+'.string-pools';
if(binaryPools)await mkdir(poolDirectory,{recursive:true});
const compileEnv={...process.env};
if(binaryPools)compileEnv.SHERMES_BINARY_STRING_DIR=poolDirectory;
else delete compileEnv.SHERMES_BINARY_STRING_DIR;
const start=performance.now();
const compiled=await run(compiler,compileArgs,output+'.compile.stdout',output+'.compile.stderr',compileEnv);
const compileMs=performance.now()-start;
if(compiled.code!==0){console.error(await readFile(output+'.compile.stderr','utf8'));throw new Error(`Native compile failed (${compiled.code??compiled.signal})`);}
const executeStart=performance.now();
const executed=await run(output,['-Xhermes-internal-test-methods'],output+'.stdout',output+'.stderr');
const executionWallMs=performance.now()-executeStart;
if(executed.code!==0){console.error(await readFile(output+'.stderr','utf8'));throw new Error(`Native execution failed (${executed.code??executed.signal})`);}
const text=await readFile(output+'.stdout','utf8');
const actual=JSON.parse(text.trim().split('\n').at(-1));
const difference=firstDifference(actual.results,reference.results);
const dependenciesAtFinish=await dependencyStatus();
const stringPools=[];
if(binaryPools)for(const name of ['s_ascii_pool.bin','s_u16_pool.bin','s_strings.bin']){
 const file=resolve(poolDirectory,name),contents=await readFile(file);stringPools.push({file,bytes:contents.length,sha256:sha(contents)});
}
const report={version:1,engine:'Static Hermes AOT original-source factories',input,output,
 inputSha256:metadata.outputSha256,compilerSha256,compileArgs,compileMs,executionWallMs,
 binaryPools,stringPools,dependenciesAtStart,dependenciesAtFinish,plumbing,
 scenario:metadata.scenario,completed:actual.completed,elapsedMs:actual.elapsedMs,battlesPerSecond:actual.battlesPerSecond,
 finalStateMatched:difference===null,firstDifference:difference,
 hostInputConsumption:actual.hostInputConsumption,expectedHostInputs:metadata.hostInputs,
 fullStateCapture:true,qualifiesFor10000Target:false,
 qualification:'Single emitted fixture paired terminal state and source-host events; full ordered battle trace and broad corpus qualification are still required',
 reference:metadata.reference,limitations:metadata.limitations};
const stamp=new Date().toISOString().replaceAll(':','-');
const directory=resolve(root,'benchmarks/results');await mkdir(directory,{recursive:true});
const reportPath=resolve(directory,`${stamp}-native-${basename(output)}.json`);
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
await writeFile(output+'.comparison.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(difference||(!dependenciesAtFinish.current&&!plumbing))process.exitCode=1;
