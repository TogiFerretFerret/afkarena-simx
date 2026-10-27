import {readFile,writeFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);assert.equal(process.platform,profile.platform);assert.equal(process.arch,profile.architecture);assert.deepEqual(process.execArgv,profile.rawBitReferenceFlags);assert.equal(process.env.NODE_OPTIONS??'',profile.rawBitReferenceNodeOptions);
const view=new DataView(new ArrayBuffer(8));
function bits(value){view.setFloat64(0,value);return view.getBigUint64(0).toString(16).padStart(16,'0')}
function number(value){view.setBigUint64(0,BigInt(`0x${value}`));return view.getFloat64(0)}
const negativeNaN=number('fff8000000000000');
const literalSource='function(a,b){return[a,b]}',scalarSource='function(a,b){return a*b}';
const literal=runInNewContext(`(${literalSource})`),scalar=runInNewContext(`(${scalarSource})`);
const sequence=[[0,0],[-0,0],[0,1],[-0,1],[0,.25],[0,0],[-0,0],[0,Infinity],[-0,Infinity],[negativeNaN,Infinity],[negativeNaN,Infinity]];
const literalRows=sequence.map(([a,b])=>({input:[bits(a),bits(b)],output:literal(a,b).map(bits)}));
assert.deepEqual(literalRows[9].input,literalRows[10].input);
assert.equal(literalRows[9].output[0],'7ff8000000000000');
assert.equal(literalRows[10].output[0],'fff8000000000000');
const manifest=JSON.parse(await readFile(resolve(root,'config/numeric-kernels.ir.json'),'utf8'));
const def=manifest.kernels.find(k=>k.sourceName==='ed.edpMult'),file=await readFile(resolve(root,manifest.source),'utf8'),original=file.slice(def.start,def.end);
assert.equal(createHash('sha256').update(original).digest('hex'),def.sourceSha256);
const multiply=runInNewContext(`(${original})`),values=[0,-0,1,-1,.5,Number.MIN_VALUE,-Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE,Infinity,-Infinity];
const multiplyRows=values.map(y=>({input:[bits(0),bits(y),bits(y)],scalar:bits(scalar(0,y)),output:multiply([0,y],y).map(bits)}));
assert.equal(multiplyRows[9].scalar,'fff8000000000000');assert.equal(multiplyRows[9].output[0],'7ff8000000000000');
assert.equal(multiplyRows[10].scalar,'fff8000000000000');assert.equal(multiplyRows[10].output[0],'fff8000000000000');
const report={version:1,referenceProfile:profile,literalSource,scalarSource,source:{file:manifest.source,start:def.start,end:def.end,sha256:def.sourceSha256,text:original},literalRows,multiplyRows,noNormalization:true,statelessVectorReturnRawBitEquivalence:false,conclusion:'Identical Number input bits produce different array-element output bits at the same literal site depending on earlier calls. Arithmetic alone cannot reproduce this V8 storage/feedback behavior in a stateless Rust [f64;2] kernel.',upstream:[{url:'https://raw.githubusercontent.com/nodejs/node/v24.19.0/deps/v8/src/objects/fixed-array-inl.h',function:'FixedDoubleArray::set',behavior:'C++ slow setter replaces NaN with std::numeric_limits<double>::quiet_NaN()'},{url:'https://raw.githubusercontent.com/nodejs/node/v24.19.0/deps/v8/src/ic/keyed-store-generic.cc',behavior:'Fast store uses Float64SilenceNaN before storing the double'}]};
await writeFile(resolve(root,'work/array-nan-storage-probe.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({identicalInput:literalRows[9].input,firstOutput:literalRows[9].output,nextOutput:literalRows[10].output,statelessVectorReturnRawBitEquivalence:false}));
