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
var literalNumbers={positive:NaN,negative:-NaN,zero:0,negativeZero:-0};
var literalArray=[NaN,-NaN,0,-0];
report.literalNumbers=[toBits(literalNumbers.positive),toBits(literalNumbers.negative),toBits(literalNumbers.zero),toBits(literalNumbers.negativeZero),toBits(literalArray[0]),toBits(literalArray[1]),toBits(literalArray[2]),toBits(literalArray[3])];
report.unicode=['汉字🙂','embedded\u0000zero',String.fromCharCode(0xD800,0xDC00,0xD800,65,0xDC00)];
var sourceProbe=function explicitSource(x){return this._super(x)+1;};
report.functionSource=Function.prototype.toString.call(sourceProbe);
report.hasSuper=/\b_super\b/.test(sourceProbe);
try{var A=cc.Class.extend({ctor:function(){this.value=2;},number:function(){return this.value;}});var B=A.extend({ctor:function(){this._super();this.value+=3;},number:function(){return this._super()+7;}});var b=new B();report.inheritance={value:b.value,number:b.number(),ownSuper:Object.prototype.hasOwnProperty.call(b,'_super')};}catch(error){report.inheritance={error:String(error)};}
var seed=1,mod=Math.pow(2,35)-31;report.rng=[];for(var i=0;i<128;i++){seed=seed*25%mod;report.rng.push([toBits(seed),toBits(seed/mod)]);}
var random=0x528143;function next(n){random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%n;}
report.math=[];for(var i=0;i<512;i++){var a=(1+next(100000))/1000,b=(next(201)-100)/16;report.math.push([toBits(Math.pow(a,b)),toBits(Math.sqrt(a)),toBits(Math.sin(a)),toBits(Math.cos(a))]);}
report.edgeMath=[];var edges=[NaN,Infinity,-Infinity,0,-0,1,-1,0.5,-0.5,2,-2,Number.MIN_VALUE,Number.MAX_VALUE];for(var i=0;i<edges.length;i++){var x=edges[i];report.edgeMath.push([toBits(Math.min(x,1)),toBits(Math.max(x,1)),toBits(Math.pow(x,0)),toBits(Math.pow(x,0.5)),toBits(Math.pow(x,2)),toBits(Math.pow(x,Infinity))]);}
report.unaryMath={};var names=['acos','acosh','asin','asinh','atan','atanh','cbrt','cos','cosh','exp','expm1','log','log10','log1p','log2','sin','sinh','tan','tanh'];for(var j=0;j<names.length;j++){var name=names[j],rows=[];for(var i=0;i<128;i++){var x=(next(40001)-20000)/1000;rows.push(toBits(Math[name](x)));}report.unaryMath[name]=rows;}
report.order=[];var q=[];function enqueue(f){q.push(f);}enqueue(function(){report.order.push('a');enqueue(function(){report.order.push('c')});});enqueue(function(){report.order.push('b')});while(q.length)q.shift()();
print(JSON.stringify(report));
`;
await mkdir(resolve(root,'work/downloads'),{recursive:true});
const input=resolve(root,'work/downloads/native-compiler-probe.js'),binary=resolve(root,'work/downloads/native-compiler-probe');
await writeFile(input,source);
function run(command,args,env=process.env){const r=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r.stdout;}
const compileArgs=['-O','-Wc,-g0,-ffp-contract=off',input,'-o',binary];
const textEnv={...process.env};delete textEnv.SHERMES_BINARY_STRING_DIR;
run(compiler,compileArgs,textEnv);
const textNative=JSON.parse(run(binary,[]));
const poolDirectory=binary+'.string-pools';await mkdir(poolDirectory,{recursive:true});
run(compiler,compileArgs,{...process.env,SHERMES_BINARY_STRING_DIR:poolDirectory});
const native=JSON.parse(run(binary,[]));
assert.deepEqual(native,textNative,'Binary pools changed compiled execution semantics');
const stringPools=await Promise.all(['s_ascii_pool.bin','s_u16_pool.bin','s_strings.bin'].map(async name=>{const contents=await readFile(resolve(poolDirectory,name));return{name,bytes:contents.length,sha256:createHash('sha256').update(contents).digest('hex')};}));
let node;
runInNewContext(source,{print:text=>{node=JSON.parse(text)}});
const differences=[];for(const key of Object.keys(node)){try{assert.deepEqual(native[key],node[key])}catch{differences.push(key);}}
const mathNames=['pow','sqrt','sin','cos'];
const mathDifferencesByFunction=Object.fromEntries(mathNames.map((name,j)=>[name,node.math.reduce((n,row,i)=>n+Number(row[j]!==native.math[i][j]),0)]));
const unaryMathDifferences=Object.fromEntries(Object.keys(node.unaryMath).map(name=>[name,node.unaryMath[name].filter((x,i)=>x!==native.unaryMath[name][i]).length]));
const edgeMathBitDifferences=node.edgeMath.reduce((n,row,i)=>n+row.filter((x,j)=>x!==native.edgeMath[i][j]).length,0);
const report={version:1,binaryPoolsMatchedTextPools:true,literalNumbers:{expected:node.literalNumbers,actual:native.literalNumbers},unicodeMatched:JSON.stringify(native.unicode)===JSON.stringify(node.unicode),stringPools,compiler,compilerVersion:run(compiler,['--version']).trim(),sourceSha256:createHash('sha256').update(source).digest('hex'),referenceRuntime:process.version,matched:differences.length===0,differences,inheritance:{expected:node.inheritance,actual:native.inheritance},functionSource:{expected:node.functionSource,actual:native.functionSource},rngMatched:JSON.stringify(node.rng)===JSON.stringify(native.rng),mathBitDifferences:node.math.reduce((n,row,i)=>n+row.filter((x,j)=>x!==native.math[i][j]).length,0),mathDifferencesByFunction,unaryMathDifferences,edgeMathBitDifferences,queueOrder:native.order,scope:'AOT compiler semantic compatibility probe, not battle fidelity or throughput'};
await writeFile(resolve(root,'work/downloads/native-compiler-probe-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(differences.length)process.exitCode=1;
