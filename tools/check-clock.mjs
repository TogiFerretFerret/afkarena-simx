import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { bits,fromBits } from './rng-trace.mjs';

const root=resolve(import.meta.dirname,'..');
export async function loadClockSource(){
  const metadata=JSON.parse(await readFile(resolve(root,'config/clock-translation.json'),'utf8'));
  const file=await readFile(resolve(root,metadata.source),'utf8');
  const source=file.slice(metadata.start,metadata.end);
  assert.equal(createHash('sha256').update(source).digest('hex'),metadata.sha256,'Stale local-clock source coordinates');
  return{metadata,source};
}
export function createClockOracle(source){
  const update=runInNewContext(`(${source})`);
  return input=>{
    let next_tick=fromBits(input.next_tick),tick_interval=fromBits(input.tick_interval),callback_count=0;
    const events=[];
    const snapshot=kind=>events.push({kind,next_tick:bits(next_tick),tick_interval:bits(tick_interval)});
    const clock={tick(){
      callback_count++;snapshot('callback_enter');
      if(input.mode&1)this.next_tick=fromBits(input.next_mutation);
      if(input.mode&2)this.tick_interval=fromBits(input.interval_mutation);
      snapshot('callback_return');
    }};
    Object.defineProperties(clock,{
      next_tick:{get(){return next_tick},set(value){next_tick=value;snapshot('next_tick_write')}},
      tick_interval:{get(){return tick_interval},set(value){tick_interval=value;snapshot('tick_interval_write')}},
    });
    snapshot('enter');
    assert.equal(update.call(clock,fromBits(input.elapsed)),undefined);
    snapshot('return');
    return{events,callback_count};
  };
}
export function compareClockTrace(expected,actual,{nanPolicy='semantic'}={}){
  if(!['bits','semantic'].includes(nanPolicy))throw new Error('Unknown NaN policy');
  if(expected.callback_count!==actual.callback_count)return{match:false,reason:'callback_count'};
  if(!Array.isArray(actual.events)||expected.events.length!==actual.events.length)return{match:false,reason:'event_count'};
  let nanBitDifferences=0;
  for(let index=0;index<expected.events.length;index++)for(const field of['kind','next_tick','tick_interval']){
    const e=expected.events[index][field],a=actual.events[index][field];
    if(e===a)continue;
    if(field!=='kind'&&nanPolicy==='semantic'&&/^[0-9a-f]{16}$/.test(a)&&Number.isNaN(fromBits(e))&&Number.isNaN(fromBits(a))){nanBitDifferences++;continue;}
    return{match:false,reason:'event_field',index,field,expected:e,actual:a};
  }
  return{match:true,nanBitDifferences};
}
export function clockCases(){
  const make=(next,interval,elapsed,mode=0,nextMutation=0,intervalMutation=.125)=>({next_tick:bits(next),tick_interval:bits(interval),elapsed:bits(elapsed),mode,next_mutation:bits(nextMutation),interval_mutation:bits(intervalMutation)});
  const cases=[make(0,.125,1),make(0,.1,.2),make(0,.1,.3),make(.125,.125,0),make(.125,.125,.125),make(-0,.125,0),make(0,Number.MIN_VALUE,0),
    make(0,.125,.5,3,-.2,.1),make(0,-0,0,1,1),make(0,0,0,1,NaN),make(-1,Infinity,0),make(-1,NaN,0),make(Infinity,0,1),make(-Infinity,.125,0,1,0),make(0,.125,NaN)];
  const special=[0,-0,1,-1,Infinity,-Infinity,NaN,Number.MAX_VALUE,-Number.MAX_VALUE,Number.MIN_VALUE,-Number.MIN_VALUE];
  for(const x of special)for(const y of special)cases.push(make(x,.125,y,3,0,.125));
  let state=0x9e3779b97f4a7c15n;
  const nextBits=()=>{state^=state<<13n;state=BigInt.asUintN(64,state);state^=state>>7n;state^=state<<17n;state=BigInt.asUintN(64,state);return state;};
  for(let i=0;i<10000;i++){
    const next=(Number(nextBits()&1023n)-512)/128,elapsed=Number(nextBits()&1023n)/128,interval=(1+Number(nextBits()&255n))/256;
    cases.push(make(next,interval,elapsed));
    // Arbitrary binary64 initial state and elapsed: the callback resets any
    // taken branch to zero with a positive/NaN interval, bounding the loop.
    const rawNext=fromBits(nextBits().toString(16)),rawElapsed=fromBits(nextBits().toString(16));
    let intervalBits=nextBits()&0x7fffffffffffffffn;
    if(intervalBits===0n)intervalBits=1n;
    cases.push(make(rawNext,.125,rawElapsed,3,0,fromBits(intervalBits.toString(16))));
  }
  return cases;
}
async function main(){
  if(!process.argv[2])throw new Error('Usage: node tools/check-clock.mjs BINARY [--strict-bits]');
  const nanPolicy=process.argv.includes('--strict-bits')?'bits':'semantic';
  const{metadata,source}=await loadClockSource();
  const oracle=createClockOracle(source),cases=clockCases();
  const result=spawnSync(resolve(process.argv[2]),[],{input:cases.map(c=>[c.next_tick,c.tick_interval,c.elapsed,c.mode,c.next_mutation,c.interval_mutation].join(' ')).join('\n')+'\n',encoding:'utf8',maxBuffer:128*1024*1024});
  if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);
  const lines=result.stdout.trim().split('\n');assert.equal(lines.length,cases.length);
  let eventCount=0,callbackCount=0,nanBitDifferences=0;
  for(let index=0;index<cases.length;index++){
    const expected=oracle(cases[index]),actual=JSON.parse(lines[index]),comparison=compareClockTrace(expected,actual,{nanPolicy});
    if(!comparison.match){
      await mkdir(resolve(root,'work'),{recursive:true});
      await writeFile(resolve(root,'work/clock-first-divergence.json'),JSON.stringify({caseIndex:index,input:cases[index],nanPolicy,comparison,expected,actual},null,2)+'\n');
      assert.fail(`Clock diverged at case ${index}; see work/clock-first-divergence.json`);
    }
    eventCount+=expected.events.length;callbackCount+=expected.callback_count;nanBitDifferences+=comparison.nanBitDifferences;
  }
  const summary={version:1,sourceSha256:metadata.sha256,referenceRuntime:process.version,cases:cases.length,eventCount,callbackCount,nanPolicy,nanBitDifferences,rawBitsExact:nanBitDifferences===0,scope:'Local clock scheduling and callback mutation; no full battle execution'};
  await mkdir(resolve(root,'work'),{recursive:true});
  await writeFile(resolve(root,'work/clock-summary.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
