import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext,runInContext } from 'node:vm';

// Disable reuse in an independent copy of the same descriptor walker; every
// captured graph byte and compact Merkle hash must match through mutations.
async function realms(){
  const source=await readFile(new URL('../battle-trace-portable.js',import.meta.url),'utf8');
  let baseline=source;
  for(const [from,to] of [['previous=propertyCache.get(key)','previous=null'],['previousNode=nodeCaches.get(value)','previousNode=null'],['cached=identityHashes.get(node)','cached=null']]){
    assert.equal(baseline.split(from).length,2,`uncached test seam ${from}`);baseline=baseline.replace(from,to);
  }
  return [baseline,source].map(text=>{
    const c=createContext({});runInContext(text,c);
    runInContext(`var calls=0,s=Symbol('local');function F(){};F.extra={n:1};var child={x:1},buffer=new ArrayBuffer(16);var root={number:-0,child:child,alias:child,array:[1,,undefined],fn:F,map:new Map([[child,-0]]),set:new Set([child]),date:new Date(0),regexp:/a/gi,buffer:buffer,view:new Float64Array(buffer),boxed:new Number(-0)};root.self=root;root[s]='symbol';var cap=installGraphCapture(),trace=installPortableBattleTrace({compact:true});`,c);
    return c;
  });
}
test('record reuse preserves every graph byte and compact hash through mutable descriptor/native state',async()=>{
  const contexts=await realms();
  const mutations=[
    '',
    'root.child.x=2;root.number=0;',
    'root.array[1]=7;root.array.push(root.child);',
    'delete root.number;root.number=-0;',
    'Object.defineProperty(root.child,"hidden",{value:9,writable:true,configurable:true});',
    'Object.defineProperty(root.child,"hidden",{value:9,writable:false,configurable:true});',
    'Object.defineProperty(root.child,"accessor",{get:function(){calls++;throw Error("getter invoked")},configurable:true});',
    'Object.defineProperty(root.child,"accessor",{set:function(v){calls++},configurable:true});',
    'F.prototype.added={v:1};F.extra.n=2;',
    'Object.defineProperty(F,"prototype",{writable:false});',
    'Object.setPrototypeOf(root.child,{inherited:{v:3}});',
    'root.map.set(root.array,NaN);root.map.delete(root.child);root.set.add(root.array);root.set.delete(root.child);',
    'root.date.setTime(123);root.regexp.lastIndex=2;root.view[0]=-0;root.view[1]=1.5;',
    'root[s]="changed";root[Symbol.for("global")]=root.child;',
    'delete root.child.hidden;delete root.child.accessor;root.child.x=4;',
    'Object.preventExtensions(root.child);Object.seal(root.array);',
    'var d=new DataView(new ArrayBuffer(8));d.setUint32(0,0xfff80000,false);d.setUint32(4,23,false);root.number=d.getFloat64(0,false);',
    'd.setUint32(4,24,false);root.number=d.getFloat64(0,false);'
  ];
  for(let i=0;i<mutations.length;i++){
    const snapshots=contexts.map(c=>{runInContext(mutations[i],c);return runInContext('JSON.stringify(cap.snapshot({state:root}))',c);});
    assert.equal(snapshots[1],snapshots[0],`complete graph mutation ${i}`);
    const hashes=contexts.map(c=>runInContext(`trace.record('mutation',{index:${i}},{state:root}).stateHash`,c));
    assert.equal(hashes[1],hashes[0],`compact hash mutation ${i}`);
    for(const c of contexts)assert.equal(c.calls,0);
  }
});
test('unchanged ordinary nodes reuse identity while changed descendants remain visited',async()=>{
  const [,c]=await realms();
  const result=runInContext(`(function(){var a=cap.snapshot({root:root}),b=cap.snapshot({root:root});var stable=a.nodes.filter(function(n){return n.kind==='object'||n.kind==='array'||n.kind==='function'}).every(function(n){return b.nodes.find(function(x){return x.id===n.id})===n});root.child.x=77;var d=cap.snapshot({root:root});var changed=d.nodes.some(function(n){var old=b.nodes.find(function(x){return x.id===n.id});return old&&n!==old&&n.properties.some(function(p){return p.key[1]==='x'&&p.value[1]==='4053400000000000'})});return{stable:stable,changed:changed};})()`,c);
  assert.equal(result.stable,true);assert.equal(result.changed,true);
});
