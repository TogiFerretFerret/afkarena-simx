import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
const adapter=await readFile(new URL('../oracle-class-manager.js',import.meta.url),'utf8');
const vendor=await readFile(new URL('../bootstrap-vendor-CCClass.js',import.meta.url),'utf8');
const proof=JSON.parse(await readFile(new URL('../../config/oracle-class-manager.json',import.meta.url),'utf8'));
function setup(){
 const context=createContext({cc:{game:{config:null,CONFIG_KEY:{}}},HTMLElement:function HTMLElement(){}});context.window=context;
 runInContext('var randomCalls=0;Math.random=function(){randomCalls++;return 0;};',context);
 runInContext(vendor,context);runInContext(adapter,context);context.proof=proof;
 const observer=runInContext('installClassManagerObserver(proof)',context);
 return{context,observer};
}
test('installation and snapshots never query allocators or consume extra entropy; zero is retained',()=>{
 const{context,observer}=setup();assert.equal(context.randomCalls,2);
 const initial=observer.snapshot();assert.equal(initial.nextClassId,null);assert.equal(initial.nextInstanceId,null);assert.equal(initial.classCalls,0);
 const manager=context.classManager,alias=manager.getNewID;
 assert.equal(manager.getNewID(),0);assert.equal(alias.call({unrelated:true},17),1);assert.equal(manager.getNewInstanceId(),0);
 const state=observer.snapshot();assert.equal(state.nextClassId,2);assert.equal(state.nextInstanceId,1);assert.equal(state.lastInstanceId,0);assert.equal(state.classCalls,2);assert.equal(state.instanceCalls,1);
 observer.finish();assert.equal(manager.getNewInstanceId(),1);assert.equal(observer.finish().nextInstanceId,2);assert.equal(context.randomCalls,2);
 assert.equal(manager.getNewID.name,'');assert.equal(manager.getNewID.length,0);
});
test('original generated class allocations are observed without changing their call sequence',()=>{
 const{context,observer}=setup();
 runInContext('var Foo=cc.Class.extend({ctor:function(){this.value=3}});var first=new Foo();var second=new Foo();',context);
 assert.equal(context.first.__instanceId,0);assert.equal(context.second.__instanceId,1);
 const state=observer.snapshot();assert.equal(state.classCalls,1);assert.equal(state.instanceCalls,2);assert.equal(state.nextClassId,1);assert.equal(state.nextInstanceId,2);
});
test('manager and method identity or descriptor changes cause sticky failure even after restoration',()=>{
 for(const kind of ['manager','constructor','method','descriptor']){
  const{context,observer}=setup(),manager=context.classManager,constructor=context.ClassManager,method=manager.getNewID;
  if(kind==='manager')context.classManager={};
  if(kind==='constructor')context.ClassManager=function Changed(){};
  if(kind==='method')manager.getNewID=()=>999;
  if(kind==='descriptor')Object.defineProperty(manager,'getNewID',{enumerable:false});
  assert.throws(()=>observer.assertIntact(),/ClassManager observer violation/);
  context.classManager=manager;context.ClassManager=constructor;
  Object.defineProperty(manager,'getNewID',{value:method,writable:true,enumerable:true,configurable:true});
  assert.throws(()=>observer.finish(),/ClassManager observer violation/);
 }
});
test('a captured preinstallation allocator bypass is detected on the next observed call',()=>{
 const context=createContext({cc:{game:{config:null,CONFIG_KEY:{}}},HTMLElement:function HTMLElement(){}});context.window=context;
 runInContext('Math.random=function(){return 0;};',context);runInContext(vendor,context);
 const bypass=context.classManager.getNewID;runInContext(adapter,context);context.proof=proof;
 const observer=runInContext('installClassManagerObserver(proof)',context);
 assert.equal(context.classManager.getNewID(),0);assert.equal(bypass(),1);
 assert.throws(()=>context.classManager.getNewID(),/sequence changed or bypassed/);assert.throws(()=>observer.finish(),/sequence changed or bypassed/);
});
test('increment derivation follows the exact prefix/postfix operator, not a hardcoded returned+1 rule',()=>{
 for(const [expression,prefix,direction,first,nextStored,nextReturned]of [['++id',true,1,1,1,2],['id--',false,-1,0,-1,-1],['--id',true,-1,-1,-1,-2]]){
  const context=createContext({});runInContext(`var ClassManager=function(){var id=0,instanceId=0;this.getNewID=function () {return ${expression};};this.getNewInstanceId=function () {return instanceId++;};};var classManager=new ClassManager();`,context);
  const localProof={constructorSource:context.ClassManager.toString(),methods:{getNewID:{source:context.classManager.getNewID.toString(),counterBinding:'id',prefix,direction},getNewInstanceId:{source:context.classManager.getNewInstanceId.toString(),counterBinding:'instanceId',prefix:false,direction:1}}};
  context.proof=localProof;runInContext(adapter,context);const observer=runInContext('installClassManagerObserver(proof)',context);
  assert.equal(context.classManager.getNewID(),first);const state=observer.snapshot();assert.equal(state.classCounterValue,nextStored);assert.equal(state.nextClassId,nextReturned);
 }
});
test('counter derivation retains f64 saturation and signed-zero returns',()=>{
 for(const seed of ['9007199254740992','-0']){
  const context=createContext({});runInContext(`var ClassManager=function(){var id=${seed},instanceId=0;this.getNewID=function () {return id++;};this.getNewInstanceId=function () {return instanceId++;};};var classManager=new ClassManager();`,context);
  context.proof={constructorSource:context.ClassManager.toString(),methods:{getNewID:{source:context.classManager.getNewID.toString(),counterBinding:'id',prefix:false,direction:1},getNewInstanceId:{source:context.classManager.getNewInstanceId.toString(),counterBinding:'instanceId',prefix:false,direction:1}}};
  runInContext(adapter,context);const observer=runInContext('installClassManagerObserver(proof)',context);
  const first=context.classManager.getNewID();
  if(seed==='-0'){assert.ok(Object.is(first,-0));assert.ok(Object.is(observer.snapshot().lastClassId,-0));assert.equal(observer.snapshot().nextClassId,1);}
  else{assert.equal(first,2**53);assert.equal(context.classManager.getNewID(),2**53);assert.equal(observer.snapshot().nextClassId,2**53);}
 }
});
