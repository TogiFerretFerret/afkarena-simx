import { writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),pid=Number(args[0]),milliseconds=Number(args[1]??10000),port=Number(args[2]??9229);
if(!Number.isSafeInteger(pid)||pid<1||!Number.isSafeInteger(milliseconds)||milliseconds<1||milliseconds>55000||!Number.isSafeInteger(port))throw Error('Usage: node tools/profile-process.mjs PID [milliseconds<=55000] [inspectorPort]');
process.kill(pid,'SIGUSR1');
let targets;
for(let attempt=0;attempt<30;attempt++){
  try{targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();break;}
  catch{await new Promise(resolve=>setTimeout(resolve,100));}
}
if(!targets?.[0]?.webSocketDebuggerUrl)throw Error('Inspector unavailable');
const socket=new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
let sequence=0;const pending=new Map();
socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);}}});
socket.addEventListener('close',()=>{for(const item of pending.values())item.reject(Error('Inspector closed before completion'));});
function post(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:500});await post('Profiler.start');
const started=performance.now();await new Promise(resolve=>setTimeout(resolve,milliseconds));
const {profile}=await post('Profiler.stop');await post('Profiler.disable');socket.close();
const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map(),totals=new Map();
for(const node of profile.nodes)for(const child of node.children??[])parents.set(child,node.id);
function add(node,field,time){const key=JSON.stringify(node.callFrame);let entry=totals.get(key);if(!entry){entry={...node.callFrame,selfMicros:0,inclusiveMicros:0};totals.set(key,entry);}entry[field]+=time;}
let sampledMicros=0;
for(let i=0;i<profile.samples.length;i++){
  const time=profile.timeDeltas[i],sample=nodes.get(profile.samples[i]);sampledMicros+=time;add(sample,'selfMicros',time);
  let id=sample.id;const seen=new Set();while(id!==undefined){const node=nodes.get(id),key=JSON.stringify(node.callFrame);if(!seen.has(key)){add(node,'inclusiveMicros',time);seen.add(key);}id=parents.get(id);}
}
const ranking=field=>[...totals.values()].sort((a,b)=>b[field]-a[field]).slice(0,50).map(n=>({...n,selfPercent:100*n.selfMicros/sampledMicros,inclusivePercent:100*n.inclusiveMicros/sampledMicros}));
const report={version:1,pid,inspectorUrl:targets[0].url,requestedMilliseconds:milliseconds,elapsedMs:performance.now()-started,sampledMicros,samples:profile.samples.length,topSelf:ranking('selfMicros'),topInclusive:ranking('inclusiveMicros'),qualifiesForThroughputTarget:false,limitations:['Live inspector sampling of an independently running diagnostic process','Sampling affects process timing; no battle throughput claim','Other concurrent processes may affect sample distribution']};
const stamp=new Date().toISOString().replaceAll(':','-'),stem=`${stamp}-process-${pid}`;
await mkdir(resolve(root,'benchmarks/profiles'),{recursive:true});
await writeFile(resolve(root,`benchmarks/profiles/${stem}.cpuprofile`),JSON.stringify(profile));
await writeFile(resolve(root,`benchmarks/profiles/${stem}.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({stem,...report},null,2));
