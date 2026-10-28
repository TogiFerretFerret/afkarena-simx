import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';

test('streamed trace checker rejects bit, callback order, count and exit changes',async()=>{
 const directory=await mkdtemp(resolve(tmpdir(),'program-trace-'));
 try{
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),hash=value=>sha(JSON.stringify(value));
  const value={bits:'3ff0000000000000'},snapshot={hash:hash(value),value},state={value:{$boundaryNode:snapshot.hash}};
  const events=['callback:after','battle:completed'].map((kind,sequence)=>({sequence,kind,state,stateHash:hash(state)}));
  const records=[{record:'report',report:{completed:1,elapsedMs:1,battlesPerSecond:1000,hostInputConsumption:{random:2,clock:{consumed:260}}},traceHeader:{rootContract:'primitive-vector-battle-boundaries-v1'},eventCount:2,snapshotCount:1},{record:'snapshot',index:0,snapshot},...events.map((event,index)=>({record:'event',index,event})),{record:'end',events:2,snapshots:1,completed:1}];
  const encode=rows=>Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n'),raw=encode(records),compressed=gzipSync(raw),archive=resolve(directory,'reference.gz');await writeFile(archive,compressed);
  const reference=resolve(directory,'reference.json');await writeFile(reference,JSON.stringify({passed:true,artifacts:[{label:'oracle-stdout',uncompressedBytes:raw.length,uncompressedSha256:sha(raw),chunks:[{file:archive,sha256:sha(compressed),uncompressedSha256:sha(raw),uncompressedBytes:raw.length}]}]}));
  const candidate=resolve(directory,'candidate.ndjson'),output=resolve(directory,'result.json'),tool=resolve(import.meta.dirname,'../check-program-trace.mjs');
  async function check(rows,exitCode=0){await writeFile(candidate,encode(rows));const result=spawnSync(process.execPath,[tool,'--candidate',candidate,'--exit-code',String(exitCode),'--reference',reference,'--output',output],{encoding:'utf8'});assert.ok(result.status===0||result.status===1,result.stderr);return JSON.parse(await readFile(output));}
  assert.equal((await check(records)).passed,true);
  const timing=structuredClone(records);timing[0].report.elapsedMs=2;timing[0].report.battlesPerSecond=500;assert.equal((await check(timing)).passed,true);
  assert.equal((await check(records,1)).passed,false);
  const host=structuredClone(records);host[0].report.hostInputConsumption.clock.consumed=259;assert.equal((await check(host)).passed,false);
  const bits=structuredClone(records);bits[1].snapshot.value.bits='3ff0000000000001';bits[1].snapshot.hash=hash(bits[1].snapshot.value);for(const row of bits)if(row.record==='event'){row.event.state.value.$boundaryNode=bits[1].snapshot.hash;row.event.stateHash=hash(row.event.state);}assert.equal((await check(bits)).passed,false);
  const order=structuredClone(records);order[2].event.kind='battle:completed';order[3].event.kind='callback:after';assert.equal((await check(order)).passed,false);
  const missing=structuredClone(records);missing.splice(3,1);missing[0].eventCount=1;missing.at(-1).events=1;assert.equal((await check(missing)).passed,false);
  assert.equal((await check(records.slice(0,-1))).passed,false);
  assert.equal((await check([...records,records[1]])).passed,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
