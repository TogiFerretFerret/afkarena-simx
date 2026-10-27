import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
const [input,label,emitterSnapshot]=process.argv.slice(2);
if(!input||!label||!/^[a-z0-9][a-z0-9-]*$/.test(label))throw new Error('Usage: node tools/archive-native-evidence.mjs GENERATED_JS LABEL [EMITTER_SOURCE]');
const prefix=resolve(root,input),directory=resolve(root,'benchmarks/fixtures',label);
const metadata=JSON.parse(await readFile(prefix+'.metadata.json','utf8'));
await mkdir(directory,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),artifacts=[];
for(const [suffix,name] of [['.metadata.json','metadata.json'],['.host-inputs.json','host-inputs.json'],['.reference.json','reference.json'],['.node.stdout','node.stdout'],['.node.stderr','node.stderr']]){
  const bytes=await readFile(prefix+suffix),compressed=gzipSync(bytes,{level:9});
  await writeFile(resolve(directory,name+'.gz'),compressed);
  artifacts.push({file:name+'.gz',compression:'gzip',sha256:sha(compressed),uncompressedSha256:sha(bytes),uncompressedBytes:bytes.length,bytes:compressed.length});
}
if(emitterSnapshot){
  const bytes=await readFile(resolve(root,emitterSnapshot));
  if(sha(bytes)!==metadata.adapterInputs['tools/emit-native-oracle.mjs'])throw new Error('Emitter snapshot hash differs from metadata');
  const compressed=gzipSync(bytes,{level:9});await writeFile(resolve(directory,'emitter-source.mjs.gz'),compressed);
  artifacts.push({file:'emitter-source.mjs.gz',compression:'gzip',sha256:sha(compressed),uncompressedSha256:sha(bytes),uncompressedBytes:bytes.length,bytes:compressed.length});
}
const manifest={version:1,description:'Recorded source inputs and exact captured output for reproducible differential diagnostics; this archive does not upgrade qualification.',
  scope:metadata.scope,captureMode:metadata.captureMode,executionContract:metadata.executionContract??null,
  oracleProfile:metadata.oracleProfile??null,oracleRuntime:metadata.oracleRuntime??null,
  qualification:'Diagnostic evidence only; actor/effect/view lifecycle excluded. Unpinned historical fixtures remain unqualified.',
  scenario:{file:relative(root,metadata.scenario.file),sha256:metadata.scenario.sha256},
  adapterInputs:metadata.adapterInputs,sourceInputs:metadata.sourceInputs??null,
  generatedProgramSha256:metadata.outputSha256,factoryCount:metadata.factoryCount,
  factoryChunks:(metadata.factoryChunks??[]).map(({sha256,firstFactory,count})=>({sha256,firstFactory,count})),
  tableBundle:{sha256:metadata.tableBundle.sha256,bytes:metadata.tableBundle.bytes},
  rebuild:{tables:'node tools/prepare-native-tables.mjs',emitter:'node tools/emit-native-oracle.mjs --scenario '+relative(root,metadata.scenario.file)+' --scope '+metadata.scope+' --capture '+metadata.captureMode+' --battles '+metadata.battles+' --warmup '+metadata.warmup+' --host-inputs '+relative(root,directory)+'/host-inputs.json.gz --output work/native-oracle-replay.js'+((metadata.factoryChunks?.length)?' --factory-chunk-size '+metadata.factoryChunks[0].count:'')+(metadata.traceEnabled?' --trace':''),
    native:'node tools/native-compiler-run.mjs --input work/native-oracle-replay.js --output work/native-oracle-replay --cc-opt O1 --compile-jobs 2 --plumbing',replay:'The emitter command consumes the archived exact random/clock tapes and rejects missing/extra host inputs. Rebuilding with changed source/oracle/compiler versions requires a new qualification.'},artifacts};
await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({directory:relative(root,directory),artifacts:artifacts.length,bytes:artifacts.reduce((sum,item)=>sum+item.bytes,0)}));
