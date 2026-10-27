import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import assert from 'node:assert/strict';
import {patchCompareFloatC,addBridgeCounterMain} from './native-rust-bridge.mjs';
import {compareNativeReports,compareHostInputConsumption,semanticNativeReport} from './native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1]};
const input=resolve(root,option('--input','work/native-oracle-replayed-pinned.js'));
const output=resolve(root,option('--output','work/native-oracle-rust-bridge'));
const compiler=resolve(root,option('--compiler','work/downloads/hermes-build/bin/shermes'));
const ccOpt=option('--cc-opt','O1'),plumbing=args.includes('--plumbing');
assert.ok(['O0','O1','O2','O3'].includes(ccOpt));
const sha=value=>createHash('sha256').update(value).digest('hex');
const metadata=JSON.parse(await readFile(input+'.metadata.json','utf8'));
assert.ok(!metadata.factoryChunks?.length,'This bridge runner accepts one source unit; broad chunked binaries remain a separate gate');
assert.equal(sha(await readFile(input)),metadata.outputSha256);
const reference=JSON.parse(await readFile(metadata.reference.file,'utf8'));
const node=JSON.parse((await readFile(input+'.node.stdout','utf8')).trim().split('\n').at(-1));
assert.equal(compareNativeReports(node,reference),null,'Complete emitted-Node gate must match first');
assert.equal(compareHostInputConsumption(node.hostInputConsumption,metadata.hostInputs),null);
const dependencies=[];
for(const [file,expected]of [...Object.entries(metadata.adapterInputs??{}),...Object.entries(metadata.sourceInputs??{})]){
  const actual=sha(await readFile(resolve(root,file)));dependencies.push({file,expected,actual,matched:expected===actual});
}
assert.ok(dependencies.every(item=>item.matched)||plumbing,'Reference adapters changed; regenerate or explicitly mark --plumbing');
const kernel=metadata.originalRecords.find(record=>record.name==='ed.compareFloat');assert.ok(kernel);
const original=(await readFile(resolve(root,kernel.file),'utf8')).slice(kernel.start,kernel.end);assert.equal(sha(original),kernel.sha256);
const directory=output+'.build';await mkdir(directory,{recursive:true});
async function run(command,parameters,label,env=process.env){
  const stdout=resolve(directory,label+'.stdout'),stderr=resolve(directory,label+'.stderr');
  const out=openSync(stdout,'w'),err=openSync(stderr,'w');
  try{await new Promise((accept,reject)=>{const child=spawn(command,parameters,{cwd:root,env,stdio:['ignore',out,err]});child.on('error',reject);child.on('exit',(code,signal)=>code===0?accept():reject(new Error(label+' failed '+(code??signal)+'; '+stderr)));});}
  finally{closeSync(out);closeSync(err);}
  return{stdout,stderr};
}
const poolDirectory=resolve(directory,'pools');await mkdir(poolDirectory,{recursive:true});
const cfile=resolve(directory,'original.c'),compileStart=performance.now();
await run(compiler,['-O','-emit-c',input,'-o',cfile],'emit',{...process.env,SHERMES_BINARY_STRING_DIR:poolDirectory});
const patch=await patchCompareFloatC(await readFile(cfile,'utf8'),poolDirectory,original);
const patched=resolve(directory,'bridge.c');await writeFile(patched,addBridgeCounterMain(patch.source));
const rustc=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc'),library=resolve(directory,'libbridge.a');
await run(rustc,['--edition=2024','-O','-C','panic=abort','--crate-type=staticlib',resolve(root,'tools/native-rust-bridge.rs'),'-o',library],'rust');
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'),'utf8'));
const build=resolve(root,'work/downloads/hermes-build'),include=resolve(root,'work/downloads',config.source.directory,'include');
const compileArgs=[patched,library,'-'+ccOpt,'-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+include];
for(const lib of ['lib','jsi','tools/shermes']){const path=resolve(build,lib);compileArgs.push('-L'+path,'-Wl,-rpath,'+path);}
compileArgs.push('-lshermes_console','-lhermesvm','-ldl','-lpthread','-lm','-o',output);
await run(process.env.CC??'cc',compileArgs,'compile');
const compileMs=performance.now()-compileStart,executionStart=performance.now();
const execution=await run(output,['-Xhermes-internal-test-methods'],'execute');
const executionWallMs=performance.now()-executionStart;
const actual=JSON.parse((await readFile(execution.stdout,'utf8')).trim().split('\n').at(-1));
const hits=Number(/bridge_hits:(\d+)/.exec(await readFile(execution.stderr,'utf8'))?.[1]??0);
const difference=compareNativeReports(actual,reference)??compareHostInputConsumption(actual.hostInputConsumption,metadata.hostInputs);
const report={version:1,engine:'Original source Static Hermes with guarded scalar Rust compareFloat trampoline',input,output,inputSha256:metadata.outputSha256,compilerSha256:sha(await readFile(compiler)),vmSha256:sha(await readFile(resolve(build,'lib/libhermesvm.so'))),rustSourceSha256:sha(await readFile(resolve(root,'tools/native-rust-bridge.rs'))),originalKernel:kernel,generatedFunction:patch.symbol,rustCalls:hits,compileArgs,compileMs,executionWallMs,completed:actual.completed,elapsedMs:actual.elapsedMs,battlesPerSecond:actual.battlesPerSecond,semanticReportMatched:difference===null,firstDifference:difference,comparedFields:Object.keys(semanticNativeReport(reference)),hostInputConsumption:actual.hostInputConsumption,oracleRuntime:metadata.oracleRuntime,executionContract:metadata.executionContract,dependencies,plumbing,qualifiesFor10000Target:false,qualification:'One frozen full 5v5 fixture; actor/effect/view lifecycle and full ordered source trace qualification remain required. Original code handles unsupported arguments and changed intrinsic implementations.'};
const reportPath=resolve(root,'benchmarks/results',new Date().toISOString().replaceAll(':','-')+'-rust-'+basename(output)+'.json');
await mkdir(resolve(root,'benchmarks/results'),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await writeFile(output+'.comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(difference||hits===0)process.exitCode=1;
