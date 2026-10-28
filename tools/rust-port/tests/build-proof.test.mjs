import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyBuildProof} from '../build-proof.mjs';

test('build proof validates stable inputs and rejects stale or failed bindings',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'rust-build-proof-'));
 try{
  const sha=text=>createHash('sha256').update(text).digest('hex');
  const manifestFile=resolve(root,'program-manifest.json'),manifestSha256=sha('manifest'),inputs={};
  const files=['program-manifest.json','tools/rust-port/build-program.mjs','tools/rust-port/program-host.rs','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/bindings.mjs','crates/js-runtime/src/lib.rs'];
  for(const file of files){const path=resolve(root,file);await mkdir(dirname(path),{recursive:true});const bytes=file==='program-manifest.json'?'manifest':file;await writeFile(path,bytes);inputs[path]=sha(bytes);}
  const proof={version:1,prepared:true,completed:true,passed:true,binaryBoundToManifest:true,unchanged:true,process:{status:0,signal:null,error:null},snapshotError:null,changedInputs:[],compilerManifestMismatches:[],binary:{sha256:'binary'},manifest:{sha256:manifestSha256},buildProfile:'release',inputs};
  const file=resolve(root,'build-proof.json'),options={root,manifestFile,manifestSha256,binarySha256:'binary',buildProfile:'release'};
  const verify=async(candidate=proof,overrides={})=>{await writeFile(file,JSON.stringify(candidate));return(await verifyBuildProof(file,{...options,...overrides})).result;};
  assert.equal((await verify()).valid,true);
  for(const overrides of [{binarySha256:'other'},{manifestSha256:'other'},{buildProfile:'debug'}])assert.equal((await verify(proof,overrides)).valid,false);
  for(const changed of [{passed:false},{completed:false},{process:{status:1}},{snapshotError:'failed read'},{changedInputs:[{file:'x'}]},{compilerManifestMismatches:[{file:'x'}]},{inputs:{}}])assert.equal((await verify({...proof,...changed})).valid,false);
  await writeFile(resolve(root,'crates/js-runtime/src/lib.rs'),'changed');
  const stale=await verify();assert.equal(stale.valid,false);assert.equal(stale.changedInputs.length,1);
  await writeFile(file,'invalid JSON');assert.equal((await verifyBuildProof(file,options)).result.valid,false);
  await writeFile(file,'null');assert.equal((await verifyBuildProof(file,options)).result.valid,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
