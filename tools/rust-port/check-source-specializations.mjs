import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileSource} from './compile.mjs';
const emitter=await readFile(new URL('../emit-native-oracle.mjs',import.meta.url),'utf8');
const start=emitter.indexOf('function __nativeDecodeUTF8('),end=emitter.indexOf('\n  }`);',start)+4;
assert.ok(start>=0&&end>start);
const source=emitter.slice(start,end),digest=createHash('sha256').update(source).digest('hex');
assert.equal(digest,'5fe05bd8580b1b6d11ff573eab9df79cdb29df580fe1127d1f43afaab2c6fae1');
const hook='rt.try_native_decode_utf8(args.first().copied().unwrap_or(Value::Undefined), parent)?';
for(const largeBody of [false,{minimumNodes:1,maxNodes:30,maxStatements:2,maxInitGroups:2}]){
 const result=compileSource(source,{largeBody,allowUnsupported:false});
 assert.ok(result.rust.includes(hook));
 assert.equal(result.manifest.functions.filter(row=>row.sourceSpecialization).length,1);
 assert.ok(result.functions[1].rust.indexOf(hook)<result.functions[1].rust.indexOf('rt.child_env(parent)'));
 const off=compileSource(source,{largeBody,sourceSpecializations:false,allowUnsupported:false});
 assert.ok(!off.rust.includes(hook));
 assert.ok(off.manifest.functions.every(row=>row.sourceSpecialization===null));
}
for(const changed of [source.replace('var parts=[]','var parts = []'),source.replace('Truncated UTF8','Different error'),source.replace('__nativeDecodeUTF8','otherName')]){
 assert.ok(!compileSource(changed,{allowUnsupported:false}).rust.includes(hook));
}
const nested=compileSource(`function outer(String,Error){${source}return __nativeDecodeUTF8;}`,{allowUnsupported:false});
assert.ok(nested.rust.includes(hook)); // Supplied parent lets the raw guard reject lexical shadows.
const pooled=compileSource(source,{sourcePoolPath:'source.utf16le',allowUnsupported:false});
assert.equal(pooled.sourcePool.toString('utf16le'),source);
assert.ok(pooled.rust.includes(`rt.set_function_source_range(`));
assert.ok(pooled.rust.includes(`, 0, ${source.length})?;`));
console.log(JSON.stringify({passed:true,exactSourceSha256:digest,cases:9,scope:'Compiler recognition and fallback contract only; runtime behavior is qualified separately.'}));
