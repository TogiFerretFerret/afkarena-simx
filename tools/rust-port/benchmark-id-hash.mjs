import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'work/rust-id-hash-benchmark');
await mkdir(work,{recursive:true});
const rustc=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc');
const input='crates/js-runtime/src/id_hash.rs',bytes=await readFile(resolve(root,input));
const source=`#[path=${JSON.stringify(resolve(root,input))}]mod id_hash;
use std::{collections::HashMap,hash::{BuildHasher,Hash},hint::black_box,time::Instant};
#[derive(Clone,Copy,Hash,PartialEq,Eq)]struct StringId(usize);
#[derive(Clone,Copy,Hash,PartialEq,Eq)]struct PropertyKey(StringId);
fn run<S:BuildHasher+Default>(label:&str,trial:usize,size:usize){
 let mut table=HashMap::<PropertyKey,usize,S>::default();
 for i in 0..size{table.insert(PropertyKey(StringId(i*17)),i);}
 let keys=(0..size).map(|i|PropertyKey(StringId(i*17))).collect::<Vec<_>>();
 let rounds=2_000_000/size;let mut sum=0usize;
 let start=Instant::now();for _ in 0..rounds{for key in &keys{sum=sum.wrapping_add(*black_box(&table).get(black_box(key)).unwrap());}}
 let nanos=start.elapsed().as_nanos();assert_eq!(sum,rounds*size*(size-1)/2);
 println!("{} {} {} {} {}",label,trial,size,rounds*size,nanos);
}
fn main(){for size in [8,32,128,512]{for trial in 0..5{if trial%2==0{run::<std::collections::hash_map::RandomState>("standard",trial,size);run::<id_hash::IdBuildHasher>("integer",trial,size);}else{run::<id_hash::IdBuildHasher>("integer",trial,size);run::<std::collections::hash_map::RandomState>("standard",trial,size);}}}}`;
await writeFile(resolve(work,'main.rs'),source);
const build=spawnSync(rustc,['--edition=2024','-O',resolve(work,'main.rs'),'-o',resolve(work,'bench')],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
const actual=spawnSync(resolve(work,'bench'),[],{encoding:'utf8'});assert.equal(actual.status,0,actual.stderr);
const rows=actual.stdout.trim().split('\n').map(line=>{const[label,trial,size,lookups,nanos]=line.split(' ');return{label,trial:+trial,size:+size,lookups:+lookups,elapsedNs:nanos};});
const summaries=[8,32,128,512].map(size=>{const total=label=>rows.filter(row=>row.size===size&&row.label===label).reduce((sum,row)=>sum+Number(row.elapsedNs),0);return{size,standardElapsedNs:String(total('standard')),integerElapsedNs:String(total('integer')),observedLookupRatio:total('standard')/total('integer')};});
assert.deepEqual(await readFile(resolve(root,input)),bytes);
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={version:1,passed:true,input:{file:input,sha256:sha(bytes)},standaloneSourceSha256:sha(source),rows,summaries,scope:'Lookup-only microbenchmark of the exact PropertyKey(StringId(usize)) hash layout; alternating five trials at four object sizes. Both use std HashMap and identical preallocated keys. Correct integer sums asserted. This measures hashing and lookup only, not JavaScript semantics, whole-battle throughput, or isolated speedup. Shared environment contention remains possible.',qualifiesFor10000Target:false};
const output='benchmarks/validation/rust-id-hash-benchmark.json';await writeFile(resolve(root,output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,summaries}));
