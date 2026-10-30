import assert from 'node:assert/strict';
// Totals include startup and warmup; only the delta between source wall markers
// can establish that the optimization ran during the measured battles.
export function parseNestedCopyWindow(stderr,{required=false}={}) {
 const lines=stderr.split('\n').filter(line=>line.startsWith('NESTED_COPY_WINDOW:'));
 if(!lines.length){assert.equal(required,false,'Missing measured nested-copy window');return null;}
 assert.equal(lines.length,1,'Expected one measured nested-copy window');
 const match=/^NESTED_COPY_WINDOW:(\d+):(\d+):(\d+):(\d+):(true|false):(true|false)$/.exec(lines[0]);
 assert.ok(match,'Malformed measured nested-copy counters');
 const [startupAttempts,startupHits,attempts,hits]=match.slice(1,5).map(Number);
 assert.ok([startupAttempts,startupHits,attempts,hits].every(Number.isSafeInteger),'Unsafe counter value');
 assert.ok(startupHits<=startupAttempts&&hits<=attempts,'Hits exceed attempts');
 const enabledAtStart=match[5]==='true',enabledAtEnd=match[6]==='true';
 const eligibleForPerformanceCredit=enabledAtStart&&enabledAtEnd&&hits>0;
 return {startupAttempts,startupHits,attempts,hits,enabledAtStart,enabledAtEnd,
  exercised:hits>0,eligibleForPerformanceCredit,
  status:eligibleForPerformanceCredit?'exercised':!enabledAtStart||!enabledAtEnd?'disabled':'unexercised',
  scope:'Host counters between the two original measured wall-clock calls; startup and three warmups excluded. Positive admission proves exercise, not a causal speedup.'};
}
