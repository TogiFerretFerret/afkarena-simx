import { readFile } from 'node:fs/promises';
import { runInContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { types } from 'node:util';

const hash=value=>createHash('sha256').update(value).digest('hex');
export async function installPortableGraph(context,options={}){
 const source=await readFile(new URL('./battle-trace-portable.js',import.meta.url),'utf8');
 runInContext(source,context,{filename:'tools/battle-trace-portable.js'});
 context.__portableGraphOptions={...options,isProxy:options.isProxy??types.isProxy};
 try{return runInContext('installGraphCapture(__portableGraphOptions)',context)}finally{delete context.__portableGraphOptions;}
}

/** Cold code normalization runs in the Node parent for both V8 and AOT exports.
 * No hash library or source-body hashing is needed in the candidate hot runtime.
 */
export function canonicalPortableGraph(graph){
 if(graph.version!==3)throw new Error(`Unsupported portable graph version ${graph.version}`);
 const codeTable=Array.from(graph.codeTable,entry=>{
  if(entry.kind==='source')return{kind:'source',sha256:hash(entry.source)};
  if(entry.kind==='native')return{kind:'native',name:entry.name,length:entry.length};
  if(entry.kind==='logical')return{kind:'logical',identity:entry.identity};
  throw new Error(`Unknown function code kind: ${entry.kind}`);
 });
 return{version:graph.version,roots:graph.roots,nodes:graph.nodes,codeTable,coverage:{accessorsInvoked:graph.coverage.accessorsInvoked,functionPolicy:graph.coverage.functionPolicy,opaque:graph.coverage.opaque}};
}
export function portableGraphHash(graph){return hash(JSON.stringify(canonicalPortableGraph(graph)));}
export function firstPortableGraphDifference(expected,actual){
 const a=canonicalPortableGraph(expected),b=canonicalPortableGraph(actual);
 function visit(left,right,path){
  if(Object.is(left,right))return null;
  if(typeof left!==typeof right||left===null||right===null)return{path,expected:left,actual:right};
  if(typeof left!=='object')return{path,expected:left,actual:right};
  if(Array.isArray(left)!==Array.isArray(right))return{path,expected:left,actual:right};
  const ka=Object.keys(left),kb=Object.keys(right);
  if(ka.length!==kb.length||ka.some((key,index)=>key!==kb[index]))return{path,reason:'keys',expected:ka,actual:kb};
  for(const key of ka){const difference=visit(left[key],right[key],`${path}.${key}`);if(difference)return difference;}
  return null;
 }
 return visit(a,b,'$');
}

/** Fail closed on unfinished/short traces, then compare every ordered event and
 * full numeric-bit state. Passing this observable-state gate alone does not
 * prove opaque native closure state or a complete renderer implementation.
 */
export function comparePortableBattleTraces(expected,actual){
 for(const [side,trace] of [['reference',expected],['candidate',actual]]){
  if(trace?.version!==1||trace.status!=='completed'||!Array.isArray(trace.events)||trace.events.at(-1)?.kind!=='battle:completed')
   return{passed:false,difference:{side,reason:'unfinished_or_invalid_trace'},qualifiesForThroughputTarget:false};
 }
 const count=Math.max(expected.events.length,actual.events.length);
 for(let i=0;i<count;i++){
  const left=expected.events[i],right=actual.events[i];
  if(!left||!right||left.sequence!==i||right.sequence!==i||left.kind!==right.kind)
   return{passed:false,difference:{sequence:i,reason:'event_order_or_count',expected:left?.kind,actual:right?.kind},qualifiesForThroughputTarget:false};
  if(left.stateHash!==undefined||right.stateHash!==undefined){
   if(!/^[0-9a-f]{64}$/.test(left.stateHash??'')||left.stateHash!==right.stateHash)
    return{passed:false,difference:{sequence:i,kind:left.kind,reason:'state_hash',expected:left.stateHash,actual:right.stateHash},qualifiesForThroughputTarget:false};
   continue;
  }
  const difference=firstPortableGraphDifference(left.graph,right.graph);
  if(difference)return{passed:false,difference:{sequence:i,kind:left.kind,...difference},qualifiesForThroughputTarget:false};
 }
 return{passed:true,eventsCompared:count,qualifiesForThroughputTarget:false,
  limitations:['Function lexical bindings and weak-collection contents remain opaque','A matching diagnostic trace does not measure battle throughput or establish missing host lifecycle coverage']};
}
