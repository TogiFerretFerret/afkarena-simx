import assert from 'node:assert/strict';

export function perfTimestampNs(text,{requireNanoseconds=false}={}){
 const match=/^(\d+)\.(\d{1,9})$/.exec(text);assert.ok(match,'Invalid perf decimal timestamp');
 if(requireNanoseconds)assert.equal(match[2].length,9,'Measured profile requires perf script --ns precision');
 return BigInt(match[1])*1000000000n+BigInt(match[2].padEnd(9,'0'));
}

export function measuredPerfWindow(profile,stderr){
 assert.equal(profile.markerClock,'CLOCK_MONOTONIC');
 assert.equal(profile.perfClockId,'mono');
 assert.ok(profile.args.includes('--clockid')&&profile.args[profile.args.indexOf('--clockid')+1]==='mono','Recorded perf clock must be mono');
 assert.ok(profile.reports.find(row=>row.label==='stacks')?.args.includes('--ns'),'Perf script must preserve nanoseconds');
 assert.equal(profile.measuredWindow?.calls,2);assert.equal(profile.measuredWindow?.valid,true);
 const markers=[...stderr.matchAll(/^simx_measure_(start|end)_ns:(\d+)$/gm)];
 assert.equal(markers.length,2,'Exactly two timing marker lines required');
 assert.equal((stderr.match(/simx_measure_[a-z]+_ns:/g)||[]).length,2,'Malformed/additional marker rejected');
 assert.deepEqual(markers.map(row=>row[1]),['start','end'],'Timing marker order');
 const startNs=BigInt(markers[0][2]),endNs=BigInt(markers[1][2]);
 assert.ok(startNs>=0n&&endNs>startNs&&endNs<=(1n<<64n)-1n,'Invalid timing marker interval');
 assert.equal(startNs.toString(),profile.measuredWindow.startNs);assert.equal(endNs.toString(),profile.measuredWindow.endNs);
 return{startNs,endNs};
}

export function withinMeasuredWindow(timeNs,window){
 return timeNs>=window.startNs&&timeNs<window.endNs;
}
