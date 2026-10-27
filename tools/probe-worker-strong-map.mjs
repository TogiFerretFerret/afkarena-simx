// Experimental whole-worker retention lease; never edits the active adapter.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compareNativeReports,compareHostInputConsumption,semanticNativeReport} from './native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-worker-strong-map');
await mkdir(directory,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex'),read=file=>readFile(resolve(root,file));
const baselineManifestPath='work/native-warm23-partition/manifest.json',baselineManifestBytes=await read(baselineManifestPath),baseline=JSON.parse(baselineManifestBytes);
assert.equal(baseline.passed,true);
const metadataPath=baseline.input.file+'.metadata.json',metadataBytes=await read(metadataPath),metadata=JSON.parse(metadataBytes);
assert.equal(sha(metadataBytes),baseline.input.metadataSha256);assert.equal(metadata.battles,20);assert.equal(metadata.warmup,3);
const adapterPath='tools/qualification-table-membrane.js',adapterBytes=await read(adapterPath),adapter=adapterBytes.toString('utf8');
assert.equal(sha(adapterBytes),metadata.adapterInputs[adapterPath]);
const original=adapter.slice(adapter.indexOf('(function(host){')).trim();
const approved=metadata.usedTableNames.filter(name=>!metadata.mutableTables.includes(name));
assert.ok(approved.length>0);
const prologue=[
 'var workerMapConstructor=Map;',
 'var workerMapGet=Function.prototype.call.bind(workerMapConstructor.prototype.get);',
 'var workerMapHas=Function.prototype.call.bind(workerMapConstructor.prototype.has);',
 'var workerMapSet=Function.prototype.call.bind(workerMapConstructor.prototype.set);',
 'var workerOwnDescriptor=Object.getOwnPropertyDescriptor,workerRoots=null;',
 'var workerApproved=Object.create(null),workerNames='+JSON.stringify(approved)+';',
 'for(var workerIndex=0;workerIndex<workerNames.length;workerIndex++)workerApproved[workerNames[workerIndex]]=true;'
].join('\n');
let candidate=original.replace('"use strict";','"use strict";\n'+prologue)
 .replaceAll('new WeakMap()','new workerMapConstructor()')
 .replace('names=new Map()','names=new workerMapConstructor()');
for(const [method,replacement] of [['get','workerMapGet'],['set','workerMapSet'],['has','workerMapHas']])candidate=candidate.replace(new RegExp('\\b(records|proxies|local|names)\\.'+method+'\\(','g'),replacement+'($1,');
const lease=[
 'function assertWorkerLease(){',
 ' if(typeof __nativeTables!=="object"||__nativeTables===null)failure("worker-scoped table loader required",false);',
 ' if(workerRoots===null)workerRoots=__nativeTables;',
 ' if(workerRoots!==__nativeTables)failure("worker table-root lease replaced",false);',
 '}',
 'function assertWorkerRoot(root,name){',
 ' assertWorkerLease();',
 ' if(workerApproved[name]!==true)failure("table outside bounded worker lease: "+name,false);',
 ' var owned=workerOwnDescriptor(workerRoots,name);',
 ' if(!owned||!("value" in owned)||owned.value!==root)failure("generic wrap root is outside worker lease",false);',
 '}'
].join('\n');
candidate=candidate.replace('function register(root,name){',lease+'\nfunction register(root,name){');
const rootGuard='if(root===null||typeof root!=="object")failure("table root must be a JSON object or array",false);';
assert.ok(candidate.includes(rootGuard));candidate=candidate.replace(rootGuard,rootGuard+'\n            assertWorkerRoot(root,name);');
const parseAPI='parse:function(text,info){if(typeof text!=="string")failure("JSON text must be a primitive string",false);return register(jsonParse(text),info&&info.name);},';
assert.ok(candidate.includes(parseAPI));candidate=candidate.replace(parseAPI,'parse:function(){return failure("generic parse is outside whole-worker root lease",false);},');
candidate=candidate.replace('assertClean:function(){if(firstFailure!==null)','assertClean:function(){assertWorkerLease();if(firstFailure!==null)');
assert.equal((candidate.match(/new WeakMap/g)||[]).length,0);
const candidatePath='benchmarks/validation/worker-strong-map-helper.js';
await writeFile(resolve(root,candidatePath),'/* EXPERIMENTAL worker-scoped diagnostic helper; generic wrap/parse unsupported. */\n'+candidate+'\n');
const units=[];let replacementProof=null;
for(let index=0;index<baseline.units.length;index++){
 const old=baseline.units[index],bytes=await read(old.file);assert.equal(sha(bytes),old.sha256);
 let file=old.file,outputBytes=bytes;
 if(index===0){
  const text=bytes.toString('utf8'),start=text.indexOf(original);assert.ok(start>=0);assert.equal(text.indexOf(original,start+1),-1);
  const before=text.slice(0,start),after=text.slice(start+original.length);
  const output=before+candidate+after;file=resolve(directory,'combined.js');outputBytes=Buffer.from(output);await writeFile(file,outputBytes);
  assert.equal(output.slice(0,before.length),before);assert.equal(output.slice(before.length+candidate.length),after);
  replacementProof={start,end:start+original.length,oldHelperSha256:sha(original),newHelperSha256:sha(candidate),unchangedPrefixSha256:sha(before),unchangedSuffixSha256:sha(after),allOriginalGameFunctionSourceBytesUnchanged:true,reason:'The sole edit replaces one exact known host-membrane IIFE. Every byte outside that host helper, and every other source unit, is unchanged; original module/helper source inputs remain separately pinned.'};
 }
 units.push({...old,file,sha256:sha(outputBytes),bytes:outputBytes.length,unchangedFromBaseline:index!==0});
}
const sourceInputs={};
for(const [file,expected] of Object.entries(metadata.sourceInputs)){const bytes=await read(file);assert.equal(sha(bytes),expected);sourceInputs[file]=expected;}
const gcAuditPath='benchmarks/validation/gc-observability.json',gcBytes=await read(gcAuditPath),gc=JSON.parse(gcBytes);
assert.equal(gc.sourceCount,18);
for(const [file,input] of Object.entries(gc.inputs)){assert.equal(sha(await read(file)),input.sha256);}
for(const row of [metadata.reference,metadata.hostInputs,metadata.tableBundle])assert.equal(sha(await read(row.file)),row.sha256);
const immutableHelperArchive='benchmarks/validation/worker-strong-map-unit0.js.gz';
await writeFile(resolve(root,immutableHelperArchive),gzipSync(await read(units[0].file),{level:9}));
const loader='const fs=require("node:fs"),vm=require("node:vm");globalThis.hermescli={loadFile:p=>new Uint8Array(fs.readFileSync(p))};globalThis.__nativeDiagnosticDigest=text=>require("node:crypto").createHash("sha256").update(text).digest("hex");for(const file of JSON.parse(process.argv[1]))vm.runInThisContext(fs.readFileSync(file,"utf8"),{filename:file});';
const run=spawnSync(process.execPath,[...metadata.oracleProfile.rawBitReferenceFlags,'-e',loader,JSON.stringify(units.map(u=>u.file))],{cwd:root,env:{...process.env,NODE_OPTIONS:metadata.oracleProfile.rawBitReferenceNodeOptions},encoding:'utf8',maxBuffer:128*1024*1024});
if(run.error)throw run.error;
await writeFile(resolve(directory,'node.stdout'),run.stdout??'');await writeFile(resolve(directory,'node.stderr'),run.stderr??'');
let actual=null,difference=null;
try{actual=JSON.parse((run.stdout??'').trim().split('\n').at(-1));difference=compareNativeReports(actual,JSON.parse(await read(metadata.reference.file)))??compareHostInputConsumption(actual.hostInputConsumption,metadata.hostInputs);}catch(error){difference={path:'$execution',message:error.message};}
const artifacts=[];
for(const [label,bytes] of [['actual',Buffer.from(run.stdout??'')],['stderr',Buffer.from(run.stderr??'')]]){const file='benchmarks/validation/worker-strong-map-'+label+'.gz',compressed=gzipSync(bytes,{level:9});await writeFile(resolve(root,file),compressed);artifacts.push({label,file,sha256:sha(compressed),uncompressedSha256:sha(bytes),uncompressedBytes:bytes.length});}
const passed=run.status===0&&difference===null&&actual?.completed===20;
const manifest={
 version:1,passed,difference,qualifiesFor10000Target:false,
 scope:'EXPERIMENTAL worker-scoped strong Map registries in the immutable qualification host helper only. All original game source bytes remain unchanged. One fixed callback-only fixture, three warmups then twenty measured battles; no broad battle/scene qualification or speed claim.',
 input:baseline.input,baselineManifest:{file:baselineManifestPath,sha256:sha(baselineManifestBytes)},metadataSha256:sha(metadataBytes),
 candidate:{file:candidatePath,sha256:sha(await read(candidatePath)),sourceSha256:sha(candidate),activeAdapterChanged:false},
 replacementProof,units,sourceInputs,approvedImmutableTables:approved,
 oracleProfile:metadata.oracleProfile,reference:metadata.reference,hostInputs:metadata.hostInputs,tableBundle:metadata.tableBundle,
 gcAudit:{file:gcAuditPath,sha256:sha(gcBytes),sourceCount:18,exactNameTotals:gc.exactNameTotals,limitations:gc.limitations},
 ownershipArgument:[
  'The native worker loader assigns __nativeTables once from the pinned JSON bundle and has no eviction. Every decoded raw root remains reachable through that binding for the single process/batch lifetime.',
  'Immutable graph edges cannot change through exposed table proxies. Under the bounded loader domain, every raw descendant remains strongly reachable from a leased root, so records Map does not add a raw-key lifetime.',
  'Each created proxy is already strongly retained by record.proxy while its raw key is reachable. proxies Map therefore adds no proxy-key lifetime within the worker lease.',
  'The register-local graph map never escapes; pending retains its raw keys throughout external validation/digest callbacks.',
  'Captured Map constructor and bound native get/has/set operations do not consult later mutable Map/Function prototype method properties. Generic root wrapping and parsing are rejected; this helper is not promoted as a generic library.',
  'The lease and source audit are bounded to this supplied-source worker. Arbitrary host raw aliases, reflection into added harness globals, cross-worker reuse, root eviction and hostile pre-bootstrap intrinsic replacement are outside this experimental domain.'
 ],
 leaseChecks:['Every wrap requires an approved immutable table name and exact own data-root identity in the retained __nativeTables object.','A replaced worker root-set binding fails sticky qualification.','Generic parse and roots outside the loader bundle fail sticky qualification.'],
 intrinsicCaptureOrdering:'The helper captures trusted host-bootstrap Map/call/bind identities at its IIFE evaluation. This is a bounded harness-domain assumption, not a test that arbitrary pre-mutated globals are pristine; hostile pre-bootstrap extensions are unsupported.',
 observed:actual?{completed:actual.completed,totalCallbacks:actual.totalCallbacks,classManagerCounters:actual.classManagerCounters,tableBoundary:actual.tableBoundary,hostInputConsumption:actual.hostInputConsumption}:null,
 comparedFields:actual?Object.keys(semanticNativeReport(actual)):[],execution:{code:run.status,signal:run.signal},artifacts,
 unit0Archive:{file:immutableHelperArchive,sha256:sha(await read(immutableHelperArchive))},
 producer:{file:'tools/probe-worker-strong-map.mjs',sha256:sha(await read('tools/probe-worker-strong-map.mjs'))}
};
await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(resolve(root,'benchmarks/validation/worker-strong-map.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({passed,completed:actual?.completed,callbacks:actual?.totalCallbacks,difference,manifest:'work/native-worker-strong-map/manifest.json',unit0:units[0],tableBoundary:actual?.tableBoundary},null,2));
if(!passed)process.exitCode=1;
