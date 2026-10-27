import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const binary = process.argv[2];
if (!binary) throw new Error('Usage: node tools/check-numeric.mjs PATH_TO_RELEASE_NUMERIC_CHECK');
const manifest = JSON.parse(await readFile(resolve(root, 'config/numeric-kernels.ir.json'), 'utf8'));
const source = await readFile(resolve(root, manifest.source), 'utf8');
// Evaluate the actual source functions, not an interpreter for the generated IR.
const functions = manifest.kernels.map(k => runInNewContext(`(${source.slice(k.start, k.end)})`));
const storage = new DataView(new ArrayBuffer(8));
function bits(value) { storage.setFloat64(0, value, false); return storage.getBigUint64(0, false).toString(16).padStart(16, '0'); }
function value(hex) { storage.setBigUint64(0, BigInt(`0x${hex}`), false); return storage.getFloat64(0, false); }
const special = [0, -0, 1, -1, .5, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE,
  -Number.MAX_VALUE, Infinity, -Infinity, NaN, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER,
  2 ** -1022, 2 ** -500, 2 ** 500, 1 + Number.EPSILON];
const cases = [];
for (const x of special) for (const y of special) cases.push([x, y, y, x]);
// xorshift64 produces input bits only; this is not the game's RNG.
let state = 0x9e3779b97f4a7c15n;
function next() { state ^= state << 13n; state = BigInt.asUintN(64, state); state ^= state >> 7n; state ^= state << 17n; state = BigInt.asUintN(64, state); return value(state.toString(16)); }
for (let i = 0; i < 20000; i++) cases.push([next(), next(), next(), next()]);
const result = spawnSync(resolve(binary), [], {
  input: cases.map(c => c.map(bits).join(' ')).join('\n') + '\n', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr);
const lines = result.stdout.trim().split('\n');
assert.equal(lines.length, cases.length);
for (let i = 0; i < cases.length; i++) {
  const a = cases[i].slice(0, 2), b = cases[i].slice(2);
  const expected = functions.flatMap(fn => {
    const result = fn(a, b);
    return Array.isArray(result) ? Array.from(result) : [result];
  });
  const actual = lines[i].split(' ');
  assert.equal(actual.length, expected.length);
  for (let j = 0; j < expected.length; j++) {
    // JS specifies NaN, not its payload or sign. Every other result is compared bitwise.
    if (Number.isNaN(expected[j])) assert.ok(Number.isNaN(value(actual[j])));
    else assert.equal(actual[j], bits(expected[j]), `case ${i}, output ${j}, input ${cases[i].map(bits)}`);
  }
}
console.log(`Matched ${cases.length} numeric input cases (${cases.length * 6} output values) against original JS; non-NaN results bit-exact, NaNs compared by class. These are kernel checks, not battles.`);
