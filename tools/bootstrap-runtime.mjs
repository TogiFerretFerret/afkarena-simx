import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import {loadBootstrapSourceRecords} from './bootstrap-records.mjs';
import { loadBootstrapTableSync } from './bootstrap-source.mjs';
import { installBootstrapCallbacks } from './bootstrap-callbacks.mjs';
import { importBootstrapValue } from './bootstrap-realm.mjs';
import { installBootstrapFunctionDeclarations } from './bootstrap-declarations.mjs';

const root=resolve(import.meta.dirname,'..');

/** Diagnostic source loader, not a validated module-loading order.
 * Original RHS expressions are evaluated on demand. Required lexical closures,
 * module side effects and dynamic property names fail rather than being invented.
 */
export async function createBootstrapRuntime({hostRandom,hostClock}={}){
  if(hostRandom!==undefined&&typeof hostRandom!=='function')throw new Error('hostRandom must be an explicit entropy input function');
  const extracted=await loadBootstrapSourceRecords();
  const {ordered,functionDeclarations,initializers}=extracted;
  const definitions=new Map(extracted.definitions),globals=new Map(extracted.globals);
  const postInitializers=extracted.postInitializers.slice();
  const tables=new Map();
  const loaded=[],active=new Set();
  const context=createContext({console});
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
  ed.getDataTable=name=>{if(!tables.has(name))tables.set(name,importBootstrapValue(context,loadBootstrapTableSync(name)));return tables.get(name);};
  ed.logbugly=message=>{throw new Error(message);};
  // These original statements have effects beyond their RHS values. Execute them
  // in original module/source order rather than losing computed writes/descriptors.
  postInitializers.sort((a,b)=>ordered.indexOf(a.file.split('/').at(-1))-ordered.indexOf(b.file.split('/').at(-1))||a.start-b.start);
  for(const initializer of postInitializers)runInContext(initializer.source,context,{filename:`${initializer.file}:${initializer.start}`});
  // The source audio singleton is normally constructed by application startup.
  // Run its actual constructor; only physical output is supplied by the host.
  new ed.soundManager();
  ed.audio_effect_switch=context.bootstrapHost.audioEnabled;
  const callbacks=await installBootstrapCallbacks(context);
  return {context,ed,loaded,tables,provenance,callbacks,clock,clockProvenance,host:context.bootstrapHost,importValue:value=>importBootstrapValue(context,value),
    sourceRecords:{definitions,globals,functionDeclarations,initializers,postInitializers,hostSources},
    sourceRecordsCache:extracted.cache,
    hostProvenance:{file:'tools/bootstrap-host.js',sha256:createHash('sha256').update(hostSource).digest('hex')},
    initializers:initializers.map(({source,...record})=>record),
    limitations:['Lazy symbol evaluation does not establish all original module side-effect order','Original queued callbacks execute after each local engine frame; actor/effect/view scene updates are outside this headless adapter','Headless Linux device output is recorded; physical audio/render output is not produced','Cocos runtime revision is pinned but original engine revision is not supplied; missing closures/globals fail explicitly']};
}
