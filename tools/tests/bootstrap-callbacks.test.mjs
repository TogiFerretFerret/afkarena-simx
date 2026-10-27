import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext} from 'node:vm';
import {installBootstrapCallbacks} from '../bootstrap-callbacks.mjs';
async function setup(){const context=createContext({ed:{clientCall_list:[]}});context.window=context;return{context,callbacks:await installBootstrapCallbacks(context)};}

test('original clientCall enqueues without executing; captured FIFO drains appended callbacks',async()=>{
  const{context,callbacks}=await setup(),events=[];
  context.clientCall(()=>{events.push('a');context.clientCall(()=>events.push('c'))});
  context.clientCall(()=>events.push('b'));
  assert.deepEqual(events,[]);
  assert.deepEqual(callbacks.drainCallbacks(),{queued:2,executed:3,pending:0});
  assert.deepEqual(events,['a','b','c']);
});
test('replacing queue preserves drain reference and appends into replacement queue',async()=>{
  const{context,callbacks}=await setup(),events=[];
  context.clientCall(()=>{events.push('a');context.ed.clientCall_list=[()=>events.push('c')]});
  context.clientCall(()=>{events.push('b');context.clientCall(()=>events.push('d'))});
  assert.deepEqual(callbacks.drainCallbacks(),{queued:2,executed:2,pending:2});
  assert.deepEqual(events,['a','b']);
  callbacks.beginFrame();
  assert.equal(context.ed.clientCall_list.length,0);
});
test('frame reset precedes source engine update; callback exceptions propagate',async()=>{
  const{context,callbacks}=await setup(),events=[];
  context.clientCall(()=>events.push('discarded-before-update'));
  context.ed.battleEngine={update(elapsed){events.push(elapsed);context.clientCall(()=>events.push('callback'))}};
  callbacks.updateFrame(.125);
  assert.deepEqual(events,[.125,'callback']);
  context.clientCall(()=>{throw new Error('original callback failure')});
  context.clientCall(()=>events.push('not-executed'));
  assert.throws(()=>callbacks.drainCallbacks(),/original callback failure/);
  assert.equal(context.ed.clientCall_list.length,1);
});
