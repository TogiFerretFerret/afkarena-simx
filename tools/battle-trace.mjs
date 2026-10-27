import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { runInContext } from 'node:vm';

const numberBuffer=new DataView(new ArrayBuffer(8));
export function binary64(value){numberBuffer.setFloat64(0,value,false);return numberBuffer.getBigUint64(0,false).toString(16).padStart(16,'0');}
const digest=text=>createHash('sha256').update(text).digest('hex');
const functionSource=fn=>Reflect.apply(Function.prototype.toString,fn,[]);

/** Snapshot observable graph state without invoking getters or source functions.
 * Closure environments, WeakMap/WeakSet entries and Proxy internals cannot be
 * reflected. They are reported rather than silently claimed as covered.
 */
export function createGraphSnapshotter({intrinsics=new Map(),maxNodes=100000}={}){
  const ids=new WeakMap(),symbols=new Map(),functionHashes=new WeakMap();let nextId=1,nextSymbol=1;
  function symbol(value){if(!symbols.has(value))symbols.set(value,nextSymbol++);return['symbol',symbols.get(value),Symbol.keyFor(value)??null,value.description??null];}
  return function snapshot(roots){
    const queue=[],nodes=[],seen=new Set(),opaque=[];
    function encode(value){
      if(value===null)return['null'];
      switch(typeof value){
        case 'undefined':return['undefined'];case 'boolean':return['boolean',value];case 'string':return['string',value];
        case 'number':return['f64',binary64(value)];case 'bigint':return['bigint',String(value)];case 'symbol':return symbol(value);
      }
      if(intrinsics.has(value))return['intrinsic',intrinsics.get(value)];
      if(!ids.has(value))ids.set(value,nextId++);
      const id=ids.get(value);
      if(!seen.has(id)){if(seen.size>=maxNodes)throw new Error(`Battle snapshot exceeds ${maxNodes} nodes; no partial snapshot emitted`);seen.add(id);queue.push(value);}
      return['ref',id];
    }
    const encodedRoots=Object.entries(roots).map(([key,value])=>[key,encode(value)]);
    for(let offset=0;offset<queue.length;offset++){
      const value=queue[offset],id=ids.get(value);
      if(types.isProxy(value))throw new Error(`Cannot faithfully inspect Proxy object ${id}`);
      const node={id,kind:typeof value==='function'?'function':Array.isArray(value)?'array':'object',prototype:encode(Reflect.getPrototypeOf(value)),properties:[]};
      if(typeof value==='function'){
        if(!functionHashes.has(value))functionHashes.set(value,digest(functionSource(value)));
        node.sourceSha256=functionHashes.get(value);
        // Captured bindings are checked through execution events, not reflection.
        opaque.push({id,kind:'function_closure_bindings'});
      }
      if(types.isMap(value)){node.kind='map';node.entries=Array.from(Reflect.apply(Map.prototype.entries,value,[]),([key,item])=>[encode(key),encode(item)]);}
      else if(types.isSet(value)){node.kind='set';node.entries=Array.from(Reflect.apply(Set.prototype.values,value,[]),encode);}
      else if(types.isWeakMap(value)||types.isWeakSet(value)){opaque.push({id,kind:types.isWeakMap(value)?'weakmap_entries':'weakset_entries'});}
      else if(types.isDate(value)){node.kind='date';node.time=encode(Reflect.apply(Date.prototype.getTime,value,[]));}
      else if(types.isRegExp(value)){
        node.kind='regexp';node.pattern=Reflect.apply(Object.getOwnPropertyDescriptor(RegExp.prototype,'source').get,value,[]);
        node.flags=['hasIndices','global','ignoreCase','multiline','dotAll','unicode','unicodeSets','sticky'].filter(key=>Object.getOwnPropertyDescriptor(RegExp.prototype,key)&&Reflect.apply(Object.getOwnPropertyDescriptor(RegExp.prototype,key).get,value,[]));
      }else if(types.isAnyArrayBuffer(value)){
        node.kind='arraybuffer';try{node.bytes=Buffer.from(new Uint8Array(value)).toString('hex');}catch(error){node.detached=true;}
      }else if(types.isTypedArray(value)||types.isDataView(value)){
        const proto=types.isDataView(value)?DataView.prototype:Object.getPrototypeOf(Uint8Array.prototype);
        const get=key=>Reflect.apply(Object.getOwnPropertyDescriptor(proto,key).get,value,[]);
        node.kind=types.isDataView(value)?'dataview':'typedarray';node.buffer=encode(get('buffer'));node.byteOffset=get('byteOffset');node.byteLength=get('byteLength');
      }
      for(const key of Reflect.ownKeys(value)){
        const descriptor=Reflect.getOwnPropertyDescriptor(value,key);
        const property={key:typeof key==='symbol'?symbol(key):['string',key],enumerable:descriptor.enumerable,configurable:descriptor.configurable};
        if('value'in descriptor){property.writable=descriptor.writable;property.value=encode(descriptor.value);}
        else{property.get=encode(descriptor.get);property.set=encode(descriptor.set);}
        node.properties.push(property);
      }
      nodes.push(node);
    }
    const graph={version:1,roots:encodedRoots,nodes};
    return{...graph,sha256:digest(JSON.stringify(graph)),coverage:{accessorsInvoked:false,opaque}};
  };
}

/** Canonical realm boundaries avoid walking native runtime globals. Source-defined
 * prototypes and every own descriptor outside these explicit boundaries remain.
 */
export function realmIntrinsics(context){
  const entries=runInContext(`(() => {
    const names=['Object','Function','Array','String','Number','Boolean','BigInt','Symbol','Date','RegExp','Map','Set','WeakMap','WeakSet','Promise','ArrayBuffer','DataView','Uint8Array','Int8Array','Uint16Array','Int16Array','Uint32Array','Int32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array','Error','TypeError','RangeError'];
    const result=[];
    for(const name of names){const value=globalThis[name];if(typeof value==='function'){result.push([name,value]);if(value.prototype)result.push([name+'.prototype',value.prototype]);}}
    result.push(['Math',Math],['JSON',JSON],['Reflect',Reflect]);return result;
  })()`,context);
  return new Map(entries.map(([name,value])=>[value,name]));
}

export function firstTraceDifference(expected,actual){
  if(expected.length!==actual.length)return{kind:'event_count',expected:expected.length,actual:actual.length,index:Math.min(expected.length,actual.length)};
  for(let index=0;index<expected.length;index++){
    if(JSON.stringify(expected[index])!==JSON.stringify(actual[index]))return{kind:'event',index,expected:expected[index],actual:actual[index]};
  }
  return null;
}

export function createTraceRecorder(snapshot){
  const events=[];
  return{events,record(kind,payload,roots){const state=snapshot(roots);const event={sequence:events.length,kind,payload,stateHash:state.sha256};events.push(event);return{event,state};}};
}

/** Lossless per-snapshot graph deltas. Roots and BFS order are retained so the
 * exact complete graph/hash can be reconstructed without repeated function data.
 */
export function createGraphDeltaRecorder(snapshot){
  let previous=new Map();
  return roots=>{
    const state=snapshot(roots),current=new Map(state.nodes.map(node=>[node.id,JSON.stringify(node)]));
    const changed=state.nodes.filter(node=>previous.get(node.id)!==current.get(node.id));
    const removed=[...previous.keys()].filter(id=>!current.has(id));
    previous=current;
    return{version:state.version,roots:state.roots,order:state.nodes.map(node=>node.id),changed,removed,sha256:state.sha256,coverage:state.coverage};
  };
}
export function applyGraphDelta(previous,delta){
  const nodes=new Map(previous?.nodes.map(node=>[node.id,node])??[]);
  for(const id of delta.removed)nodes.delete(id);
  for(const node of delta.changed)nodes.set(node.id,node);
  const graph={version:delta.version,roots:delta.roots,nodes:delta.order.map(id=>{if(!nodes.has(id))throw new Error(`Missing graph delta node ${id}`);return nodes.get(id);})};
  if(digest(JSON.stringify(graph))!==delta.sha256)throw new Error('Graph delta checksum mismatch');
  return{...graph,sha256:delta.sha256,coverage:delta.coverage};
}
