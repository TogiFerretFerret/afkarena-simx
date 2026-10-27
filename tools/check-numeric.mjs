import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const binary = process.argv[2];
if (!binary) throw new Error('Usage: node tools/check-numeric.mjs PATH_TO_RELEASE_NUMERIC_CHECK [--strict-bits]');
// Keep the documented JS semantic domain as default; raw NaN bits are an
// explicit stronger diagnostic and every mismatch is counted in either mode.
const nanPolicy = process.argv.includes('--strict-bits') ? 'bits' : 'semantic';
const manifest = JSON.parse(await readFile(resolve(root, 'config/numeric-kernels.ir.json'), 'utf8'));
const source = await readFile(resolve(root, manifest.source), 'utf8');
// Evaluate the actual source functions, not an interpreter for the generated IR.
const functions = manifest.kernels.map(k => {
  const code = source.slice(k.start, k.end);
  assert.equal(createHash('sha256').update(code).digest('hex'), k.sourceSha256, `Stale source location: ${k.sourceName}`);
  return runInNewContext(`(${code})`);
});
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
let outputValues = 0, nanBitDifferences = 0;
for (let i = 0; i < cases.length; i++) {
  const a = cases[i].slice(0, 2), b = cases[i].slice(2);
  const expected = functions.flatMap((fn, index) => {
    const args = manifest.kernels[index].params.map((type, p) => {
      if (p > 1) throw new Error('Input protocol currently supports at most two parameters');
      const pair = p === 0 ? a : b;
      return type === 'vec2' ? pair : pair[0];
    });
    const result = fn(...args);
    // Capture bits directly at the return boundary. Materializing a second
    // numeric JS array can canonicalize NaNs and corrupt a payload comparison.
    return Array.isArray(result) ? [bits(result[0]), bits(result[1])] : [bits(result)];
  });
  const actual = lines[i].split(' ');
  assert.equal(actual.length, expected.length);
  for (let j = 0; j < expected.length; j++) {
    if (actual[j] === expected[j]) continue;
    if (nanPolicy === 'semantic' && Number.isNaN(value(expected[j])) && Number.isNaN(value(actual[j]))) {
      nanBitDifferences++;
      continue;
    }
    await mkdir(resolve(root, 'work'), { recursive: true });
    await writeFile(resolve(root, 'work/numeric-first-divergence.json'), JSON.stringify({
      caseIndex: i, outputIndex: j, inputBits: cases[i].map(bits),
      expectedBits: expected[j], actualBits: actual[j], nanPolicy,
    }, null, 2) + '\n');
    assert.fail(`case ${i}, output ${j}; see work/numeric-first-divergence.json`);
  }
  outputValues += expected.length;
}
console.log(JSON.stringify({ kernelCount: functions.length, inputCases: cases.length, outputValues,
  nanPolicy, nanBitDifferences, rawBitsExact: nanBitDifferences === 0,
  scope: 'Numeric kernel checks, not battles' }));
