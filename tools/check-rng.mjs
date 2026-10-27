import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
if (!process.argv[2]) throw new Error('Usage: node tools/check-rng.mjs PATH_TO_RNG_CHECK');
const manifest = JSON.parse(await readFile(resolve(root,'config/rng-translation.json'),'utf8'));
const source = await readFile(resolve(root,manifest.source),'utf8');
const storage = new DataView(new ArrayBuffer(8));
function bits(value) { storage.setFloat64(0,value,false); return storage.getBigUint64(0,false).toString(16).padStart(16,'0'); }
function value(hex) { storage.setBigUint64(0,BigInt(`0x${hex}`),false); return storage.getFloat64(0,false); }
function assertBits(actual, expected, detail) {
  if (Number.isNaN(expected)) assert.ok(Number.isNaN(value(actual)),detail);
  else assert.equal(actual,bits(expected),detail);
}
let events = [];
let context;
const record = tag => events.push({ tag, state:context.random_seed, initial:context.ed.init_battle_seed });
context = createContext({ ed:{ btLog:{ append:s=>record(s.startsWith('srand')?'seed':'rand') } }, cc:{ error:()=>record('error') } });
runInContext(`var random_seed=1; var multiplier=${source.slice(manifest.constants.multiplier.start,manifest.constants.multiplier.end)}; var moder=${source.slice(manifest.constants.moder.start,manifest.constants.moder.end)};`,context);
for (const fn of manifest.functions) runInContext(`${fn.name}=(${source.slice(fn.start,fn.end)});`,context);
const seeds=[0,-0,NaN,Infinity,-Infinity,1,-1,.5,-.5,Number.MIN_VALUE,-Number.MIN_VALUE,
  Number.MAX_VALUE,-Number.MAX_VALUE,34359738337,34359738338,2**53-1,2**53,2**-1022];
for(let i=1;i<=2048;i++)seeds.push(i);
// Exercise all binary64 exponent ranges, including inputs outside ordinary game seeds.
let state=0x9e3779b97f4a7c15n;
for(let i=0;i<2048;i++){
  state^=state<<13n;state=BigInt.asUintN(64,state);state^=state>>7n;state^=state<<17n;state=BigInt.asUintN(64,state);
  seeds.push(value(state.toString(16)));
}
const result=spawnSync(resolve(process.argv[2]),[],{input:seeds.map(bits).join('\n')+'\n',encoding:'utf8',maxBuffer:32*1024*1024});
if(result.error)throw result.error;
assert.equal(result.status,0,result.stderr);
const lines=result.stdout.trim().split('\n');assert.equal(lines.length,seeds.length);
for(let i=0;i<seeds.length;i++){
  const [numbersPart,eventsPart]=lines[i].split(' | ');
  const numbers=numbersPart.split(' ');
  events=[];
  context.ed.srand(seeds[i]);
  const expected=[context.random_seed];
  for(let j=0;j<32;j++){
    const before=bits(context.random_seed);
    expected.push(context.ed.randDontChangeSeed());
    assert.equal(bits(context.random_seed),before);
    expected.push(context.ed.rand(),context.random_seed);
  }
  assert.equal(numbers.length,expected.length);
  for(let j=0;j<expected.length;j++)assertBits(numbers[j],expected[j],`seed ${i}, numeric value ${j}`);
  const actualEvents=eventsPart.split(' ');
  assert.equal(actualEvents.length,events.length);
  for(let j=0;j<events.length;j++){
    const [tag,state,initial]=actualEvents[j].split(':');
    assert.equal(tag,events[j].tag);
    assertBits(state,events[j].state,`seed ${i}, event ${j} state`);
    assertBits(initial,events[j].initial,`seed ${i}, event ${j} initial input`);
  }
}
console.log(`Matched ${seeds.length} reseeds and ${seeds.length*32} RNG draws, including peek, callback order and callback-visible state. Exact log-string rendering is outside this check.`);
