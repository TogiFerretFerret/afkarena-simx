// Read existing ELF/NFI data only: no Babel parse, recompilation, or execution.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const reportPath=option('--report','benchmarks/results/2026-10-27T20-51-34.120Z-native-warm23-entity.json');
const output=option('--output','benchmarks/validation/native-js-symbol-map');
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=path=>readFile(resolve(root,path));
const reportBytes=await read(reportPath),report=JSON.parse(reportBytes);
const binaryPath=option('--binary',report.linkArgs[report.linkArgs.lastIndexOf('-o')+1]);
const binaryBytes=await read(binaryPath);assert.equal(sha(binaryBytes),report.outputSha256,'Native report binary hash');
if(report.kind==='profiling-prepared-wrapper'){
 assert.equal(report.semanticReportMatched,null,'Prepared wrapper must not claim execution parity');
 assert.equal(report.allSevenObjectsReused,true);
 const baselineBytes=await read(report.strictBaseline.file);assert.equal(sha(baselineBytes),report.strictBaseline.sha256);
 const strict=JSON.parse(baselineBytes);assert.equal(strict.semanticReportMatched,true);
 assert.equal(strict.units.length,report.units.length);
 strict.units.forEach((unit,index)=>assert.equal(unit.objectSha256,report.units[index].objectSha256,'Prepared wrapper object identity'));
}
function elf(bytes){
 assert.equal(bytes.subarray(0,4).toString('hex'),'7f454c46');assert.equal(bytes[4],2,'ELF64 only');assert.equal(bytes[5],1,'Little endian ELF only');assert.equal(bytes.readUInt16LE(18),62,'x86_64 only');
 const number=(offset)=>{const value=bytes.readBigUInt64LE(offset);assert.ok(value<=BigInt(Number.MAX_SAFE_INTEGER));return Number(value);};
 const sectionOffset=number(40),sectionSize=bytes.readUInt16LE(58),count=bytes.readUInt16LE(60),namesIndex=bytes.readUInt16LE(62);
 assert.equal(sectionSize,64);assert.ok(count>0&&namesIndex<count,'Extended section numbering unsupported');
 const sections=Array.from({length:count},(_,index)=>{const at=sectionOffset+index*sectionSize;return{index,nameOffset:bytes.readUInt32LE(at),type:bytes.readUInt32LE(at+4),address:number(at+16),offset:number(at+24),size:number(at+32),link:bytes.readUInt32LE(at+40),entrySize:number(at+56)};});
 const string=(section,offset)=>{assert.ok(offset<section.size);const at=section.offset+offset,end=bytes.indexOf(0,at);assert.ok(end>=at&&end<section.offset+section.size);return bytes.toString('utf8',at,end);};
 for(const section of sections)section.name=string(sections[namesIndex],section.nameOffset);
 const symbols=[];
 for(const section of sections.filter(s=>s.type===2)){
  assert.equal(section.entrySize,24);const strings=sections[section.link];
  for(let offset=0;offset<section.size;offset+=24){const at=section.offset+offset,nameOffset=bytes.readUInt32LE(at),info=bytes[at+4],sectionIndex=bytes.readUInt16LE(at+6);symbols.push({name:nameOffset?string(strings,nameOffset):'',type:info&15,binding:info>>4,sectionIndex,value:number(at+8),size:number(at+16)});}
 }
 assert.ok(symbols.length,'Full ELF .symtab required');
 function data(symbol){const section=sections[symbol.sectionIndex];assert.ok(section&&section.type!==8);const offset=section.offset+symbol.value-section.address;assert.ok(offset>=section.offset&&offset+symbol.size<=section.offset+section.size);return bytes.subarray(offset,offset+symbol.size);}
 return{sections,symbols,data};
}
const executable=elf(binaryBytes),byAddress=new Map();
for(const symbol of executable.symbols.filter(s=>s.type===2)){const key=symbol.value+':'+symbol.name;if(!byAddress.has(key))byAddress.set(key,[]);byAddress.get(key).push(symbol);}
const metadataManifestBytes=await read(report.sourceManifest.file);assert.equal(sha(metadataManifestBytes),report.sourceManifest.sha256);
const manifest=JSON.parse(metadataManifestBytes),metadataPath=manifest.input.file+'.metadata.json',metadataBytes=await read(metadataPath);assert.equal(sha(metadataBytes),report.metadataSha256);
const metadata=JSON.parse(metadataBytes),units=[],functions=[],sourceTexts=new Map(),unresolved=[],additionalSourceInputs={};
if(manifest.candidate){
 assert.equal(manifest.passed,true,'Experimental host helper requires its passed manifest');
 assert.equal(manifest.units.length,report.units.length);
 manifest.units.forEach((unit,index)=>assert.equal(unit.sha256,report.units[index].sha256,'Candidate source unit binding'));
 assert.equal(typeof manifest.candidate.file,'string');assert.match(manifest.candidate.sha256,/^[a-f0-9]{64}$/);
 additionalSourceInputs[manifest.candidate.file]=manifest.candidate.sha256;
}
for(const unit of report.units){
 const bytes=await read(unit.object);assert.equal(sha(bytes),unit.objectSha256);
 const source=await read(unit.file);assert.equal(sha(source),unit.sha256);
 const object=elf(bytes),named=name=>{const rows=object.symbols.filter(s=>s.name===name);assert.equal(rows.length,1,unit.name+' '+name);return rows[0];};
 const exporter=named('sh_export_'+unit.name),linked=executable.symbols.filter(s=>s.name===exporter.name&&s.type===2);assert.equal(linked.length,1,'Unique export anchor required');
 const base=linked[0].value-exporter.value,nfi=object.data(named('s_function_info_table')),strings=object.data(named('s_strings')),ascii=object.data(named('s_ascii_pool'));
 const utfSymbol=object.symbols.find(s=>s.name==='s_u16_pool'),utf=utfSymbol?object.data(utfSymbol):Buffer.alloc(0);
 assert.equal(nfi.length%16,0,'Pinned NFI layout');assert.equal(strings.length%12,0);
 function string(index){assert.ok(Number.isInteger(index)&&index>=0&&index<strings.length/12);const at=index*12,offset=strings.readUInt32LE(at),length=strings.readUInt32LE(at+4);if(offset&0x80000000){const start=(offset&0x7fffffff)*2;assert.ok(start+length*2<=utf.length);return utf.toString('utf16le',start,start+length*2);}assert.ok(offset+length<=ascii.length);return ascii.toString('utf8',offset,offset+length);}
 let cEvidence=null;
 const cPath=unit.compilation?.ccArgs?.find(arg=>typeof arg==='string'&&arg.endsWith('.c'));
 if(cPath){const cBytes=await read(cPath);assert.equal(sha(cBytes),unit.compilation.patchedCSha256);const table=/static SHNativeFuncInfo s_function_info_table\[\] = \{([\s\S]*?)\n\};/.exec(cBytes.toString('utf8'));assert.ok(table);const rows=table[1].trim().split('\n');assert.equal(rows.length,nfi.length/16);rows.forEach((row,index)=>{assert.equal(Number(/name_index = (\d+)/.exec(row)[1]),nfi.readUInt32LE(index*16));assert.equal(Number(/source_index_plus_one = (\d+)/.exec(row)[1]),nfi.readUInt32LE(index*16+8));});cEvidence={file:relative(root,resolve(root,cPath)),sha256:sha(cBytes),nfiRowsVerified:rows.length};}
 units.push({name:unit.name,object:relative(root,unit.object),objectSha256:sha(bytes),source:relative(root,unit.file),sourceSha256:sha(source),exportAnchor:exporter.name,linkedExportAddress:'0x'+linked[0].value.toString(16),textBase:'0x'+base.toString(16),nfiRows:nfi.length/16,nfiSha256:sha(nfi),stringTableSha256:sha(strings),asciiPoolSha256:sha(ascii),utf16PoolSha256:sha(utf),generatedC:cEvidence,generatedCUnavailable:!cEvidence});
 for(const symbol of object.symbols.filter(s=>s.type===2)){
  const match=/^_(\d+)_/.exec(symbol.name);if(!match)continue;
  if(symbol.sectionIndex!==exporter.sectionIndex){unresolved.push({unit:unit.name,symbol:symbol.name,reason:'Function is outside the export-anchor section; no guessed linked address'});continue;}
  const address=base+symbol.value,linkedRows=byAddress.get(address+':'+symbol.name)||[];
  assert.ok(linkedRows.some(s=>s.size===symbol.size),'Exact linked address/name/size match required: '+unit.name+' '+symbol.name);
  const index=Number(match[1]);assert.ok(index<nfi.length/16);
  const name=string(nfi.readUInt32LE(index*16)),sourceIndex=nfi.readUInt32LE(index*16+8),text=sourceIndex?string(sourceIndex-1):null,sourceSha256=text===null?null:sha(text);
  if(text!==null)sourceTexts.set(sourceSha256,text);
  functions.push({unit:unit.name,symbol:symbol.name,address:'0x'+address.toString(16),size:symbol.size,nfiIndex:index,name,argumentCount:nfi.readUInt32LE(index*16+4),sourceSha256,sourceLength:text?.length??null,sourceStatus:text===null?'NFI source unavailable':'Pending exact substring search'});
 }
}
// Index only exact retained function prefixes. Scanning source bytes avoids
// reparsing hundreds of MB; all matches are subsequently checked in full.
const prefixLength=64,longPrefixes=new Set(),shortByLength=new Map(),ranges=new Map();
for(const [hash,text] of sourceTexts){ranges.set(hash,[]);if(!text.startsWith('function'))continue;if(text.length>=prefixLength)longPrefixes.add(text.slice(0,prefixLength));else{if(!shortByLength.has(text.length))shortByLength.set(text.length,new Map());shortByLength.get(text.length).set(text,hash);}}
const longByPrefix=new Map();for(const [hash,text] of sourceTexts)if(text.startsWith('function')&&text.length>=prefixLength){const key=text.slice(0,prefixLength);if(!longByPrefix.has(key))longByPrefix.set(key,[]);longByPrefix.get(key).push([hash,text]);}
const sourceFiles=[];
for(const [file,expected] of Object.entries({...metadata.sourceInputs,...metadata.adapterInputs,...additionalSourceInputs})){
 const bytes=await read(file);assert.equal(sha(bytes),expected,'Original source changed: '+file);const text=bytes.toString('utf8');sourceFiles.push({file,sha256:sha(bytes),bytes:bytes.length,domain:file.startsWith('src/')?'original-game':'adapter'});
 for(let at=text.indexOf('function');at!==-1;at=text.indexOf('function',at+8)){
  const prefix=text.slice(at,at+prefixLength);
  if(longPrefixes.has(prefix))for(const [hash,needle] of longByPrefix.get(prefix))if(text.startsWith(needle,at))ranges.get(hash).push({file,start:at,end:at+needle.length,contextBefore:text.slice(Math.max(0,at-100),at)});
  for(const [length,needles] of shortByLength){const needle=text.slice(at,at+length),hash=needles.get(needle);if(hash)ranges.get(hash).push({file,start:at,end:at+length,contextBefore:text.slice(Math.max(0,at-100),at)});}
 }
}
for(const row of functions){if(row.sourceSha256===null)continue;const matches=ranges.get(row.sourceSha256);row.sourceRangeCount=matches.length;row.originalGameRangeCount=matches.filter(r=>r.file.startsWith('src/')).length;row.sourceStatus=matches.length===0?'No exact occurrence in pinned source modules (generated source or unmatched syntax)':matches.length===1?'Unique exact source occurrence':'Repeated exact source; all occurrences retained in shared sourceRecords';}
const symbolCounts=new Map();for(const row of functions)symbolCounts.set(row.symbol,(symbolCounts.get(row.symbol)||0)+1);
const mapping={version:1,binary:{file:relative(root,binaryPath),sha256:sha(binaryBytes)},inputReport:{file:reportPath,sha256:sha(reportBytes)},compilerSha256:report.compilerSha256,originalVMSha256:report.originalVMSha256,units,sourceFiles,sourceRecords:Object.fromEntries([...sourceTexts].map(([hash,text])=>[hash,{length:text.length,ranges:ranges.get(hash)}])),functions,unresolved,notes:['ELF64 x86_64 local symbols are resolved by unique per-unit sh_export anchor and validated against linked address, name and size. Repeated static symbol names are never resolved by name alone.','NFI layout is16bytes in the pinned compiler ABI; retained generated C is checked field-by-field where available. Other NFI and string pools are read directly from the exact hashed ELF object.','Exact source substring matches identify byte-for-byte retained JS function text; indices use JS UTF16 offsets, matching repository extraction metadata. Repeated identical source occurrences remain explicit; no guessed semantic owner.','Name is the compiler NFI function name, not an inferred fully qualified property path. Context is supplied for inspection. Functions without source information remain unmapped.']};
const compressed=gzipSync(JSON.stringify(mapping),{level:9});await writeFile(resolve(root,output+'.json.gz'),compressed);
const summary={version:1,passed:true,scope:'Native executable static-symbol to retained original JS source mapping; no performance or battle qualification claim.',qualifiesFor10000Target:false,binary:mapping.binary,inputReport:mapping.inputReport,mapping:{file:output+'.json.gz',sha256:sha(compressed),bytes:compressed.length},toolSha256:sha(await readFile(import.meta.filename)),units:units.map(u=>({name:u.name,nfiRows:u.nfiRows,generatedC:u.generatedC})),functions:functions.length,withRetainedSource:functions.filter(r=>r.sourceSha256!==null).length,uniqueOriginalSource:functions.filter(r=>r.originalGameRangeCount===1).length,repeatedOriginalSource:functions.filter(r=>r.originalGameRangeCount>1).length,noOriginalSource:functions.filter(r=>r.sourceSha256!==null&&!r.sourceRangeCount).length,duplicateSymbolNames:[...symbolCounts].filter(([,count])=>count>1).length,unresolved,examples:functions.filter(r=>r.symbol==='_564_update_11_').concat(functions.filter(r=>r.name==='get'||r.name==='child').slice(0,5)).map(row=>({...row,ranges:row.sourceSha256?ranges.get(row.sourceSha256).slice(0,4):[]}))};
await writeFile(resolve(root,output+'.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
