import assert from 'node:assert/strict';
import { relative,resolve } from 'node:path';

// These commands are data, never shell-executed by the validator. The archiver
// emits simple repository-relative paths; reject shell syntax rather than
// interpreting a hand-edited command with different execution semantics.
export function parseNativeReplayCommand(command){
  assert.equal(typeof command,'string');
  assert.match(command,/^[A-Za-z0-9_./,:=+ -]+$/,'Replay command must use plain command arguments');
  const words=command.trim().split(/\s+/);
  assert.deepEqual(words.splice(0,2),['node','tools/emit-native-oracle.mjs']);
  const result=new Map(),switches=new Set(['--trace','--trace-initial','--table-membrane','--tracked-mutable-tables','--eager-battle']);
  for(let i=0;i<words.length;i++){
    const key=words[i];assert.ok(key.startsWith('--'),'Unexpected replay argument '+key);assert.ok(!result.has(key),'Duplicate replay option '+key);
    if(switches.has(key))result.set(key,true);
    else{assert.ok(words[i+1]&&!words[i+1].startsWith('--'),'Missing replay option value '+key);result.set(key,words[++i]);}
  }
  return result;
}
export function validateNativeReplayContract(manifest,metadata,{root,fixtureDirectory,reference}={}){
  const opts=parseNativeReplayCommand(manifest.rebuild.emitter);
  const required=new Map([
    ['--scenario',relative(root,metadata.scenario.file)],['--scope',metadata.scope],
    ['--capture',metadata.captureMode??reference?.capture??'all'],
    ['--battles',String(metadata.battles)],['--warmup',String(metadata.warmup)],
    ['--host-inputs',relative(root,resolve(fixtureDirectory,'host-inputs.json.gz'))],['--output','work/native-oracle-replay.js'],
  ]);
  if(metadata.initialTrace)required.set('--trace-initial',true);
  else if(metadata.traceEnabled)required.set('--trace',true);
  else if(metadata.tableMembraneEnabled)required.set('--table-membrane',true);
  if(metadata.mutableTables?.length)required.set('--mutable-tables',metadata.mutableTables.join(','));
  if(metadata.trackMutable)required.set('--tracked-mutable-tables',true);
  if(metadata.eagerBattle)required.set('--eager-battle',true);
  if(metadata.factoryChunks?.length)required.set('--factory-chunk-size',String(metadata.factoryChunks[0].count));
  if(metadata.factoryChunkPolicy?.maxSourceBytes)required.set('--factory-chunk-bytes',String(metadata.factoryChunkPolicy.maxSourceBytes));
  assert.deepEqual([...opts].sort(),[...required].sort(),'Archived replay options differ from captured source execution');
  assert.equal(manifest.scenario.file,required.get('--scenario'),'Archived scenario path differs');
  assert.equal(manifest.scenario.sha256,metadata.scenario.sha256,'Archived scenario hash differs');
  for(const key of['adapterInputs','sourceInputs','oracleProfile','oracleRuntime']){
    if(manifest[key]!=null)assert.deepEqual(manifest[key],metadata[key],'Archived '+key+' differs');
  }
  return{valid:true,legacyCaptureInferred:metadata.captureMode===undefined,sourceProfilePinned:!!metadata.oracleProfile};
}
