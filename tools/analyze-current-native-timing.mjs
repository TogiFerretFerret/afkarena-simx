import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {measuredPerfWindow,perfTimestampNs,withinMeasuredWindow} from './native-perf-window.mjs';
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex'),read=f=>readFile(resolve(root,f));
const profileFile=process.argv[2]??'benchmarks/results/2026-10-28T15-13-33.840Z-native-perf-current-rust-speeder-measured.json';
const mappedFile='benchmarks/validation/native-current-measured-perf-source.json',mapFile='benchmarks/validation/native-current-measured-js-symbol-map.json';
const profileBytes=await read(profileFile),profile=JSON.parse(profileBytes),mappedBytes=await read(mappedFile),mapped=JSON.parse(mappedBytes),mapBytes=await read(mapFile),mapSummary=JSON.parse(mapBytes);
assert.equal(profile.profileSucceeded,true);assert.equal(profile.semanticReportMatched,true);assert.equal(profile.candidateRuntimeGate.passed,true);
assert.equal(mapped.profile.sha256,sha(profileBytes));assert.equal(mapped.binary.sha256,profile.binary.sha256);assert.equal(mapSummary.binary.sha256,profile.binary.sha256);
const compressedMap=await read(mapSummary.mapping.file);assert.equal(sha(compressedMap),mapSummary.mapping.sha256);const mapping=JSON.parse(gunzipSync(compressedMap));
assert.equal(sha(await read(profile.binary.file)),profile.binary.sha256);assert.equal(sha(await read(profile.privateVM.file)),profile.privateVM.sha256);
async function artifact(label){const row=profile.artifacts.find(a=>a.label===label);assert.ok(row);const chunks=[];for(const chunk of row.chunks){const b=await read(chunk.file);assert.equal(sha(b),chunk.sha256);chunks.push(b);}const compressed=Buffer.concat(chunks);assert.equal(sha(compressed),row.compressedSha256);const raw=gunzipSync(compressed);assert.equal(sha(raw),row.uncompressedSha256);return raw;}
const stderr=(await artifact('record-stderr')).toString(),window=measuredPerfWindow(profile,stderr),text=(await artifact('stacks')).toString();
const lostRecords=(text.match(/PERF_RECORD_LOST(?:_SAMPLES)?\b/g)||[]).length;assert.equal(lostRecords,0,'Lost samples invalidate this timing report');
const rows=[];let current=null;function finish(){if(current){assert.ok(current.frames.length,'Sample without any frames');rows.push(current);current=null;}}
for(const line of text.split('\n')){
 const header=/^\s*(.*?)\s+(\d+)\/(\d+)\s+(\d+\.\d+):\s+(\d+)\s+(cpu-clock:u):\s*$/.exec(line);
 if(header){finish();current={pid:Number(header[2]),tid:Number(header[3]),timeNs:perfTimestampNs(header[4],{requireNanoseconds:true}),periodNs:BigInt(header[5]),frames:[]};assert.ok(current.periodNs>0n);continue;}
 if(/PERF_RECORD_MMAP/.test(line)){finish();continue;}
 const frame=/^\s+([a-f0-9]+)\s+(.+)\s+\((.+)\)\s*$/i.exec(line);
 if(frame&&current){const dso=/^(.*)\+(0x[a-f0-9]+)$/i.exec(frame[3]);current.frames.push({symbol:frame[2].replace(/\+0x[a-f0-9]+$/i,''),file:dso?dso[1]:frame[3]});continue;}
 assert.ok(!line.trim()||/^\s*#/.test(line)||line.includes('PERF_RECORD_'),'Unknown perf script line: '+line.slice(0,160));
}finish();assert.equal(rows.length,profile.sampleCount);const selected=rows.filter(r=>withinMeasuredWindow(r.timeNs,window));assert.equal(selected.length,mapped.samples);assert.ok(selected.length>0);
const totalNs=selected.reduce((sum,r)=>sum+r.periodNs,0n),battles=profile.completed;assert.equal(battles,20);
const stat=(count,ns)=>({samples:count,sampledUserCpuNs:ns.toString(),sampledUserCpuMs:Number(ns)/1e6,percentOfSampledUserCpu:Number(ns)/Number(totalNs)*100,sampledUserCpuMsPerBattle:Number(ns)/1e6/battles});
const groups=new Map(),leaf=new Map();
function group(frame){const s=frame.symbol;
 if(/hermes::vm::(?:HadesGC|GCBase|GCCell|(?:\w+::)*CardTable)|hades::|acceptWeak\(/.test(s))return 'Garbage collector';
 if(/_sh_ljs_(?:try_get_by_id|get_by_id|get_by_val)|JSObject::(?:get(?:Named|Computed|OwnNamed|OwnComputed)|getOwn.*Descriptor)|HiddenClass::findProperty|IdentifierHashTable::lookupString/.test(s))return 'Property reads, lookup and key hashing';
 if(/_sh_ljs_(?:put_by|define)|JSObject::(?:set|put|define)|HiddenClass::(?:addProperty|updateProperty|deleteProperty)/.test(s))return 'Property writes and shape changes';
 if(/_sh_ljs_(?:call|construct|create_closure)|BoundFunction|Callable::|JSFunction::(?:call|create)|NativeFunction::(?:call|create)/.test(s))return 'Call dispatch and function construction';
 if(/(?:^|::)(?:malloc|free|realloc|calloc|memcpy|memmove|memset)(?:@|$)|alloc(?:ate|ation)/i.test(s))return 'Allocation and memory primitives';
 if(/_sh_ljs_|hermes::vm::/.test(s))return 'Other VM operations';
 if(frame.file===profile.binary.file)return 'Other compiled application code';
 return 'Other native/system code';
}
for(const row of selected){const top=row.frames[0],name=group(top),key=top.file+'\n'+top.symbol;for(const [map,id]of [[groups,name],[leaf,key]]){const v=map.get(id)??{count:0,ns:0n};v.count++;v.ns+=row.periodNs;map.set(id,v);}}
const selfGroups=[...groups].map(([name,v])=>({name,...stat(v.count,v.ns)})).sort((a,b)=>b.percentOfSampledUserCpu-a.percentOfSampledUserCpu);
assert.equal(selfGroups.reduce((s,r)=>s+r.samples,0),selected.length);
const topSelf=[...leaf].map(([key,v])=>({file:key.split('\n')[0],symbol:key.split('\n')[1],...stat(v.count,v.ns)})).sort((a,b)=>b.percentOfSampledUserCpu-a.percentOfSampledUserCpu).slice(0,30);
const targets=[['BattleEngine.tick','_878_tick'],['Unit.update','_564_update_11_'],['Unit.addBuff','_546_addBuff_1_'],['Unit.resetBuffApply','_534_resetBuffApply'],['Skill.update','_320_update_3_'],['Buff.update','_379_update_4_'],['Ai.update','_277_update_1_'],['Callback queue drain','_148___nativeDrain']];
const mechanics=[];
for(const [name,symbol]of targets){
 const functions=mapping.functions.filter(f=>f.symbol===symbol);assert.equal(functions.length,1,'Selected function must have a unique symbol across every linked unit');const fn=functions[0];assert.ok(fn.sourceSha256);
 const source=mapping.sourceRecords[fn.sourceSha256];assert.ok(source.ranges.length>0||fn.name==='__nativeDrain','Game mechanic needs exact source range; generated drain is explicitly identified by retained NFI name');
 let inclusive=0n,self=0n,count=0,selfCount=0;
 for(const row of selected){if(row.frames.some(f=>f.file===profile.binary.file&&f.symbol===symbol)){inclusive+=row.periodNs;count++;}if(row.frames[0].file===profile.binary.file&&row.frames[0].symbol===symbol){self+=row.periodNs;selfCount++;}}
 mechanics.push({name,symbol,unit:fn.unit,sourceSha256:fn.sourceSha256,sourceRanges:source.ranges,inclusive:stat(count,inclusive),self:stat(selfCount,self)});
}
const nativeSpeeder=selected.filter(row=>/simx_unit_speeder|battle_unit_speeder|unit_speeder::/.test(row.frames[0].symbol));
const speederSelf=stat(nativeSpeeder.length,nativeSpeeder.reduce((s,r)=>s+r.periodNs,0n));
const output='benchmarks/validation/native-current-timing-breakdown.json';
const result={version:1,passed:true,scope:'Period-weighted user-CPU sampling of 20 measured battles in one fixed callback-only fixture. Startup, three warmups and final report are excluded by exact CLOCK_MONOTONIC markers. Sampling changes execution cost; this is a hotspot diagnostic, not a throughput measurement or whole-game qualification.',qualifiesFor10000Target:false,profile:{file:profileFile,sha256:sha(profileBytes)},mapped:{file:mappedFile,sha256:sha(mappedBytes)},symbolMap:{file:mapFile,sha256:sha(mapBytes)},producer:{file:'tools/analyze-current-native-timing.mjs',sha256:sha(await read(import.meta.filename))},completed:battles,callbacks:profile.totalCallbacks,lostRecords,wholeProcessSamples:rows.length,measuredSamples:selected.length,excludedSamples:rows.length-selected.length,samplingFrequencyHz:profile.sampleFrequencyHz,markerWallMs:Number(window.endNs-window.startNs)/1e6,periodWeights:{unit:'ns of sampled cpu-clock:u event period',totalNs:totalNs.toString(),totalMs:Number(totalNs)/1e6,minNs:selected.reduce((m,r)=>r.periodNs<m?r.periodNs:m,selected[0].periodNs).toString(),maxNs:selected.reduce((m,r)=>r.periodNs>m?r.periodNs:m,0n).toString(),policy:'Each sample contributes its recorded CPU-clock event period, not elapsed wall time. Values are statistical estimates; window edges, sampling skid and profiler overhead prevent treating their sum as exact task-clock accounting.'},selfGroups,topSelf,mechanics,speederGuardAndRustSelf:speederSelf,limits:['Self groups are disjoint top-frame buckets; classification regexes are in the SHA-bound producer.','Inclusive mechanic rows include all descendants and overlap; never sum their percentages.','Mechanic selection requires unique exact linked symbols and SHA-bound retained source. Other generated functions are not assigned guessed owners.','Profiled marker window is approximately 12.38 seconds versus the separate unprofiled candidate trial 7.187 seconds; do not transfer sampled milliseconds to unprofiled performance or claim a new battles/second result.','One frozen callback-only fixture does not qualify full-scene mechanics, broad random battles or the 10,000 faithful battles/second target.']};
await writeFile(resolve(root,output),JSON.stringify(result,null,2)+'\n');
const fmt=n=>n.toFixed(2),baseline='results/2026-10-28T00-00-09.130Z-native-warm23-unit-speeder-battle.json';
let markdown='# Current battle timing profile\n\nThe current Rust-integrated native candidate passes the complete raw JS report comparison, including callbacks, RNG/clock consumption and fast-path/runtime counters. The profile covers **20 measured battles**, after three warmups, with **'+selected.length.toLocaleString('en-US')+' measured-window samples at '+profile.sampleFrequencyHz+' Hz**. Startup and final diagnostics are excluded.\n\n';
markdown+='The marker window is **'+fmt(result.markerWallMs/1000)+' seconds under profiling**. The separate unprofiled trial is **7.187 seconds for 20 battles (2.783 battles/second)**. DWARF sampling adds substantial overhead; this run is a hotspot diagnostic, not a new throughput result.\n\n';
markdown+='## Where user CPU is spent\n\nThese self-time buckets are disjoint. Milliseconds are **period-weighted sampling estimates per battle under profiling**, not unprofiled timings.\n\n| Self-time bucket | Sampled user CPU | Estimated CPU ms/battle |\n|---|---:|---:|\n';
for(const row of selfGroups)markdown+='| '+row.name+' | '+fmt(row.percentOfSampledUserCpu)+'% | '+fmt(row.sampledUserCpuMsPerBattle)+' |\n';
markdown+='\nThe largest individual leaf is `'+topSelf[0].symbol+'` at **'+fmt(topSelf[0].percentOfSampledUserCpu)+'%**. This supports moving state access into typed Rust storage rather than replacing only arithmetic while retaining dynamic object lookups.\n\n';
markdown+='## Which mechanics contain the cost\n\nInclusive time includes descendants. These rows **overlap and must not be added**. Small self time does not make a mechanic cheap: most work executes in its VM callees.\n\n| Mechanic | Inclusive user CPU | Own self CPU |\n|---|---:|---:|\n';
for(const row of mechanics)markdown+='| '+row.name+' | '+fmt(row.inclusive.percentOfSampledUserCpu)+'% | '+fmt(row.self.percentOfSampledUserCpu)+'% |\n';
markdown+='\nThe Rust Speeder guard/kernel together account for **'+fmt(speederSelf.percentOfSampledUserCpu)+'% self samples**. It is not the large opportunity implied by the whole `Unit.update` subtree. Buff creation/reapplication and the unit/skill execution path are the source-level targets; callback dispatch and source ordering still need to be preserved.\n\n';
markdown+='## Evidence and reproduction\n\n- [Period-weighted timing data](validation/native-current-timing-breakdown.json)\n- [Source-mapped measured samples](validation/native-current-measured-perf-source.json)\n- [Raw profile and exact replay gate]('+profileFile.replace('benchmarks/','')+')\n- [Separate unprofiled benchmark]('+baseline+')\n\n```sh\nnode tools/analyze-current-native-timing.mjs '+profileFile+'\n```\n\nThis is one fixed callback-only fixture. It does not qualify the full actor/effect/view lifecycle, the requested random 5v5 corpus, or 10,000 faithful battles/second.\n';
await writeFile(resolve(root,'benchmarks/CURRENT_TIMING.md'),markdown);
console.log(JSON.stringify({output,measuredSamples:selected.length,markerWallMs:result.markerWallMs,periodWeightedCpuMs:result.periodWeights.totalMs,selfGroups,mechanics:mechanics.map(r=>({name:r.name,inclusive:r.inclusive.percentOfSampledUserCpu,self:r.self.percentOfSampledUserCpu})),speederSelf},null,2));
