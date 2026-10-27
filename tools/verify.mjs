import { readFile, readdir, access, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, delimiter } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const toolchains = JSON.parse(await readFile(resolve(root,'config/toolchains.json'),'utf8'));
async function exists(path) { try { await access(path); return true; } catch { return false; } }
const env = { ...process.env };
// Local session tools stay in ignored work/. No implicit installation or network access.
const localRust = resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin');
if (await exists(resolve(localRust,'rustc'))) env.PATH = `${localRust}${delimiter}${env.PATH}`;
const buck = process.env.BUCK2 ?? (await exists(resolve(root,'work/buck2')) ? resolve(root,'work/buck2') : 'buck2');
function run(command,args,capture=false) {
  const result = spawnSync(command,args,{cwd:root,env,encoding:'utf8',stdio:capture?'pipe':'inherit',maxBuffer:16*1024*1024});
  if(result.error)throw result.error;
  if(capture && result.stderr)process.stderr.write(result.stderr);
  assert.equal(result.status,0,`${command} ${args.join(' ')} failed${capture?'\n'+result.stdout:''}`);
  return result.stdout;
}
assert.match(run('rustc',['--version'],true),new RegExp(`^rustc ${toolchains.rust.replaceAll('.','\\.')} `));
assert.ok(run(buck,['--version'],true).includes(toolchains.buck2Commit),'Buck2 version differs from config/toolchains.json');
const tests=(await readdir(resolve(root,'tools/tests'))).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>`tools/tests/${n}`);
run(process.execPath,['--test',...tests]);
run(process.execPath,['tools/lower-numeric.mjs','--check']);
run(process.execPath,['tools/generate-rng.mjs','--check']);
await mkdir(resolve(root,'work'),{recursive:true});
run('rustc',['--edition=2024','--test','crates/battle-core/src/lib.rs','-o','work/core-tests']);
run(resolve(root,'work/core-tests'),[]);
run(process.execPath,['tools/bootstrap-check.mjs']);
const targets=['root//crates/battle-core:numeric_check','root//crates/battle-core:rng_check',
  'root//crates/battle-core:entity_check','root//crates/battle-core:scheduler_check'];
const artifacts=JSON.parse(run(buck,['build',...targets,'--show-json-output'],true));
run(process.execPath,['tools/check-numeric.mjs',artifacts[targets[0]]]);
run(process.execPath,['tools/check-rng.mjs',artifacts[targets[1]]]);
run(process.execPath,['tools/check-entity.mjs',artifacts[targets[2]],'--strict-bits']);
run(process.execPath,['tools/check-scheduler.mjs',artifacts[targets[3]]]);
console.log('Verification passed. Full battle execution and battle equivalence are not implemented yet.');
