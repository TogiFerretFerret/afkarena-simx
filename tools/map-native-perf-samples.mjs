import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const profilePath=option('--profile'),mapPath=option('--map','benchmarks/validation/native-copy-js-symbol-map.json'),output=option('--output','benchmarks/validation/native-copy-perf-source.json');
assert.ok(profilePath,'--profile <completed native perf report.json> required');
const sha=value=>createHash('sha256').update(value).digest('hex'),read=path=>readFile(resolve(root,path));
const profileBytes=await read(profilePath),profile=JSON.parse(profileBytes),mapBytes=await read(mapPath),mapSummary=JSON.parse(mapBytes);
assert.equal(profile.profileSucceeded,true);assert.equal(profile.semanticReportMatched,true);
assert.equal(profile.binary.sha256,mapSummary.binary.sha256);
const compressedMap=await read(mapSummary.mapping.file);assert.equal(sha(compressedMap),mapSummary.mapping.sha256);const mapping=JSON.parse(gunzipSync(compressedMap));
assert.equal(mapping.binary.sha256,profile.binary.sha256);
const binary=await read(profile.binary.file);assert.equal(sha(binary),profile.binary.sha256);
assert.equal(binary.subarray(0,6).toString('hex'),'7f454c460201');
const phoff=Number(binary.readBigUInt64LE(32)),phsize=binary.readUInt16LE(54),phcount=binary.readUInt16LE(56),segments=[];assert.equal(phsize,56);
for(let index=0;index<phcount;index++){const at=phoff+index*phsize;if(binary.readUInt32LE(at)!==1)continue;segments.push({offset:binary.readBigUInt64LE(at+8),virtual:binary.readBigUInt64LE(at+16),fileSize:binary.readBigUInt64LE(at+32),flags:binary.readUInt32LE(at+4)});}
const artifact=profile.artifacts.find(a=>a.label==='stacks');assert.ok(artifact);
const chunks=[];for(const chunk of artifact.chunks){const bytes=await read(chunk.file);assert.equal(sha(bytes),chunk.sha256);chunks.push(bytes);}const compressed=Buffer.concat(chunks);assert.equal(sha(compressed),artifact.compressedSha256);const scriptBytes=gunzipSync(compressed);assert.equal(sha(scriptBytes),artifact.uncompressedSha256);
const functions=mapping.functions.map(row=>({...row,start:BigInt(row.address),end:BigInt(row.address)+BigInt(row.size)})).sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:0);
function lookup(address){let lo=0,hi=functions.length;while(lo<hi){const mid=(lo+hi)>>1;if(functions[mid].start<=address)lo=mid+1;else hi=mid;}const row=functions[lo-1];return row&&address<row.end?row:null;}
const binaryPath=resolve(root,profile.binary.file),mappings=new Map(),rows=[],unknownLines=[],unresolved=new Map();let current=null,mmapEvents=0;
function finish(){if(current){rows.push(current);current=null;}}
for(const line of scriptBytes.toString('utf8').split('\n')){
 const mmap=/PERF_RECORD_MMAP2?\s+(\d+)\/\d+:\s+\[(0x[0-9a-f]+)\((0x[0-9a-f]+)\)\s+@\s+(0x[0-9a-f]+|0)[^\]]*\]:\s+\S+\s+(.+)$/i.exec(line);
 if(mmap){finish();const pid=Number(mmap[1]),entry={start:BigInt(mmap[2]),length:BigInt(mmap[3]),offset:BigInt(mmap[4]),file:mmap[5]};if(!mappings.has(pid))mappings.set(pid,[]);mappings.get(pid).push(entry);mmapEvents++;continue;}
 const sample=/^\s*(.*?)\s+(\d+)\/(\d+)\s+(\d+\.\d+):\s+(.+):\s*$/.exec(line);
 if(sample){finish();current={pid:Number(sample[2]),tid:Number(sample[3]),time:Number(sample[4]),event:sample[5],frames:[]};continue;}
 const frame=/^\s+([a-f0-9]+)\s+(.+)\s+\((.+)\)\s*$/i.exec(line);
 if(frame&&current){
  const ip=BigInt('0x'+frame[1]),displayDSO=frame[3],dsoMatch=/^(.*)\+(0x[a-f0-9]+)$/i.exec(displayDSO),file=dsoMatch?dsoMatch[1]:displayDSO;
  const value={symbol:frame[2],file,ip:'0x'+ip.toString(16),native:null};
  if(file===binaryPath){
   const candidates=(mappings.get(current.pid)||[]).filter(m=>m.file===binaryPath&&ip>=m.start&&ip<m.start+m.length);const mmap=candidates.at(-1);
   if(!mmap)value.unresolved='No preceding MMAP for target IP';
   else{
    const fileOffset=ip-mmap.start+mmap.offset,segment=segments.find(s=>(s.flags&1)!==0&&fileOffset>=s.offset&&fileOffset<s.offset+s.fileSize);
    if(!segment)value.unresolved='Target file offset outside executable PT_LOAD';
    else{
     const address=segment.virtual+fileOffset-segment.offset;
     // dsoff is retained as independent evidence; MMAP+PT_LOAD is authoritative.
     value.elfAddress='0x'+address.toString(16);value.fileOffset='0x'+fileOffset.toString(16);value.perfDSOOffset=dsoMatch?dsoMatch[2]:null;
     const found=lookup(address);if(found)value.native={unit:found.unit,symbol:found.symbol,address:found.address,name:found.name,sourceSha256:found.sourceSha256};else value.unresolved='ELF address has no mapped NFI JS function (native C/Rust wrapper or other code)';
    }
   }
   if(value.unresolved)unresolved.set(value.unresolved,(unresolved.get(value.unresolved)||0)+1);
  }
  current.frames.push(value);continue;
 }
 if(line.trim()&&!/^\s*#/.test(line)&&!line.includes('PERF_RECORD_'))unknownLines.push(line.slice(0,500));
}
finish();assert.ok(rows.length>0,'No parsed samples');assert.ok(mmapEvents>0,'No MMAP events; do not guess ASLR bias');assert.equal(unknownLines.length,0,'Unrecognized perf script format');
const leaf=new Map(),inclusive=new Map(),dsoLeaf=new Map(),bins=new Map(),first=rows[0].time;
const key=entry=>entry.unit+':'+entry.address;
for(const sample of rows){
 const top=sample.frames[0];if(!top)continue;const displayKey=top.file+'\n'+(top.native?top.native.unit+':'+top.native.symbol:top.symbol.replace(/\+0x[a-f0-9]+$/i,''));dsoLeaf.set(displayKey,(dsoLeaf.get(displayKey)||0)+1);
 if(top.native)leaf.set(key(top.native),(leaf.get(key(top.native))||0)+1);
 const visited=new Set();for(const frame of sample.frames)if(frame.native&&!visited.has(key(frame.native))){visited.add(key(frame.native));inclusive.set(key(frame.native),(inclusive.get(key(frame.native))||0)+1);}
 const bin=Math.floor((sample.time-first)/10);if(!bins.has(bin))bins.set(bin,{startSeconds:bin*10,endSeconds:(bin+1)*10,samples:0,mappedJSLeafSamples:0,hadesGCLeafSamples:0,hadesWeakGCLeafSamples:0});const bucket=bins.get(bin);bucket.samples++;if(top.native)bucket.mappedJSLeafSamples++;if(top.file===profile.privateVM.file&&top.symbol.includes("hermes::vm::HadesGC::")){bucket.hadesGCLeafSamples++;if(top.symbol.includes("acceptWeak("))bucket.hadesWeakGCLeafSamples++;}
}
const known=new Map(functions.map(row=>[row.unit+':'+row.address,row]));
function ranked(counts){return[...counts].sort((a,b)=>b[1]-a[1]).slice(0,100).map(([id,count])=>{const fn=known.get(id);return{samples:count,percentOfAllSamples:count/rows.length*100,unit:fn.unit,symbol:fn.symbol,address:fn.address,name:fn.name,sourceSha256:fn.sourceSha256,sourceRangeCount:fn.sourceRangeCount,ranges:fn.sourceSha256?mapping.sourceRecords[fn.sourceSha256].ranges.slice(0,8):[]};});}
const result={version:1,passed:true,scope:'Native whole-process sampled profile mapped by recorded MMAP and exact ELF PT_LOAD/NFI addresses. Cold initialization, warmups, measured battles and final reporting are combined; bins are elapsed sample time only, not proven battle phases.',qualifiesFor10000Target:false,profile:{file:profilePath,sha256:sha(profileBytes)},mapping:{file:mapPath,sha256:sha(mapBytes),compressedMapSha256:sha(compressedMap)},binary:profile.binary,toolSha256:sha(await readFile(import.meta.filename)),samples:rows.length,recordedSampleCount:profile.sampleCount,mmapEvents,firstSampleTime:first,lastSampleTime:rows.at(-1).time,unresolvedTargetFrames:Object.fromEntries(unresolved),leaf:ranked(leaf),inclusive:ranked(inclusive),dsoLeaf:[...dsoLeaf].sort((a,b)=>b[1]-a[1]).slice(0,100).map(([id,samples])=>({file:id.split('\n')[0],symbol:id.split('\n')[1],samples,percentOfAllSamples:samples/rows.length*100})),timeBins:[...bins.values()].map(bin=>({...bin,hadesGCLeafPercent:bin.hadesGCLeafSamples/bin.samples*100})),notes:['Inclusive counts deduplicate recursive occurrences of each exact native function per sample.','Duplicate static symbol names are resolved by translated IP and owning unit; name-only attribution is never used.','Unmapped NFI functions may be generated native C/Rust code. No semantic owner is invented.','Samples are diagnostic observations, not a throughput or speedup measurement.']};
await writeFile(resolve(root,output),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output,samples:rows.length,mmapEvents,topJSLeaf:result.leaf.slice(0,10),topJSInclusive:result.inclusive.slice(0,10),unresolvedTargetFrames:result.unresolvedTargetFrames},null,2));
