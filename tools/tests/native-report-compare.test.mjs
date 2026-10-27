import test from 'node:test';
import assert from 'node:assert/strict';
import {compareNativeReports,compareHostInputConsumption} from '../native-report-compare.mjs';
const reference={completed:1,elapsedMs:10,battlesPerSecond:100,capture:'final',checksum:'ab',totalCallbacks:2,results:[{result:'victory',ticks:12}],finalCapture:{state:{hp:'0000000000000000'},events:['callback']}};
test('all semantic fields match while timing can differ',()=>assert.equal(compareNativeReports({...reference,elapsedMs:20,battlesPerSecond:50},reference),null));
test('corrupted finalCapture fails even when summaries match',()=>{const candidate=structuredClone(reference);candidate.finalCapture.state.hp='8000000000000000';assert.equal(compareNativeReports(candidate,reference).path,'$.finalCapture.state.hp');});
test('callbacks, checksum and complete trace are compared',()=>{for(const key of ['totalCallbacks','checksum']){const candidate=structuredClone(reference);candidate[key]='corrupt';assert.equal(compareNativeReports(candidate,reference).path,'$.'+key);}assert.ok(compareNativeReports({...reference,trace:{events:[]}},reference));});
test('host input tape must be entirely consumed successfully',()=>{const stats={random:2,clock:{consumed:3,total:3,attempts:3,mode:'replay',remaining:0,finished:true,failure:null}};assert.equal(compareHostInputConsumption(stats,{randomCount:2,clockCount:3}),null);assert.ok(compareHostInputConsumption({...stats,random:1},{randomCount:2,clockCount:3}));assert.ok(compareHostInputConsumption({...stats,clock:{...stats.clock,remaining:1}},{randomCount:2,clockCount:3}));});
