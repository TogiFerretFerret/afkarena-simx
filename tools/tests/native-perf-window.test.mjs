import test from 'node:test';
import assert from 'node:assert/strict';
import {perfTimestampNs,measuredPerfWindow,withinMeasuredWindow} from '../native-perf-window.mjs';
const profile=()=>({markerClock:'CLOCK_MONOTONIC',perfClockId:'mono',args:['record','--clockid','mono'],reports:[{label:'stacks',args:['script','--ns']}],measuredWindow:{calls:2,valid:true,startNs:'9007199254740993',endNs:'9007199254740995'}});
const markers='simx_measure_start_ns:9007199254740993\nsimx_measure_end_ns:9007199254740995\n';
test('timestamp conversion retains individual ns beyond Number integer precision',()=>{
 assert.equal(perfTimestampNs('9007199.254740993',{requireNanoseconds:true}),9007199254740993n);
 assert.equal(perfTimestampNs('1.123456'),1123456000n);
 for(const text of ['1.123456','1.1234567890','-1.123456789','NaN','1e3'])assert.throws(()=>perfTimestampNs(text,{requireNanoseconds:true}));
});
test('window is exact half-open start inclusive end exclusive',()=>{
 const window=measuredPerfWindow(profile(),markers);
 assert.equal(withinMeasuredWindow(9007199254740992n,window),false);
 assert.equal(withinMeasuredWindow(9007199254740993n,window),true);
 assert.equal(withinMeasuredWindow(9007199254740994n,window),true);
 assert.equal(withinMeasuredWindow(9007199254740995n,window),false);
});
test('missing duplicate reversed malformed or third markers fail closed',()=>{
 for(const text of ['',markers.split('\n')[0],markers+markers,markers.split('\n').reverse().join('\n'),markers+'simx_measure_extra_ns:7\n',markers.replace('9007199254740995','bad')])assert.throws(()=>measuredPerfWindow(profile(),text));
});
test('clock domains, timestamp precision declaration and report marker identities must match',()=>{
 const variants=[p=>p.markerClock='CLOCK_REALTIME',p=>p.perfClockId='mono_raw',p=>p.args=['record'],p=>p.reports[0].args=['script'],p=>p.measuredWindow.calls=3,p=>p.measuredWindow.valid=false,p=>p.measuredWindow.endNs='9007199254740996'];
 for(const mutate of variants){const p=profile();mutate(p);assert.throws(()=>measuredPerfWindow(p,markers));}
});
