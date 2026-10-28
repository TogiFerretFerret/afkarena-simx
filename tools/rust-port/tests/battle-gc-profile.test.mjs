import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse} from '@babel/parser';
import {isRootBattleCall,proveBattleGcProfile,battleGcSourceHashes} from '../battle-gc-proof.mjs';
const root='void (__nativeResult=__nativeRun(__nativeRuntime,__nativeWire,20,3,__nativeWallNow,"final"));';
const statement=source=>parse(source,{sourceType:'script'}).program.body[0];
test('only the verified global-root call shape qualifies',()=>{
 assert.equal(isRootBattleCall(statement(root)),true);
 for(const changed of [root.replace('__nativeWire','freshWire()'),root.replace(',20,3,',',1,0,'),root.replace('__nativeResult=','other='),root.replace('void ','')])assert.equal(isRootBattleCall(statement(changed)),false,changed);
 assert.equal(isRootBattleCall(statement('function outer(){'+root+'}')),false);
});
test('partial and changed source profiles never authorize collection',()=>{
 assert.equal(proveBattleGcProfile({units:[]},[]).passed,false);
 const units=battleGcSourceHashes.map((sha256,index)=>({index,sha256}));
 const result=proveBattleGcProfile({units},units.map(()=>Buffer.from('changed')));
 assert.equal(result.passed,false);assert.equal(result.reason,'Unreviewed source profile');
});
