import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { openSync,writeSync,closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createBootstrapRuntime } from './bootstrap-runtime.mjs';
import { instantiateScenario } from './scenario-factory.mjs';

const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2);
function option(name,fallback){const i=args.indexOf(name);if(i>=0){if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing ${name} value`);return args[i+1];}return fallback;}
const scenarioPath=resolve(root,option('--scenario','config/scenario-example-2026.json'));
const output=resolve(root,option('--output','work/native-oracle.js'));
const tablesPath=resolve(root,option('--tables-file','work/native-tables.json'));
const battles=Number(option('--battles','1')),warmup=Number(option('--warmup','0'));
const scope=option('--scope',args.includes('--all-definitions')?'all':'battle-core');
if(!['all','battle','battle-core','observed'].includes(scope))throw new Error('Scope must be all, battle, battle-core, or observed');
if(!Number.isSafeInteger(battles)||battles<1||!Number.isSafeInteger(warmup)||warmup<0)throw new Error('Invalid battle count');
const sha=value=>createHash('sha256').update(value).digest('hex');
const adapterFiles=['tools/emit-native-oracle.mjs','tools/bootstrap-runtime.mjs','tools/bootstrap-source.mjs','tools/bootstrap-packed.mjs','tools/bootstrap-realm.mjs','tools/bootstrap-callbacks.mjs','tools/scenario-factory.mjs','tools/bootstrap-host.js','tools/oracle-clock.js','config/bootstrap-packed-config.json'];
const adapterInputs=Object.fromEntries(await Promise.all(adapterFiles.map(async file=>[file,sha(await readFile(resolve(root,file)))])));
const wireText=await readFile(scenarioPath,'utf8'),wire=JSON.parse(wireText);
const entropy=[];
const runtime=await createBootstrapRuntime({hostRandom:()=>{const value=Math.random();entropy.push(value);return value;},hostClock:{mode:'record',tape:[]}});
if(!runtime.clock)throw new Error('Copied source runtime must expose recorded hostClock before native emission');
if(!runtime.sourceRecords)throw new Error('Copied source runtime must expose its exact sourceRecords');

function __nativeBits(value){
  var data=new DataView(new ArrayBuffer(8));data.setFloat64(0,value,false);var result='';
  for(var i=0;i<8;i++){var part=data.getUint8(i).toString(16);result+=(part.length===1?'0':'')+part;}
  return result;
}
function __nativePrimitiveState(object){
  var out={},keys=Object.keys(object).sort();
  for(var i=0;i<keys.length;i++){
    var key=keys[i],descriptor=Object.getOwnPropertyDescriptor(object,key);
    if(!descriptor||!('value'in descriptor))continue;
    var value=descriptor.value;
    if(typeof value==='number')out[key]={bits:__nativeBits(value)};
    else if(typeof value==='undefined')out[key]={kind:'undefined'};
    else if(typeof value==='boolean'||typeof value==='string'||value===null)out[key]=value;
    else if(Array.isArray(value)&&value.every(function(x){return typeof x==='number';}))out[key]=value.map(function(x){return{bits:__nativeBits(x)};});
  }
  return out;
}
function __nativeUnitState(unit){
  return{fields:__nativePrimitiveState(unit),attributes:__nativePrimitiveState(unit.attribs||{}),buffEffects:__nativePrimitiveState(unit.buff_effects||{}),
    skills:(unit.skill_list||[]).map(function(skill){return{name:skill.info&&skill.info.SkillName,fields:__nativePrimitiveState(skill)};}),
    buffs:(unit.buff_list||[]).map(function(buff){return{fields:__nativePrimitiveState(buff)};})};
}
function __nativeRun(runtime,wire,battles,warmup,wallNow){
  var results=[],ed=runtime.ed,start=0;
  for(var battleIndex=-warmup;battleIndex<battles;battleIndex++){
    if(battleIndex===0)start=wallNow();
    var materialized=instantiateScenario(runtime,wire),engine=new ed.BattleEngine();ed.battleEngine=engine;
    ed.srand(materialized.battleSeed);
    engine.enterBattle(materialized.players,materialized.enemies,materialized.config);
    var frames=0,callbackCount=0,queued=0,eventStart=runtime.host.events.length;
    while(engine.running){
      var phase=runtime.callbacks.updateFrame(0.125);
      frames++;callbackCount+=phase.executed;queued+=phase.queued;
    }
    if(battleIndex>=0)results.push({result:engine.result,ticks:engine.ticks,frames:frames,callbacks:callbackCount,queuedCallbacks:queued,
      rngBits:__nativeBits(runtime.context.random_seed),serialized:engine.toString(),
      stateBits:{engine:__nativePrimitiveState(engine),units:engine.unit_list.map(__nativeUnitState),deadUnits:engine.dead_unit_list.map(__nativeUnitState),pets:engine.pet_list.map(__nativeUnitState)},
      hostEvents:runtime.host.events.slice(eventStart),audioState:JSON.parse(JSON.stringify(runtime.host.audioState()))});
  }
  var elapsedMs=wallNow()-start;
  return{completed:results.length,elapsedMs:elapsedMs,battlesPerSecond:elapsedMs>0?results.length*1000/elapsedMs:null,results:results};
}
const reference=__nativeRun(runtime,wire,battles,warmup,Date.now);
runtime.clock.finish();
const usedTableNames=[...runtime.tables.keys()].sort();
// Include every table actually requested by the copied source oracle, including
// dynamically selected helpers outside the prioritized literal-source regions.
const prepared=spawnSync(process.execPath,[resolve(root,'tools/prepare-native-tables.mjs'),'--output='+tablesPath,'--tables='+usedTableNames.join(',')],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
if(prepared.error)throw prepared.error;
assert.equal(prepared.status,0,prepared.stderr);
process.stdout.write(prepared.stdout);
const hostInputs={version:1,random:entropy,clock:runtime.clock.tape};
const hostInputsPath=output+'.host-inputs.json',referencePath=output+'.reference.json';
await mkdir(resolve(output,'..'),{recursive:true});
await writeFile(hostInputsPath,JSON.stringify(hostInputs)+'\n');
await writeFile(referencePath,JSON.stringify(reference)+'\n');

const records={...runtime.sourceRecords};
if(scope!=='all'){
  const selected=new Set(scope==='observed'||scope==='battle-core'?runtime.loaded:[]);
  const maps=[records.definitions,records.globals];
  const baseline=new Set(['game_battle.js','game_util.js','game_base.js']);
  if(scope==='battle'||scope==='battle-core')for(const map of maps)for(const[name,list]of map)if(list.some(r=>scope==='battle-core'?r.file.endsWith('/game_battle.js'):baseline.has(r.file.split('/').at(-1))))selected.add(name);
  function parents(name){for(let p=name.lastIndexOf('.');p>0;p=name.lastIndexOf('.',p-1))selected.add(name.slice(0,p));}
  for(const name of [...selected])parents(name);
  if(scope==='battle'||scope==='battle-core'){
    let changed=true;
    while(changed){
      const before=selected.size;
      for(const map of maps)for(const[name,list]of map){
        if(!selected.has(name))continue;
        for(const record of list){
          for(const ref of record.source.matchAll(/\bed(?:\.[A-Za-z_$][\w$]*)+/g)){selected.add(ref[0]);parents(ref[0]);}
          for(const ref of record.source.matchAll(/\b[A-Za-z_$][\w$]*\b/g))if(records.globals.has(ref[0]))selected.add(ref[0]);
        }
      }
      changed=selected.size!==before;
    }
  }
  records.definitions=new Map([...records.definitions].filter(([name])=>selected.has(name)));
  records.globals=new Map([...records.globals].filter(([name])=>selected.has(name)));
}
const allFactoryRecords=[],definitionNames=[],globalNames=[];
function collect(map,names){for(const[name,list]of map){names.push(name);for(const record of list){record.factoryId=allFactoryRecords.length;allFactoryRecords.push({...record,name});}}}
collect(records.definitions,definitionNames);collect(records.globals,globalNames);
const cocosManifest=JSON.parse(await readFile(resolve(root,'config/bootstrap-cocos-runtime.json'),'utf8'));
const cocosSource=await readFile(resolve(root,cocosManifest.file),'utf8');
assert.equal(sha(cocosSource),cocosManifest.sha256);
const hostSource=await readFile(resolve(root,'tools/bootstrap-host.js'),'utf8');
const clockSource=await readFile(resolve(root,'tools/oracle-clock.js'),'utf8');
const realmSource=await readFile(resolve(root,'tools/bootstrap-realm.mjs'),'utf8');
const realmStart=realmSource.indexOf('(function(value){');
const realmEnd=realmSource.indexOf('})`,context',realmStart);
assert.ok(realmStart>=0&&realmEnd>realmStart,'Missing original source-realm copy function');
const realmCopy=realmSource.slice(realmStart,realmEnd+2);
const uiSource=await readFile(resolve(root,'src/srcmodule/game_ui_1.js'),'utf8');
const clientCall=uiSource.slice(4337876,4337915),snapshot=uiSource.slice(4342606,4343218),onUpdate=uiSource.slice(4343228,4343636);
assert.equal(clientCall,'function(e){ed.clientCall_list.push(e)}');
const resetMatch=/resetClientCall=(function\(\)\{ed\.clientCall_list=\[\]\})/.exec(uiSource);assert.ok(resetMatch);
const drainStart=onUpdate.indexOf('ed.clientCallCount='),drainEnd=onUpdate.indexOf('this.updateActor',drainStart);
assert.ok(drainStart>=0&&drainEnd>drainStart);const drainBody=onUpdate.slice(drainStart,drainEnd);
const tableBytes=await readFile(tablesPath);
const fd=openSync(output,'w');
const put=text=>writeSync(fd,text+'\n');
try{
  put('// Generated original-source AOT oracle. No runtime eval/Function constructor is introduced.');
  put('var __nativeGlobal=globalThis;var __nativeWallNow=Date.now;');
  put('if(typeof print!=="function")globalThis.print=function(x){console.log(x);};');
  put('if(typeof console==="undefined")globalThis.console={log:function(){print(Array.prototype.join.call(arguments," "));}};');
  put('var ed=globalThis.ed={};var cc=globalThis.cc={game:{config:null,CONFIG_KEY:{}},Node:function Node(){},error:function(){throw new Error(Array.prototype.join.call(arguments," "));}};var window=globalThis;globalThis.window=globalThis;globalThis.HTMLElement=function HTMLElement(){};');
  put('var __nativeHostInputs=JSON.parse('+JSON.stringify(JSON.stringify(hostInputs))+');var __nativeEntropyIndex=0;Math.random=function(){if(__nativeEntropyIndex>=__nativeHostInputs.random.length)throw new Error("Host random input tape exhausted");return __nativeHostInputs.random[__nativeEntropyIndex++];};');
  put(clockSource);
  put('var __nativeClock=installOracleClock({mode:"replay",tape:__nativeHostInputs.clock});');
  put(hostSource);
  // Preserve original declaration hoisting/global self-reassignment; do not
  // turn named declarations into expression factories.
  for(const record of records.functionDeclarations||[])put(record.source);
  for(const record of records.initializers)put(record.source+';');
  put(cocosSource);
  for(let i=0;i<allFactoryRecords.length;i++)put(`function __nativeFactory${i}(){return (${allFactoryRecords[i].source});}`);
  put('var __nativeDefinitions=Object.create(null),__nativeGlobals=Object.create(null);');
  for(const[name,list]of records.definitions)put(`__nativeDefinitions[${JSON.stringify(name)}]=[${list.map(r=>'__nativeFactory'+r.factoryId).join(',')}];`);
  for(const[name,list]of records.globals)put(`__nativeGlobals[${JSON.stringify(name)}]=[${list.map(r=>'__nativeFactory'+r.factoryId).join(',')}];`);
  // Keep all known property names even in scoped builds. A missing factory then
  // throws on access instead of making a source-defined branch look undefined.
  put(`var __nativeDefinitionNames=${JSON.stringify([...runtime.sourceRecords.definitions.keys()])};var __nativeGlobalNames=${JSON.stringify([...runtime.sourceRecords.globals.keys()])};`);
  put('var __nativeLoaded=[],__nativeActive=Object.create(null);');
  put(`function __nativeExpose(owner,prefix){
    var keys=Object.create(null);
    for(var i=0;i<__nativeDefinitionNames.length;i++){var full=__nativeDefinitionNames[i];if(full.indexOf(prefix+'.')===0)keys[full.slice(prefix.length+1).split('.')[0]]=true;}
    Object.keys(keys).forEach(function(key){var name=prefix+'.'+key;
      if(key in owner){var descriptor=Object.getOwnPropertyDescriptor(owner,key);if(descriptor&&'value'in descriptor&&descriptor.value&&(typeof descriptor.value==='object'||typeof descriptor.value==='function'))__nativeExpose(descriptor.value,name);return;}
      Object.defineProperty(owner,key,{configurable:true,enumerable:true,get:function(){
        if(__nativeActive[name])throw new Error('Source dependency cycle at '+name);
        var factories=__nativeDefinitions[name];if(!factories)throw new Error('Unsupported scoped source definition: '+name);
        __nativeActive[name]=true;var value;
        try{for(var j=0;j<factories.length;j++){Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value:value});value=factories[j].call(__nativeGlobal);}
          Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value:value});
          if(value&&(typeof value==='object'||typeof value==='function'))__nativeExpose(value,name);__nativeLoaded.push(name);return value;
        }finally{delete __nativeActive[name];}
      },set:function(value){Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value:value});}});
    });
  }
  __nativeExpose(ed,'ed');
  __nativeGlobalNames.forEach(function(name){if(name in __nativeGlobal)return;
    Object.defineProperty(__nativeGlobal,name,{configurable:true,enumerable:true,get:function(){
      if(__nativeActive[name])throw new Error('Source global dependency cycle at '+name);
      __nativeActive[name]=true;var value,factories=__nativeGlobals[name];if(!factories)throw new Error('Unsupported scoped source global: '+name);
      try{for(var i=0;i<factories.length;i++){Object.defineProperty(__nativeGlobal,name,{configurable:true,enumerable:true,writable:true,value:value});value=factories[i].call(__nativeGlobal);}
        Object.defineProperty(__nativeGlobal,name,{configurable:true,enumerable:true,writable:true,value:value});if(value&&(typeof value==='object'||typeof value==='function'))__nativeExpose(value,name);__nativeLoaded.push(name);return value;
      }finally{delete __nativeActive[name];}
    },set:function(value){Object.defineProperty(__nativeGlobal,name,{configurable:true,enumerable:true,writable:true,value:value});}});
  });`);
  put(`function __nativeDecodeUTF8(bytes){
    var parts=[],units=[],i=0;
    while(i<bytes.length){var a=bytes[i++],code;
      if(a<128)code=a;
      else if(a>=194&&a<224){if(i>=bytes.length)throw new Error('Truncated UTF8');code=((a&31)<<6)|(bytes[i++]&63);}
      else if(a<240){if(i+1>=bytes.length)throw new Error('Truncated UTF8');code=((a&15)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63);}
      else{if(i+2>=bytes.length)throw new Error('Truncated UTF8');code=((a&7)<<18)|((bytes[i++]&63)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63);code-=65536;units.push(55296+(code>>10));code=56320+(code&1023);}
      units.push(code);if(units.length>=4096){parts.push(String.fromCharCode.apply(null,units));units=[];}
    }
    if(units.length)parts.push(String.fromCharCode.apply(null,units));return parts.join('');
  }`);
  if(args.includes('--embed-tables'))put('var __nativeTableText='+JSON.stringify(tableBytes.toString('utf8'))+';');
  else put('var __nativeTablePath='+JSON.stringify(tablesPath)+';var __nativeTableText=null;');
  put(`var __nativeTables=null;ed.getDataTable=function(name){
    if(__nativeTables===null){
      if(__nativeTableText===null){if(typeof hermescli!=='object'||typeof hermescli.loadFile!=='function')throw new Error('External table IO requires hermescli.loadFile host binding');__nativeTableText=__nativeDecodeUTF8(hermescli.loadFile(__nativeTablePath));}
      __nativeTables=JSON.parse(__nativeTableText).tables;__nativeTableText=null;
    }
    if(!Object.prototype.hasOwnProperty.call(__nativeTables,name))throw new Error('Missing native source table: '+name);return __nativeTables[name];
  };ed.logbugly=function(message){throw new Error(message);};`);
  for(const record of records.postInitializers)put(record.source+';');
  put('new ed.soundManager();ed.audio_effect_switch=bootstrapHost.audioEnabled;');
  put('globalThis.clientCall=('+clientCall+');globalThis.resetClientCall=('+resetMatch[1]+');');
  put('var __nativeSourceSnapshot=('+snapshot+');var __nativeSnapshots=0;var __nativeScene={snapshot:function(){__nativeSnapshots++;return __nativeSourceSnapshot.apply(this,arguments);}};');
  put('function __nativeDrain(){'+drainBody+'}');
  put('var __nativeCallbacks={updateFrame:function(elapsed){resetClientCall();ed.battleEngine.update(elapsed);__nativeSnapshots=0;__nativeDrain.call(__nativeScene);return{queued:ed.clientCallCount,executed:__nativeSnapshots/2,pending:ed.clientCall_list.length};}};');
  put('var __nativeRealmCopy='+realmCopy+';function importBootstrapValue(_context,value){return __nativeRealmCopy(value);}');
  put(instantiateScenario.toString());
  put(__nativeBits.toString());put(__nativePrimitiveState.toString());put(__nativeUnitState.toString());put(__nativeRun.toString());
  put('var __nativeWire=JSON.parse('+JSON.stringify(wireText)+');');
  put(`var __nativeResult=__nativeRun({ed:ed,context:globalThis,callbacks:__nativeCallbacks,host:bootstrapHost},__nativeWire,${battles},${warmup},__nativeWallNow);`);
  put('__nativeClock.finish();if(__nativeEntropyIndex!==__nativeHostInputs.random.length)throw new Error("Unconsumed host random inputs: "+(__nativeHostInputs.random.length-__nativeEntropyIndex));');
  put('__nativeResult.hostInputConsumption={random:__nativeEntropyIndex,clock:__nativeClock.stats()};print(JSON.stringify(__nativeResult));');
}finally{closeSync(fd);}
const metadata={version:1,scope,output,outputSha256:sha(await readFile(output)),scenario:{file:scenarioPath,sha256:sha(wireText),inputSha256:wire.inputSha256},battles,warmup,
  adapterInputs,
  sourceRuntime:{file:'tools/bootstrap-runtime.mjs',sha256:sha(await readFile(resolve(root,'tools/bootstrap-runtime.mjs')))},
  definitionCount:records.definitions.size,globalCount:records.globals.size,factoryCount:allFactoryRecords.length,
  usedTableNames,
  originalRecords:allFactoryRecords.map(({source,factoryId,...record})=>({...record,sha256:sha(source)})),
  initializers:records.initializers.map(({source,...record})=>({...record,sha256:sha(source)})),postInitializers:records.postInitializers.map(({source,...record})=>({...record,sha256:sha(source)})),
  functionDeclarations:(records.functionDeclarations||[]).map(({source,...record})=>({...record,sha256:sha(source)})),
  cocos:cocosManifest,host:{file:'tools/bootstrap-host.js',sha256:sha(hostSource)},clock:{file:'tools/oracle-clock.js',sha256:sha(clockSource)},
  tableBundle:{file:tablesPath,sha256:sha(tableBytes),bytes:tableBytes.length,embedded:args.includes('--embed-tables')},
  hostInputs:{file:hostInputsPath,sha256:sha(JSON.stringify(hostInputs)+'\n'),randomCount:entropy.length,clockCount:runtime.clock.tape.length},reference:{file:referencePath,sha256:sha(JSON.stringify(reference)+'\n')},
  limitations:runtime.limitations,qualification:scope==='observed'?'Compiler plumbing only: observed factory keys for this exact source run; broader inputs may explicitly fail and this is not the full-domain throughput qualification':'Emitted static original-source factories; no throughput or whole-program equivalence claim until emitted Node and native executions match the copied source oracle'};
await writeFile(output+'.metadata.json',JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({status:'emitted',output,bytes:(await readFile(output)).length,factoryCount:allFactoryRecords.length,reference:referencePath,metadata:output+'.metadata.json'}));
if(!args.includes('--no-node-check')){
  const loader='const fs=require("node:fs");globalThis.hermescli={loadFile:p=>new Uint8Array(fs.readFileSync(p))};require(process.argv[1]);';
  const checked=spawnSync(process.execPath,['-e',loader,output],{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024});
  await writeFile(output+'.node.stdout',checked.stdout??'');await writeFile(output+'.node.stderr',checked.stderr??'');
  if(checked.error)throw checked.error;
  assert.equal(checked.status,0,'Emitted Node failed; see '+output+'.node.stderr');
  const result=JSON.parse(checked.stdout.trim().split('\n').at(-1));
  // The output contract is JSON. VM arrays/prototypes and absent undefined keys
  // are normalized exactly as in the persisted copied-oracle reference artifact.
  assert.deepEqual(result.results,JSON.parse(JSON.stringify(reference.results)),'Emitted Node original-source results differ from copied oracle');
  console.log(JSON.stringify({status:'node_match',completed:result.completed,results:result.results.map(x=>({result:x.result,ticks:x.ticks,callbacks:x.callbacks,rngBits:x.rngBits}))}));
}
