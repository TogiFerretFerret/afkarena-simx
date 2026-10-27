import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseExpression } from '@babel/parser';

// Attribution only: consumes committed measurements; never launches a profiler.
const root = resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = {};
async function load(file) {
  const bytes = await readFile(resolve(root, file));
  inputs[file] = sha(bytes);
  return file.endsWith('.json') ? JSON.parse(bytes) : bytes.toString();
}
const profileFile = 'benchmarks/results/2026-10-27T17-53-26.167Z-realistic-5v5-profile.json';
const vectorFile = 'benchmarks/results/2026-10-27T18-39-46.555Z-rust-native-oracle-rust-vectors-warm20.json';
const profile = await load(profileFile), vectors = await load(vectorFile);
const skill = await load('config/skill-cache-specialization.json');
const emitter = await load('tools/emit-native-oracle.mjs');
const sourceFiles = {};
async function functionSource(file, start) {
  const source = sourceFiles[file] ??= await load(file);
  assert.equal(source.slice(start, start + 8), 'function');
  // Try closing braces until Babel accepts exactly one complete expression.
  // This avoids parsing the entire multi-megabyte original module.
  for (let end = source.indexOf('}', start); end >= 0; end = source.indexOf('}', end + 1)) {
    const body = source.slice(start, end + 1);
    try {
      const ast = parseExpression(body);
      assert.equal(ast.type, 'FunctionExpression');
      return { file, start, end: end + 1, sha256: sha(body), bytes: Buffer.byteLength(body) };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error('No complete source function at ' + file + ':' + start);
}
function samples(url, functionName = '') {
  const match = profile.topSourceSelf.find(row => row.url === url && row.functionName === functionName);
  assert.ok(match, 'Missing committed source profile row: ' + url);
  return { file: profileFile, type: 'sample-attribution-not-call-count', ...match };
}
const definitions = [
  {
    name: 'ed.parseUseSkillCacheStageBattle', file: skill.parser.file, start: skill.parser.start,
    observed: samples('src/srcmodule/game_ui_1.js:4500415'),
    opportunity: 'Reuse the proved closure-private parsed Param map for validated immutable tokens; a Rust parser is secondary to eliminating repeated parsing.',
    obligations: [
      'Retain original table and battle-ID reads, parser/intrinsic guards, warning behavior and source function metadata.',
      'Do not expose cached map or alias it with caller state. Unknown grammar, inherited mode collisions and changed parser/intrinsics fall back before effects.',
      'Existing opt-in specialization changes helper identity/text and has not passed a complete ordered battle trace; native lowering must preserve original reflective metadata.'
    ],
    status: '20k source queries already checked in config/skill-cache-specialization.json; not enabled by the current frozen native battle gate.'
  },
  {
    name: 'ed.createDataObj', file: 'src/srcmodule/game_util.js', start: 640811,
    observed: samples('src/srcmodule/game_util.js:640811'),
    opportunity: 'Reduce wrapper, wrap-stack and readonly-array allocations while retaining canonical VM objects; avoid introducing a second mutable Rust world.',
    obligations: [
      'ed.swallowCopyObject is dynamic dispatch. Retain copied graph identity, fresh child arrays, original key order and inherited for-in behavior.',
      'Only the outer copied array receives readonlyArrayProto; nested arrays remain mutable. Immutable sharing is not proved.',
      'wrapTable stores the exact caller override in o, old values in p, and a lock flag. recover(0) selects the latest entry; locked entries stop recovery; undefined restoration creates or retains a property.',
      'Functions, descriptors, prototypes, aliasing, allocation counters and mutation errors remain observable. A Rust representation needs a canonical VM adapter and source identity guards.'
    ],
    status: 'Source overlay regression probes exist; no native replacement or call count established.'
  },
  {
    name: 'ed.Buff.applyPercentValue', file: 'src/srcmodule/game_battle.js', start: 41723,
    observed: samples('src/srcmodule/game_battle.js:37791', 'applyPercentValue'),
    opportunity: 'A guarded callback-free numeric inner loop can use dense ordered attribute slots, retaining VM state as canonical storage.',
    obligations: [
      'Owner attr-lock exemption calls and optional debug hooks are observable. Guard inactive branches or retain exact dispatch and reread mutable state after them.',
      'Snapshot source attrib length once, but read each live attrib element in order. Preserve owner-versus-caster basis choice, ||0 truthiness, named-attribute maps and HPR/MPR exceptions.',
      'Preserve multiply/add order, signed zero, NaN, f64 rounding, sequential writes and alias effects when an earlier attribute write changes a later basis read.',
      'Table Proxy read counters are part of current raw report equivalence: direct slot reads cannot silently replace guarded get operations. Preserve original ordered reads or prove an admitted unproxied domain.',
      'Fallback must happen before effects, or resume at an exact continuation; never restart a partially executed loop.'
    ],
    status: 'Pure Rust attribute references exist; no actual native loop integration or observed call count established.'
  },
  {
    name: 'ed.Unit.buffAttribs', file: 'src/srcmodule/game_battle.js', start: 192868,
    observed: samples('src/srcmodule/game_battle.js:192868'),
    opportunity: 'Coordinate percent and fixed attribute reductions through canonical slots; optimize the callees before attempting to lower orchestration.',
    obligations: [
      'Capture buff_list.length once for both passes. Reread live indexed buffs; list edits during callbacks may cause errors that must remain observable.',
      'Execute every percent application before any fixed application. Preserve beginBuff, applyPercentValue/applyFixedValue, finishBuff ordering and receiver identities.',
      'Overridden buff methods, debug manager changes and callback mutation require dynamic dispatch or exact continuation guards; batching all buffs into an unordered matrix is not proved.'
    ],
    status: 'Hot inclusive subtree, not a callback-free kernel. No call count or safe whole-method replacement established.'
  },
  {
    name: 'ed.Unit.rebuildIdleAttrbs', file: 'src/srcmodule/game_battle.js', start: 191068,
    observed: samples('src/srcmodule/game_battle.js:191068'),
    opportunity: 'Reuse only a proved immutable static prefix; apply dynamic passive, aura, buff, configuration and guild-skill changes in original order.',
    obligations: [
      'The rebuild branch first replaces fixed_attribs with {}, then calls getAttribsByUnit; preserve reentrant visibility and errors.',
      'ed.swallowCopyObject and all five attribute phases are source dispatches; preserve beginDynamic/finishDynamic and live object replacement.',
      'Any cached static contributions need complete source/version/config keys and per-worker mutable overlays. Existing 47x10 Rust precompute reference alone does not prove the remaining dynamic phases.',
      'Retain f64 addition order; reassociation, SIMD or matrix reduction requires a separate execution-equivalence proof.'
    ],
    status: 'Source-proven immutable attribute contribution work exists; no whole-method native replacement or call count established.'
  }
];
const candidates = [];
for (const row of definitions) {
  const { file, start, ...rest } = row;
  const source = await functionSource(file, start);
  if (rest.name === 'ed.parseUseSkillCacheStageBattle') assert.equal(source.sha256, skill.parser.sha256);
  candidates.push({ ...rest, source, observedCallCount: null });
}
const runStart = emitter.indexOf('function __nativeRun(');
const runEnd = emitter.indexOf('\nconst reference=', runStart);
assert.ok(runStart >= 0 && runEnd > runStart);
const report = {
  version: 1, kind: 'source-bound-native-optimization-attribution', qualifiesFor10000Target: false,
  scope: 'Existing single-scenario callback-only measurements; source Node sample percentages are not native costs or call counts. No new profiling, speedup claim, broad corpus qualification or changed simulator behavior.',
  inputs,
  timer: {
    source: { file: 'tools/emit-native-oracle.mjs', start: runStart, end: runEnd, sha256: sha(emitter.slice(runStart, runEnd)) },
    start: 'Immediately before instantiateScenario for measured battle index0, after all requested warmups.',
    included: ['Scenario materialization, BattleEngine allocation and enterBattle', 'Original frame loop and all executed queued callbacks', 'Per-battle result bits, JSON checksum mixing and result allocation', 'All-capture serialization when captureMode=all', 'Any lazy table validation/hash work first reached inside these phases; without warmups this is first-battle cold overhead'],
    excluded: ['Source/VM startup and module/table file loading before __nativeRun', 'Requested warmup battles', 'Final capture when captureMode=final (after elapsedMs is computed)', 'Final class-manager assertion, table assertClean/stats, trace.stop and host-tape finish checks after timer', 'Process shutdown and report JSON serialization'],
    caveat: 'Warming3 runs moves reached lazy validation outside the measured20; it does not remove hot Proxy gets, mutation hashing, observers or diagnostic checks executed during those20.'
  },
  diagnosticOverhead: [
    { name: 'Table membranes and mutable-table Merkle tracking', evidence: 'benchmarks/validation/table-proxy-get-profile-native.json', contract: 'Retain private get counters and mutation hashes in fidelity reports; source observed behavior is not permission to delete validation from benchmark candidates.' },
    { name: 'Full-state exporter', evidence: 'benchmarks/profiles/2026-10-27-trace-exporter.md', contract: 'Recorder serialization/snapshot/encoding/GC dominate the separate traced profile. Current warm23 capture=final does not execute a full snapshot at every event. Do not use trace-profile percentages as warm23 mechanics attribution.' },
    { name: 'Diagnostic SHA256', evidence: 'benchmarks/validation/native-diagnostic-sha256.json', contract: 'Already has a guarded private native host path. Its isolated string hash speed is not a battle speedup.' }
  ],
  alreadyObservedNativeKernels: {
    evidence: vectorFile, measuredBattles: vectors.completed,
    countedScope: 'Counters span process warmups and measured runs; do not divide by measured battle count without subtracting warmup counts.',
    exactHitCounts: { compareFloat: vectors.rustCalls, ...vectors.vectorHits },
    sourceBindings: { compareFloat: vectors.originalKernel, vectors: vectors.vectorKernels },
    status: 'Historical guarded native integration. These counts support prioritization but do not establish current warm23 speed or full-scene qualification.'
  },
  coordinatedElsewhere: ['Entity.update mutable canonical VM integration', 'ed.copyObj guarded numeric-object and empty-array copies', 'V8-compatible Rust TimSort'],
  candidates
};
await writeFile(resolve(root, 'benchmarks/validation/native-hotspot-map.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sourceBoundCandidates: candidates.length, measuredNativeDistanceCalls: vectors.vectorHits.distance_squared, newProfilesRun: 0, qualifiesFor10000Target: false }));
