import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {gunzipSync} from 'node:zlib';

const baseline=await readFile(new URL('../battle-trace-portable.js',import.meta.url),'utf8');
const candidate=gunzipSync(await readFile(new URL('../../benchmarks/validation/trace-brand-memo/lazy-trail.js.gz',import.meta.url))).toString('utf8');

test('snapshot-local native-brand reuse preserves every byte and observes later prototype mutations without invoking getters',()=>{
 const contexts=[baseline,candidate].map(text=>{
  const context=createContext({});runInContext(text,context);
  runInContext(`var getterCalls=0,parent={},middle=Object.create(parent),children=[];
   Object.defineProperty(parent,'constructor',{get:function(){getterCalls++;throw Error('constructor getter invoked')},configurable:true});
   for(var i=0;i<100;i++)children.push(Object.create(middle));
   var root={children:children,parent:parent,middle:middle},capture=installGraphCapture();`,context);
  return context;
 });
 const mutations=['','Object.setPrototypeOf(parent,Date.prototype)',
  'Object.setPrototypeOf(parent,Number.prototype)',
  'Object.setPrototypeOf(parent,null)',
  'Object.setPrototypeOf(middle,Map.prototype)',
  'Object.setPrototypeOf(middle,parent);Object.defineProperty(parent,"poison",{get:function(){getterCalls++;throw Error("poison getter invoked")},configurable:true})',
  'Object.setPrototypeOf(parent,Set.prototype)'];
 for(const [index,mutation]of mutations.entries()){
  const graphs=contexts.map(context=>{
   runInContext(mutation,context);
   const graph=runInContext('JSON.stringify(capture.snapshot({state:root}))',context);
   assert.equal(context.getterCalls,0);
   return graph;
  });
  assert.equal(graphs[1],graphs[0],`prototype mutation ${index}`);
  if(index===1)assert.match(graphs[1],/"nativeBrandRejected":"Date"/);
  if(index===2)assert.match(graphs[1],/"nativeBrandRejected":"Number"/);
  if(index===3)assert.doesNotMatch(graphs[1],/nativeBrandRejected/);
 }
});
