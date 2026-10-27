import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/battle-boundary-trace'),sha=b=>createHash('sha256').update(b).digest('hex'),hash=async file=>sha(await readFile(resolve(root,file)));
const buildFile=resolve(directory,'native-fast-build.json'),build=JSON.parse(await readFile(buildFile));assert.equal(build.passed,true);
const dependencies=[{file:buildFile,sha256:await hash(buildFile)},{file:build.output,sha256:build.outputSha256},{file:build.helper.file,sha256:build.helper.sha256},{file:build.privateVM.output,sha256:build.privateVM.privateSha256},{file:build.hostInputs.file,sha256:build.hostInputs.sha256},{file:'tools/run-battle-boundary-native.mjs',sha256:await hash('tools/run-battle-boundary-native.mjs')},...build.dependenciesAtFinish];
for(const unit of build.units)dependencies.push({file:unit.file,sha256:unit.sourceSha256??unit.sha256},{file:unit.object,sha256:unit.objectSha256});
for(const row of dependencies)assert.equal(await hash(row.file),row.sha256,'Stale native trace input '+row.file);
const environment={PATH:'/usr/bin:/bin',HOME:resolve(root,'work'),LANG:'C',LD_LIBRARY_PATH:dirname(build.privateVM.output)};
const ldd=spawnSync('ldd',[build.output],{cwd:root,env:environment,encoding:'utf8'});assert.equal(ldd.status,0);assert.ok(ldd.stdout.includes('libhermesvm.so => '+build.privateVM.output));await writeFile(resolve(directory,'native-fast.ldd'),ldd.stdout);
const stdout=resolve(directory,'native-fast.stdout'),stderr=resolve(directory,'native-fast.stderr'),out=openSync(stdout,'w'),err=openSync(stderr,'w'),runtimeArgs=['-Xhermes-internal-test-methods'];let execution;
try{execution=await new Promise((accept,reject)=>{const child=spawn(build.output,runtimeArgs,{cwd:root,env:environment,stdio:['ignore',out,err]});child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}));});}finally{closeSync(out);closeSync(err);}
const dependenciesAtFinish=[];for(const row of dependencies){const actual=await hash(row.file);dependenciesAtFinish.push({...row,matched:actual===row.sha256});assert.equal(actual,row.sha256,'Native trace input changed during execution '+row.file);}
const report={version:1,execution,scope:'Actual optimized native narrower boundary-state trace execution only. Independent source and ordered snapshot comparison must pass a separate final gate.',passed:execution.code===0,semanticReportMatched:null,qualifiesFor10000Target:false,build:{file:buildFile,sha256:await hash(buildFile)},output:build.output,outputSha256:await hash(build.output),stdout:{file:stdout,sha256:await hash(stdout)},stderr:{file:stderr,sha256:await hash(stderr)},environment,runtimeArgs,dependenciesAtFinish};
await writeFile(resolve(directory,'native-execution.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));assert.equal(execution.code,0);
