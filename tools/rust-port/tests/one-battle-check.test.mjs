import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {compareOneBattleReports,runMonitored} from '../one-battle-check-support.mjs';

test('one-battle comparison omits exactly two timing fields',()=>{
 const expected={completed:1,elapsedMs:10,battlesPerSecond:100,results:[{rngBits:'7ff8000000000001',callbacks:7}],hostInputConsumption:{random:2}};
 assert.equal(compareOneBattleReports({...expected,elapsedMs:20,battlesPerSecond:50},expected),null);
 for(const actual of [{...expected,completed:0},{...expected,results:[{rngBits:'7ff8000000000002',callbacks:7}]},{...expected,results:[{rngBits:'7ff8000000000001',callbacks:6}]},{...expected,hostInputConsumption:{random:1}},{...expected,extra:true}])assert.notEqual(compareOneBattleReports(actual,expected),null);
});

test('child monitor retains output and enforces timeout/RSS limits',async()=>{
 const work=await mkdtemp(resolve(tmpdir(),'one-battle-monitor-'));
 try{
  const options={cwd:work,env:process.env,stdoutFile:resolve(work,'stdout'),stderrFile:resolve(work,'stderr'),pollMs:10,timeoutMs:5000};
  const complete=await runMonitored([process.execPath,'-e','console.log("report");console.error("diagnostic");process.exitCode=1'],options);
  assert.equal(complete.status,1);assert.equal(complete.termination,null);assert.match(await readFile(options.stdoutFile,'utf8'),/report/);assert.match(await readFile(options.stderrFile,'utf8'),/diagnostic/);
  const timeout=await runMonitored([process.execPath,'-e','setInterval(()=>{},1000)'],{...options,timeoutMs:100});
  assert.equal(timeout.termination?.reason,'timeout');assert.notEqual(timeout.status,0);
  const rss=await runMonitored([process.execPath,'-e','setInterval(()=>{},1000)'],{...options,maxRssKiB:1});
  assert.equal(rss.termination?.reason,'rss-limit');assert.ok(rss.peakRssKiB>1);assert.notEqual(rss.status,0);
 }finally{await rm(work,{recursive:true,force:true});}
});
