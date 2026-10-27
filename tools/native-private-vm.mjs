import{readFile,mkdir}from'node:fs/promises';
import{resolve}from'node:path';
import{spawnSync}from'node:child_process';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';

/** Link a private probe DSO; never alter the pinned live VM or compiler files. */
export async function buildPrivateVMHelper({root,directory,helperFile}){
 await mkdir(directory,{recursive:true});
 const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json')));
 const build=resolve(root,'work/downloads/hermes-build'),checkout=resolve(root,'work/downloads',config.source.directory);
 const sha=b=>createHash('sha256').update(b).digest('hex');
 const original=resolve(build,'lib/libhermesvm.so'),originalSha256=sha(await readFile(original));
 const run=(command,args,options={})=>{const r=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,...options});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r;};
 const helper=resolve(directory,'helper.o');
 const args=['-DHERMESVM_ALLOW_CONCURRENT_GC','-DHERMESVM_ALLOW_INLINE_ASM','-DHERMESVM_INDIRECT_THREADING','-DHERMES_CHECK_NATIVE_STACK','-DHERMES_ENABLE_UNICODE_REGEXP_PROPERTY_ESCAPES','-DHERMES_USE_BOOST_CONTEXT=1','-DSTATIC_HERMES','-fno-exceptions','-fno-rtti','-x','c++','-std=c++17','-O2','-g0','-DNDEBUG','-fPIC','-ffp-contract=off'];
 for(const path of[resolve(build,'lib/config'),resolve(checkout,'include'),resolve(checkout,'external/llvh/include'),resolve(checkout,'external/llvh/gen/include'),resolve(checkout,'external'),resolve(checkout,'public'),resolve(checkout,'API'),resolve(checkout,'API/jsi'),resolve(build,'external/llvh/include'),resolve(build,'include')])args.push('-I'+path);
 args.push('-c',resolve(root,helperFile),'-o',helper);run('c++',args);
 const ninja=resolve(root,'work/downloads/ninja-bin/ninja');
 let link=run(ninja,['-C',build,'-t','commands','lib/libhermesvm.so']).stdout.trim().split('\n').at(-1);
 assert.ok(link.startsWith(': && /usr/bin/c++ ')&&link.includes('-o lib/libhermesvm.so '));
 const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 const output=resolve(directory,'libhermesvm.so');
 link=link.replace('-o lib/libhermesvm.so ','-o '+quote(output)+' '+quote(helper)+' ').replace('-Wl,--dependency-file=lib/CMakeFiles/hermesvm.dir/link.d','-Wl,--dependency-file='+quote(resolve(directory,'link.d')));
 run('/bin/bash',['-c',link],{cwd:build});
 assert.equal(sha(await readFile(original)),originalSha256,'Private probe modified live VM');
 return{output,originalSha256,privateSha256:sha(await readFile(output)),helperSha256:sha(await readFile(resolve(root,helperFile)))};
}
