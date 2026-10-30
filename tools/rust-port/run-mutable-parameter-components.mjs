import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'work/mutable-parameter-components'),hash=b=>createHash('sha256').update(b).digest('hex');
assert.ok(process.execArgv.includes('--jitless'),'Use pinned --jitless oracle');
const pin=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,pin.node);assert.equal(process.versions.v8,pin.v8);
const prep=JSON.parse(await readFile(resolve(work,'preparation.json'))),observations=[],expected={},rows=[],counted=[];const modes=process.argv.includes('--buff-only')?['buff']:Object.keys(prep.scenarios);
for(const [kind,b] of Object.entries(prep.binaries))assert.equal(hash(await readFile(b.file)),b.sha256,kind+' executable drift');
for(const mode of modes){const s=prep.scenarios[mode];
 const source=await readFile(resolve(work,mode+'.source.js'),'utf8');assert.equal(hash(source),prep.sourceSha256[mode]);
 const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source,realm);realm[s.method](...s.warm);realm.resetBench();realm[s.method](...s.parameters);expected[mode]=JSON.parse(realm.snapshotBench());
}
function execute(mode,variant,kind,trial){
 const r=spawnSync(prep.binaries[kind].file,[mode,variant],{cwd:root,env:{...process.env,RUST_PORT_TRACE:'0'},encoding:'utf8',maxBuffer:192*1024*1024});
 observations.push({mode,variant,kind,trial,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});
 assert.equal(r.status,0,r.stderr);const lines=r.stdout.trim().split('\n');
 const metricLine=lines.find(s=>s.startsWith('METRICS\t')),snapshotLine=lines.find(s=>s.startsWith('SNAPSHOT\t'));
 assert.ok(metricLine&&snapshotLine,r.stdout.slice(0,1000));
 const metrics=JSON.parse(metricLine.slice(8)),snapshot=JSON.parse(snapshotLine.slice(9));
 assert.deepEqual(snapshot,expected[mode],`${mode}/${variant}/${kind} differs from Node`);
 return {mode,variant,trial,...metrics,elapsedNs:Number(metrics.elapsedNs)};
}
for(const mode of modes){
 for(let trial=0;trial<3;trial++)for(const variant of trial%2?['on','off']:['off','on'])rows.push(execute(mode,variant,'timing',trial));
 for(const variant of ['off','on'])counted.push(execute(mode,variant,'counted',0));
}
for(const [kind,b] of Object.entries(prep.binaries))assert.equal(hash(await readFile(b.file)),b.sha256,kind+' executable changed');
const totals={};for(const mode of modes){
 const sums={};for(const variant of ['off','on'])sums[variant]=rows.filter(r=>r.mode===mode&&r.variant===variant).reduce((n,r)=>n+r.elapsedNs,0);
 const pairs=[0,1,2].map(trial=>rows.find(r=>r.mode===mode&&r.variant==='off'&&r.trial===trial).elapsedNs/rows.find(r=>r.mode===mode&&r.variant==='on'&&r.trial===trial).elapsedNs);
 totals[mode]={elapsedNs:sums,speedRatio:sums.off/sums.on,pairSpeedRatios:pairs};
}
const prefix='benchmarks/results/'+new Date().toISOString().replaceAll(':','-')+'-mutable-parameter-components',artifacts=[];
async function archive(label,bytes){const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),gzip=gzipSync(data,{level:9}),file=prefix+'.'+label+'.gz';await writeFile(resolve(root,file),gzip);artifacts.push({file,sha256:hash(gzip),uncompressedSha256:hash(data),uncompressedBytes:data.length});}
await archive('actual',JSON.stringify(observations));await archive('expected',JSON.stringify(expected));await archive('preparation',JSON.stringify(prep));
for(const mode of modes)await archive(mode+'-source',await readFile(resolve(work,mode+'.source.js')));
const functions={};for(const [name,c]of Object.entries(prep.compiled))functions[name]={nativeMutableParameters:c.manifest.nativeMutableParameters,functions:c.manifest.functions.map(f=>({id:f.id,name:f.name,nativeBindings:f.nativeBindings,nativeMutableParameters:f.nativeMutableParameters,mirroredMutableParameters:f.mirroredMutableParameters,nativeActivationElided:f.nativeActivationElided})).filter(f=>f.nativeBindings?.length||f.nativeMutableParameters?.length)};
const report={passed:true,sameRuntime:true,trialsPerVariant:3,rows,counted,totals,functions,artifacts,oracle:{node:process.version,v8:process.versions.v8,flags:process.execArgv},library:prep.library,binaries:prep.binaries,scenarios:Object.fromEntries(modes.map(m=>[m,prep.scenarios[m]])),scope:prep.scope,qualifiesFor10000Target:false,notes:'Separate timing executable has no allocation API counters. Counted executable instruments generated environment creation and binding declarations. All outputs from all executions match the same warmed/reset pinned Node component fixtures. Source calls and callbacks remain active; these are component rates, not battles/second.'};
await writeFile(resolve(root,prefix+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:prefix+'.json',totals,counted}));
