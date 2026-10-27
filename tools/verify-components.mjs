import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const diagnostics = process.argv.includes('--diagnostics');
assert.ok(process.argv.slice(2).every(arg => arg === '--diagnostics'), 'Usage: node tools/verify-components.mjs [--diagnostics]');
const localRust = resolve(root, 'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc');
let rustc = process.env.RUSTC ?? 'rustc';
if (!process.env.RUSTC) { try { await access(localRust); rustc = localRust; } catch {} }
const directory = resolve(root, 'work/component-verification');
await mkdir(directory, { recursive: true });
function run(command, args) {
  console.log(`Running ${command === rustc ? 'rustc' : command === process.execPath ? 'node' : command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
  assert.equal(result.status, 0, `Command failed: ${command} ${args.join(' ')}`);
  return result.stdout;
}
const toolchain = JSON.parse(await readFile(resolve(root, 'config/toolchains.json'), 'utf8'));
const rustVersion = run(rustc, ['--version']).trim();
assert.ok(rustVersion.startsWith(`rustc ${toolchain.rust} `), 'Rust version differs from config/toolchains.json');
const suites = [
  ['unit', 'check-unit.rs', 'check-unit.mjs', [], 'unit-differential-summary.json'],
  ['skill', 'check-skill.rs', 'check-skill.mjs', [], 'skill-summary.json'],
  ['damage-primitives', 'check-damage.rs', 'check-damage.mjs', ['--finite'], 'damage-finite-summary.json'],
  ['damage-controller', 'check-damage-controller.rs', 'check-damage-controller.mjs', [], 'damage-controller-summary.json'],
  ['ai-targeting', 'check-ai-runner.rs', 'check-ai.mjs', [], 'ai-targeting-summary.json'],
  ['ai-movement', 'check-ai-movement-runner.rs', 'check-ai-movement.mjs', [], 'ai-movement-summary.json'],
  ['ai-selection', 'check-ai-control-runner.rs', 'check-ai-control.mjs', [], 'ai-control-summary.json'],
  ['ai-update', 'check-ai-update.rs', 'check-ai-update.mjs', [], 'ai-update-summary.json'],
  ['attribute-initialization', 'precompute-config-runner.rs', 'precompute-config-differential.mjs', [], 'precompute-config-summary.json'],
];
const strict = [];
for (const [name, runner, checker, args, summary] of suites) {
  const binary = resolve(directory, name);
  // Rust's normal IEEE operations; deliberately no fast-math/reassociation flags.
  run(rustc, ['--edition=2024', '-O', '-Awarnings', `tools/${runner}`, '-o', binary]);
  run(process.execPath, [`tools/${checker}`, binary, ...args]);
  const result = JSON.parse(await readFile(resolve(root, 'work', summary), 'utf8'));
  assert.notEqual(result.rawBitsExact, false, `${name} reported a raw-bit mismatch`);
  assert.equal(result.cases, 20000, `${name} did not run the full component corpus`);
  strict.push({ name, checker: `tools/${checker}`, arguments: args, result });
}
const diagnosticResults = [];
if (diagnostics) {
  // This separate run intentionally compares NaNs semantically and counts all raw-bit
  // differences. Its success is never included in the strict raw-bit gate above.
  run(process.execPath, ['tools/check-damage.mjs', resolve(directory, 'damage-primitives'), '--nan=semantic']);
  const result = JSON.parse(await readFile(resolve(root, 'work/damage-summary.json'), 'utf8'));
  diagnosticResults.push({ name: 'damage-adversarial-NaNs', qualifiesForRawBitGate: false, result });
}
const files = [
  'tools/verify-components.mjs', 'config/toolchains.json',
  ...suites.flatMap(([, runner, checker]) => [`tools/${runner}`, `tools/${checker}`]),
  ...(await readdir(resolve(root, 'crates/battle-core/src'))).filter(name => name.endsWith('.rs')).map(name => `crates/battle-core/src/${name}`),
];
const sha256 = {};
for (const file of [...new Set(files)].sort()) sha256[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
const report = {
  version: 1, createdAt: new Date().toISOString(), referenceRuntime: process.version, rustVersion,
  strictComponentGatePassed: true, strictCases: strict.reduce((sum, suite) => sum + suite.result.cases, 0),
  fullBattleEquivalence: false, qualifiesForBattleThroughputTarget: false,
  scope: 'Component source control and scripted mechanics hooks only. Does not validate a composed Rust battle, all Buff mechanics, or the realistic 5v5 corpus.',
  strict, diagnostics: diagnosticResults, sha256,
};
await writeFile(resolve(root, 'work/component-verification-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Strict component verification passed (${report.strictCases} cases). Full-battle equivalence remains unqualified.`);
