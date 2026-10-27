/* Diagnostic only: ordered source callbacks/RNG/mechanics with getter-free
 * primitive/vector state at every boundary. This is NOT a whole-program graph.
 * Inject this exact file in the original-source realm and the native runner.
 */
(function(host){
 'use strict';
 host.installBattleBoundaryStateTrace=function(runtime,options){
  options=options||{};
  var ed=runtime.ed,events=[],restores=[],ids=new WeakMap(),symbols=new Map(),nextId=1,frame=-1,finished=false,snapshots=[],snapshotText=new Map();
  var digest=options.digest||host.__nativeDiagnosticDigest;
  if(typeof digest!=='function')throw new Error('Boundary trace requires SHA256');
  var buffer=new ArrayBuffer(8),view=new DataView(buffer);
  function bits(value){view.setFloat64(0,value,false);return view.getUint32(0,false).toString(16).padStart(8,'0')+view.getUint32(4,false).toString(16).padStart(8,'0');}
  function own(object,key){if(object===null||object===undefined)return undefined;var d=Object.getOwnPropertyDescriptor(object,key);return d&&'value'in d?d.value:undefined;}
  function identity(value){if(value===null||typeof value!=='object'&&typeof value!=='function')return atom(value);if(!ids.has(value))ids.set(value,nextId++);return{ref:ids.get(value)};}
  function atom(value){if(typeof value==='number')return{bits:bits(value)};if(value===undefined)return{kind:'undefined'};if(value===null||typeof value==='string'||typeof value==='boolean')return value;
   if(typeof value==='bigint')return{kind:'bigint',digits:String(value)};
   if(typeof value==='symbol'){if(!symbols.has(value))symbols.set(value,symbols.size+1);return{kind:'symbol',identity:symbols.get(value),globalKey:Symbol.keyFor(value)===undefined?null:Symbol.keyFor(value),text:String(value)};}
   return identity(value);}
  function intern(value){var text=JSON.stringify(value),hash=snapshotText.get(text);if(hash===undefined){hash=digest(text);snapshotText.set(text,hash);snapshots.push({hash:hash,value:value});}return{$boundaryNode:hash};}
  function numericArray(value){
   if(!Array.isArray(value))return null;
   var length=own(value,'length'),out=[];
   for(var i=0;i<length;i++){
    var d=Object.getOwnPropertyDescriptor(value,String(i));
    if(!d){out.push({kind:'hole'});continue;}
    if(!('value'in d)||typeof d.value!=='number')return null;
    out.push({bits:bits(d.value)});
   }
   return out;
  }
  function primitiveState(object){
   var out={};if(object===null||object===undefined)return intern(out);
   var keys=Object.keys(object).sort();
   for(var i=0;i<keys.length;i++){
    var key=keys[i],d=Object.getOwnPropertyDescriptor(object,key);
    if(!d||!('value'in d))continue;
    var value=d.value;
    if(value===null||typeof value!=='object'&&typeof value!=='function')out[key]=atom(value);
    else{var vector=numericArray(value);if(vector!==null)out[key]=vector;}
   }
   return intern(out);
  }
  function ordered(array,visit){
   if(!Array.isArray(array))return{kind:'absent-list'};
   var out=[],length=own(array,'length');
   for(var i=0;i<length;i++){
    var d=Object.getOwnPropertyDescriptor(array,String(i));
    out.push(!d?{kind:'hole'}:!('value'in d)?{kind:'accessor'}:visit(d.value));
   }
   return out;
  }
  function unitState(unit){return intern({
   identity:identity(unit),fields:primitiveState(unit),attributes:primitiveState(own(unit,'attribs')),
   buffEffects:primitiveState(own(unit,'buff_effects')),
   skills:ordered(own(unit,'skill_list'),function(skill){return{identity:identity(skill),fields:primitiveState(skill),name:atom(own(own(skill,'info'),'SkillName'))};}),
   buffs:ordered(own(unit,'buff_list'),function(buff){return{identity:identity(buff),fields:primitiveState(buff)};})
  });}
  function capture(){
   var engine=own(ed,'_battleEngineInstance'),lists={};
   var names=['unit_list','dead_unit_list','pet_list','dead_pet_list','fieldNpc_list','dead_fieldNpc_list','projectile_list'];
   for(var i=0;i<names.length;i++)lists[names[i]]=ordered(own(engine,names[i]),unitState);
   return{engine:primitiveState(engine),lists:lists,battleRng:atom(own(host,'random_seed')),
    initialBattleSeed:atom(own(ed,'init_battle_seed')),pendingCallbacks:ordered(own(ed,'clientCall_list'),identity),
    clientCallCount:atom(own(ed,'clientCallCount')),
    classManagerCounters:runtime.classManagerObserver?runtime.classManagerObserver.snapshot():null};
  }
  function payload(value){return atom(value);}
  function record(kind,data){
   if(finished)throw new Error('Boundary trace already finished');
   var state=capture(),event={sequence:events.length,kind:kind,frame:frame,payload:data||null,state:state,stateHash:digest(JSON.stringify(state))};
   events.push(event);
   if(options.onProgress&&events.length%1000===0)options.onProgress({events:events.length,frame:frame,kind:kind});
  }
  function replace(owner,key,make){
   var d=Object.getOwnPropertyDescriptor(owner,key);
   if(!d||!('value'in d)||typeof d.value!=='function')throw new Error('Cannot wrap boundary '+key);
   Object.defineProperty(owner,key,Object.assign({},d,{value:make(d.value)}));
   restores.push(function(){Object.defineProperty(owner,key,d);});
  }
  function wrap(owner,key,kind){replace(owner,key,function(original){return function(){
   var args=[];for(var i=0;i<arguments.length;i++)args.push(payload(arguments[i]));
   record(kind+':before',{receiver:identity(this),args:args});
   try{var result=Reflect.apply(original,this,arguments);record(kind+':after',{result:payload(result)});return result;}
   catch(error){record(kind+':throw',{error:identity(error),name:atom(own(error,'name')),message:atom(own(error,'message'))});throw error;}
  };});}
  void ed.rand;void ed.srand;
  wrap(ed,'rand','rng:draw');wrap(ed,'srand','rng:seed');
  wrap(host.Math,'random','rng:host');
  replace(host,'clientCall',function(original){return function(callback){var result=Reflect.apply(original,this,arguments);record('callback:enqueue',{callback:identity(callback)});return result;};});
  replace(runtime.callbacks.sceneHost,'snapshot',function(original){return function(callback){
   if(arguments.length===0)record('callback:before',null);
   var result=Reflect.apply(original,this,arguments);
   if(arguments.length!==0)record('callback:after',{callback:identity(callback)});
   return result;
  };});
  ['setHp','setMp','castSkill','onDied','terminate'].forEach(function(key){
   var owner=ed.Unit.prototype;while(owner&&!Object.hasOwn(owner,key))owner=Object.getPrototypeOf(owner);
   if(owner)wrap(owner,key,'mechanic:'+key);
  });
  if(runtime.host&&runtime.host.setTraceObserver){runtime.host.setTraceObserver(function(event,ordinal){record('device:output',{ordinal:ordinal,event:event});});restores.push(function(){runtime.host.setTraceObserver(null);});}
  if(options.subscribeClock){var restore=options.subscribeClock(function(entry,ordinal){record('host:clock',{ordinal:ordinal,entry:entry});});if(restore)restores.push(restore);}
  return{record:record,captureState:capture,beginFrame:function(){frame++;record('frame:before',null);},endFrame:function(){record('frame:after',null);},
   stop:function(summary){record('battle:completed',summary);finished=true;for(var i=restores.length-1;i>=0;i--)restores[i]();return{version:1,status:'completed',rootContract:'primitive-vector-battle-boundaries-v1',graphHash:'sha256-interned-state-json-v1',events:events,snapshots:snapshots,qualifiesFor10000Target:false,
    limitations:['Not a whole-program graph: nested objects, prototype state, function code/closures, shared-object aliases outside selected roots and weak contents are omitted','Only own primitive fields, numeric vectors and selected ordered engine/unit/skill/buff lists are captured','Own data-descriptor reads do not invoke ordinary getters; reflective inspection of an unknown Proxy can invoke traps and is outside the supported fixture domain','Actor/effect/view lifecycle remains outside this callback-only adapter']};}
  };
 };
})(globalThis);
