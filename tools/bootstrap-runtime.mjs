import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { constants, createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import {loadBootstrapSourceRecords} from './bootstrap-records.mjs';
import { loadBootstrapTableSync } from './bootstrap-source.mjs';
import { installBootstrapCallbacks } from './bootstrap-callbacks.mjs';
import { importBootstrapValue } from './bootstrap-realm.mjs';
import { installBootstrapFunctionDeclarations } from './bootstrap-declarations.mjs';

const root=resolve(import.meta.dirname,'..');

/** Source loader with optional whole original battle-module execution.
 * External helper modules retain the explicit diagnostic lazy adapter. Required
 * lexical closures and missing host dependencies fail rather than being invented.
 */
export async function createBootstrapRuntime({hostRandom,hostClock,tableBoundaryFactory,eagerBattle=false,observeClassManager=false}={}){
  if(hostRandom!==undefined&&typeof hostRandom!=='function')throw new Error('hostRandom must be an explicit entropy input function');
  if(typeof eagerBattle!=='boolean')throw new Error('eagerBattle must be boolean');
  if(typeof observeClassManager!=='boolean')throw new Error('observeClassManager must be boolean');
  const extracted=await loadBootstrapSourceRecords();
  const {ordered}=extracted;
  const eagerModules=[];
  if(eagerBattle){
    const file='src/srcmodule/game_battle.js',source=await readFile(resolve(root,file),'utf8');
    eagerModules.push({file,source,sha256:createHash('sha256').update(source).digest('hex'),kind:'eager-module'});
  }
  const eagerFiles=new Set(eagerModules.map(record=>record.file));
  const helperRecords=records=>records.filter(record=>!eagerFiles.has(record.file));
  // Future declarations from an eager module must remain absent until its actual
  // script hoisting/execution. A lazy accessor here would change original flow.
  const helperDefinitions=entries=>new Map(entries.map(([name,records])=>[name,helperRecords(records)]).filter(([,records])=>records.length));
  const functionDeclarations=helperRecords(extracted.functionDeclarations),initializers=helperRecords(extracted.initializers);
  const definitions=helperDefinitions(extracted.definitions),globals=helperDefinitions(extracted.globals);
  const sourceGlobalNames=extracted.sourceGlobalNames??[...new Set([...extracted.globals.map(([name])=>name),...extracted.functionDeclarations.map(record=>record.name)])];
  const sourceDefinitionNames=extracted.definitions.map(([name])=>name);
  const postInitializers=helperRecords(extracted.postInitializers);
  const tables=new Map();
  const loaded=[],active=new Set();
  // Keep ordinary Script global-binding descriptors. Node's contextified
  // sandbox wrapper changes initialized var/function configurability and hides
  // uninitialized bindings from parent reflection.
  const oracleContextMode='vm.constants.DONT_CONTEXTIFY';
  const context=createContext(constants.DONT_CONTEXTIFY);
  context.console=console;
  const realmInitSource=await readFile(resolve(root,'tools/bootstrap-realm-init.js'),'utf8');
  runInContext(realmInitSource,context,{filename:'tools/bootstrap-realm-init.js'});
  const ed=context.ed;
  let clock,clockProvenance;
  if(hostClock!==undefined){
    const clockSource=await readFile(resolve(root,'tools/oracle-clock.js'),'utf8');
    runInContext(clockSource,context,{filename:'tools/oracle-clock.js'});
    context.__oracleClockOptions=hostClock;
    try{clock=runInContext('installOracleClock(__oracleClockOptions)',context);}
    finally{delete context.__oracleClockOptions;}
    clockProvenance={file:'tools/oracle-clock.js',sha256:createHash('sha256').update(clockSource).digest('hex')};
  }
  if(hostRandom){
    context.__hostRandom=hostRandom;
    runInContext('Math.random=__hostRandom;delete __hostRandom;',context);
  }
  const hostSource=await readFile(resolve(root,'tools/bootstrap-host.js'),'utf8');
  const hostSources=[{file:'tools/bootstrap-realm-init.js',source:realmInitSource,phase:'realm-scaffold'},{file:'tools/bootstrap-host.js',source:hostSource,phase:'before-original-initializers'}];
  runInContext(hostSource,context,{filename:'tools/bootstrap-host.js'});
  // In this supplied revision declaration names have no variable-initializer
  // collision; reject a future collision instead of silently changing hoisting.
  for(const record of functionDeclarations)assert.ok(!globals.has(record.name),`Original function/variable initialization ordering requires a dedicated adapter: ${record.name}`);
  for(const module of ordered){
    const file=`src/srcmodule/${module}`;
    installBootstrapFunctionDeclarations(context,functionDeclarations.filter(record=>record.file===file));
    for(const initializer of initializers.filter(record=>record.file===file))runInContext(initializer.source,context,{filename:`${initializer.file}:${initializer.start}`});
  }
  const provenance=JSON.parse(await readFile(resolve(root,'config/bootstrap-cocos-runtime.json'),'utf8'));
  const cocos=await readFile(resolve(root,provenance.file),'utf8');
  assert.equal(createHash('sha256').update(cocos).digest('hex'),provenance.sha256);
  hostSources.push({file:provenance.file,source:cocos,phase:'cocos-class'});
  runInContext(cocos,context,{filename:provenance.file});
  let classManagerObserver,classManagerObserverProvenance;
  if(observeClassManager){
    const file='tools/oracle-class-manager.js',proofFile='config/oracle-class-manager.json';
    const source=await readFile(resolve(root,file),'utf8'),proofText=await readFile(resolve(root,proofFile),'utf8'),proof=JSON.parse(proofText);
    assert.equal(proof.vendor.file,provenance.file);assert.equal(proof.vendor.sha256,provenance.sha256);
    assert.equal(createHash('sha256').update(proof.constructorSource).digest('hex'),proof.constructorSha256);
    for(const record of Object.values(proof.methods))assert.equal(createHash('sha256').update(record.source).digest('hex'),record.sha256);
    runInContext(source,context,{filename:file});
    context.__classManagerObserverProof=importBootstrapValue(context,proof);
    try{classManagerObserver=runInContext('installClassManagerObserver(__classManagerObserverProof)',context);}
    finally{delete context.__classManagerObserverProof;}
    hostSources.push({file,source,phase:'after-cocos-before-render'});
    classManagerObserverProvenance={file,sha256:createHash('sha256').update(source).digest('hex'),proofFile,proofSha256:createHash('sha256').update(proofText).digest('hex'),proof};
  }
  const renderHostSource=await readFile(resolve(root,'tools/bootstrap-render-host.js'),'utf8');
  hostSources.push({file:'tools/bootstrap-render-host.js',source:renderHostSource,phase:'after-cocos'});
  runInContext(renderHostSource,context,{filename:'tools/bootstrap-render-host.js'});
  const geometryProvenance=JSON.parse(await readFile(resolve(root,'config/bootstrap-cocos-geometry.json'),'utf8'));
  for(const record of geometryProvenance.files){
    const source=await readFile(resolve(root,record.file),'utf8');
    assert.equal(createHash('sha256').update(source).digest('hex'),record.sha256);
    hostSources.push({file:record.file,source,phase:'after-cocos'});
    runInContext(source,context,{filename:record.file});
  }
  function expose(owner,prefix){
    const keys=new Set([...definitions.keys()].filter(name=>name.startsWith(prefix+'.')).map(name=>name.slice(prefix.length+1).split('.')[0]));
    for(const key of keys){
      const name=`${prefix}.${key}`;
      if(key in owner){
        const descriptor=Object.getOwnPropertyDescriptor(owner,key);
        if(descriptor&&'value'in descriptor&&descriptor.value&&(typeof descriptor.value==='object'||typeof descriptor.value==='function'))expose(descriptor.value,name);
        continue;
      }
      Object.defineProperty(owner,key,{configurable:true,enumerable:true,get(){
        if(active.has(name))throw new Error(`Source dependency cycle at ${name}`);
        const records=definitions.get(name);
        if(!records)throw new Error(`Missing original parent definition: ${name}`);
        active.add(name);
        let value;
        try{
          for(const record of records){
            // Make previous definitions visible to source wrappers such as ed.override.
            Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value});
            value=runInContext(`(${record.source})`,context,{filename:`${record.file}:${record.start}`});
          }
          Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value});
          if(value&&(typeof value==='object'||typeof value==='function'))expose(value,name);
          loaded.push(name);return value;
        }finally{active.delete(name);}
      },set(value){Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value});}});
    }
  }
  expose(ed,'ed');
  for(const[name,records]of globals){
    if(name in context)continue;
    Object.defineProperty(context,name,{configurable:true,enumerable:true,get(){
      if(active.has(name))throw new Error(`Source global dependency cycle at ${name}`);
      active.add(name);
      let value;
      try{
        for(const record of records){
          Object.defineProperty(context,name,{configurable:true,enumerable:true,writable:true,value});
          value=runInContext(`(${record.source})`,context,{filename:`${record.file}:${record.start}`});
        }
        Object.defineProperty(context,name,{configurable:true,enumerable:true,writable:true,value});
        if(value&&(typeof value==='object'||typeof value==='function'))expose(value,name);
        loaded.push(name);return value;
      }finally{active.delete(name);}
    },set(value){Object.defineProperty(context,name,{configurable:true,enumerable:true,writable:true,value});}});
  }
  if(tableBoundaryFactory!==undefined&&typeof tableBoundaryFactory!=='function')throw new Error('tableBoundaryFactory must install a qualification boundary in the source realm');
  const tableBoundary=tableBoundaryFactory?tableBoundaryFactory(context):null;
  if(tableBoundary&&typeof tableBoundary.wrap!=='function')throw new Error('Source table boundary requires wrap');
  ed.getDataTable=name=>{if(!tables.has(name)){
    const raw=importBootstrapValue(context,loadBootstrapTableSync(name));
    tables.set(name,tableBoundary?tableBoundary.wrap(raw,{name}):raw);
  }return tables.get(name);};
  ed.logbugly=message=>{throw new Error(message);};
  // These original statements have effects beyond their RHS values. Execute them
  // in original module/source order rather than losing computed writes/descriptors.
  postInitializers.sort((a,b)=>ordered.indexOf(a.file.split('/').at(-1))-ordered.indexOf(b.file.split('/').at(-1))||a.start-b.start);
  const initializationPlan=[];
  let nextHelper=0;
  for(const module of eagerModules){
    const index=ordered.indexOf(module.file.split('/').at(-1));
    while(nextHelper<postInitializers.length&&ordered.indexOf(postInitializers[nextHelper].file.split('/').at(-1))<index)
      initializationPlan.push({...postInitializers[nextHelper++],kind:'helper-statement'});
    initializationPlan.push(module);
  }
  while(nextHelper<postInitializers.length)initializationPlan.push({...postInitializers[nextHelper++],kind:'helper-statement'});
  for(const initializer of initializationPlan)runInContext(initializer.source,context,{filename:initializer.kind==='eager-module'?initializer.file:`${initializer.file}:${initializer.start}`});
  // The source audio singleton is normally constructed by application startup.
  // Run its actual constructor; only physical output is supplied by the host.
  new ed.soundManager();
  ed.audio_effect_switch=context.bootstrapHost.audioEnabled;
  const callbacks=await installBootstrapCallbacks(context);
  return {context,oracleContextMode,ed,loaded,tables,tableBoundary,provenance,callbacks,clock,clockProvenance,classManagerObserver,classManagerObserverProvenance,host:context.bootstrapHost,importValue:value=>importBootstrapValue(context,value),
    sourceRecords:{oracleContextMode,definitions,globals,functionDeclarations,initializers,postInitializers,eagerModules,initializationPlan,sourceGlobalNames,sourceDefinitionNames,hostSources},
    sourceRecordsCache:extracted.cache,
    hostProvenance:{file:'tools/bootstrap-host.js',sha256:createHash('sha256').update(hostSource).digest('hex')},
    initializers:initializers.map(({source,...record})=>record),
    limitations:[eagerBattle?'Whole original game_battle.js executes once; external prerequisite modules still use the explicit lazy helper adapter':'Lazy symbol evaluation does not establish all original module side-effect order','Original queued callbacks execute after each local engine frame; actor/effect/view scene updates are outside this headless adapter','Headless Linux device output is recorded; physical audio/render output is not produced','Cocos runtime revision is pinned but original engine revision is not supplied; missing closures/globals fail explicitly']};
}
