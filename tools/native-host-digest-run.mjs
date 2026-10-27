import{readFile,writeFile,mkdir}from'node:fs/promises';
import{resolve,basename}from'node:path';
import{spawn}from'node:child_process';
import{openSync,closeSync}from'node:fs';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
import{compareNativeReports,compareHostInputConsumption,semanticNativeReport}from'./native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const input=resolve(root,option('--input','work/native-partition-counter-capsule/unit-7.js'));
const objectsPrefix=resolve(root,option('--objects-prefix','work/native-oracle-partition-o1'));
const output=resolve(root,option('--output','work/native-oracle-seven-host-digest'));
const privateDirectory=resolve(root,option('--vm-directory','work/native-diagnostic-sha256-host'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const metadata=JSON.parse(await readFile(input+'.metadata.json'));
const cache=JSON.parse(await readFile(resolve(root,option('--object-cache','work/native-seven-object-cache.json'))));
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes');
assert.equal(cache.compilerSha256,sha(await readFile(compiler)));
const liveVM=resolve(root,'work/downloads/hermes-build/lib/libhermesvm.so');
assert.equal(cache.vmSha256,sha(await readFile(liveVM)));
for(const row of cache.headers)assert.equal(sha(await readFile(resolve(root,row.file))),row.sha256);
const units=[...metadata.factoryChunks.map(row=>({...row,name:row.nativeName})),{file:input,sha256:metadata.outputSha256,name:metadata.nativeRunnerName}];
assert.ok(units.length<=7&&units.length>0);
const dependencies=[];
for(const[file,expected]of[...Object.entries(metadata.adapterInputs),...Object.entries(metadata.sourceInputs)]){
 const actual=sha(await readFile(resolve(root,file)));dependencies.push({file,expected,actual,matched:actual===expected});assert.equal(actual,expected,'Changed source/adapter: '+file);
}
for(const row of[metadata.tableBundle,metadata.hostInputs,metadata.reference])assert.equal(sha(await readFile(row.file)),row.sha256);
const reference=JSON.parse(await readFile(metadata.reference.file));
const node=JSON.parse((await readFile(input+'.node.stdout','utf8')).trim().split('\n').at(-1));
assert.equal(compareNativeReports(node,reference),null);assert.equal(compareHostInputConsumption(node.hostInputConsumption,metadata.hostInputs),null);
for(const unit of units){
 assert.match(unit.name,/^[A-Za-z_][A-Za-z0-9_]*$/);assert.equal(sha(await readFile(unit.file)),unit.sha256);
 unit.object=resolve(objectsPrefix+'.units',unit.name+'.o');unit.objectSha256=sha(await readFile(unit.object));
 const cached=cache.units.find(row=>row.name===unit.name);
 if(cached){assert.equal(unit.objectSha256,cached.objectSha256);assert.equal(unit.sha256,cached.sourceSha256);unit.compilation=cached.compileArgs;}
 else{
  // The merged declaration/effect object is the only new compilation. Its
  // exact source, object, compiler and flags are recorded alongside the six
  // independently verified unchanged objects from the failed eight-unit run.
  assert.equal(unit.name,'partition_0');
  unit.compilation=['-O','-c','-exported-unit='+unit.name,'-Wc,-O1,-g0,-ffp-contract=off',unit.file,'-o',unit.object];
 }
}
const privateVM=resolve(privateDirectory,'libhermesvm.so'),privateVMSha256=sha(await readFile(privateVM));
const proof=JSON.parse(await readFile(resolve(root,'benchmarks/validation/native-diagnostic-sha256-host.json')));
assert.equal(proof.passed,true);assert.equal(proof.privateVM.originalSha256,cache.vmSha256);
assert.equal(proof.privateVM.privateSha256,privateVMSha256);
const baselineWrapper=await readFile(objectsPrefix+'.units/main.c','utf8');
assert.ok(baselineWrapper.includes('_sh_initialize_units(shr,'+units.length+','));
for(const unit of units)assert.ok(baselineWrapper.includes('sh_export_'+unit.name));
let wrapper=baselineWrapper.replace('int main(int argc,char **argv) {','extern bool simx_install_diagnostic_digest(SHRuntime *);\nint main(int argc,char **argv) {');
assert.notEqual(wrapper,baselineWrapper);
wrapper=wrapper.replace('  bool success=_sh_initialize_units','  if(!simx_install_diagnostic_digest(shr))return 2;\n  bool success=_sh_initialize_units');
assert.ok(wrapper.includes('if(!simx_install_diagnostic_digest(shr))'));
await writeFile(output+'.main.c',wrapper);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),build=resolve(root,'work/downloads/hermes-build');
const linkArgs=[output+'.main.c',...units.map(unit=>unit.object),'-O2','-g0','-DNDEBUG','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include'),'-L'+privateDirectory,'-Wl,-rpath,'+privateDirectory];
for(const lib of['lib','jsi','tools/shermes']){const path=resolve(build,lib);linkArgs.push('-L'+path,'-Wl,-rpath,'+path);}linkArgs.push('-lshermes_console','-lm','-lhermesvm','-o',output);
async function run(command,parameters,label,env=process.env){const out=openSync(output+'.'+label+'.stdout','w'),err=openSync(output+'.'+label+'.stderr','w');try{await new Promise((accept,reject)=>{const child=spawn(command,parameters,{cwd:root,env,stdio:['ignore',out,err]});child.on('error',reject);child.on('exit',(code,signal)=>code===0?accept():reject(new Error(label+' failed: '+(code??signal))));});}finally{closeSync(out);closeSync(err);}}
await run(process.env.CC??'cc',linkArgs,'link');
const start=performance.now();await run(output,['-Xhermes-internal-test-methods'],'execute',{...process.env,LD_LIBRARY_PATH:privateDirectory});const executionWallMs=performance.now()-start;
assert.equal(sha(await readFile(privateVM)),privateVMSha256);assert.equal(sha(await readFile(liveVM)),cache.vmSha256);
const actual=JSON.parse((await readFile(output+'.execute.stdout','utf8')).trim().split('\n').at(-1));
const difference=compareNativeReports(actual,reference)??compareHostInputConsumption(actual.hostInputConsumption,metadata.hostInputs);
const dependenciesAtFinish=[];for(const row of dependencies){const hash=sha(await readFile(resolve(root,row.file)));dependenciesAtFinish.push({...row,actual:hash,matched:hash===row.expected});}
const report={version:1,engine:'Original source seven-unit Static Hermes O1 with native diagnostic SHA256 host',input,output,outputSha256:sha(await readFile(output)),compilerSha256:cache.compilerSha256,originalVMSha256:cache.vmSha256,privateVMSha256,diagnosticHostProof:'benchmarks/validation/native-diagnostic-sha256-host.json',diagnosticHostOnly:true,battleMechanicsFastPaths:[],units,wrapperSha256:sha(wrapper),linkArgs,executionWallMs,completed:actual.completed,elapsedMs:actual.elapsedMs,battlesPerSecond:actual.battlesPerSecond,semanticReportMatched:difference===null,firstDifference:difference,comparedFields:Object.keys(semanticNativeReport(reference)),classManagerCounters:actual.classManagerCounters??null,hostInputConsumption:actual.hostInputConsumption,executionContract:metadata.executionContract,dependenciesAtStart:dependencies,dependenciesAtFinish,qualifiesFor10000Target:false,qualification:'One frozen source fixture. Native SHA256 accelerates diagnostic hashing only; callbacks, RNG, allocator counters and original source battle execution are compared. Full random corpus and complete actor/effect/view lifecycle qualification remain required.'};
await mkdir(resolve(root,'benchmarks/results'),{recursive:true});
const reportPath=resolve(root,'benchmarks/results',new Date().toISOString().replaceAll(':','-')+'-'+basename(output)+'.json');await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await writeFile(output+'.comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(difference||dependenciesAtFinish.some(row=>!row.matched))process.exitCode=1;
