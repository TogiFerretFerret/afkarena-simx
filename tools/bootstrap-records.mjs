import {readFile,readdir,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const schemaVersion=1;
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}
function validate(records,sources){
  if(!records||typeof records!=='object')throw new Error('Invalid source-record cache payload');
  if(records.sourceGlobalNames!==undefined&&(!Array.isArray(records.sourceGlobalNames)||records.sourceGlobalNames.some(name=>typeof name!=='string'||!name)||new Set(records.sourceGlobalNames).size!==records.sourceGlobalNames.length))throw new Error('Invalid source global-name catalog');
  const lists=[];
  for(const key of ['definitions','globals']){
    if(!Array.isArray(records[key]))throw new Error(`Invalid source-record cache ${key}`);
    const names=new Set();
    for(const entry of records[key]){
      if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||names.has(entry[0])||!Array.isArray(entry[1]))throw new Error(`Invalid source-record cache ${key} entry`);
      names.add(entry[0]);lists.push(entry[1]);
    }
  }
  for(const key of ['functionDeclarations','initializers','postInitializers']){
    if(!Array.isArray(records[key]))throw new Error(`Invalid source-record cache ${key}`);
    lists.push(records[key]);
  }
  for(const list of lists)for(const record of list){
    const source=sources.get(record?.file);
    if(typeof source!=='string'||!Number.isSafeInteger(record.start)||!Number.isSafeInteger(record.end)||record.start<0||record.end<record.start||record.end>source.length||record.source!==source.slice(record.start,record.end))throw new Error('Cached record differs from original source range');
    if(record.sha256!==undefined&&record.sha256!==sha256(record.source))throw new Error('Cached declaration hash mismatch');
  }
}

/** Only immutable original-source records cross this boundary. Cache hits still
 * verify every source byte/hash, all record slices and the full payload digest.
 * No evaluated JS object, class, callback, table or VM realm is cached.
 */
export async function loadSourceRecordCache({sources,ordered,keyMaterial,cacheDirectory,extract,enabled=true}){
  const key=sha256(JSON.stringify({schemaVersion,ordered,keyMaterial,sourceHashes:[...sources].map(([file,source])=>[file,sha256(source)])}));
  const path=resolve(cacheDirectory,`${key}.json`);
  if(enabled){
    try{
      const envelope=JSON.parse(await readFile(path,'utf8'));
      if(envelope.schemaVersion!==schemaVersion||envelope.key!==key||envelope.payloadSha256!==sha256(JSON.stringify(envelope.records)))throw new Error('Source-record cache digest mismatch');
      validate(envelope.records,sources);
      return {...freeze(envelope.records),ordered:freeze(ordered.slice()),cache:{key,hit:true,path,schemaVersion}};
    }catch(error){
      // Corrupt, stale and truncated cache files are rebuildable derived data.
      // Actual extraction/initialization errors below are never swallowed.
      if(error?.code&&error.code!=='ENOENT')throw error;
    }
  }
  const records=await extract(sources,ordered);
  validate(records,sources);
  if(enabled){
    await mkdir(cacheDirectory,{recursive:true});
    const temporary=`${path}.${process.pid}.${randomUUID()}.tmp`;
    try{
      await writeFile(temporary,JSON.stringify({schemaVersion,key,payloadSha256:sha256(JSON.stringify(records)),records}));
      await rename(temporary,path);
    }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  return {...freeze(records),ordered:freeze(ordered.slice()),cache:{key,hit:false,path:enabled?path:null,schemaVersion}};
}

export async function loadBootstrapSourceRecords(){
  const modules=(await readdir(resolve(root,'src/srcmodule'))).filter(file=>file.endsWith('.js')).sort();
  const ordered=['game_util.js','game_battle.js',...modules.filter(file=>!['game_util.js','game_battle.js'].includes(file))];
  const sources=new Map();
  const originalByteHashes=[];
  for(const module of ordered){
    const file=`src/srcmodule/${module}`,bytes=await readFile(resolve(root,file));
    originalByteHashes.push([file,sha256(bytes)]);sources.set(file,bytes.toString('utf8'));
  }
  // Only the pure extraction producer determines these immutable records.
  // Runtime filtering, realm construction, host devices and execution happen
  // after this cache boundary on every call. Their complete hashes still belong
  // in oracle/native artifact provenance, but cannot change extraction output.
  const dependencies=['tools/bootstrap-records.mjs','tools/bootstrap-records-extractor.mjs','tools/source-index.mjs'];
  const keyMaterial={dependencies:[],packages:[],originalByteHashes};
  for(const file of dependencies)keyMaterial.dependencies.push([file,sha256(await readFile(resolve(root,file)))]);
  for(const name of ['@babel/parser','@babel/traverse']){
    const file=resolve(root,'node_modules',name,'package.json');
    const text=await readFile(file,'utf8');
    keyMaterial.packages.push([name,JSON.parse(text).version,sha256(text)]);
  }
  return loadSourceRecordCache({sources,ordered,keyMaterial,cacheDirectory:resolve(root,'work/bootstrap-records-cache'),enabled:process.env.AFK_SOURCE_RECORDS_CACHE!=='0',
    async extract(originals,moduleOrder){const{extractBootstrapSourceRecords}=await import('./bootstrap-records-extractor.mjs');return extractBootstrapSourceRecords(originals,moduleOrder);}});
}
