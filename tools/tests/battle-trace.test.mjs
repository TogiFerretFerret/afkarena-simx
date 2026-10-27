import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext,runInContext } from 'node:vm';
import { binary64,createGraphSnapshotter,realmIntrinsics,firstTraceDifference } from '../battle-trace.mjs';

test('full graph preserves aliases, missing values, holes, cycles and numeric bits',()=>{
 const shared={value:-0};const hole=new Array(2);hole[1]=undefined;const root={a:shared,b:shared,null:null,undefined:undefined,hole};root.self=root;
 const snapshot=createGraphSnapshotter();const state=snapshot({root});
 const rootNode=state.nodes.find(n=>n.id===state.roots[0][1][1]);const props=new Map(rootNode.properties.map(p=>[p.key[1],p.value]));
 assert.deepEqual(props.get('a'),props.get('b'));assert.deepEqual(props.get('self'),state.roots[0][1]);assert.deepEqual(props.get('null'),['null']);assert.deepEqual(props.get('undefined'),['undefined']);
 const array=state.nodes.find(n=>n.id===props.get('hole')[1]);assert.equal(array.properties.some(p=>p.key[1]==='0'),false);assert.deepEqual(array.properties.find(p=>p.key[1]==='1').value,['undefined']);
 assert.equal(state.nodes.find(n=>n.id===props.get('a')[1]).properties.find(p=>p.key[1]==='value').value[1],binary64(-0));
 const before=state.sha256;shared.value=0;assert.notEqual(snapshot({root}).sha256,before);
});

test('snapshot records getters without executing them, source prototypes and nonenumerable properties',()=>{
 let getterCalls=0;const proto={method(){return 1}};const root=Object.create(proto);Object.defineProperty(root,'get',{get(){getterCalls++;return 5},enumerable:true});Object.defineProperty(root,'hidden',{value:1});
 const state=createGraphSnapshotter()({root});assert.equal(getterCalls,0);assert.ok(state.nodes.some(n=>n.kind==='function'));assert.ok(state.coverage.opaque.some(n=>n.kind==='function_closure_bindings'));
 assert.ok(state.nodes.flatMap(n=>n.properties).some(p=>p.key[1]==='hidden'&&!p.enumerable));
});

test('Map/Set insertion order and typed array buffer aliases are captured',()=>{
 const buffer=new ArrayBuffer(8);const a=new Uint8Array(buffer);a[0]=128;const root={a,b:new Uint8Array(buffer),map:new Map([[1,'a'],[2,'b']]),set:new Set([2,1])};
 const state=createGraphSnapshotter()({root});const arrays=state.nodes.filter(n=>n.kind==='typedarray');assert.equal(arrays.length,2);assert.deepEqual(arrays[0].buffer,arrays[1].buffer);assert.equal(state.nodes.find(n=>n.kind==='arraybuffer').bytes,'8000000000000000');
 assert.deepEqual(state.nodes.find(n=>n.kind==='map').entries.map(([k])=>k[1]),[binary64(1),binary64(2)]);
});

test('independent realm snapshots are deterministic and event changes fail comparison',()=>{
 const snapshot=()=>{const context=createContext({});const root=runInContext('({x:-0,list:[1,,undefined],child:{alive:true}})',context);return createGraphSnapshotter({intrinsics:realmIntrinsics(context)})({root});};
 assert.deepEqual(snapshot(),snapshot());const events=[{kind:'rng',bits:binary64(1)},{kind:'callback',id:2}];
 assert.equal(firstTraceDifference(events,events),null);assert.equal(firstTraceDifference(events,events.slice(1)).kind,'event_count');assert.equal(firstTraceDifference(events,[events[1],events[0]]).index,0);
});

test('graph deltas reconstruct complete snapshots including removals and alias changes',async()=>{
 const {createGraphDeltaRecorder,applyGraphDelta}=await import('../battle-trace.mjs');
 const snapshot=createGraphSnapshotter(),capture=createGraphDeltaRecorder(snapshot);const shared={hp:1};let roots={unit:shared,list:[shared]};
 let restored=applyGraphDelta(null,capture(roots));assert.deepEqual(restored,snapshot(roots));
 shared.hp=-0;roots.list.push({hp:NaN});restored=applyGraphDelta(restored,capture(roots));assert.deepEqual(restored,snapshot(roots));
 roots={only:roots.list[1]};restored=applyGraphDelta(restored,capture(roots));assert.deepEqual(restored,snapshot(roots));
});

test('practical code identity policy retains custom function data and prototype mutations',()=>{
 function sourceMethod(){}sourceMethod.counter=-0;
 const snapshot=createGraphSnapshotter({functionPolicy:'code'});
 const a=snapshot({fn:sourceMethod,alias:sourceMethod});
 assert.deepEqual(a.roots[0][1],a.roots[1][1]);assert.equal(a.roots[0][1][0],'function');
 assert.equal(a.nodes.find(n=>n.kind==='function').properties.find(p=>p.key[1]==='counter').value[1],binary64(-0));
 sourceMethod.counter=0;assert.notEqual(snapshot({fn:sourceMethod,alias:sourceMethod}).sha256,a.sha256);
 const before=snapshot({fn:sourceMethod});sourceMethod.prototype.changed=1;
 const after=snapshot({fn:sourceMethod});assert.notEqual(after.sha256,before.sha256);
 assert.ok(after.nodes.flatMap(n=>n.properties).some(p=>p.key[1]==='changed'));
});

test('host entropy replay preserves every binary64 output and rejects extra or missing draws',async()=>{
 const {createHostRandomTape}=await import('../battle-trace.mjs');const original=createHostRandomTape(7);const expected=Array.from({length:20},()=>binary64(original.random()));
 const replay=createHostRandomTape(999,{replay:original.tape});assert.deepEqual(Array.from({length:20},()=>binary64(replay.random())),expected);replay.assertFullyConsumed();assert.throws(()=>replay.random(),/extra draw/);
 const short=createHostRandomTape(7,{replay:original.tape});short.random();assert.throws(()=>short.assertFullyConsumed(),/omitted 19/);
});

test('cached descriptors retain exact fresh encoding when a default function prototype becomes mutable',()=>{
 function Source(){}const root={prototype:Source.prototype};const cached=createGraphSnapshotter({functionPolicy:'code'});
 cached({root});Source.prototype.extra=-0;
 const a=cached({root}),b=createGraphSnapshotter({functionPolicy:'code'})({root});
 // Persistent IDs can differ; compare the root edge representation and data.
 assert.equal(a.nodes[0].properties[0].value[0],b.nodes[0].properties[0].value[0]);
 assert.ok(a.nodes.flatMap(n=>n.properties).some(p=>p.key[1]==='extra'&&p.value[1]===binary64(-0)));
});
