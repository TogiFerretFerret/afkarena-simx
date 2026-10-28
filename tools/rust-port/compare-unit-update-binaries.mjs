// Build both binaries with benchmark-unit-update.mjs's unchanged generated
// fixture before invoking this comparator. Runtime source changes are recorded.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const [before,after]=process.argv.slice(2);assert.ok(before&&after,'Provide baseline and optimized binary paths');
const frozenAt=process.argv.indexOf('--frozen-runtime-root'),frozen=frozenAt<0?null:resolve(root,process.argv[frozenAt+1]);
const differenceAt=process.argv.indexOf('--runtime-difference'),runtimeDifference=differenceAt<0?'env.rs':process.argv[differenceAt+1];assert.match(runtimeDifference,/^[a-z_]+\.rs$/);
const assessment=JSON.parse(await readFile(resolve(root,'benchmarks/validation/rust-unit-update-optimization-assessment.json'),'utf8'));
const previous=JSON.parse(await readFile(resolve(root,assessment.result.file),'utf8'));
async function artifact(label){const row=previous.artifacts.find(row=>row.label===label),bytes=await readFile(resolve(root,row.file));assert.equal(sha(bytes),row.sha256);const raw=gunzipSync(bytes);assert.equal(sha(raw),row.uncompressedSha256);return raw;}
const source=await artifact('source'),expectedArtifact=await artifact('expected');
const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source.toString(),realm);realm.benchmarkUnitUpdates(3000);const expected=JSON.parse(realm.snapshotBench());assert.deepEqual(expected,JSON.parse(expectedArtifact));
for(const label of ['baseline','cached'])assert.deepEqual(await readFile(resolve(root,'work/rust-unit-update-benchmark/'+label+'.rs')),await artifact(label+'-generated'));
const pairsAt=process.argv.indexOf('--pairs'),pairs=pairsAt<0?3:Number(process.argv[pairsAt+1]);assert.ok(Number.isSafeInteger(pairs)&&pairs>0&&pairs<=20);
const rows=[],outputs=[],allocationRows=[];
for(let pair=0;pair<pairs;pair++)for(const variant of pair%2===0?['before','after']:['after','before']){
 const file=resolve(root,variant==='before'?before:after),actual=spawnSync(file,[],{encoding:'utf8',maxBuffer:128*1024*1024});assert.equal(actual.status,0,actual.stderr);
 outputs.push({variant,pair,stdout:actual.stdout,stderr:actual.stderr});
 for(const line of actual.stderr.trim().split('\n'))if(line.startsWith('allocation:')){const [,compilerVariant,trial,allocations,requestedBytes]=line.split(':');allocationRows.push({variant,pair,compilerVariant,trial:+trial,updates:3000,allocations:+allocations,requestedBytes:+requestedBytes});}
 for(const line of actual.stdout.trim().split('\n')){const [compilerVariant,trial,elapsedNs,...json]=line.split('\t');const snapshot=JSON.parse(json.join('\t'));assert.deepEqual(snapshot,expected);rows.push({variant,pair,compilerVariant,trial:+trial,updates:3000,elapsedNs,orderedEvents:snapshot.events.length});}
}
const summaries=['baseline','cached'].map(compilerVariant=>{const total=variant=>rows.filter(row=>row.variant===variant&&row.compilerVariant===compilerVariant).reduce((sum,row)=>sum+Number(row.elapsedNs),0);return{compilerVariant,updatesPerRuntime:9000*pairs,beforeUpdatesPerSecond:9000*pairs/(total('before')/1e9),afterUpdatesPerSecond:9000*pairs/(total('after')/1e9),observedRatio:total('before')/total('after')};});
const labelAt=process.argv.indexOf('--label'),label=labelAt<0?'env-map':process.argv[labelAt+1];assert.match(label,/^[a-z0-9-]+$/);
const prefix='benchmarks/results/'+new Date().toISOString().replaceAll(':','-')+'-rust-unit-update-'+label;
const archive=gzipSync(JSON.stringify(outputs),{level:9});await writeFile(resolve(root,prefix+'.outputs.json.gz'),archive);
const baselineCommit=(await readFile(resolve(root,'work/rust-env-map-benchmark/baseline-commit.txt'),'utf8')).trim();
const changes=frozen?spawnSync('diff',['-u',resolve(frozen,'before/runtime/src/'+runtimeDifference),resolve(frozen,'after/runtime/src/'+runtimeDifference)],{encoding:'utf8'}):spawnSync('git',['diff',baselineCommit,'--','crates/js-runtime/src'],{cwd:root,encoding:'utf8'});assert.ok(changes.status===0||(frozen&&changes.status===1));await writeFile(resolve(root,prefix+'.runtime.patch'),changes.stdout);
let frozenRuntimeInputs=null,frozenRuntimeArchive=null;if(frozen){const a=JSON.parse(await readFile(resolve(frozen,'before/manifest.json'),'utf8')),b=JSON.parse(await readFile(resolve(frozen,'after/manifest.json'),'utf8'));assert.deepEqual(Object.keys(a),Object.keys(b));for(const key of Object.keys(a))if(key!==runtimeDifference)assert.equal(a[key],b[key]);frozenRuntimeInputs={before:a,after:b,onlyDifferentRuntimeSource:runtimeDifference};const files={};for(const variant of ['before','after']){for(const file of Object.keys(a)){const text=await readFile(resolve(frozen,variant,'runtime/src',file),'utf8');assert.equal(sha(text),(variant==='before'?a:b)[file]);files[variant+'/runtime/src/'+file]=text;}for(const file of ['runtime/Cargo.toml','app/Cargo.toml','app/main.rs','app/allocations.rs','app/baseline.rs','app/cached.rs'])try{files[variant+'/'+file]=await readFile(resolve(frozen,variant,file),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}}const bytes=gzipSync(JSON.stringify(files),{level:9});const file=prefix+'.frozen-runtime.json.gz';await writeFile(resolve(root,file),bytes);frozenRuntimeArchive={file,sha256:sha(bytes)};}
const report={version:1,passed:true,timingContended:process.argv.includes('--contended'),baselineCommit,frozenRuntimeInputs,frozenRuntimeArchive,binaries:{before:{file:before,sha256:sha(await readFile(resolve(root,before)))},after:{file:after,sha256:sha(await readFile(resolve(root,after)))}},sourceReference:assessment.result,allOrderedEventsAndStateBitsMatch:true,rows,summaries,allocationRows,outputs:{file:prefix+'.outputs.json.gz',sha256:sha(archive)},runtimePatch:{file:prefix+'.runtime.patch',sha256:sha(changes.stdout)},scope:'Original unchanged Unit.update component fixture. Each binary runs three 3000-update trials per compiler-cache variant. '+pairs+' alternated process pairs, all callbacks and raw-bit observer formatting retained. Component updates/sec only, not battles/sec. Shared CPU contention remains possible; runtime patch discloses every source change between builds. Arena allocations persist for each finite trial. Optional allocation rows count alloc/realloc requests and requested bytes inside the timed call; instrumented timing includes counter overhead.',qualifiesFor10000Target:false};await writeFile(resolve(root,prefix+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:prefix+'.json',summaries,allocationRows:allocationRows.length}));
