/* Inject verbatim in source and compiled candidates after battle-trace-portable.
 * This diagnostic adapter calls every wrapped source function exactly once and
 * restores its original descriptor. It never supplies a mechanic implementation.
 */
(function(host){
 "use strict";
 host.installBattleTraceInstrumentation=function(runtime,options){
  options=options||{};
  var ed=runtime.ed,context=runtime.context,callbacks=runtime.callbacks;
  if(!callbacks||!callbacks.sceneHost)throw new Error('Trace needs the actual source callback sceneHost');
  var trace=host.installPortableBattleTrace(options),restores=[],callbackIds=new WeakMap(),nextCallback=1,frame=-1,stopped=false;
  var knownNames=new Set(options.definitionNames||[]),registered=new WeakSet(),loaderRevision=-1;
  function logical(fn,name){if(typeof fn==='function'&&!registered.has(fn)){trace.capture.registerFunctionCode(fn,name);registered.add(fn);}}
  function loaderAccessors(){
   var revision=runtime.loaded&&(runtime.loaded.length??runtime.loaded.size);
   if(revision!==undefined&&revision===loaderRevision)return;
   loaderRevision=revision;
   // Normalize only audited loader-created descriptors, identified by the exact
   // source definition catalog path. Original source accessor code is retained.
   var queue=[[ed,'ed']],visited=new WeakSet();
   for(var i=0;i<queue.length;i++){
    var object=queue[i][0],prefix=queue[i][1];
    if(!object||!['object','function'].includes(typeof object)||visited.has(object))continue;
    visited.add(object);
    var keys=Reflect.ownKeys(object);
    for(var j=0;j<keys.length;j++){
     var key=keys[j];if(typeof key!=='string')continue;
     var name=prefix+'.'+key,d=Object.getOwnPropertyDescriptor(object,key);
     var getterCode=typeof d.get==='function'?Function.prototype.toString.call(d.get):'';
     var isLoader=getterCode.includes('Missing original parent definition:')&&getterCode.includes('active.has(name)')||
      getterCode.includes('Unsupported scoped source definition:')&&getterCode.includes('__nativeActive[name]');
     if(!('value'in d)&&knownNames.has(name)&&isLoader&&d.enumerable&&d.configurable){
      logical(d.get,'source-loader:get:'+name);logical(d.set,'source-loader:set:'+name);
     }else if('value'in d&&knownNames.has(name))queue.push([d.value,name]);
    }
   }
  }
  var heroScripts={};
  function scriptRoots(engine){
   var names=['unit_list','dead_unit_list','pet_list','dead_pet_list','fieldNpc_list','dead_fieldNpc_list','projectile_list'];
   var scripts=Object.getOwnPropertyDescriptor(ed,'battlehero')?.value;
   if(!scripts)return heroScripts;
   for(var listIndex=0;listIndex<names.length;listIndex++){
    var units=engine&&Object.getOwnPropertyDescriptor(engine,names[listIndex])?.value;
    if(!Array.isArray(units))continue;
    for(var unitIndex=0;unitIndex<units.length;unitIndex++){
     var info=units[unitIndex]&&Object.getOwnPropertyDescriptor(units[unitIndex],'info')?.value;
     var name=info&&Object.getOwnPropertyDescriptor(info,'Script')?.value;
     if(typeof name!=='string')continue;
     var d=Object.getOwnPropertyDescriptor(scripts,name);
     if(d&&'value'in d)heroScripts[name]=d.value;
    }
   }
   return heroScripts;
  }
  function roots(){
   var engine=ed.battleEngine;
   return{engine:engine,battleRng:context.random_seed,initialBattleSeed:ed.init_battle_seed,
    pendingCallbacks:ed.clientCall_list,clientCallCount:ed.clientCallCount,
    battleLog:Object.getOwnPropertyDescriptor(ed,'btLog')?.value,
    heroScripts:scriptRoots(engine),
    hostState:runtime.host?.snapshotState?runtime.host.snapshotState():null,
    soundManager:Object.getOwnPropertyDescriptor(ed,'sound_manager')?.value};
  }
  function record(kind,payload){loaderAccessors();trace.record(kind,{frame:frame,data:payload},roots());}
  function callbackId(fn){if(!callbackIds.has(fn))callbackIds.set(fn,nextCallback++);return callbackIds.get(fn);}
  function replace(owner,key,make){
   var d=Object.getOwnPropertyDescriptor(owner,key);
   if(!d||typeof d.value!=='function')throw new Error('Cannot trace missing source method '+key);
   Object.defineProperty(owner,key,Object.assign({},d,{value:make(d.value)}));
   restores.push(function(){Object.defineProperty(owner,key,d);});
  }
  function wrap(owner,key,kind,captureReceiver){replace(owner,key,function(original){return function(){
   var args=Array.prototype.slice.call(arguments);record(kind+':before',{receiver:captureReceiver?this:null,args:args});
   try{var result=Reflect.apply(original,this,args);record(kind+':after',{receiver:captureReceiver?this:null,result:result});return result;}
   catch(error){record(kind+':throw',{name:error.name,message:error.message});throw error;}
  };});}
  // Force resolution before installing wrappers; adapter code is identical in
  // each runtime and its source text is included by the portable code table.
  void ed.rand;void ed.srand;
  wrap(ed,'rand','rng:draw');wrap(ed,'srand','rng:seed');
  wrap(host.Math,'random','rng:host');
  replace(context,'clientCall',function(original){return function(callback){
   var result=Reflect.apply(original,this,arguments);
   record('callback:enqueue',{id:callbackId(callback),callback:callback});return result;
  };});
  var scene=callbacks.sceneHost;
  replace(scene,'snapshot',function(original){return function(callback){
   if(arguments.length===0)record('callback:before',{});
   var result=Reflect.apply(original,this,arguments);
   if(arguments.length!==0)record('callback:after',{id:callbackId(callback),callback:callback});
   return result;
  };});
  ['setHp','setMp','castSkill','onDied','terminate'].forEach(function(key){
   var owner=ed.Unit.prototype;while(owner&&!Object.hasOwn(owner,key))owner=Object.getPrototypeOf(owner);
   if(owner)wrap(owner,key,'mechanic:'+key,true);
  });
  if(runtime.host?.setTraceObserver){
   runtime.host.setTraceObserver(function(event,ordinal){record('device:output',{ordinal:ordinal,event:event});});
   restores.push(function(){runtime.host.setTraceObserver(null);});
  }
  if(options.subscribeClock){var restore=options.subscribeClock(function(entry,ordinal){record('host:clock',{ordinal:ordinal,entry:entry});});if(restore)restores.push(restore);}
  return{
   record:record,
   beginFrame:function(){frame++;record('frame:before',{});},
   endFrame:function(){record('frame:after',{});},
   stop:function(summary){
    if(stopped)throw new Error('Trace already stopped');
    try{return trace.finish(summary);}finally{stopped=true;for(var i=restores.length-1;i>=0;i--)restores[i]();}
   },
   restore:function(){if(!stopped){stopped=true;for(var i=restores.length-1;i>=0;i--)restores[i]();}}
  };
 };
})(globalThis);
