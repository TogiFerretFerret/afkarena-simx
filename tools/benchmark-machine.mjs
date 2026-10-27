import {cpus,availableParallelism,platform,arch,release} from 'node:os';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function benchmarkMachine(){
  const read=async file=>{try{return(await readFile(file,'utf8')).trim();}catch{return null;}};
  const [cpuMax,memoryMax]=await Promise.all([read('/sys/fs/cgroup/cpu.max'),read('/sys/fs/cgroup/memory.max')]);
  const [quota,period]=(cpuMax??'').split(/\s+/);
  const quotaCpus=quota!=='max'&&Number.isSafeInteger(Number(quota))&&Number(quota)>0&&Number.isSafeInteger(Number(period))&&Number(period)>0?Number(quota)/Number(period):null;
  const available=availableParallelism(),processors=cpus();
  return{version:1,capturedAt:new Date().toISOString(),runtime:process.version,v8:process.versions.v8,platform:platform(),architecture:arch(),kernel:release(),cpuModel:processors[0]?.model??null,logicalCpus:processors.length,availableParallelism:available,cgroupV2:{cpuMax,memoryMax,cpuQuotaCores:quotaCpus},effectiveCpuCapacity:quotaCpus===null?available:Math.min(available,quotaCpus),scope:'Host resource snapshot. CPU affinity and cgroup quota are distinct; this file is not a throughput result.'};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const report=JSON.stringify(await benchmarkMachine(),null,2)+'\n';
 if(process.argv[2])await writeFile(process.argv[2],report);else process.stdout.write(report);
}
