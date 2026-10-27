import { readFile } from 'node:fs/promises';
import { runInContext } from 'node:vm';

export const traceSourceFiles=['tools/battle-trace-portable.js','tools/battle-trace-instrumentation.js'];
export async function loadNativeTraceSources(root){
  const { resolve }=await import('node:path');
  return Promise.all(traceSourceFiles.map(async file=>({file,source:await readFile(resolve(root,file),'utf8')})));
}
export function installNativeReferenceTrace(runtime,sources,{clockObserver}={}){
  for(const {file,source} of sources)runInContext(source,runtime.context,{filename:file});
  runtime.context.__nativeTraceRuntime=runtime;
  runtime.context.__nativeTraceOptions={compact:true,onProgress(progress){process.stderr.write(JSON.stringify({status:"trace_progress",...progress})+"\n");},definitionNames:[...runtime.sourceRecords.definitions.keys()],subscribeClock(observer){
    clockObserver.current=observer;
    return()=>{clockObserver.current=null;};
  }};
  try{return runInContext('installBattleTraceInstrumentation(__nativeTraceRuntime,__nativeTraceOptions)',runtime.context);}
  finally{delete runtime.context.__nativeTraceRuntime;delete runtime.context.__nativeTraceOptions;}
}
