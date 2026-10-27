import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePortableBattleTraces} from '../battle-trace-portable.mjs';
import {checkArchivedNativeTrace} from '../check-archived-native-trace.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';

const compact=()=>({version:1,status:'completed',rootContract:'ed-cc-source-globals',graphHash:'sha256-merkle-v1',events:[{sequence:0,kind:'battle:completed',stateHash:'a'.repeat(64)}]});
test('ordered trace gate rejects missing captures even when both reports omit them',()=>{
 for(const mutate of [t=>delete t.events[0].stateHash,t=>t.events[0].stateHash='bad',t=>t.graphHash='future-protocol',t=>{t.graphHash=null;delete t.events[0].stateHash;}]){
  const report=compact();mutate(report);
  const gate=comparePortableBattleTraces(report,structuredClone(report));
  assert.equal(gate.passed,false);
  assert.equal(gate.qualifiesForThroughputTarget,false);
 }
 assert.equal(comparePortableBattleTraces(compact(),compact()).passed,true);
});

test('archive gate binds compressed bytes and rejects incomplete replay independently of state',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'simx-trace-gate-'));
 try{
  const reference={completed:1,trace:compact(),elapsedMs:10};
  const candidate={...reference,elapsedMs:20,hostInputConsumption:{random:2,clock:{consumed:3,total:3,attempts:3,mode:'replay',remaining:0,finished:true,failure:null}}};
  const source=join(dir,'source.stdout.gz'),native=join(dir,'native.stdout.gz'),metadata=join(dir,'metadata.json');
  await writeFile(source,gzipSync('progress\n'+JSON.stringify(reference)+'\n'));
  await writeFile(native,gzipSync(JSON.stringify(candidate)+'\n'));
  await writeFile(metadata,JSON.stringify({hostInputs:{randomCount:2,clockCount:3}}));
  const gate=await checkArchivedNativeTrace(source,native,metadata);
  assert.equal(gate.passed,true);assert.match(gate.candidate.sha256,/^[a-f0-9]{64}$/);
  candidate.hostInputConsumption.clock.remaining=1;
  await writeFile(native,gzipSync(JSON.stringify(candidate)+'\n'));
  const failed=await checkArchivedNativeTrace(source,native,metadata);
  assert.equal(failed.passed,false);assert.equal(failed.traceGate.passed,true);assert.ok(failed.hostInputDifference);
 }finally{await rm(dir,{recursive:true,force:true});}
});
