import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext,runInContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { installPortableGraph,canonicalPortableGraph,portableGraphHash,firstPortableGraphDifference,comparePortableBattleTraces } from '../battle-trace-portable.mjs';

async function setup(program){const context=createContext({});runInContext(program,context);return{context,capture:await installPortableGraph(context)}}

test('same pure-JS exporter is deterministic across independent realms with all numeric/alias primitives',async()=>{
 const code=`var shared={hp:-0};var a=new Array(3);a[1]=undefined;a[2]=shared;var root={a:a,b:shared,c:shared,nan:NaN,inf:Infinity,n:null,u:undefined};root.self=root;`;
 const a=await setup(code),b=await setup(code);const x=a.capture.snapshot({root:a.context.root}),y=b.capture.snapshot({root:b.context.root});
 assert.equal(firstPortableGraphDifference(x,y),null);assert.equal(portableGraphHash(x),portableGraphHash(y));
 const props=x.nodes.find(n=>n.id===x.roots[0][1][1]).properties;
 assert.deepEqual(props.find(p=>p.key[1]==='b').value,props.find(p=>p.key[1]==='c').value);
 assert.ok(x.nodes.flatMap(n=>n.properties).some(p=>p.value?.[0]==='f64'&&p.value[1]==='8000000000000000'));
});

test('portable code table emits immutable source once and preserves mutable function/prototype data',async()=>{
 const {context,capture}=await setup(`function Source(){return 2}Source.count=1;Source.prototype.field=-0;var root={fn:Source,alias:Source};`);
 const x=capture.snapshot({root:context.root});assert.ok(x.codeTable.some(c=>c.kind==='source'&&c.source.includes('function Source()')));
 assert.equal(x.codeTable.filter(c=>c.kind==='source'&&c.source.includes('function Source()')).length,1);
 const before=portableGraphHash(x);runInContext('Source.count=2;Source.prototype.field=0',context);
 const y=capture.snapshot({root:context.root});assert.notEqual(portableGraphHash(y),before);
 assert.notEqual(firstPortableGraphDifference(x,y),null);
});

test('portable exporter never invokes accessors and captures boxed, Map/Set, Date and typed buffer state',async()=>{
 const {context,capture}=await setup(`var calls=0;var buffer=new ArrayBuffer(8);var bytes=new Uint8Array(buffer);bytes[0]=255;var root={map:new Map([[1,'a'],[2,'b']]),set:new Set([3,2]),date:new Date(0),number:new Number(-0),bytes:bytes,alias:new Uint8Array(buffer)};Object.defineProperty(root,'get',{get:function(){calls++;return 1}});`);
 const x=capture.snapshot({root:context.root});assert.equal(context.calls,0);
 assert.deepEqual(Array.from(x.nodes.filter(n=>n.kind==='typedarray'),n=>n.buffer[1]),[x.nodes.find(n=>n.kind==='typedarray').buffer[1],x.nodes.find(n=>n.kind==='typedarray').buffer[1]]);
 assert.equal(x.nodes.find(n=>n.kind==='arraybuffer').bytes,'ff00000000000000');
 assert.equal(x.nodes.find(n=>n.kind==='boxed_number').value[1],'8000000000000000');
 assert.equal(x.nodes.find(n=>n.kind==='date').time[1],'0000000000000000');
 assert.equal(x.nodes.find(n=>n.kind==='map').entries.length,2);
});

test('proxy and node-bound failures reject capture rather than returning partial state',async()=>{
 const {context,capture}=await setup('var root=new Proxy({a:1},{getPrototypeOf:function(){throw new Error("trap must not execute")}});');
 assert.throws(()=>capture.snapshot({root:context.root}),/Proxy/);
 const small=await installPortableGraph(context,{maxNodes:1});assert.throws(()=>small.snapshot({a:{child:{}}}),/node bound/);
 const map=runInContext('new Map([[{},{}]])',context);assert.throws(()=>small.snapshot({map}),/node bound/);
});

test('logical code registration supports source-identified adapter functions without masking mutable data',async()=>{
 const {context,capture}=await setup('function adapter(){return 1}adapter.state=0;var root={adapter:adapter}');
 capture.registerFunctionCode(context.adapter,'loader:get:ed.Unit@source-hash');
 const x=capture.snapshot({root:context.root});assert.ok(x.codeTable.some(c=>c.kind==='logical'&&c.identity==='loader:get:ed.Unit@source-hash'));
 assert.throws(()=>capture.registerFunctionCode(context.adapter,'different'),/already captured/);
 context.adapter.state=2;assert.notEqual(portableGraphHash(x),portableGraphHash(capture.snapshot({root:context.root})));
 assert.ok(canonicalPortableGraph(x).codeTable.some(c=>c.kind==='logical'));
});

test('extensibility and changed function prototype descriptors remain observable',async()=>{
 const {context,capture}=await setup('var root={};function f(){}root.fn=f;');
 const before=capture.snapshot({root:context.root});
 runInContext('Object.preventExtensions(root);Object.defineProperty(f,"prototype",{writable:false})',context);
 const after=capture.snapshot({root:context.root});
 assert.notEqual(firstPortableGraphDifference(before,after),null);
 assert.equal(after.nodes.find(n=>n.id===after.roots[0][1][1]).extensible,false);
 assert.ok(after.nodes.some(n=>n.kind==='function'&&n.properties.some(p=>p.key[1]==='prototype'&&!p.writable)));
});

test('shared ordered trace detects callback omission, reordered RNG, and negative-zero changes',async()=>{
 async function trace(changed){
  const {context}=await setup('var state={hp:3};');
  context.changed=changed;
  return runInContext(`var trace=installPortableBattleTrace();
   trace.record('callback:before',{value:changed==='bits'?0:-0},state);
   if(changed!=='skip')trace.record(changed==='reorder'?'rng:draw':'callback:after',{value:NaN},state);
   trace.finish({status:'completed',running:false,ticks:1,result:'victory'});`,context);
 }
 const reference=await trace();
 assert.equal(comparePortableBattleTraces(reference,await trace()).passed,true);
 for(const kind of ['bits','skip','reorder'])assert.equal(comparePortableBattleTraces(reference,await trace(kind)).passed,false,kind);
 const incomplete={...reference,events:reference.events.slice(0,-1)};
 assert.equal(comparePortableBattleTraces(reference,incomplete).passed,false);
 assert.equal(comparePortableBattleTraces(reference,reference).qualifiesForThroughputTarget,false);
});

test('portable trace refuses unfinished battles, bound overflows and writes after completion',async()=>{
 const {context}=await setup('var state={};');
 const trace=runInContext('installPortableBattleTrace({maxEvents:2})',context);
 assert.throws(()=>trace.finish({status:'completed',running:true}),/terminated/);
 trace.record('frame',{},context.state);trace.finish({status:'completed',running:false});
 assert.throws(()=>trace.record('extra',{},context.state),/completion/);
 const bounded=runInContext('installPortableBattleTrace({maxEvents:0})',context);
 assert.throws(()=>bounded.record('frame',{},context.state),/event bound/);
});

test('portable SHA256 matches host crypto over padding boundaries and UTF-8 surrogate edge cases',async()=>{
 const {context}=await setup('');
 const vectors=['','abc','😀🦊é汉字','\ud800','\udfff','a'.repeat(100000)];
 for(let length=0;length<140;length++)vectors.push('x'.repeat(length));
 for(const input of vectors)assert.equal(context.portableTraceSha256(input),createHash('sha256').update(input).digest('hex'));
});

test('compact event checksums cover exactly the full canonical graph and all payload bits',async()=>{
 const {context}=await setup('var roots={hp:-0,a:[undefined,NaN]};');
 const full=runInContext('var t=installPortableBattleTrace();t.record("event",{f:Infinity},roots);t.finish({status:"completed",running:false})',context);
 const compact=runInContext('var t=installPortableBattleTrace({compact:true});t.record("event",{f:Infinity},roots);t.finish({status:"completed",running:false})',context);
 assert.equal(compact.events.length,full.events.length);
 for(let i=0;i<full.events.length;i++)assert.equal(compact.events[i].stateHash,portableGraphHash(full.events[i].graph));
 assert.equal(comparePortableBattleTraces(compact,compact).passed,true);
 const changed={...compact,events:compact.events.map((event,i)=>i?event:{...event,stateHash:'0'.repeat(64)})};
 assert.equal(comparePortableBattleTraces(compact,changed).passed,false);
 context.__digest=text=>createHash('sha256').update(text).digest('hex');
 const accelerated=runInContext('var t=installPortableBattleTrace({compact:true,digest:__digest});t.record("event",{f:Infinity},roots);t.finish({status:"completed",running:false})',context);
 assert.equal(comparePortableBattleTraces(compact,accelerated).passed,true);
});
