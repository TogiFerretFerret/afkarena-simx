import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {compareNativeReports,firstDifference} from '../native-report-compare.mjs';

const root=resolve(import.meta.dirname,'../..');
const args=process.argv.slice(2);
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const manifestFile=resolve(root,option('--manifest','work/rust-battle-full/program-manifest.json'));
const manifest=JSON.parse(await readFile(manifestFile));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
if(args.includes('--oracle')){
 assert.equal(process.version,profile.node);
 assert.equal(process.versions.v8,profile.v8);
 assert.deepEqual(process.execArgv,profile.rawBitReferenceFlags);
 const context=vm.createContext({print:(...values)=>process.stdout.write(values.join(' ')+'\n')});
 for(const unit of manifest.units){
  const bytes=await readFile(unit.file);
  assert.equal(sha(bytes),unit.sourceSha256,'Frozen source changed');
  vm.runInContext(bytes.toString('utf8'),context,{filename:unit.file});
 }
 process.exit(0);
}
assert.equal(manifest.units.length,7,'A whole-program gate requires all seven modules');
const binary=resolve(root,option('--binary','work/rust-port-shared-target/debug/rust-battle-program'));
const output=resolve(root,option('--output','benchmarks/validation/rust-full-program.json'));
await mkdir(dirname(output),{recursive:true});
const artifactPrefix=output.replace(/\.json$/,'');
const binaryBefore=sha(await readFile(binary));
for(const unit of manifest.units)assert.equal(sha(await readFile(unit.file)),unit.sourceSha256);
const timeout=Number(option('--timeout-ms','600000'));
const run=(command,argv,env)=>{
 const begin=performance.now();
 const result=spawnSync(command,argv,{cwd:root,env,encoding:'utf8',timeout,maxBuffer:128*1024*1024});
 return{status:result.status,signal:result.signal,error:result.error?.message??null,
  wallMs:performance.now()-begin,stdout:result.stdout??'',stderr:result.stderr??''};
};
const oracle=run(process.execPath,[...profile.rawBitReferenceFlags,import.meta.filename,'--oracle','--manifest',manifestFile],{...process.env,NODE_OPTIONS:profile.rawBitReferenceNodeOptions});
const native=run(binary,[],{...process.env,RUST_PORT_TRACE:'0'});
for(const [name,result] of [['oracle',oracle],['native',native]]){
 await writeFile(artifactPrefix+'.'+name+'.stdout.gz',gzipSync(result.stdout));
 await writeFile(artifactPrefix+'.'+name+'.stderr.gz',gzipSync(result.stderr));
}
function parse(text){
 for(const line of text.trim().split('\n').reverse()){
  try{const value=JSON.parse(line);if(value&&typeof value==='object'&&'completed' in value)return value;}catch{}
 }
 return null;
}
const expected=parse(oracle.stdout),actual=parse(native.stdout);
const difference=expected&&actual?compareNativeReports(actual,expected):{reason:'Missing complete battle report'};
const hostDifference=expected&&actual?firstDifference(actual.hostInputConsumption,expected.hostInputConsumption,'$.hostInputConsumption'):null;
const binaryUnchanged=sha(await readFile(binary))===binaryBefore;
const passed=oracle.status===0&&native.status===0&&!!actual&&!!expected&&!difference&&!hostDifference&&binaryUnchanged;
const compact=result=>({status:result.status,signal:result.signal,error:result.error,wallMs:result.wallMs});
const report={version:1,passed,qualifiesFor10000Target:false,
 scope:'Seven frozen source modules executed as generated native Rust and pinned Node. Exact non-timing report and host consumption comparison. This fixed callback fixture does not qualify full-scene random battles or 20k battle coverage.',
 buildProfile:option('--profile','debug'),traceEnabled:false,
 manifest:{file:manifestFile,sha256:sha(await readFile(manifestFile))},
 binary:{file:binary,sha256:binaryBefore,unchanged:binaryUnchanged},
 producer:{file:'tools/rust-port/check-program.mjs',sha256:sha(await readFile(import.meta.filename))},
 oracle:compact(oracle),native:compact(native),firstDifference:difference,hostDifference,
 completed:actual?.completed??0,battlesPerSecond:passed?actual.battlesPerSecond:null,
 nativeReport:actual,referenceReport:expected};
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,passed,completed:report.completed,battlesPerSecond:report.battlesPerSecond,firstDifference:difference,hostDifference,native:report.native}));
if(!passed)process.exitCode=1;
