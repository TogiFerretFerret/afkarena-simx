// Native Rust profiling only. External perf control observes existing stderr
// markers; it never edits game code, consumes RNG, or calls the source clock.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {openSync,closeSync,createWriteStream} from 'node:fs';
import {resolve,relative} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compareNativeReports,firstDifference as difference} from '../native-report-compare.mjs';
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const binaryOption=option('--binary',null);assert.ok(binaryOption,'Usage: node tools/rust-port/profile-program.mjs --binary PATH [--scope whole|unit6] [--frequency 99] [--program-dir DIR] [--reference JSON]');
const binary=resolve(root,binaryOption),scope=option('--scope','whole'),frequency=Number(option('--frequency','99'));
assert.ok(['whole','unit6','markers'].includes(scope));assert.ok(Number.isInteger(frequency)&&frequency>=1&&frequency<=997);
const controlled=scope!=='whole',startMarker=option('--start-marker','unit_start:6'),endMarker=option('--end-marker','unit_finished:6'),expectedExit=Number(option('--expected-exit','0')),stackBytes=Number(option('--stack-bytes','32768')),reportPrefix=option('--report-prefix','');assert.ok(startMarker&&endMarker&&startMarker!==endMarker);assert.ok([0,1].includes(expectedExit));assert.ok(Number.isInteger(stackBytes)&&stackBytes>=8192&&stackBytes<=65528&&stackBytes%8===0);
const perf=resolve(root,option('--perf','work/downloads/perf/perf')),sha=b=>createHash('sha256').update(b).digest('hex');
const hash=async file=>sha(await readFile(file)),binaryHash=await hash(binary);
const stamp=new Date().toISOString().replaceAll(':','-'),directory=resolve(root,'work/rust-program-perf'),prefix=resolve(directory,stamp);
const home=resolve(directory,'empty-home');await mkdir(home,{recursive:true});
// DWARF samples can contain process environment bytes. Never pass ambient
// credentials or proxy configuration to perf or its child.
const environment={PATH:'/usr/bin:/bin',HOME:home,LANG:'C',TZ:'UTC',RUST_PORT_TRACE:'0'};
const data=prefix+'.data',control=[],acknowledgments=[],markers=[];
const recordArgs=['record','--clockid','mono','-e','cpu-clock:u','-F',String(frequency),'--call-graph','dwarf,'+stackBytes,'-o',data,...(controlled?['--delay=-1','--control','fd:3,4']:[]),'--',binary];
async function command(commandArgs,label){const out=openSync(prefix+'.'+label+'.stdout','w'),err=openSync(prefix+'.'+label+'.stderr','w');try{return await new Promise((accept,reject)=>{const child=spawn(perf,commandArgs,{cwd:root,env:environment,stdio:['ignore',out,err]});child.once('error',reject);child.once('close',(code,signal)=>accept({code,signal}));});}finally{closeSync(out);closeSync(err);}}
const recordOut=openSync(prefix+'.record.stdout','w'),recordErr=createWriteStream(prefix+'.record.stderr');
const start=performance.now();let execution;
try{execution=await new Promise((accept,reject)=>{
 const child=spawn(perf,recordArgs,{cwd:root,env:environment,stdio:controlled?['ignore',recordOut,'pipe','pipe','pipe']:['ignore',recordOut,'pipe']});
 let pending='';const observe=line=>{const kind=line.startsWith(startMarker)?'start':line.startsWith(endMarker)?'end':null;if(!kind&&!/^unit_(start|finished):\d+$/.test(line))return;markers.push({line,kind,observerElapsedMs:performance.now()-start});if(controlled&&kind){const operation=kind==='start'?'enable':'disable';control.push({operation,observerElapsedMs:performance.now()-start});child.stdio[3].write(operation+'\n');}};
 child.stderr.on('data',chunk=>{recordErr.write(chunk);pending+=chunk.toString();let at;while((at=pending.indexOf('\n'))>=0){observe(pending.slice(0,at).replace(/\r$/,''));pending=pending.slice(at+1);}});
 if(controlled){child.stdio[3].on('error',error=>control.push({error:error.message}));child.stdio[4].on('data',chunk=>acknowledgments.push({text:chunk.toString(),observerElapsedMs:performance.now()-start}));}
 child.once('error',reject);child.once('close',(code,signal)=>{if(pending)observe(pending);accept({code,signal});});
 });}finally{closeSync(recordOut);await new Promise(accept=>recordErr.end(accept));}
const wallMs=performance.now()-start,stderr=await readFile(prefix+'.record.stderr','utf8');
const dataBytes=await stat(data).then(s=>s.size).catch(()=>0),reports=[];
if(dataBytes>0)for(const[label,options]of[
 ['leaf',['report','--no-inline','--stdio','--no-children','--sort','symbol,dso','--field-separator','|','--fields','overhead,period,sample,symbol,dso','--percent-limit','0','--call-graph','none']],
 ['inclusive',['report','--no-inline','--stdio','--children','--sort','symbol,dso','--percent-limit','0.5','--call-graph','graph,0.5,caller']],
 ['stacks',['script','--no-inline','--ns','-F','comm,pid,tid,time,event,period,ip,sym,symoff,dso']],
 ['buildids',['buildid-list']]
])reports.push({label,...await command([...options,'-i',data],label)});
const leafText=reports.find(r=>r.label==='leaf')?.code===0?await readFile(prefix+'.leaf.stdout','utf8'):'';
const leaves=[];for(const line of leafText.split('\n')){const columns=line.split('|').map(s=>s.trim());if(columns.length<5||!/^\d+(?:\.\d+)?%$/.test(columns[0])||!/^\d+$/.test(columns[1]))continue;leaves.push({symbol:columns[3].replace(/^\[.\]\s*/,''),dso:columns[4],samples:Number(columns[2]),periodNs:columns[1]});}
// This perf package lacks Rust v0 demangling. Binutils supplies it without
// rebuilding the profiled binary or guessing names from address ranges.
let demangler=null;if(leaves.length){const result=spawnSync('/usr/bin/c++filt',['--format=rust'],{input:leaves.map(row=>row.symbol).join('\n')+'\n',encoding:'utf8',env:environment,maxBuffer:32*1024*1024});if(result.status===0){const names=result.stdout.trimEnd().split('\n');if(names.length===leaves.length){for(let i=0;i<names.length;i++){leaves[i].rawSymbol=leaves[i].symbol;leaves[i].symbol=names[i].replace(/\[[0-9a-f]{16}\]/g,'');}demangler={file:'/usr/bin/c++filt',sha256:await hash('/usr/bin/c++filt')};}}}
const group=s=>/js_runtime::/.test(s)?'Rust JavaScript semantics runtime':/battle_unit_\d/.test(s)?'Generated source execution':/rust_battle_program::program_host/.test(s)?'Oracle file and diagnostic host':/alloc|malloc|free|memcpy|memmove|memset|hashbrown|RawVec|BTree/i.test(s)?'Allocation, collections and memory':s==='[unknown]'||/^0x[0-9a-f]+$/.test(s)?'Unresolved':'Other Rust and system code';
const groups=new Map();let period=0n;for(const row of leaves){const ns=BigInt(row.periodNs);period+=ns;const label=group(row.symbol),previous=groups.get(label)??{samples:0,ns:0n};previous.samples+=row.samples;previous.ns+=ns;groups.set(label,previous);}
const percentage=ns=>period===0n?0:Number(ns)*100/Number(period);
const selfGroups=[...groups].map(([name,row])=>({name,samples:row.samples,periodNs:String(row.ns),percent:percentage(row.ns)})).sort((a,b)=>b.percent-a.percent);
const sourceMapping=[];const programDir=option('--program-dir',null);if(programDir)for(let unit=0;unit<7;unit++){
 const file=resolve(root,programDir,`battle-unit-${unit}/manifest.json`);let manifest;try{manifest=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
 for(const row of leaves){const match=new RegExp(`battle_unit_${unit}(?:_part_\\d+)?::(js_function_(\\d+)|js_part_(\\d+)_[A-Za-z0-9_]+)`).exec(row.symbol);if(!match)continue;const id=Number(match[2]??match[3]),fn=manifest.functions.find(fn=>fn.id===id);if(fn)sourceMapping.push({...row,unit,functionId:id,sourceFile:manifest.filename,sourceSha256:fn.sourceSha256,utf16Start:fn.start,utf16End:fn.end,name:fn.name,manifest:{file:relative(root,file),sha256:await hash(file)}});}
}
let semanticReportMatched=null,firstDifference=null,actual=null;
try{const lines=(await readFile(prefix+'.record.stdout','utf8')).trim().split('\n');if(reportPrefix){const matching=lines.filter(line=>line.startsWith(reportPrefix));assert.equal(matching.length,1);actual=JSON.parse(matching[0].slice(reportPrefix.length));}else actual=JSON.parse(lines.at(-1));}catch{}
const referenceFile=option('--reference',null);let reference=null;if(referenceFile){const file=resolve(root,referenceFile);reference={file:referenceFile,sha256:await hash(file)};const expected=JSON.parse(await readFile(file,'utf8'));firstDifference=actual?(compareNativeReports(actual,expected)??difference(actual.hostInputConsumption,expected.hostInputConsumption,'$.hostInputConsumption')):{path:'$execution',reason:'No final JSON report'};semanticReportMatched=execution.code===expectedExit&&firstDifference===null;}
const binaryUnchanged=await hash(binary)===binaryHash;
const sampled=leaves.reduce((sum,row)=>sum+row.samples,0),lost=/Total Lost Samples:\s*(\d+)/.exec(leafText)?.[1]??null;
// A program may exit immediately after unit_finished:6, before perf services
// the disable command. Process exit ends sampling too; retain the lost disable
// acknowledgment and pipe-reset evidence rather than calling it an exact edge.
const acknowledgmentCount=(acknowledgments.map(r=>r.text).join('').match(/ack\n/g)??[]).length;
const controlValid=scope==='whole'||(control.filter(r=>r.operation==='enable').length===1&&control.filter(r=>r.operation==='disable').length===1&&markers.filter(r=>r.kind==='start').length===1&&markers.filter(r=>r.kind==='end').length===1&&acknowledgmentCount>=(scope==='markers'?2:1)&&/Events enabled/.test(stderr)&&execution.code===expectedExit);
const profileSucceeded=execution.code===expectedExit&&binaryUnchanged&&dataBytes>0&&sampled>0&&reports.length===4&&reports.every(r=>r.code===0)&&controlValid;
const outputPrefix='benchmarks/results/'+stamp+'-rust-program-perf',artifacts=[];
for(const[label,file]of[['record-stdout',prefix+'.record.stdout'],['record-stderr',prefix+'.record.stderr'],...reports.flatMap(r=>[[r.label,prefix+'.'+r.label+'.stdout'],[r.label+'-stderr',prefix+'.'+r.label+'.stderr']]),...(dataBytes>0?[['data',data]]:[])]){
 const bytes=await readFile(file),compressed=gzipSync(bytes,{level:6}),chunks=[];for(let offset=0;offset<compressed.length;offset+=24*1024*1024){const bytes=compressed.subarray(offset,offset+24*1024*1024),file=outputPrefix+'.'+label+'.'+String(chunks.length).padStart(3,'0')+'.gz';await writeFile(resolve(root,file),bytes);chunks.push({file,bytes:bytes.length,sha256:sha(bytes)});}artifacts.push({label,chunks,uncompressedBytes:bytes.length,uncompressedSha256:sha(bytes),compression:'Concatenate chunks, then gunzip'});
}
const result={version:1,profileSucceeded,execution,expectedExit,scope,startMarker,endMarker,stackBytes,reportPrefix,wallMs,frequencyHz:frequency,perf:{file:relative(root,perf),sha256:await hash(perf)},demangler,binary:{file:binaryOption,sha256:binaryHash,unchanged:binaryUnchanged},recordArgs,environment,markers,control,acknowledgments,acknowledgmentCount,controlValid,dataBytes,sampled,lostSamples:lost,estimatedSampledUserCpuNs:String(period),selfGroups,topSelf:leaves.sort((a,b)=>Number(BigInt(b.periodNs)-BigInt(a.periodNs))).slice(0,40).map(row=>({...row,percent:percentage(BigInt(row.periodNs))})),sourceMapping,semanticReportMatched,firstDifference,reference,completed:actual?.completed??null,totalCallbacks:actual?.totalCallbacks??null,reports,artifacts,producer:{file:'tools/rust-port/profile-program.mjs',sha256:await hash(resolve(root,'tools/rust-port/profile-program.mjs'))},qualifiesFor10000Target:false,limitations:[scope==='markers'?'Sampling is externally enabled/disabled after observing the requested marker prefixes. Both control acknowledgments are required. Pipe/control latency and sample skid mean this approximates the wrapper interval rather than an exact source-clock boundary. Startup before start marker and external serialization after end marker are excluded; work inside the wrapper interval remains included.':scope==='whole'?'Profile includes the entire process: source/table initialization, warmups, measured battles and final diagnostics.':'Sampling is enabled after observing unit_start:6 and disable is requested after unit_finished:6, with asynchronous pipe/control acknowledgment latency. A fast program exit may end sampling before disable acknowledgment. Units0–5 startup is approximately excluded. Unit6 setup, warmups and final diagnostics remain included; this is not an exact measured-battle window.','Profiling changes execution time. No battles/sec or unprofiled millisecond inference is supported. A configured expected nonzero exit is diagnostic-only and never qualifies a complete normal workload.','Self groups classify linked symbol names and are disjoint. Inlined code is attributed to its containing native symbol; unresolved samples are retained. Inclusive report rows overlap.','Source mappings refer to exact function ranges in the frozen source modules; anonymous functions are not assigned invented mechanic names.','A matching supplied final reference is a separate semantic report check, not broad corpus or full-scene qualification. Without --reference, semanticReportMatched stays null.']};
await writeFile(resolve(root,outputPrefix+'.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({file:outputPrefix+'.json',profileSucceeded,semanticReportMatched,sampled,controlValid,selfGroups}));if(!profileSucceeded||semanticReportMatched===false)process.exitCode=1;
