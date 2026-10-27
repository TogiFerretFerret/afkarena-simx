import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTickSource,createSchedulerOracle } from '../check-scheduler.mjs';
const {source}=await loadTickSource();
const oracle=createSchedulerOracle(source);
const scenario=(lists,groups,actions,flags=[])=>({lists,groups,actions:actions.map(([kind=0,a=0,b=0])=>({kind,a,b})),entities:actions.map((_,i)=>({frozen:flags[i]?.[0]??false,terminated:flags[i]?.[1]??false}))});

test('new entities appended to current list execute in the same pass',()=>{
  const result=oracle(scenario([[0]],[0],[[1,0,1],[0]]));
  assert.deepEqual(result.updates,[0,1]);
  assert.deepEqual(result.lists,[[0,1],[0,1]]);
  assert.deepEqual(result.groups,[1]);
});

test('cached array survives group replacement during an update',()=>{
  const result=oracle(scenario([[0,1],[2]],[0],[[3,0,1],[0],[0]]));
  assert.deepEqual(result.updates,[0,1]);
  assert.deepEqual(result.groups,[2]);
  assert.deepEqual(result.lists[2],[0,1]);
});

test('termination does not skip an update; frozen terminated entries are still filtered',()=>{
  const result=oracle(scenario([[0,1,2]],[0],[[0],[0],[0]],[[false,true],[true,true],[false,false]]));
  assert.deepEqual(result.updates,[0,2]);
  assert.deepEqual(result.lists.at(-1),[2]);
});

test('removing current array element shifts the next element past the loop cursor',()=>{
  const result=oracle(scenario([[0,1,2]],[0],[[2,0,0],[0],[0]]));
  assert.deepEqual(result.updates,[0,2]);
  assert.deepEqual(result.lists.at(-1),[1,2]);
});

test('duplicate group references preserve old-array identity after first compaction',()=>{
  const result=oracle(scenario([[0]],[0,0],[[1,0,1],[0]]));
  assert.deepEqual(result.updates,[0,1,0,1]);
  assert.deepEqual(result.groups,[1,2]);
  assert.deepEqual(result.lists,[[0,1],[0,1],[0,1]]);
});

test('frames retain order and complete snapshots around actions and stable filtering',()=>{
  const result=oracle(scenario([[0],[1]],[0],[[1,0,1],[0]]));
  assert.deepEqual(result.frames.map(f=>[f.kind,f.id]),[['before_update',0],['after_update',0],['before_update',1],['after_update',1],['filter',0]]);
  assert.deepEqual(result.frames[0].state.entities[0],{frozen:false,terminated:false,updates:0,used:false});
  assert.deepEqual(result.frames[1].state.entities[0],{frozen:false,terminated:false,updates:1,used:true});
  assert.deepEqual(result.frames[1].state.lists[0],[0,1]);
  assert.deepEqual(result.frames.at(-1).state.groups,[2]);
});
