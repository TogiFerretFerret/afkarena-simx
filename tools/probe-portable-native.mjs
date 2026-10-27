import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {comparePortableBattleTraces} from './battle-trace-portable.mjs';

const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1]};
const compiler=resolve(root,option('--compiler','work/downloads/hermes-build/bin/shermes'));
const outputDir=resolve(root,option('--work-dir','work/portable-native-probe'));
const reportPath=resolve(root,option('--output','benchmarks/validation/portable-native-probe.json'));
await mkdir(outputDir,{recursive:true});
const exporter=await readFile(resolve(root,'tools/battle-trace-portable.js'),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
const compilerFlags=['-O','-Wc,-O1,-g0,-ffp-contract=off'];
const configurations=[
 {name:'finite_infinity_signed_zero',scalar:'1.25',map:'3.5'},
 {name:'positive_nan_literal',scalar:'NaN',map:'NaN'},
 {name:'nan_payload_from_buffer',scalar:'view.getFloat64(0,false)',map:'NaN'},
];
function run(command,parameters){
 const result=spawnSync(command,parameters,{cwd:root,env:{...process.env,NODE_OPTIONS:''},encoding:'utf8',maxBuffer:16*1024*1024});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(`${command} failed (${result.status}): ${result.stderr}`);
 return result.stdout;
}
const cases=[];
for(const config of configurations.filter(config=>!args.includes('--finite')||config.name.startsWith('finite'))){
 let fullDifference;
 const artifacts=[];
 let gate;
 for(const compact of [true,false]){
  if(!compact&&gate.passed)break;
  const source=exporter+`\nif(typeof print!=='function')globalThis.print=function(value){console.log(value)};
var buffer=new ArrayBuffer(8),view=new DataView(buffer);view.setUint32(0,0x7ff80000,false);view.setUint32(4,0x17,false);
function sourceCallback(){return -0}sourceCallback.calls=0;
var shared={hp:-0,nan:${config.scalar}};
var root={unit:shared,alias:shared,buffer:buffer,bytes:new Uint8Array(buffer),map:new Map([[shared,${config.map}]]),set:new Set([3,2]),callback:sourceCallback};root.self=root;
var trace=installPortableBattleTrace({compact:${compact}});
trace.record('callback:before',{f64:-0},root);
shared.hp=1.5;sourceCallback.calls++;trace.record('callback:after',{rng:0.125},root);
trace.record('rng:draw',{result:Infinity},root);
print(JSON.stringify(trace.finish({status:'completed',running:false,result:'victory',ticks:3})));
`;
  const prefix=resolve(outputDir,config.name+(compact?'':'-full'));
  await writeFile(prefix+'.js',source);
  const referenceText=run(process.execPath,['--jitless',prefix+'.js']);
  run(compiler,[...compilerFlags,prefix+'.js','-o',prefix]);
  const candidateText=run(prefix,[]);
  await writeFile(prefix+'.reference.json',referenceText);await writeFile(prefix+'.candidate.json',candidateText);
  const comparison=comparePortableBattleTraces(JSON.parse(referenceText),JSON.parse(candidateText));
  artifacts.push({compact,source:relative(root,prefix+'.js'),sourceSha256:hash(source),referenceSha256:hash(referenceText),candidateSha256:hash(candidateText)});
  if(compact)gate=comparison;else fullDifference=comparison.difference;
 }
 cases.push({name:config.name,gate,fullDifference,artifacts});
 console.log(JSON.stringify({case:config.name,passed:gate.passed,difference:fullDifference??gate.difference}));
}
const report={version:1,reference:{runtime:process.version,flags:['--jitless'],NODE_OPTIONS:''},compiler:{file:relative(root,compiler),sha256:hash(await readFile(compiler)),flags:compilerFlags},
 exporterSha256:hash(exporter),cases,passed:cases.every(config=>config.gate.passed),qualifiesForThroughputTarget:false,
 limitations:['This is an actual compiled exporter probe, not a completed battle corpus','NaN payload and sign differences are strict failures and are retained in this report']};
await mkdir(resolve(reportPath,'..'),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
if(!report.passed)process.exitCode=2;
