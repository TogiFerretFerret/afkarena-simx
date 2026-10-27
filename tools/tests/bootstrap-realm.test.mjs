import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext,runInContext} from 'node:vm';
import {importBootstrapValue} from '../bootstrap-realm.mjs';

test('source data arrays and objects use the original source VM realm',()=>{
 const context=createContext({});context.data=importBootstrapValue(context,{rows:[{value:1}]});
 assert.equal(runInContext('data.rows instanceof Array',context),true);
 assert.equal(runInContext('Object.getPrototypeOf(data)===Object.prototype',context),true);
 assert.equal(runInContext('data.rows.constructor===Array',context),true);
});

test('realm import preserves signed zero, alias identity, undefined, holes and cycles',()=>{
 const shared={value:-0},array=[shared,shared];array.length=4;
 const input={array,missing:undefined};input.self=input;
 const output=importBootstrapValue(createContext({}),input);
 assert.ok(Object.is(output.array[0].value,-0));assert.equal(output.array[0],output.array[1]);assert.equal(output.self,output);
 assert.equal(output.array.length,4);assert.equal(2 in output.array,false);assert.equal(Object.hasOwn(output,'missing'),true);
 output.array[0].value=1;assert.ok(Object.is(input.array[0].value,-0),'source input must remain separate');
});

test('realm import does not invoke or silently drop live accessors and functions',()=>{
 let calls=0;const input={};Object.defineProperty(input,'danger',{enumerable:true,get(){calls++;return 1}});
 const context=createContext({});assert.throws(()=>importBootstrapValue(context,input),/does not accept accessors/);assert.equal(calls,0);
 assert.throws(()=>importBootstrapValue(context,{fn(){}}),/does not accept live functions/);
});

test('literal __proto__ key remains an own data property rather than mutating prototypes',()=>{
 const context=createContext({});context.data=importBootstrapValue(context,JSON.parse('{"__proto__":{"sentinel":1}}'));
 assert.equal(runInContext('Object.getPrototypeOf(data)===Object.prototype',context),true);
 assert.equal(runInContext('Object.prototype.hasOwnProperty.call(data,"__proto__")',context),true);
 assert.equal(runInContext('data.sentinel===undefined',context),true);
});
test('shared source scaffold creates globals, sentinels and errors in the executing realm',async()=>{
 const{readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../bootstrap-realm-init.js',import.meta.url),'utf8');
 const context=createContext({});runInContext(source,context);
 assert.equal(runInContext('window===globalThis',context),true);
 assert.equal(runInContext('ed instanceof Object && cc instanceof Object && cc.game instanceof Object && cc.game.CONFIG_KEY instanceof Object',context),true);
 assert.equal(runInContext('Object.getPrototypeOf(ed)===Object.prototype && Object.getPrototypeOf(cc)===Object.prototype',context),true);
 assert.equal(runInContext('cc.Node instanceof Function && HTMLElement instanceof Function && new cc.Node() instanceof Object && new HTMLElement() instanceof Object',context),true);
 assert.equal(runInContext('Object.getPrototypeOf(cc.Node)===Function.prototype && Object.getPrototypeOf(HTMLElement)===Function.prototype',context),true);
 assert.equal(runInContext('try {cc.error("source", "failure")} catch(e) {e instanceof Error && e.message==="source failure"}',context),true);
 const second=createContext({});runInContext(source,second);
 assert.notEqual(context.ed,second.ed);assert.notEqual(context.cc.Node,second.cc.Node);assert.notEqual(context.HTMLElement,second.HTMLElement);
});
