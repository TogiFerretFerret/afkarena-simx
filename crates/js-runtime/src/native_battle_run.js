function __nativeRun(runtime,wire,battles,warmup,wallNow,captureMode){
  var results=[],ed=runtime.ed,start=0,checksum=2166136261,totalCallbacks=0,lastEngine=null,lastEventStart=0;
  function mix(text){for(var i=0;i<text.length;i++){checksum^=text.charCodeAt(i);checksum=Math.imul(checksum,16777619)>>>0;}}
  function fullCapture(engine,eventStart){return{serialized:engine.toString(),
    stateBits:{engine:__nativePrimitiveState(engine),units:engine.unit_list.map(__nativeUnitState),deadUnits:engine.dead_unit_list.map(__nativeUnitState),pets:engine.pet_list.map(__nativeUnitState)},
    hostEvents:runtime.host.events.slice(eventStart),audioState:JSON.parse(JSON.stringify(runtime.host.audioState()))};}
  for(var battleIndex=-warmup;battleIndex<battles;battleIndex++){
    if(battleIndex===0)start=wallNow();
    var materialized=instantiateScenario(runtime,wire),engine=new ed.BattleEngine();ed.battleEngine=engine;
    ed.srand(materialized.battleSeed);
    engine.enterBattle(materialized.players,materialized.enemies,materialized.config);
    if(runtime.nativeTrace)runtime.nativeTrace.record('battle:entered',{});
    var frames=0,callbackCount=0,queued=0,eventStart=runtime.host.events.length;
    while(engine.running){
      if(runtime.nativeTrace)runtime.nativeTrace.beginFrame();
      var phase=runtime.callbacks.updateFrame(0.125);
      if(runtime.nativeTrace)runtime.nativeTrace.endFrame();
      frames++;callbackCount+=phase.executed;queued+=phase.queued;
    }
    if(battleIndex>=0){
      var result={result:engine.result,ticks:engine.ticks,frames:frames,callbacks:callbackCount,queuedCallbacks:queued,rngBits:__nativeBits(runtime.context.random_seed)};
      mix(JSON.stringify(result));totalCallbacks+=callbackCount;
      if(captureMode==='all'){var capture=fullCapture(engine,eventStart);for(var key in capture)result[key]=capture[key];}
      results.push(result);lastEngine=engine;lastEventStart=eventStart;
    }
  }
  var elapsedMs=wallNow()-start;
  var report={completed:results.length,elapsedMs:elapsedMs,battlesPerSecond:elapsedMs>0?results.length*1000/elapsedMs:null,capture:captureMode,checksum:checksum,totalCallbacks:totalCallbacks,results:results};
  if(captureMode==='final')report.finalCapture=fullCapture(lastEngine,lastEventStart);
  if(runtime.classManagerObserver){runtime.classManagerObserver.assertIntact();report.classManagerCounters=runtime.classManagerObserver.snapshot();}
  if(runtime.tableBoundary){runtime.tableBoundary.assertClean();report.tableBoundary=runtime.tableBoundary.stats();}
  if(runtime.nativeTrace)report.trace=runtime.nativeTrace.stop({status:'completed',running:lastEngine.running,ticks:lastEngine.ticks,result:lastEngine.result});
  return report;
}