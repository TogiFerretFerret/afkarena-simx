// Durable sequential full-program build and oracle gate. Generated sources must
// already match their manifest. Source inputs remain frozen throughout build.
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);
const opt=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const label=opt('--label','allocation-wave');assert.match(label,/^[a-z0-9-]+$/);
const cadence=opt('--expected-gc-cadence','1');assert.match(cadence,/^[1-9][0-9]*$/);
const jobs=opt('--jobs','4');assert.match(jobs,/^[1-9][0-9]*$/);
const prefix=resolve(root,`benchmarks/validation/rust-program-${label}`);
const reportFile=prefix+'-chain.json',buildFile=prefix+'-build.json',fullFile=prefix+'-full.json';
await mkdir(resolve(root,'benchmarks/validation'),{recursive:true});
const report={version:1,passed:false,qualifiesFor10000Target:false,startedAt:new Date().toISOString(),pid:process.pid,stage:'starting',steps:[],scope:'Sequential frozen native build proof followed by original twenty measured/three warmup full-report and host-input comparison against pinned JS. This fixed fixture is not random20k-battle qualification.'};
const save=()=>writeFile(reportFile,JSON.stringify(report,null,2)+'\n');await save();
async function run(name,script,parameters){
  report.stage=name;await save();
  const stdoutFile=prefix+'-'+name+'.stdout',stderrFile=prefix+'-'+name+'.stderr';
  const stdout=await open(stdoutFile,'w'),stderr=await open(stderrFile,'w');
  const command=[process.execPath,resolve(root,script),...parameters],started=performance.now();
  const execution=await new Promise(accept=>{const child=spawn(command[0],command.slice(1),{cwd:root,env:process.env,stdio:['ignore',stdout.fd,stderr.fd]});let error=null;child.on('error',e=>{error=e.message});child.on('close',(status,signal)=>accept({status,signal,error,pid:child.pid??null,wallMs:performance.now()-started}));});
  await stdout.close();await stderr.close();
  report.steps.push({name,command,execution,stdoutFile,stderrFile});await save();
  assert.equal(execution.status,0,`Failed ${name}: ${await readFile(stderrFile,'utf8')}`);
}
try{
  await run('features','tools/rust-port/check-program-features.mjs',['--expected-gc-cadence',cadence]);
  await run('build','tools/rust-port/build-program.mjs',['--profile','release','--jobs',jobs,'--output',buildFile]);
  const build=JSON.parse(await readFile(buildFile));assert.equal(build.passed,true);assert.equal(build.changedInputs.length,0);report.build={file:buildFile,binary:build.binary,wallMs:build.wallMs};
  await run('full','tools/rust-port/check-program.mjs',['--profile','release','--binary',build.binary.file,'--build-proof',buildFile,'--output',fullFile,...(args.includes('--require-measured-nested-copy')?['--require-measured-nested-copy']:[])]);
  const full=JSON.parse(await readFile(fullFile));assert.equal(full.passed,true);assert.equal(full.completed,20);
  report.full={file:fullFile,completed:full.completed,performance:full.performance??null,battlesPerSecond:full.nativeReport?.battlesPerSecond??full.actualReport?.battlesPerSecond??null};
  report.passed=true;report.stage='passed';
}catch(error){report.error=String(error.stack??error);report.stage='failed';process.exitCode=1;}
report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({reportFile,passed:report.passed,stage:report.stage,full:report.full,error:report.error}));
