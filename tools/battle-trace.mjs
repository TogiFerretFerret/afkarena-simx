import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { runInContext } from 'node:vm';

const numberBuffer=new DataView(new ArrayBuffer(8));
export function binary64(value){numberBuffer.setFloat64(0,value,false);return numberBuffer.getBigUint64(0,false).toString(16).padStart(16,'0');}
const digest=text=>createHash('sha256').update(text).digest('hex');
const functionSource=fn=>Reflect.apply(Function.prototype.toString,fn,[]);
const sameEncoding=(a,b)=>a===b||Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>sameEncoding(value,b[index]));
function graphHash(graph,cache){
  if(graph.version===1)return digest(JSON.stringify(graph));
  const nodeHashes=graph.nodes.map(node=>{
    if(cache?.has(node))return cache.get(node);
    const hash=digest(JSON.stringify(node));cache?.set(node,hash);return hash;
  });
  // Each complete node is SHA256-covered; the root/order hash covers every
  // identity, edge, descriptor and raw numeric bit, with no XOR cancellation.
  return digest(JSON.stringify([graph.version,graph.roots,nodeHashes]));
}
export function sourceCodeIdentity(fn){
  const text=functionSource(fn);
  // Native/bound function formatting is implementation-defined. Public name and
  // arity plus logical object identity are stable; actual invocation effects are
  // checked by the ordered event/state trace.
  if(/\{\s*\[native code\]\s*\}/.test(text))return digest(JSON.stringify({kind:'native_function',name:Reflect.getOwnPropertyDescriptor(fn,'name')?.value??'',length:Reflect.getOwnPropertyDescriptor(fn,'length')?.value??0}));
  return digest(text);
}

/** Snapshot observable graph state without invoking getters or source functions.
 * Closure environments, WeakMap/WeakSet entries and Proxy internals cannot be
 * reflected. They are reported rather than silently claimed as covered.
 */
export function createGraphSnapshotter({intrinsics=new Map(),maxNodes=100000,functionPolicy='graph'}={}){
  if(!['graph','code'].includes(functionPolicy))throw new Error('Unknown function snapshot policy');
  const ids=new WeakMap(),symbols=new Map(),functionHashes=new WeakMap(),propertyCaches=new WeakMap(),nodeCaches=new WeakMap(),nodeHashes=new WeakMap();let nextId=1,nextSymbol=1;
  function codeOnlyFunction(value){
    for(const key of Reflect.ownKeys(value)){
      if(['length','name','arguments','caller'].includes(key))continue;
      if(key!=='prototype')return false;
      const p=Reflect.getOwnPropertyDescriptor(value,key);
      if(!p||!('value'in p)||!p.value||types.isProxy(p.value))return false;
      const keys=Reflect.ownKeys(p.value),d=Reflect.getOwnPropertyDescriptor(p.value,'constructor');
      if(keys.length!==1||keys[0]!=='constructor'||d?.value!==value||d.writable!==true||d.enumerable!==false||d.configurable!==true)return false;
    }
    return true;
  }
  function symbol(value){if(!symbols.has(value))symbols.set(value,nextSymbol++);return['symbol',symbols.get(value),Symbol.keyFor(value)??null,value.description??null];}
  return function snapshot(roots){
    const queue=[],nodes=[],seen=new Set(),opaque=[];let opaqueFunctionCount=0;
    function encode(value){
      if(value===null)return['null'];
      switch(typeof value){
        case 'undefined':return['undefined'];case 'boolean':return['boolean',value];case 'string':return['string',value];
        case 'number':return['f64',binary64(value)];case 'bigint':return['bigint',String(value)];case 'symbol':return symbol(value);
      }
      if(intrinsics.has(value))return['intrinsic',intrinsics.get(value)];
      // Ordinary functions each carry an otherwise empty prototype object. Its
      // complete descriptor graph has a lossless compact form: identity is the
      // constructor's prototype, and all default flags are implied by this tag.
      // A changed descriptor/property/parent immediately falls back to full data.
      if(typeof value==='object'&&!types.isProxy(value)){
        const d=Reflect.getOwnPropertyDescriptor(value,'constructor');
        if(typeof d?.value==='function'&&Reflect.ownKeys(value).length===1){
          const fn=d?.value,p=typeof fn==='function'&&Reflect.getOwnPropertyDescriptor(fn,'prototype');
          const parent=Reflect.getPrototypeOf(value);
          if(d.writable===true&&d.enumerable===false&&d.configurable===true&&p?.value===value&&
            (intrinsics.get(parent)==='Object.prototype'||parent===Object.prototype))return['default-function-prototype',encode(fn)];
        }
      }
      if(!ids.has(value))ids.set(value,nextId++);
      const id=ids.get(value);
      if(!seen.has(id)){
        if(seen.size>=maxNodes)throw new Error(`Battle snapshot exceeds ${maxNodes} nodes; no partial snapshot emitted`);
        seen.add(id);
        if(typeof value==='function'&&functionPolicy==='code'&&codeOnlyFunction(value))opaqueFunctionCount++;
        else queue.push(value);
      }
      if(typeof value==='function'&&functionPolicy==='code'){
        if(!functionHashes.has(value))functionHashes.set(value,sourceCodeIdentity(value));
        return['function',id,functionHashes.get(value)];
      }
      return['ref',id];
    }
    const encodedRoots=Object.entries(roots).map(([key,value])=>[key,encode(value)]);
    for(let offset=0;offset<queue.length;offset++){
      const value=queue[offset],id=ids.get(value);
      if(types.isProxy(value))throw new Error(`Cannot faithfully inspect Proxy object ${id}`);
      const codeFunction=typeof value==='function'&&functionPolicy==='code';
      const prototypeValue=codeFunction?null:Reflect.getPrototypeOf(value);
      let node={id,kind:typeof value==='function'?'function':Array.isArray(value)?'array':'object',...(codeFunction?{}:{prototype:encode(prototypeValue)}),properties:[]};
      if(typeof value==='function'){
        if(!functionHashes.has(value))functionHashes.set(value,sourceCodeIdentity(value));
        node.sourceSha256=functionHashes.get(value);
        // Captured bindings are checked through execution events, not reflection.
        opaqueFunctionCount++;
        if(functionPolicy==='graph')opaque.push({id,kind:'function_closure_bindings'});
      }
      if(types.isBoxedPrimitive(value)){
        const type=types.isNumberObject(value)?'number':types.isBooleanObject(value)?'boolean':types.isStringObject(value)?'string':types.isBigIntObject(value)?'bigint':'symbol';
        const prototype={number:Number.prototype,boolean:Boolean.prototype,string:String.prototype,bigint:BigInt.prototype,symbol:Symbol.prototype}[type];
        node.kind=`boxed_${type}`;node.value=encode(Reflect.apply(prototype.valueOf,value,[]));
      }else if(types.isMap(value)){node.kind='map';node.entries=Array.from(Reflect.apply(Map.prototype.entries,value,[]),([key,item])=>[encode(key),encode(item)]);}
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
      let cache=propertyCaches.get(value);if(!cache){cache=new Map();propertyCaches.set(value,cache);}
      const presentKeys=new Set();
      for(const key of Reflect.ownKeys(value)){
        const descriptor=Reflect.getOwnPropertyDescriptor(value,key);
        if(codeFunction){
          if(['length','name','arguments','caller'].includes(key))continue;
          if(key==='prototype'&&descriptor.value){
            const proto=descriptor.value,constructor=Reflect.getOwnPropertyDescriptor(proto,'constructor');
            if(Reflect.ownKeys(proto).length===1&&constructor?.value===value&&constructor.writable===true&&constructor.enumerable===false&&constructor.configurable===true)continue;
          }
        }
        presentKeys.add(key);
        const previous=cache.get(key),data='value'in descriptor;
        const sameValue=data&&previous?.data&&Object.is(previous.value,descriptor.value)&&
          (typeof descriptor.value!=='number'||!Number.isNaN(descriptor.value)||previous.numberBits===binary64(descriptor.value));
        if(previous&&previous.data===data&&previous.enumerable===descriptor.enumerable&&previous.configurable===descriptor.configurable&&
          (data?previous.writable===descriptor.writable&&sameValue:previous.get===descriptor.get&&previous.set===descriptor.set)){
          // Reference-valued children must still be visited: their own mutable
          // state may have changed even though this edge retained its identity.
          if(data){if(descriptor.value!==null&&['object','function','symbol'].includes(typeof descriptor.value)){
            const encoded=encode(descriptor.value);
            if(!sameEncoding(previous.property.value,encoded)){
              const property={...previous.property,value:encoded};cache.set(key,{...previous,property});node.properties.push(property);continue;
            }
          }}
          else{encode(descriptor.get);encode(descriptor.set);}
          node.properties.push(previous.property);continue;
        }
        const property={key:typeof key==='symbol'?symbol(key):['string',key],enumerable:descriptor.enumerable,configurable:descriptor.configurable};
        if('value'in descriptor){property.writable=descriptor.writable;property.value=encode(descriptor.value);}
        else{property.get=encode(descriptor.get);property.set=encode(descriptor.set);}
        cache.set(key,{...descriptor,data,property,numberBits:data&&typeof descriptor.value==='number'&&Number.isNaN(descriptor.value)?binary64(descriptor.value):null});
        node.properties.push(property);
      }
      for(const key of cache.keys())if(!presentKeys.has(key))cache.delete(key);
      if(['object','array','function'].includes(node.kind)){
        const previous=nodeCaches.get(value);
        if(previous&&previous.prototypeValue===prototypeValue&&sameEncoding(previous.node.prototype,node.prototype)&&previous.node.kind===node.kind&&previous.node.sourceSha256===node.sourceSha256&&
          previous.node.properties.length===node.properties.length&&previous.node.properties.every((property,index)=>property===node.properties[index]))node=previous.node;
        else nodeCaches.set(value,{prototypeValue,node});
      }
      if(!codeFunction||node.properties.length)nodes.push(node);
    }
    if(functionPolicy==='code'&&opaqueFunctionCount)opaque.push({kind:'function_closure_bindings',count:opaqueFunctionCount});
    const graph={version:2,roots:encodedRoots,nodes};
    return{...graph,sha256:graphHash(graph,nodeHashes),coverage:{accessorsInvoked:false,functionPolicy,opaque}};
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
  const serialized=new WeakMap();
  return roots=>{
    const state=snapshot(roots),current=new Map(state.nodes.map(node=>{if(!serialized.has(node))serialized.set(node,JSON.stringify(node));return[node.id,serialized.get(node)];}));
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
  if(graphHash(graph)!==delta.sha256)throw new Error('Graph delta checksum mismatch');
  return{...graph,sha256:delta.sha256,coverage:delta.coverage};
}

/** Explicit host entropy input, separate from the game's ed.rand algorithm.
 * Every Math.random call is either recorded or consumes one exact replay value.
 */
export function createHostRandomTape(seed=0x12345678,{replay}={}){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Host entropy seed must be uint32');
  let state=seed>>>0;if(state===0)state=0x6d2b79f5;
  const tape=[];
  function random(){
    let value;
    if(replay){
      if(tape.length>=replay.length)throw new Error('Host Math.random replay consumed an extra draw');
      const hex=replay[tape.length];
      if(!/^[0-9a-f]{16}$/.test(hex))throw new Error('Invalid host entropy replay bits');
      numberBuffer.setBigUint64(0,BigInt(`0x${hex}`),false);value=numberBuffer.getFloat64(0,false);
      if(!(value>=0&&value<1))throw new Error('Host Math.random replay value outside [0,1)');
    }else{
      state^=state<<13;state^=state>>>17;state^=state<<5;state>>>=0;value=state/4294967296;
    }
    tape.push(binary64(value));return value;
  }
  return{random,tape,assertFullyConsumed(){if(replay&&tape.length!==replay.length)throw new Error(`Host Math.random replay omitted ${replay.length-tape.length} draws`);},provenance:{algorithm:replay?'exact_binary64_replay':'xorshift32_uniform_binary64',seed,separateFromBattleRng:true}};
}
