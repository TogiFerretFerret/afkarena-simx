import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Extract pinned Debian packages into work/. No package installation, privilege
// escalation, kernel change, or change to the benchmark process is performed.
const root=resolve(import.meta.dirname,'..');
const directory=resolve(root,process.argv[2]??'work/downloads/perf');
const configFile='config/native-profiler-packages.json';
const config=JSON.parse(await readFile(resolve(root,configFile)));
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(command,args,options={})=>{
 const result=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,...options});
 if(result.error)throw result.error;
 assert.equal(result.status,0,result.stderr);return result;
};
await mkdir(directory,{recursive:true});
const downloads=resolve(directory,'packages');await mkdir(downloads,{recursive:true});
for(const row of config.packages){
 const path=resolve(downloads,basename(row.url));
 let bytes=await readFile(path).catch(()=>null);
 if(!bytes){run('curl',['--fail','--location','--silent','--show-error',row.url,'--output',path]);bytes=await readFile(path);}
 assert.equal(bytes.length,row.size,row.name+' package size');
 assert.equal(sha(bytes),row.sha256,row.name+' package SHA256');
 run('dpkg-deb',['--extract',path,directory]);
}
const binary=resolve(directory,'usr/bin/perf'),libraryPath=resolve(directory,'usr/lib/x86_64-linux-gnu');
const env={...process.env,LD_LIBRARY_PATH:libraryPath+(process.env.LD_LIBRARY_PATH?':'+process.env.LD_LIBRARY_PATH:'')};
const version=run(binary,['version'],{env}).stdout.trim();
const libraries=run('ldd',[binary],{env}).stdout;
assert.ok(!libraries.includes('not found'),libraries);
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const launcher=resolve(directory,'perf');
await writeFile(launcher,'#!/bin/sh\nexport LD_LIBRARY_PATH='+quote(libraryPath)+'${LD_LIBRARY_PATH:+:"$LD_LIBRARY_PATH"}\nexec '+quote(binary)+' "$@"\n');
await chmod(launcher,0o755);
assert.equal(run(launcher,['version']).stdout.trim(),version);
const smokeArgs=['stat','-e','cpu-clock:u','--','true'];
const smoke=spawnSync(launcher,smokeArgs,{cwd:root,encoding:'utf8'});
const report={version:1,passed:true,scope:'Pinned userspace profiling tool bootstrap only; no battle throughput or fidelity claim.',binary,launcher,binarySha256:sha(await readFile(binary)),reportedVersion:version,packages:config.packages,sources:{[configFile]:sha(await readFile(resolve(root,configFile))),'tools/bootstrap-native-profiler.mjs':sha(await readFile(import.meta.filename))},libraries,userCPUClockSmoke:{args:smokeArgs,status:smoke.status,stdout:smoke.stdout,stderr:smoke.stderr}};
await writeFile(resolve(root,'benchmarks/validation/native-profiler-bootstrap.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({launcher,version,report:'benchmarks/validation/native-profiler-bootstrap.json'}));
