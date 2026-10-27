import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {compareHostInputConsumption} from './native-report-compare.mjs';

const root = resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function read(file) { return readFile(resolve(root, file)); }
async function proof(file) { const bytes = await read(file); return {file, sha256: sha(bytes), value: JSON.parse(bytes)}; }
const source = await proof('benchmarks/results/2026-10-27T23-15-36.402Z-boundary-source-reference.json');
const native = await proof('benchmarks/results/2026-10-27T23-49-07.298Z-boundary-optimized-native.json');
const replay = await proof('benchmarks/validation/battle-boundary-archive-replay.json');
for (const p of [source, native, replay]) assert.equal(p.value.passed, true);
assert.equal(native.value.sourceArchive.sha256, source.sha256);
assert.equal(replay.value.source.sha256, source.sha256);
assert.equal(replay.value.native.sha256, native.sha256);
const moduleBindings = [];
for (const p of [source, native]) for (const binding of p.value.modules) {
  assert.equal(sha(await read(binding.file)), binding.sha256, binding.file);
  moduleBindings.push(binding);
}
const small = new Map(); let chunksChecked = 0, rawBytesChecked = 0;
// Hash one decompressed chunk at a time. Never parse or retain the large traces.
let nativeHeader;
for (const p of [source, native]) for (const artifact of p.value.artifacts) {
  const aggregate = createHash('sha256'); let bytes = 0; const retained = [];
  for (const chunk of artifact.chunks) {
    const compressed = await read(chunk.file);
    assert.equal(sha(compressed), chunk.sha256, chunk.file);
    assert.equal(compressed.length, chunk.bytes);
    const raw = gunzipSync(compressed);
    assert.equal(raw.length, chunk.uncompressedBytes);
    assert.equal(sha(raw), chunk.uncompressedSha256);
    aggregate.update(raw); bytes += raw.length; chunksChecked++;
    if (artifact.uncompressedBytes < 1024 * 1024) retained.push(raw);
    if (artifact.label === 'native-traced' && !nativeHeader) {
      const line = raw.toString('utf8').split('\n').find(line => line.startsWith('{"record":"report"'));
      if (line) nativeHeader = JSON.parse(line);
    }
  }
  assert.equal(bytes, artifact.uncompressedBytes);
  assert.equal(aggregate.digest('hex'), artifact.uncompressedSha256);
  rawBytesChecked += bytes;
  if (retained.length) small.set(artifact.label, Buffer.concat(retained));
}
const execution = JSON.parse(small.get('native-execution'));
const build = JSON.parse(small.get('native-fast-build'));
const plain = JSON.parse(small.get('source-untraced'));
const sourceProof = JSON.parse(small.get('source-proof'));
const tape = JSON.parse(small.get('host-inputs'));
assert.equal(sha(small.get('native-execution')), native.value.nativeExecution.sha256);
assert.equal(sha(small.get('native-fast-build')), execution.build.sha256);
assert.deepEqual(execution.execution, {code: 0, signal: null});
assert.ok(execution.dependenciesAtFinish.length > 0);
for (const row of execution.dependenciesAtFinish) assert.equal(row.matched, true);
assert.equal(build.serializer.sha256, moduleBindings.find(row => row.file === 'tools/battle-boundary-ndjson.mjs').sha256);
const expectedInputs = {randomCount: tape.random.length, clockCount: tape.clock.length};
assert.deepEqual(expectedInputs, {randomCount: 2, clockCount: 260});
for (const report of [plain, nativeHeader.report]) assert.equal(compareHostInputConsumption(report.hostInputConsumption, expectedInputs), null);
assert.equal(sourceProof.hostInputs.randomCount, expectedInputs.randomCount);
assert.equal(sourceProof.hostInputs.clockCount, expectedInputs.clockCount);
const stderr = small.get('native-stderr').toString('utf8');
for (const [name, field] of [['entity_hits','entity'], ['copy_hits','copy'], ['empty_copy_hits','emptyCopy'], ['numeric_copy_hits','numericCopy'], ['sort_hits','sort'], ['sort_fallbacks','sortUnsupportedFallbacks']]) {
  const rows = [...stderr.matchAll(new RegExp('^' + name + ':(\\d+)$', 'gm'))];
  assert.equal(rows.length, 1); assert.equal(Number(rows[0][1]), native.value.fastPathHits[field]);
}
for (const [prefix, field] of [['global_slot_cache:', 'globalSlotCache'], ['global_slot_lifecycle:', 'globalSlotLifecycle'], ['global_ed_prefilter_active:', 'prefilterActive'], ['global_ed_prefilter:', 'prefilterCleared']]) {
  const rows = stderr.split('\n').filter(line => line.startsWith(prefix)); assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].slice(prefix.length)), native.value[field]);
}
for (const field of ['sourceTerminalReportMatched', 'nativeTerminalReportMatched', 'orderedEventStateMatched', 'strictSnapshotSchemaMatched', 'fastPathsObserved', 'runtimeLifecycleMatched']) assert.equal(native.value[field], true);
assert.equal(native.value.events, 64419); assert.equal(native.value.sourceSnapshotNodes, 55078);
assert.equal(nativeHeader.eventCount, 64419); assert.equal(nativeHeader.snapshotCount, 55078);
for (const p of [native.value, replay.value]) { assert.equal(p.completeProgramRootContract, false); assert.equal(p.qualifiesFor10000Target, false); }
assert.equal(replay.value.ordered.eventsCompared, 64419);
const bindings = [];
for (const file of ['tools/review-battle-boundary-final-provenance.mjs', 'tools/check-battle-boundary-archive.mjs', 'tools/native-report-compare.mjs']) bindings.push({file, sha256: sha(await read(file))});
const result = {
  version: 1, passed: true,
  scope: 'Independent lightweight provenance review of completed native and archive-replay proofs. Rehashes all committed compressed and raw chunks incrementally, binds current modules, validates archived execution/build and actual fast-path/lifecycle counters, and separately checks exact host tape exhaustion in source/plain and native header. Does not repeat the large ordered-state parse; ordered equality relies on the SHA-bound completed collector and archive replay.',
  source: {file: source.file, sha256: source.sha256}, native: {file: native.file, sha256: native.sha256}, replay: {file: replay.file, sha256: replay.sha256},
  chunksChecked, rawBytesChecked, moduleBindingsChecked: moduleBindings.length,
  nativeExecutionExit: execution.execution, nativeInputBindingsMatched: execution.dependenciesAtFinish.length,
  exactHostInputs: expectedInputs, hostInputConsumptionMatched: true, stderrCountersMatched: true,
  reportedOrderedEvents: 64419, reportedSnapshotNodes: 55078,
  orderedStateReparsedByThisReview: false,
  limitations: ['One frozen callback-only battle; selected own enumerable string-keyed data fields, numeric vectors and payloads only.', 'No full-program graph, arbitrary nested/prototype/closure/weak state, actor/effect/view lifecycle, random-corpus or throughput qualification.', 'The archive replay checks semantic reports through a comparator that excludes timing and hostInputConsumption; this review separately validates the latter against the committed exact replay tape.'],
  completeProgramRootContract: false, qualifiesFor10000Target: false, bindings,
};
const output = 'benchmarks/validation/battle-boundary-final-provenance-review.json';
await writeFile(resolve(root, output), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({passed: true, output, chunksChecked, rawBytesChecked}));
