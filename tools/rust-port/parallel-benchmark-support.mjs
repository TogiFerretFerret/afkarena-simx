import assert from'node:assert/strict';
import{parseExpression,parse}from'@babel/parser';
import{createHash}from'node:crypto';
export function validateParallelSource(runSource,driverSource){
 assert.equal(createHash('sha256').update(runSource).digest('hex'),'d7f91f446d24282b489ef9943494f0658f778232b5948d66b8d941d3f42e950d');
 const calls=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type==='CallExpression')calls.push(n);for(const[k,v]of Object.entries(n))if(!['loc','extra','comments','tokens'].includes(k))Array.isArray(v)?v.forEach(walk):walk(v);}
 walk(parseExpression(runSource));assert.equal(calls.filter(n=>n.callee?.name==='wallNow').length,2);calls.length=0;
 walk(parse(driverSource,{sourceType:'script'}));const rootCalls=calls.filter(n=>n.callee?.name==='__nativeRun');assert.equal(rootCalls.length,1);const args=rootCalls[0].arguments;assert.deepEqual(args.map(n=>n.type==='Identifier'?n.name:n.value),['__nativeRuntime','__nativeWire',20,3,'__nativeWallNow','final']);
 return{runSourceSha256:createHash('sha256').update(runSource).digest('hex'),wallNowCalls:2,battles:20,warmup:3,capture:'final'};
}
export function aggregateParallelWindows(windows){assert.equal(windows.length,4);const starts=windows.map(w=>BigInt(w.startUnixNs)),ends=windows.map(w=>BigInt(w.endUnixNs));for(let i=0;i<4;i++)assert.ok(ends[i]>starts[i]);const min=a=>a.reduce((x,y)=>x<y?x:y),max=a=>a.reduce((x,y)=>x>y?x:y),start=min(starts),end=max(ends),overlapStart=max(starts),overlapEnd=min(ends);return{completed:80,startUnixNs:String(start),endUnixNs:String(end),elapsedNs:String(end-start),elapsedSeconds:Number(end-start)/1e9,battlesPerSecond:80/(Number(end-start)/1e9),commonOverlapNs:String(overlapEnd>overlapStart?overlapEnd-overlapStart:0n),allFourOverlap:overlapEnd>overlapStart,method:'80 measured battles / (latest measured end - earliest measured start), using a common SystemTime UNIX epoch; never sum per-process rates.'};}
