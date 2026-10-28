// Durable post-build trace qualification. Never starts from a partial build.
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {verifyBuildProof} from './build-proof.mjs';
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2),opt=(n,f)=>args.includes(n)?args[args.indexOf(n)+1]:f;
const chainFile=resolve(root,opt('--chain','benchmarks/validation/rust-program-allocation-wave-chain.json'));
const output=resolve(root,opt('--output','benchmarks/validation/rust-native-prefix-after-full.json'));
const work=resolve(root,opt('--work','work/rust-reused-trace-prefix'));
const sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(dirname(output),{recursive:true});
const report={version:1,passed:false,qualifiesFor10000Target:false,pid:process.pid,startedAt:new Date().toISOString(),stage:'checking-full-pass',steps:[],scope:'Native first1000 ordered selected-state events, full transitive snapshot closure and terminal report, gated by a completed unchanged full-program build and20-battle exact gate. Later trace events and exhaustive graph coverage remain unqualified.'};
const save=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');await save();
async function execute(name,script,parameters){
 report.stage=name;await save();const stdoutFile=output+'.'+name+'.stdout',stderrFile=output+'.'+name+'.stderr',out=await open(stdoutFile,'w'),err=await open(stderrFile,'w'),command=[process.execPath,resolve(root,script),...parameters],start=performance.now();
 const result=await new Promise(accept=>{const child=spawn(command[0],command.slice(1),{cwd:root,env:process.env,stdio:['ignore',out.fd,err.fd]});let error=null;child.on('error',e=>error=String(e));child.on('close',(status,signal)=>accept({pid:child.pid,status,signal,error,wallMs:performance.now()-start}));});
 await out.close();await err.close();report.steps.push({name,command,...result,stdoutFile,stderrFile});await save();assert.equal(result.status,0,'Failed '+name);assert.equal(result.signal,null);assert.equal(result.error,null);
}
try{
 const chainBytes=await readFile(chainFile),chain=JSON.parse(chainBytes);assert.equal(chain.passed,true,'Full build chain has not passed');assert.equal(chain.stage,'passed');assert.equal(chain.full.completed,20);
 const buildFile=resolve(root,chain.build.file),fullFile=resolve(root,chain.full.file),buildBytes=await readFile(buildFile),fullBytes=await readFile(fullFile),build=JSON.parse(buildBytes),full=JSON.parse(fullBytes);assert.equal(full.passed,true);assert.equal(full.completed,20);assert.equal(full.provenance.binaryBoundToManifest,true);assert.equal(full.provenance.unchanged,true);assert.equal(full.provenance.buildProof.sha256,sha(buildBytes));
 const manifestFile=resolve(root,build.manifest.file),manifestBytes=await readFile(manifestFile),binaryFile=resolve(root,build.binary.file),binarySha=sha(await readFile(binaryFile));
 async function verify(){const {result}=await verifyBuildProof(buildFile,{root,manifestFile,manifestSha256:sha(manifestBytes),binarySha256:binarySha,buildProfile:'release'});assert.equal(result.valid,true,JSON.stringify(result));return result;}
 report.gate={chain:{file:chainFile,sha256:sha(chainBytes)},full:{file:fullFile,sha256:sha(fullBytes)},build:{file:buildFile,sha256:sha(buildBytes)},verification:await verify()};await save();
 await execute('prepare','tools/rust-port/prepare-reused-trace.mjs',['--prefix-events','1000','--output',work]);
 // This branch must reuse exactly the already accepted derived Node prefix.
 const accepted=JSON.parse(await readFile(resolve(root,'benchmarks/validation/2026-10-28T20-23-55.444Z-rust-reused-trace-source.json')));assert.equal(accepted.passed,true);
 for(const name of ['unit-0-diagnostic.js','unit-6-diagnostic.js']){const file=resolve(work,name),previous=Object.entries(accepted.inputs).find(([p])=>p.endsWith('/'+name));assert.ok(previous,'Accepted source missing '+name);assert.equal(sha(await readFile(file)),previous[1],'Derived source changed: requires a new independent Node reference');}
 report.preparedVerification=await verify();await save();
 const traceFile=output+'.trace.json';await execute('native','tools/rust-port/run-reused-trace.mjs',['--work',work,'--max-rss-gib','12','--timeout-ms','120000','--output',traceFile]);
 const traceBytes=await readFile(traceFile),trace=JSON.parse(traceBytes);assert.equal(trace.passed,true);assert.equal(trace.execution.status,0);assert.equal(trace.changedInputs.length,0);assert.equal(trace.changedLibraries.length,0);assert.equal(trace.comparison.comparison.events,1000);assert.equal(trace.comparison.comparison.requiredSnapshots,1437);
 report.trace={file:traceFile,sha256:sha(traceBytes)};report.finalVerification=await verify();for(const f of [report.gate.chain,report.gate.full,report.gate.build])assert.equal(sha(await readFile(f.file)),f.sha256,'Gate input changed');report.passed=true;report.stage='passed';
}catch(error){report.error=String(error.stack??error);report.stage='failed';process.exitCode=1;}
report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({output,passed:report.passed,stage:report.stage,error:report.error}));
