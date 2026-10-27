import test from 'node:test';
import assert from 'node:assert/strict';
import { bits } from '../rng-trace.mjs';
import { loadClockSource,createClockOracle,compareClockTrace } from '../check-clock.mjs';
const{source}=await loadClockSource();
const oracle=createClockOracle(source);
const input=(next,interval,elapsed,mode=0,nextMutation=0,intervalMutation=.125)=>({next_tick:bits(next),tick_interval:bits(interval),elapsed:bits(elapsed),mode,next_mutation:bits(nextMutation),interval_mutation:bits(intervalMutation)});

test('late update calls tick once and records each repeated addition',()=>{
  const result=oracle(input(0,.125,1));
  assert.equal(result.callback_count,1);
  const writes=result.events.filter(e=>e.kind==='next_tick_write');
  assert.equal(writes.length,10);
  assert.equal(writes[0].next_tick,bits(-1));
  assert.equal(result.events.at(-1).next_tick,bits(.125));
});
test('callback mutations precede and affect repeated additions',()=>{
  const result=oracle(input(0,.125,.5,3,-.2,.1));
  assert.deepEqual(result.events.slice(0,6).map(e=>e.kind),['enter','next_tick_write','callback_enter','next_tick_write','tick_interval_write','callback_return']);
  assert.equal(result.events.at(-1).next_tick,bits(.1));
});
test('NaN comparison skips callback while negative zero enters it',()=>{
  assert.equal(oracle(input(0,.125,NaN)).callback_count,0);
  assert.equal(oracle(input(-0,.125,0)).callback_count,1);
});
test('trace comparison detects hidden repeated-add changes and signed-zero writes',()=>{
  const expected=oracle(input(0,.125,1));
  const actual=structuredClone(expected);actual.events[5].next_tick=bits(-0);
  assert.equal(compareClockTrace(expected,actual).match,false);
  const missing=structuredClone(expected);missing.events.splice(5,1);
  assert.equal(compareClockTrace(expected,missing).reason,'event_count');
});
