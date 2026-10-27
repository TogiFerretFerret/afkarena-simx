import { createHash } from 'node:crypto';
import { runInContext } from 'node:vm';
import { binary64,createGraphSnapshotter,createGraphDeltaRecorder,realmIntrinsics } from './battle-trace.mjs';
import { installBootstrapCallbacks } from './bootstrap-callbacks.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
const source=fn=>Reflect.apply(Function.prototype.toString,fn,[]);

/** Instrument original calls while retaining their receiver, arguments, result and
 * exceptions. Callbacks themselves are never replaced or omitted.
 */
export async function traceBattle(runtime,wire,{materialize,maxFrames=20000,keepDeltas=false,onEvent,strictGraph=false}={}){
  if(typeof materialize!=='function')throw new Error('A source-model materializer is required');
  const {ed,context}=runtime;
  const phase=runtime.callbacks??await installBootstrapCallbacks(context);
  const snapshot=createGraphSnapshotter({intrinsics:realmIntrinsics(context),functionPolicy:strictGraph?'graph':'code'});
  const delta=createGraphDeltaRecorder(snapshot);
  const events=[],deltas=[],restores=[],callbackIds=new WeakMap();let nextCallback=1,frame=-1,activeCallback=0,snapshotSide='before';
  let engine,callbackCount=0,rngCount=0,hostRngCount=0,lastGraph,lastError;
  const callableId=fn=>{if(!callbackIds.has(fn))callbackIds.set(fn,nextCallback++);return callbackIds.get(fn)};
  const heroScripts={};
  function scriptRoots(){
    for(const list of ['unit_list','dead_unit_list','pet_list','dead_pet_list','fieldNpc_list','dead_fieldNpc_list','projectile_list']){
      const units=engine&&Object.getOwnPropertyDescriptor(engine,list)?.value;
      if(!Array.isArray(units))continue;
      for(const unit of units){
        const info=unit&&Object.getOwnPropertyDescriptor(unit,'info')?.value;
        const name=info&&Object.getOwnPropertyDescriptor(info,'Script')?.value;
        if(typeof name!=='string')continue;
        const battlehero=Object.getOwnPropertyDescriptor(ed,'battlehero')?.value;
        const descriptor=battlehero&&Object.getOwnPropertyDescriptor(battlehero,name);
        if(descriptor&&'value'in descriptor)heroScripts[name]=descriptor.value;
      }
    }
    return heroScripts;
  }
  const roots=()=>({engine,battleRng:context.random_seed,initialBattleSeed:ed.init_battle_seed,
    pendingCallbacks:ed.clientCall_list,clientCallCount:ed.clientCallCount,
    battleLog:Object.getOwnPropertyDescriptor(ed,'btLog')?.value,heroScripts:scriptRoots()});
  function record(kind,payload={},capture=true){
    let state;
    if(capture){state=delta(roots());lastGraph=state;if(keepDeltas)deltas.push({sequence:events.length,state});}
    const event={sequence:events.length,frame,kind,payload,...(state?{stateHash:state.sha256}:{})};
    events.push(event);onEvent?.(event,state);
    return event;
  }
  function replace(owner,key,make){
    const descriptor=Object.getOwnPropertyDescriptor(owner,key);
    if(!descriptor||typeof descriptor.value!=='function')throw new Error(`Cannot instrument source method ${key}`);
    const original=descriptor.value,wrapped=make(original);
    Object.defineProperty(owner,key,{...descriptor,value:wrapped});restores.push(()=>Object.defineProperty(owner,key,descriptor));
  }
  // Eagerly resolve only methods that the source engine already uses. No call
  // result or callback is synthesized by the tracing layer.
  void ed.rand;void ed.srand;
  replace(ed,'rand',original=>function(...args){
    const before=binary64(context.random_seed),result=Reflect.apply(original,this,args);rngCount++;
    record('rng:draw',{before,after:binary64(context.random_seed),result:binary64(result)},false);return result;
  });
  replace(ed,'srand',original=>function(...args){
    const before=binary64(context.random_seed),result=Reflect.apply(original,this,args);
    record('rng:seed',{input:typeof args[0]==='number'?binary64(args[0]):String(args[0]),before,after:binary64(context.random_seed)},false);return result;
  });
  const math=runInContext('Math',context);
  replace(math,'random',original=>function(...args){
    const result=Reflect.apply(original,this,args);hostRngCount++;
    record('rng:host',{draw:hostRngCount,result:binary64(result)},false);return result;
  });
  replace(context,'clientCall',original=>function(callback){
    const result=Reflect.apply(original,this,[callback]);
    record('callback:enqueue',{id:callableId(callback),sourceSha256:hash(source(callback)),queueLength:ed.clientCall_list.length},false);return result;
  });
  const originalSnapshot=phase.sceneHost.snapshot;
  phase.sceneHost.snapshot=function(callback){
    if(arguments.length===0){snapshotSide='after';activeCallback++;record('callback:before',{ordinal:activeCallback});}
    const result=Reflect.apply(originalSnapshot,this,arguments);
    if(arguments.length!==0){callbackCount++;record('callback:after',{ordinal:activeCallback,id:callableId(callback),sourceSha256:hash(source(callback))});snapshotSide='before';}
    return result;
  };
  restores.push(()=>{phase.sceneHost.snapshot=originalSnapshot});
  const methods=['setHp','setMp','castSkill','onDied','terminate'];
  const patched=new Set();
  for(const key of methods){
    let owner=ed.Unit.prototype;
    while(owner&&!Object.hasOwn(owner,key))owner=Reflect.getPrototypeOf(owner);
    if(!owner||patched.has(owner[key]))continue;
    const original=owner[key];patched.add(original);
    replace(owner,key,fn=>function(...args){
      record(`mechanic:${key}:before`,{unitTid:this.tid,args:args.map(value=>typeof value==='number'?['f64',binary64(value)]:value===null?['null']:['type',typeof value])});
      try{const result=Reflect.apply(fn,this,args);record(`mechanic:${key}:after`,{unitTid:this.tid});return result;}
      catch(error){record(`mechanic:${key}:throw`,{name:error.name,message:error.message});throw error;}
    });
  }
  let status='completed';
  try{
    const input=materialize(runtime,wire);
    engine=new ed.BattleEngine();ed.battleEngine=engine;
    ed.srand(input.battleSeed);
    engine.enterBattle(input.players,input.enemies,input.config);
    record('battle:entered',{inputSha256:input.inputSha256});
    while(engine.running&&frame+1<maxFrames){
      frame++;activeCallback=0;snapshotSide='before';
      const discarded=ed.clientCall_list?.length??0;
      phase.beginFrame();record('frame:reset',{discardedByOriginalFrameReset:discarded});
      engine.update(engine.tick_interval);record('frame:engine_updated');
      const drained=phase.drainCallbacks();record('frame:callbacks_drained',drained);
    }
    if(engine.running)throw new Error(`Original source battle did not terminate in ${maxFrames} frames`);
    record('battle:completed',{result:engine.result,ticks:binary64(engine.ticks)});
  }catch(error){status='failed';lastError={name:error.name,message:error.message,stack:error.stack?.split('\n').slice(0,8),phase:snapshotSide==='after'?'callback_execution':'engine_or_snapshot'};
    try{record('battle:failed',lastError)}catch(snapshotError){lastError.snapshotFailure=snapshotError.message;}
  }finally{for(const restore of restores.reverse())restore();}
  const coverage={snapshot:'All reachable own descriptors and source prototypes from the engine/queue roots; canonical VM intrinsics are boundaries',
    limitations:['Native lexical closure bindings cannot be reflected; callback execution effects and event/RNG order are checked',...(strictGraph?[]:['Standard function metadata is treated as immutable code; source function identity/hash and custom data properties remain captured']),'This instrumented source oracle is not a completed native simulator','Actor/effect/view lifecycle outside the source callback phase is not provided by this adapter'],
    opaque:lastGraph?.coverage.opaque??[]};
  return{version:1,status,error:lastError,inputSha256:wire.inputSha256,events,...(keepDeltas?{deltas}:{}),lastGraph,
    callbackCount,rngCount,hostRngCount,frames:frame+1,result:engine?.result,sourceCallbackProvenance:phase.provenance,coverage,
    qualifiesForThroughputTarget:false};
}
