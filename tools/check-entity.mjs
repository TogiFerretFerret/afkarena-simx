import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { staticName } from './source-index.mjs';
import { bits, fromBits } from './rng-trace.mjs';

const root = resolve(import.meta.dirname, '..');

export function instrumentEntity(source) {
  const ast = parse(`(${source})`);
  const wrapped = new WeakSet();
  const writes = [];
  traverse(ast, {
    AssignmentExpression: { exit(path) {
      if (wrapped.has(path.node)) return;
      const target = staticName(path.node.left);
      const kind = target === 't.0' ? 'position_x_write' : target === 't.1' ? 'position_y_write' : target === 'this.direction' ? 'direction_write' : null;
      if (!kind) throw new Error(`Unexpected Entity.update write: ${target}`);
      writes.push(kind);
      wrapped.add(path.node);
      path.replaceWith({ type: 'CallExpression', callee: { type: 'Identifier', name: '__entityWrite' },
        arguments: [{ type: 'StringLiteral', value: kind }, path.node] });
      path.skip();
    } },
  });
  assert.deepEqual(writes, ['position_x_write', 'position_y_write', 'direction_write']);
  return generate(ast).code;
}

export async function loadEntitySource() {
  const metadata = JSON.parse(await readFile(resolve(root, 'config/entity-translation.json'), 'utf8'));
  const file = await readFile(resolve(root, metadata.source), 'utf8');
  const source = file.slice(metadata.start, metadata.end);
  assert.equal(createHash('sha256').update(source).digest('hex'), metadata.sha256, 'Stale Entity.update source coordinates');
  return { metadata, source };
}

export function createEntityOracle(source, { instrumented = true } = {}) {
  let currentSnapshot;
  const update = runInNewContext(instrumented ? instrumentEntity(source) : `(${source})`, {
    __entityWrite: (kind, value) => { currentSnapshot(kind); return value; },
  });
  return input => {
  const vectors = input.vectors.map(vector => [fromBits(vector[0]), fromBits(vector[1])]);
  assert.ok(Number.isInteger(input.position) && input.position >= 0 && input.position < vectors.length);
  assert.ok(Number.isInteger(input.velocity) && input.velocity >= 0 && input.velocity < vectors.length);
  const entity = { position: vectors[input.position], velocity: vectors[input.velocity], direction: fromBits(input.direction) };
  const events = [];
  function snapshot(kind) {
    events.push({ kind, direction: bits(entity.direction), position: input.position, velocity: input.velocity,
      vectors: vectors.map(vector => [bits(vector[0]), bits(vector[1])]) });
  }
  currentSnapshot = snapshot;
  snapshot('enter');
  const result = update.call(entity, fromBits(input.dt));
  assert.equal(result, undefined);
  assert.equal(entity.position, vectors[input.position]);
  assert.equal(entity.velocity, vectors[input.velocity]);
  snapshot('return');
  currentSnapshot = null;
  return { events };
  };
}

export function entityOracle(source, input, options) {
  return createEntityOracle(source, options)(input);
}

export function compareEntityTrace(expected, actual, { nanPolicy = 'semantic' } = {}) {
  if (!['semantic', 'bits'].includes(nanPolicy)) throw new Error('Unknown NaN policy');
  if (!Array.isArray(actual?.events)) return { match: false, reason: 'missing_events' };
  if (expected.events.length !== actual.events.length) return { match: false, reason: 'event_count', expected: expected.events.length, actual: actual.events.length };
  let nanBitDifferences = 0;
  const compareBits = (a, b) => {
    if (a === b) return true;
    if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return false;
    if (nanPolicy === 'semantic' && Number.isNaN(fromBits(a)) && Number.isNaN(fromBits(b))) { nanBitDifferences++; return true; }
    return false;
  };
  for (let index = 0; index < expected.events.length; index++) {
    const e = expected.events[index], a = actual.events[index];
    for (const field of ['kind', 'position', 'velocity']) if (e[field] !== a[field]) return { match: false, reason: 'event_field', index, field, expected: e[field], actual: a[field] };
    if (!compareBits(e.direction, a.direction)) return { match: false, reason: 'event_field', index, field: 'direction', expected: e.direction, actual: a.direction };
    if (!Array.isArray(a.vectors) || e.vectors.length !== a.vectors.length) return { match: false, reason: 'arena_length', index };
    for (let v = 0; v < e.vectors.length; v++) {
      if (!Array.isArray(a.vectors[v]) || a.vectors[v].length !== 2) return { match: false, reason: 'vector_shape', index, vector: v };
      for (let component = 0; component < 2; component++) if (!compareBits(e.vectors[v][component], a.vectors[v][component])) {
        return { match: false, reason: 'vector_bits', index, vector: v, component, expected: e.vectors[v][component], actual: a.vectors[v][component] };
      }
    }
  }
  return { match: true, nanBitDifferences };
}

export function entityCases() {
  const cases = [];
  const make = (position, velocity, direction, dt, vectors) => ({ position, velocity, direction: bits(direction), dt: bits(dt), vectors: vectors.map(v => v.map(bits)) });
  const special = [0, -0, 1, -1, .125, -.125, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE,
    -Number.MAX_VALUE, Infinity, -Infinity, NaN, 2 ** -1022, 2 ** 500, 2 ** -500];
  for (const x of special) for (const y of special) {
    cases.push(make(0, 1, -1, .125, [[x, y], [y, x], [11, -22]]));
    cases.push(make(0, 0, 1, .125, [[x, y], [11, -22]]));
    cases.push(make(1, 0, x, y, [[y, x], [x, y], [11, -22]]));
  }
  let state = 0x9e3779b97f4a7c15n;
  const next = () => { state ^= state << 13n; state = BigInt.asUintN(64, state); state ^= state >> 7n; state ^= state << 17n; state = BigInt.asUintN(64, state); return fromBits(state.toString(16)); };
  for (let i = 0; i < 20000; i++) {
    const count = 1 + i % 4, position = i % count, velocity = i % 3 === 0 ? position : (position + 1) % count;
    const vectors = Array.from({ length: count }, () => [next(), next()]);
    cases.push(make(position, velocity, i % 2 ? -1 : next(), i % 2 ? .125 : next(), vectors));
  }
  return cases;
}

async function main() {
  const binary = process.argv[2];
  if (!binary) throw new Error('Usage: node tools/check-entity.mjs BINARY [--strict-bits]');
  const nanPolicy = process.argv.includes('--strict-bits') ? 'bits' : 'semantic';
  const { metadata, source } = await loadEntitySource();
  const cases = entityCases();
  const result = spawnSync(resolve(binary), [], { input: cases.map(c => [c.position, c.velocity, c.direction, c.dt, ...c.vectors.flat()].join(' ')).join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, cases.length);
  let eventCount = 0, nanBitDifferences = 0;
  const oracle = createEntityOracle(source);
  for (let index = 0; index < cases.length; index++) {
    const expected = oracle(cases[index]);
    const actual = JSON.parse(lines[index]);
    const comparison = compareEntityTrace(expected, actual, { nanPolicy });
    if (!comparison.match) {
      await mkdir(resolve(root, 'work'), { recursive: true });
      await writeFile(resolve(root, 'work/entity-first-divergence.json'), JSON.stringify({ caseIndex: index, input: cases[index], nanPolicy, comparison, expected, actual }, null, 2) + '\n');
      assert.fail(`Entity trace diverged at case ${index}; see work/entity-first-divergence.json`);
    }
    eventCount += expected.events.length;
    nanBitDifferences += comparison.nanBitDifferences;
  }
  const summary = { version: 1, sourceName: metadata.sourceName, sourceSha256: metadata.sha256,
    referenceRuntime: process.version, cases: cases.length, eventCount, nanPolicy, nanBitDifferences,
    rawBitsExact: nanBitDifferences === 0, scope: 'Entity.update ordered state mutation, not full battles' };
  await mkdir(resolve(root, 'work'), { recursive: true });
  await writeFile(resolve(root, 'work/entity-trace-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
