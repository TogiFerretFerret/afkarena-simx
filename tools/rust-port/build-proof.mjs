import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// Verification checks a completed build artifact; it never invokes Cargo.
export async function verifyBuildProof(file,{root,manifestFile,manifestSha256,binarySha256,buildProfile}){
 const result={file:resolve(root,file),sha256:null,valid:false,reasons:[],inputCount:0,changedInputs:[],buildProfile:null};
 let proof;
 try{const bytes=await readFile(result.file);result.sha256=sha(bytes);proof=JSON.parse(bytes);}catch(error){result.reasons.push({kind:'unreadable-proof',message:String(error.message)});return{result,inputs:{}};}
 if(!proof||typeof proof!=='object'||Array.isArray(proof)){result.reasons.push({kind:'invalid-proof-object'});return{result,inputs:{}};}
 const check=(condition,kind)=>{if(!condition)result.reasons.push({kind});};
 check(proof.version===1,'unsupported-proof-version');
 check(proof.passed===true&&proof.completed===true&&proof.prepared===true,'build-not-passed');
 check(proof.binaryBoundToManifest===true&&proof.unchanged===true,'build-inputs-not-bound');
 check(proof.process?.status===0&&!proof.process?.signal&&!proof.process?.error,'cargo-not-successful');
 check(proof.snapshotError===null,'build-snapshot-error');
 check(Array.isArray(proof.changedInputs)&&proof.changedInputs.length===0,'build-inputs-changed');
 check(Array.isArray(proof.compilerManifestMismatches)&&proof.compilerManifestMismatches.length===0,'stale-generated-inputs');
 check(proof.binary?.sha256===binarySha256,'binary-sha256-mismatch');
 check(proof.manifest?.sha256===manifestSha256,'manifest-sha256-mismatch');
 check(proof.buildProfile===buildProfile,'build-profile-mismatch');result.buildProfile=proof.buildProfile??null;
 const inputs=proof.inputs&&typeof proof.inputs==='object'&&!Array.isArray(proof.inputs)?proof.inputs:{};
 check(inputs[resolve(manifestFile)]===manifestSha256,'manifest-not-in-build-inputs');
 for(const required of ['tools/rust-port/build-program.mjs','tools/rust-port/program-host.rs','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/bindings.mjs','crates/js-runtime/src/lib.rs'])check(typeof inputs[resolve(root,required)]==='string','missing-build-input:'+required);
 let featureManifest={};try{featureManifest=JSON.parse(await readFile(manifestFile,'utf8'));}catch{check(false,'unreadable-feature-manifest');}const scalarHelper='tools/rust-port/scalar-arrays.mjs';if(Object.hasOwn(featureManifest.sources??{},scalarHelper)||featureManifest.units?.some(unit=>unit.scalarLocalArrays>0)){check(typeof inputs[resolve(root,scalarHelper)]==='string','missing-build-input:'+scalarHelper);if(featureManifest.sources?.[scalarHelper])check(inputs[resolve(root,scalarHelper)]===featureManifest.sources[scalarHelper],'scalar-helper-manifest-input-mismatch');}
 for(const [file,before] of Object.entries(inputs)){
  let after=null;try{after=sha(await readFile(file));}catch{}
  if(after!==before)result.changedInputs.push({file,before,after});
 }
 result.inputCount=Object.keys(inputs).length;
 check(result.changedInputs.length===0,'current-inputs-differ-from-build');
 result.valid=result.reasons.length===0;
 return{result,inputs};
}
