import { readFile, writeFile, readdir, access, mkdir, rename } from 'node:fs/promises';
import { openSync, writeSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { loadBootstrapTableSync } from './bootstrap-source.mjs';

const root=resolve(import.meta.dirname,'..');
const sha=data=>createHash('sha256').update(data).digest('hex');
const contractPath='config/native-table-contract.json';
const contractText=await readFile(resolve(root,contractPath),'utf8');
const contract=JSON.parse(contractText);
const allLiterals=process.argv.includes('--all-literals');
const outputArgument=process.argv.find(arg=>arg.startsWith('--output='));
const output=resolve(root,outputArgument?outputArgument.slice('--output='.length):contract.output);
const metadataPath=outputArgument?`${output}.meta.json`:resolve(root,contract.cacheMetadata);
const names=new Set(contract.additionalTables),inputFiles=new Map([[contractPath,sha(contractText)]]),literalSources=[];
function addLiterals(source){
  for(const match of source.matchAll(/\bed\.(?:getDataTable|lookupDataTable)\(\s*["']([A-Za-z0-9_]+)["']/g))names.add(match[1]);
}
const scopes=allLiterals
  ? (await readdir(resolve(root,'src/srcmodule'))).filter(file=>file.endsWith('.js')).sort().map(file=>({file:`src/srcmodule/${file}`,scope:'all'}))
  : contract.literalSources;
for(const scope of scopes){
  const source=await readFile(resolve(root,scope.file),'utf8');
  inputFiles.set(scope.file,sha(source));
  const selected=scope.scope==='all'?source:source.slice(scope.start,scope.end);
  const before=names.size;addLiterals(selected);
  literalSources.push({...scope,newNames:names.size-before});
}
const scenarioSource=await readFile(resolve(root,contract.scenarioCatalog),'utf8');
inputFiles.set(contract.scenarioCatalog,sha(scenarioSource));
const catalog=scenarioSource.match(/const\s+names\s*=\s*\[([^\]]+)\]/);
if(!catalog)throw new Error('Cannot locate source scenario catalog table list');
for(const match of catalog[1].matchAll(/["']([A-Za-z0-9_]+)["']/g))names.add(match[1]);
addLiterals(scenarioSource);
for(const file of ['tools/prepare-native-tables.mjs',contract.loader.split('#')[0],contract.packedDecoder,contract.decoderProvenance])inputFiles.set(file,sha(await readFile(resolve(root,file))));
const decoder=JSON.parse(await readFile(resolve(root,contract.decoderProvenance),'utf8'));
inputFiles.set(decoder.decompressor.source,sha(await readFile(resolve(root,decoder.decompressor.source))));

// Follow the original stage lookup path to include its dynamically assembled table name.
const stageIndex=loadBootstrapTableSync('StageBattleIdx');
const stageChapterIndex=loadBootstrapTableSync('StageBattleIndex');
for(const battleId of contract.dynamicBattleIds){
  const type=stageIndex[battleId]?.Type;
  if(type)names.add(`StageBattle${type}`);
  const chapter=stageChapterIndex[battleId]?.ChapterID??1;
  names.add(`StageBattleChap${chapter}`);
}
const requested=[...names].sort(),tableFiles={};
for(const name of requested){
  const file=['src/srcmodule','src/csvjson/en'].map(dir=>`${dir}/${name}.json`).find(file=>existsSync(resolve(root,file)));
  if(!file)continue;
  const raw=await readFile(resolve(root,file));
  const digest=sha(raw);
  tableFiles[name]={file,sha256:digest,bytes:raw.length,packed:raw[4]===35&&raw[5]===36};
  inputFiles.set(file,digest);
}
const sourceInputs=Object.fromEntries([...inputFiles].sort(([a],[b])=>a.localeCompare(b)));
const cacheKey=sha(JSON.stringify({version:contract.version,allLiterals,requested,sourceInputs}));
let previous;
try{previous=JSON.parse(await readFile(metadataPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(previous?.cacheKey===cacheKey){
  try{
    await access(output);
    if(sha(await readFile(output))===previous.outputSha256){console.log(JSON.stringify({status:'cached',output,tableCount:previous.tableCount,missing:previous.missing,bytes:previous.outputBytes,cacheKey}));process.exit(0);}
  }catch(error){if(error.code!=='ENOENT')throw error;}
}
if(typeof JSON.rawJSON!=='function')throw new Error('JSON.rawJSON support is required to preserve negative zero in native table JSON');
function pureJson(value){
  return JSON.stringify(value,(_key,item)=>{
    if(typeof item==='number'){
      if(!Number.isFinite(item))throw new Error('Source table contains a nonfinite number; explicit numeric encoding required');
      if(Object.is(item,-0))return JSON.rawJSON('-0');
    }
    return item;
  });
}
await mkdir(resolve(output,'..'),{recursive:true});
const temporary=`${output}.tmp`,fd=openSync(temporary,'w');
const missing=[],errors={},digests={},tableSources={};let tableCount=0;
try{
  writeSync(fd,'{"tables":{');
  for(const name of requested){
    if(!tableFiles[name]){missing.push(name);continue;}
    let table,serialized;
    try{table=loadBootstrapTableSync(name);serialized=pureJson(table);}
    catch(error){missing.push(name);errors[name]=error.message;continue;}
    if(tableCount)writeSync(fd,',');
    writeSync(fd,`${JSON.stringify(name)}:${serialized}`);
    digests[name]=sha(serialized);
    tableSources[name]={...tableFiles[name],decodedBytes:Buffer.byteLength(serialized)};
    tableCount++;
  }
  const rest={missing,digests,version:contract.version,cacheKey,allLiterals,literalSources,sourceInputs,tableSources,errors,decoderProvenance:decoder};
  writeSync(fd,'},'+JSON.stringify(rest).slice(1));
}finally{closeSync(fd);}
await rename(temporary,output);
const contents=await readFile(output);
const metadata={version:contract.version,cacheKey,outputSha256:sha(contents),outputBytes:contents.length,tableCount,missing,errors};
await writeFile(metadataPath,JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({status:'generated',output,tableCount,missing,errors,bytes:contents.length,cacheKey}));
