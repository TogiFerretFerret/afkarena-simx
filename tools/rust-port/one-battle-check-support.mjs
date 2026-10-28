import {readFile,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {firstDifference} from '../native-report-compare.mjs';

export function compareOneBattleReports(actual,expected){
 const strip=({elapsedMs,battlesPerSecond,...semantic})=>semantic;
 return firstDifference(strip(actual),strip(expected));
}
export async function runMonitored(command,{cwd,env,stdoutFile,stderrFile,maxRssKiB=8*1024*1024,timeoutMs=120000,pollMs=100}){
 const stdout=await open(stdoutFile,'w'),stderr=await open(stderrFile,'w'),started=performance.now();
 try{return await new Promise(accept=>{
  const child=spawn(command[0],command.slice(1),{cwd,env,stdio:['ignore',stdout.fd,stderr.fd]});
  let error=null,termination=null,peakRssKiB=0,peakHwmKiB=0,interval=null,timeout=null,forceKill=null,reading=false,closed=false;
  function stop(reason){if(termination||closed)return;termination={reason,atWallMs:performance.now()-started,maxRssKiB,timeoutMs};child.kill('SIGTERM');forceKill=setTimeout(()=>child.kill('SIGKILL'),2000);}
  async function sample(){if(reading||closed||!child.pid)return;reading=true;try{const status=await readFile(`/proc/${child.pid}/status`,'utf8'),rss=Number(/^VmRSS:\s+(\d+)\s+kB/m.exec(status)?.[1]??0),hwm=Number(/^VmHWM:\s+(\d+)\s+kB/m.exec(status)?.[1]??0);peakRssKiB=Math.max(peakRssKiB,rss);peakHwmKiB=Math.max(peakHwmKiB,hwm);if(rss>maxRssKiB)stop('rss-limit');}catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')stop('rss-monitor-error:'+error.message);}finally{reading=false;}}
  child.on('error',value=>{error=value.message;});
  child.on('close',(status,signal)=>{closed=true;clearInterval(interval);clearTimeout(timeout);clearTimeout(forceKill);accept({status,signal,error,pid:child.pid??null,wallMs:performance.now()-started,peakRssKiB,peakHwmKiB,termination});});
  interval=setInterval(sample,pollMs);timeout=setTimeout(()=>stop('timeout'),timeoutMs);sample();
 });}finally{await stdout.close();await stderr.close();}
}
