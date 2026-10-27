import {createHash} from 'node:crypto';
const sha=text=>createHash('sha256').update(text).digest('hex');
export function validateBattleBoundaryTrace(trace){
 try{
  if(trace?.version!==1||trace.status!=='completed'||trace.rootContract!=='primitive-vector-battle-boundaries-v1'||trace.graphHash!=='sha256-interned-state-json-v1')throw Error('Unsupported or unfinished boundary trace');
  if(!Array.isArray(trace.snapshots)||!Array.isArray(trace.events)||trace.events.at(-1)?.kind!=='battle:completed')throw Error('Missing snapshots or completion event');
  const nodes=new Map();
  for(const record of trace.snapshots){if(!/^[0-9a-f]{64}$/.test(record.hash)||sha(JSON.stringify(record.value))!==record.hash||nodes.has(record.hash))throw Error('Invalid or duplicate snapshot node');nodes.set(record.hash,record.value);}
  const verified=new Set(),active=new Set();
  function visit(value){
   if(value===null||typeof value!=='object')return;
   if(Object.hasOwn(value,'$boundaryNode')){
    if(Object.keys(value).length!==1||!nodes.has(value.$boundaryNode))throw Error('Missing or malformed snapshot reference');
    const hash=value.$boundaryNode;if(verified.has(hash))return;if(active.has(hash))throw Error('Cyclic snapshot reference');active.add(hash);visit(nodes.get(hash));active.delete(hash);verified.add(hash);return;
   }
   for(const child of Object.values(value))visit(child);
  }
  for(const [hash,value] of nodes){active.add(hash);visit(value);active.delete(hash);verified.add(hash);}
  for(let i=0;i<trace.events.length;i++){const event=trace.events[i];if(event.sequence!==i||typeof event.kind!=='string'||!event.state||event.stateHash!==sha(JSON.stringify(event.state)))throw Error('Invalid ordered event or state hash at '+i);visit(event.state);}
  return{passed:true,events:trace.events.length,snapshotNodes:nodes.size};
 }catch(error){return{passed:false,reason:error.message};}
}
export function reconstructBattleBoundaryState(trace,sequence){
 const valid=validateBattleBoundaryTrace(trace);if(!valid.passed)throw Error(valid.reason);
 const nodes=new Map(trace.snapshots.map(record=>[record.hash,record.value]));
 function expand(value){if(value===null||typeof value!=='object')return value;if(Object.hasOwn(value,'$boundaryNode'))return expand(nodes.get(value.$boundaryNode));if(Array.isArray(value))return value.map(expand);return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,expand(child)]));}
 if(!trace.events[sequence])throw Error('Missing event '+sequence);return expand(trace.events[sequence].state);
}
export function compareBattleBoundaryTraces(expected,actual){
 for(const [side,trace]of[['source',expected],['native',actual]]){const validation=validateBattleBoundaryTrace(trace);if(!validation.passed)return{passed:false,difference:{side,...validation},qualifiesFor10000Target:false};}
 const length=Math.max(expected.events.length,actual.events.length);
 for(let i=0;i<length;i++){const a=expected.events[i],b=actual.events[i];if(JSON.stringify(a)!==JSON.stringify(b))return{passed:false,difference:{sequence:i,expected:a,actual:b},qualifiesFor10000Target:false};}
 const left=new Map(expected.snapshots.map(n=>[n.hash,JSON.stringify(n.value)])),right=new Map(actual.snapshots.map(n=>[n.hash,JSON.stringify(n.value)]));
 if(left.size!==right.size||[...left].some(([hash,value])=>right.get(hash)!==value))return{passed:false,difference:{reason:'snapshot-node-pool'},qualifiesFor10000Target:false};
 return{passed:true,eventsCompared:length,sourceSnapshotNodes:left.size,nativeSnapshotNodes:right.size,rootContract:expected.rootContract,qualifiesFor10000Target:false,limitations:expected.limitations};
}
