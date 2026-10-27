import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInContext} from 'node:vm';
import {createBootstrapRuntime} from '../bootstrap-runtime.mjs';

test('whole original battle script executes once without any battle lazy factory or initializer replay',async()=>{
 let entropyDraws=0;
 const runtime=await createBootstrapRuntime({eagerBattle:true,hostRandom(){entropyDraws++;return .125}});
 const records=runtime.sourceRecords,file='src/srcmodule/game_battle.js';
 assert.equal(runtime.oracleContextMode,'vm.constants.DONT_CONTEXTIFY');
 assert.equal(runtime.context,runInContext('globalThis',runtime.context));
 assert.equal(runtime.context,runtime.context.window);
 assert.equal(records.eagerModules.length,1);
 const original=await readFile(new URL('../../'+file,import.meta.url),'utf8');
 assert.equal(records.eagerModules[0].source,original);
 assert.equal(records.eagerModules[0].sha256,createHash('sha256').update(original).digest('hex'));
 for(const entries of [records.definitions,records.globals])for(const list of entries.values())assert.ok(list.every(record=>record.file!==file));
 for(const list of [records.functionDeclarations,records.initializers,records.postInitializers])assert.ok(list.every(record=>record.file!==file));
 assert.equal(records.initializationPlan.filter(record=>record.kind==='eager-module').length,1);
 const eagerIndex=records.initializationPlan.findIndex(record=>record.kind==='eager-module');
 assert.ok(records.initializationPlan.slice(0,eagerIndex).every(record=>record.file.endsWith('/game_util.js')));
 assert.equal(entropyDraws,2);
 assert.ok(Object.getOwnPropertyDescriptor(runtime.ed,'Entity').value);
 assert.equal(typeof runtime.ed.Unit.prototype.update,'function');
 assert.ok(records.sourceDefinitionNames.includes('ed.Unit'));
 assert.ok(records.sourceGlobalNames.includes('CandleDog'));
 for(const name of runtime.ed.attrib_names){assert.equal(runtime.ed.attrib_names_x[name],name+'.x');assert.equal(runtime.ed.attrib_names_a[name],name+'.a');}
 const candle=Object.getOwnPropertyDescriptor(runtime.context,'CandleDog').value;
 assert.equal(candle.BASIC_IMPACT_EFF[candle.BASIC_ACTION_WAX],'spine_eff_impact_CandleDog_pet_atka.skel');
 assert.equal(candle.BASIC_IMPACT_SOUND[candle.BASIC_ACTION_BURN],'CANDLEDOG_ATKB_IMPACT');
 runInContext('var __realmUnassigned;var __realmAssigned=2;function __realmFunction(){};Object.defineProperty(globalThis,"__realmGetter",{get:function(){return this},configurable:true});',runtime.context);
 for(const name of ['__realmUnassigned','__realmAssigned','__realmFunction']){
  const d=Object.getOwnPropertyDescriptor(runtime.context,name);
  assert.equal(d.configurable,false);assert.equal(d.writable,true);assert.equal(d.enumerable,true);
 }
 assert.equal(runtime.context.__realmGetter,runtime.context);
 assert.equal(runInContext('__realmGetter===globalThis && ed.constructor===Object && cc.Node.constructor===Function',runtime.context),true);
});
