// Independent pinned V8 primitive operator / UTF-16 conversion differential gate.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const p=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1],...process.argv.slice(2)],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(p.status??1);}
assert.ok(process.argv[2],'Usage: node tools/rust-port/check-values.mjs VALUE_CHECK_BINARY');
const sha=x=>createHash('sha256').update(x).digest('hex'),view=new DataView(new ArrayBuffer(8));
function bits(value){view.setFloat64(0,value);return view.getBigUint64(0).toString(16).padStart(16,'0');}
function fromBits(value){view.setBigUint64(0,BigInt('0x'+value));return view.getFloat64(0);}
function encode(value){if(value===undefined)return'u';if(value===null)return'n';if(typeof value==='boolean')return'b'+Number(value);if(typeof value==='number')return'd'+bits(value);if(typeof value==='string')return's'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('fixture value is not primitive');}
const ops={Add:(a,b)=>a+b,Sub:(a,b)=>a-b,Mul:(a,b)=>a*b,Div:(a,b)=>a/b,Rem:(a,b)=>a%b,Pow:(a,b)=>a**b,Shl:(a,b)=>a<<b,Shr:(a,b)=>a>>b,UShr:(a,b)=>a>>>b,BitOr:(a,b)=>a|b,BitXor:(a,b)=>a^b,BitAnd:(a,b)=>a&b,Eq:(a,b)=>a==b,Ne:(a,b)=>a!=b,StrictEq:(a,b)=>a===b,StrictNe:(a,b)=>a!==b,Lt:(a,b)=>a<b,Le:(a,b)=>a<=b,Gt:(a,b)=>a>b,Ge:(a,b)=>a>=b};
const unaries={Plus:a=>+a,Minus:a=>-a,Not:a=>!a,BitNot:a=>~a,TypeOf:a=>typeof a,Void:a=>void a};
const conversions={number:a=>Number(a),string:a=>String(a),truthy:a=>!!a};
const values=[undefined,null,false,true,0,-0,1,-1,42.5,NaN,Infinity,-Infinity,Number.MIN_VALUE,Number.MAX_VALUE,
 fromBits('7ff8123456789abc'),fromBits('fff8abcdef012345'),fromBits('7ff0123456789abc'),
 '', ' ', '0', '-0', '.5','1.','1e3','0x1f','0b101','0o77','Infinity','-Infinity','NaN','+0x1','1_000','inf','1e','💩','\ud800','\u200942\u2009','\u008542','\u180e42',
 '0x'+'f'.repeat(256),'0x'+'f'.repeat(257),'0b1'+'0'.repeat(52)+'1','0b1'+'0'.repeat(52)+'11','0o777777777777777777777777777777777777777777777777777777777777777'];
const rows=[];for(const [name,op]of Object.entries(ops))for(const a of values)for(const b of values)rows.push({input:`binary ${name} ${encode(a)} ${encode(b)}`,expected:encode(op(a,b)),kind:name});
for(const [name,op]of Object.entries(unaries))for(const a of values)rows.push({input:`unary ${name} ${encode(a)}`,expected:encode(op(a)),kind:name});
for(const [name,op]of Object.entries(conversions))for(const a of values)rows.push({input:`convert ${name} ${encode(a)}`,expected:encode(op(a)),kind:name});
let state=0x13572468;function next(){state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;}
for(let i=0;i<20000;i++){const a=fromBits(next().toString(16).padStart(8,'0')+next().toString(16).padStart(8,'0')),b=fromBits(next().toString(16).padStart(8,'0')+next().toString(16).padStart(8,'0'));const names=['Add','Sub','Mul','Div','Rem','Shl','Shr','UShr','BitOr','BitXor','BitAnd','Lt','Le','Gt','Ge','Eq'];const name=names[i%names.length];rows.push({input:`binary ${name} ${encode(a)} ${encode(b)}`,expected:encode(ops[name](a,b)),kind:name});rows.push({input:`convert string ${encode(a)}`,expected:encode(String(a)),kind:'string'});}
const binary=resolve(process.argv[2]),input=rows.map(r=>r.input).join('\n')+'\n',run=spawnSync(binary,[],{input,cwd:root,encoding:'utf8',maxBuffer:128*1024*1024});
assert.ifError(run.error);assert.equal(run.status,0,run.stderr);const actual=run.stdout.trimEnd().split('\n');assert.equal(actual.length,rows.length);
const failures=[],unsupported=[];let compared=0;for(let i=0;i<rows.length;i++){if(actual[i].startsWith('unsupported:')){unsupported.push({index:i,input:rows[i].input,reason:actual[i]});continue;}compared++;if(actual[i]!==rows[i].expected&&failures.length<30)failures.push({index:i,...rows[i],actual:actual[i]});}
await mkdir(resolve(root,'benchmarks/validation'),{recursive:true});const prefix='benchmarks/validation/rust-value-semantics',artifacts=[];
for(const [label,text]of [['input',input],['expected',rows.map(r=>r.expected).join('\n')+'\n'],['actual',run.stdout],['stderr',run.stderr]]){const file=prefix+'.'+label+'.gz';await writeFile(resolve(root,file),gzipSync(text));artifacts.push({file,sha256:sha(await readFile(resolve(root,file))),uncompressedSha256:sha(text)});}
const sources={};for(const file of ['tools/rust-port/check-values.mjs','crates/js-runtime/examples/value_check.rs','crates/js-runtime/src/value.rs','crates/battle-core/src/js_math.rs','config/source-oracle-runtime.json'])sources[file]=sha(await readFile(resolve(root,file)));
const proof={version:1,passed:failures.length===0,cases:rows.length,compared,unsupportedCount:unsupported.length,unsupported,failures,sources,binary:{file:binary,sha256:sha(await readFile(binary))},oracleProfile:profile,artifacts,scope:'Pure Rust primitive values, source-order operator helpers and UTF-16 StringNumericLiteral/Number string formatting compared to pinned jitless V8. Raw f64 payload bits retained. Ambiguous tagged-number remainder domains remain explicit and are not counted as passes. This is not an object-coercion, generated-program or battle qualification.',qualifiesFor10000Target:false};
await writeFile(resolve(root,prefix+'.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:proof.passed,cases:proof.cases,compared,unsupportedCount:unsupported.length,failures}));if(!proof.passed)process.exitCode=1;
