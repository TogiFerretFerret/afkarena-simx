import { readFile,mkdir,access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve,delimiter } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'),'utf8'));
const directory=resolve(root,'work/downloads');
const jobs=Number(process.argv[2]??3);
assert.ok(Number.isInteger(jobs)&&jobs>0,'Usage: node tools/native-compiler-build.mjs [JOBS]');
await mkdir(directory,{recursive:true});
const exists=async path=>{try{await access(path);return true}catch{return false}};
async function run(command,args,env=process.env,cwd=root){
  await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env,stdio:'inherit'});
    child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(`${command} failed (${code??signal})`)));
  });
}
for(const [name,spec] of Object.entries({source:config.source,cmake:config.cmake,ninja:config.ninja})){
  const archive=resolve(directory,spec.archive);
  if(!await exists(archive))await run('curl',['--fail','--location','--retry','2','--silent','--show-error','--output',archive,spec.url]);
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),spec.sha256,`Archive checksum mismatch: ${name}`);
  const destination=resolve(directory,spec.directory);
  if(!await exists(destination)){
    if(name==='ninja')await run('unzip',['-o',archive,'-d',destination]);
    else await run('tar',['-xzf',archive,'-C',directory]);
  }
}
const sourceDirectory=resolve(directory,config.source.directory);
for(const manifestPath of config.patches??[]){
  const manifest=JSON.parse(await readFile(resolve(root,manifestPath),'utf8'));
  assert.equal(manifest.baseCommit,config.commit,'Patch base differs from compiler source');
  assert.equal(createHash('sha256').update(await readFile(resolve(root,manifest.patch))).digest('hex'),manifest.sha256,'Patch checksum mismatch');
  const hashes=await Promise.all(manifest.files.map(async file=>createHash('sha256').update(await readFile(resolve(sourceDirectory,file.path))).digest('hex')));
  if(hashes.every((hash,index)=>hash===manifest.files[index].patchedSha256))continue;
  assert.ok(hashes.every((hash,index)=>hash===manifest.files[index].originalSha256),'Compiler source has unexpected modifications; refusing a partial patch');
  await run('patch',['-p1','--forward','--batch','--input',resolve(root,manifest.patch)],process.env,sourceDirectory);
  for(const file of manifest.files)assert.equal(createHash('sha256').update(await readFile(resolve(sourceDirectory,file.path))).digest('hex'),file.patchedSha256,'Patched source checksum mismatch');
}
const cmake=resolve(directory,config.cmake.directory,'bin/cmake');
const build=resolve(directory,'hermes-build');
const env={...process.env,PATH:`${resolve(directory,config.ninja.directory)}${delimiter}${process.env.PATH}`};
await run(cmake,['-S',resolve(directory,config.source.directory),'-B',build,'-G','Ninja',...config.configureFlags],env);
await run(cmake,['--build',build,'--target',...config.targets,'-j',String(jobs)],env);
await run(resolve(build,'bin/shermes'),['--version'],env);
console.log(`Built ${config.expectedCompiler}; source-fidelity and battle-throughput gates remain required.`);
