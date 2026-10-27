import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const compiler=resolve(process.argv[2]??resolve(root,'work/downloads/hermes-build/bin/shermes'));
const runtime=await readFile(resolve(root,'tools/bootstrap-vendor-CCClass.js'),'utf8');
const source=`var cc={game:{config:null,CONFIG_KEY:{}}};\n${runtime}\n`+String.raw`
function toBits(value){var a=new ArrayBuffer(8),v=new DataView(a);v.setFloat64(0,value,false);function hex(n){var s=n.toString(16);while(s.length<8)s='0'+s;return s;}return hex(v.getUint32(0,false))+hex(v.getUint32(4,false));}
var report={};
var sourceProbe=function explicitSource(x){return this._super(x)+1;};
report.functionSource=Function.prototype.toString.call(sourceProbe);
report.hasSuper=/\b_super\b/.test(sourceProbe);
try{var A=cc.Class.extend({ctor:function(){this.value=2;},number:function(){return this.value;}});var B=A.extend({ctor:function(){this._super();this.value+=3;},number:function(){return this._super()+7;}});var b=new B();report.inheritance={value:b.value,number:b.number(),ownSuper:Object.prototype.hasOwnProperty.call(b,'_super')};}catch(error){report.inheritance={error:String(error)};}
var seed=1,mod=Math.pow(2,35)-31;report.rng=[];for(var i=0;i<128;i++){seed=seed*25%mod;report.rng.push([toBits(seed),toBits(seed/mod)]);}
var random=0x528143;function next(n){random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%n;}
report.math=[];for(var i=0;i<512;i++){var a=(1+next(100000))/1000,b=(next(201)-100)/16;report.math.push([toBits(Math.pow(a,b)),toBits(Math.sqrt(a)),toBits(Math.sin(a)),toBits(Math.cos(a))]);}
report.order=[];var q=[];function enqueue(f){q.push(f);}enqueue(function(){report.order.push('a');enqueue(function(){report.order.push('c')});});enqueue(function(){report.order.push('b')});while(q.length)q.shift()();
print(JSON.stringify(report));
`;
await mkdir(resolve(root,'work/downloads'),{recursive:true});
const input=resolve(root,'work/downloads/native-compiler-probe.js'),binary=resolve(root,'work/downloads/native-compiler-probe');
await writeFile(input,source);
function run(command,args){const r=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r.stdout;}
run(compiler,['-O',input,'-o',binary]);
const native=JSON.parse(run(binary,[]));let node;
runInNewContext(source,{print:text=>{node=JSON.parse(text)}});
const differences=[];for(const key of Object.keys(node)){try{assert.deepEqual(native[key],node[key])}catch{differences.push(key);}}
const mathNames=['pow','sqrt','sin','cos'];
const mathDifferencesByFunction=Object.fromEntries(mathNames.map((name,j)=>[name,node.math.reduce((n,row,i)=>n+Number(row[j]!==native.math[i][j]),0)]));
const report={version:1,compiler,compilerVersion:run(compiler,['--version']).trim(),sourceSha256:createHash('sha256').update(source).digest('hex'),referenceRuntime:process.version,matched:differences.length===0,differences,inheritance:{expected:node.inheritance,actual:native.inheritance},functionSource:{expected:node.functionSource,actual:native.functionSource},rngMatched:JSON.stringify(node.rng)===JSON.stringify(native.rng),mathBitDifferences:node.math.reduce((n,row,i)=>n+row.filter((x,j)=>x!==native.math[i][j]).length,0),mathDifferencesByFunction,queueOrder:native.order,scope:'AOT compiler semantic compatibility probe, not battle fidelity or throughput'};
await writeFile(resolve(root,'work/downloads/native-compiler-probe-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(differences.length)process.exitCode=1;
