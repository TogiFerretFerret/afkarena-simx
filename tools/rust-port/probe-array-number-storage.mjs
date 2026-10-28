import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../..'),tool='tools/rust-port/probe-array-number-storage.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
assert.deepEqual(process.execArgv,profile.rawBitReferenceFlags,'Run with pinned node --jitless');
assert.equal(process.env.NODE_OPTIONS??'','');
const rawInputs=[
 '0000000000000000','8000000000000000','3ff0000000000000','bff0000000000000',
 '3ff8000000000000','0000000000000001','7fefffffffffffff','7ff0000000000000','fff0000000000000',
 '7ff8000000000000','7ff8000000000001','7ff8000000001234','fff8000000000000','fff8000000001234',
 '7ff0000000000001','7ff4000000000000','fff0000000001234','ffffffffffffffff',
];
// Only hex strings enter host arrays. The raw Number travels directly from
// DataView to the operation's parameter, avoiding an accidental corpus store.
const strategies={
 literal:'var a=[x];return a[0];',
 literalSmiPrefix:'var a=[0,x];return a[1];',
 literalDoublePrefix:'var a=[0.5,x];return a[1];',
 literalObjectPrefix:'var a=[null,x];return a[1];',
 emptySet:'var a=[];a[0]=x;return a[0];',
 smiSet:'var a=[0];a[0]=x;return a[0];',
 doubleSet:'var a=[0.5];a[0]=x;return a[0];',
 objectSet:'var a=[null];a[0]=x;return a[0];',
 holeSet:'var a=new Array(1);a[0]=x;return a[0];',
 smiDeleteSet:'var a=[0];delete a[0];a[0]=x;return a[0];',
 doubleDeleteSet:'var a=[0.5];delete a[0];a[0]=x;return a[0];',
 objectDeleteSet:'var a=[null];delete a[0];a[0]=x;return a[0];',
 sparseSet:'var a=[];a[2]=x;return a[2];',
 emptyPush:'var a=[];a.push(x);return a[0];',
 smiPush:'var a=[0];a.push(x);return a[1];',
 doublePush:'var a=[0.5];a.push(x);return a[1];',
 objectPush:'var a=[null];a.push(x);return a[1];',
 holePush:'var a=new Array(1);a.push(x);return a[1];',
 sliceNumeric:'var a=[x].slice();return a[0];',
 sliceObject:'var a=[null,x].slice(1);return a[0];',
 sliceSmiThenSet:'var a=[0].slice();a[0]=x;return a[0];',
 spreadNumeric:'var a=[...[x]];return a[0];',
 spreadObject:'var a=[...[null,x]];return a[1];',
 spreadSmiThenSet:'var a=[...[0]];a[0]=x;return a[0];',
 concatScalar:'var a=[].concat(x);return a[0];',
 concatSmiScalar:'var a=[0].concat(x);return a[1];',
 concatDoubleScalar:'var a=[0.5].concat(x);return a[1];',
 concatNumeric:'var a=[].concat([x]);return a[0];',
 concatObject:'var a=[].concat([null,x]);return a[1];',
 concatSmiThenSet:'var a=[0].concat([]);a[0]=x;return a[0];',
 defineSmi:'var a=[0];Object.defineProperty(a,"0",{value:x});return a[0];',
 defineObject:'var a=[null];Object.defineProperty(a,"0",{value:x});return a[0];',
 fromArrayLike:'var a=Array.from({0:x,length:1});return a[0];',
 fromMapper:'var a=Array.from({length:1},function(){return x;});return a[0];',
 arrayOf:'var a=Array.of(x);return a[0];',
 objectControl:'var a={x:x};return a.x;',
 dataViewControl:'var a=new DataView(new ArrayBuffer(8));a.setFloat64(0,x,false);return a.getFloat64(0,false);',
};
const prefixes={
 repeatedInput:[],
 finiteWarmup:['0000000000000000','3ff0000000000000','3ff8000000000000','8000000000000000'],
 objectWarmup:[null],
 nanWarmup:['7ff8000000000000'],
};
const prelude=`
var storage=new DataView(new ArrayBuffer(8));
function raw(hex){storage.setBigUint64(0,BigInt('0x'+hex),false);return storage.getFloat64(0,false);}
function bits(value){storage.setFloat64(0,value,false);return storage.getBigUint64(0,false).toString(16).padStart(16,'0');}
`;
const rows=[];
for(const [strategy,body]of Object.entries(strategies)){
 for(const inputBits of rawInputs){
  for(const [history,prefix]of Object.entries(prefixes)){
   // A fresh realm isolates allocation-site feedback for every row. Repeated
   // calls then expose history effects without asserting a hidden V8 kind.
   const realm=createContext(constants.DONT_CONTEXTIFY);
   const source=prelude+`function store(x){${body}}\nfunction probe(hex){var x=raw(hex);return {inputBits:bits(x),outputBits:bits(store(x))};}`;
   const probe=runInContext(source+';probe',realm);
   for(let i=0;i<16;i++)for(const hex of prefix){if(hex===null)runInContext('store(null)',realm);else probe(hex);}
   const outputs=[];
   for(let call=0;call<24;call++){const result=probe(inputBits);assert.equal(result.inputBits,inputBits,'Raw corpus was altered before store');outputs.push(result.outputBits);}
   rows.push({strategy,inputBits,history,prefixCalls:16*prefix.length,outputs});
  }
 }
}
const artifact='benchmarks/validation/pinned-array-number-storage.outputs.json.gz';
const bytes=Buffer.from(JSON.stringify({strategies,rawInputs,prefixes,rows})+'\n');
await writeFile(resolve(root,artifact),gzipSync(bytes,{level:9}));
const byOperation=[];
for(const strategy of Object.keys(strategies)){
 const selected=rows.filter(row=>row.strategy===strategy);
 byOperation.push({strategy,coldAlteredInputs:selected.filter(row=>row.history==='repeatedInput'&&row.outputs[0]!==row.inputBits).map(row=>({inputBits:row.inputBits,outputBits:row.outputs[0]})),withinRowHistoryChanges:selected.filter(row=>new Set(row.outputs).size>1).map(row=>({inputBits:row.inputBits,history:row.history,outputs:row.outputs})),prefixChanges:selected.filter(row=>row.history!=='repeatedInput'&&row.outputs[0]!==selected.find(other=>other.inputBits===row.inputBits&&other.history==='repeatedInput').outputs[0]).map(row=>({inputBits:row.inputBits,history:row.history,outputBits:row.outputs[0]}))});
}
const report={version:1,passed:true,oracleProfile:profile,nodeOptions:process.env.NODE_OPTIONS??'',toolSha256:sha(await readFile(resolve(root,tool))),strategies:Object.keys(strategies).length,rawInputs,rows:rows.length,callsPerRow:24,allInputBitsPreservedBeforeStorage:true,negativeZeroAlwaysPreserved:rows.filter(row=>row.inputBits==='8000000000000000').every(row=>row.outputs.every(bits=>bits===row.inputBits)),byOperation,artifacts:[{file:artifact,sha256:sha(await readFile(resolve(root,artifact))),uncompressedSha256:sha(bytes)}],scope:'Pinned jitless V8 observation of array Number storage, with fresh realms per operation/input/history and exact DataView input/output bits. Covers payload/sign/signaling NaNs, signed zero, literals, Smi/double/object initializers, holes, writes, push, slice, spread, concat and repeated-call history. Labels describe source initializers, not verified internal V8 elements kinds. This is source-engine evidence only; no native runtime changes or battle qualification.',qualifiesFor10000Target:false};
await writeFile(resolve(root,'benchmarks/validation/pinned-array-number-storage.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,strategies:report.strategies,rows:rows.length,negativeZeroAlwaysPreserved:report.negativeZeroAlwaysPreserved,operationsWithHistoryChanges:byOperation.filter(row=>row.withinRowHistoryChanges.length||row.prefixChanges.length).map(row=>row.strategy)}));
