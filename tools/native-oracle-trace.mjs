import { readFile } from 'node:fs/promises';
import { runInContext } from 'node:vm';
import { createHash } from 'node:crypto';

export const traceSourceFiles=['tools/battle-trace-portable.js','tools/battle-trace-instrumentation.js','tools/qualification-table-membrane.js','tools/qualification-table-policy.js'];
export async function loadNativeTraceSources(root){
  const { resolve }=await import('node:path');
  return Promise.all(traceSourceFiles.map(async file=>({file,source:await readFile(resolve(root,file),'utf8')})));
}
export function createNativeTableBoundaryFactory(sources,{mutableTables=[]}={}){
  const source=sources.find(record=>record.file==='tools/qualification-table-membrane.js');
  if(!source)throw new Error('Missing qualification table boundary source');
  return context=>{
    runInContext(source.source,context,{filename:source.file});
    const policy=sources.find(record=>record.file==='tools/qualification-table-policy.js');
    runInContext(policy.source,context,{filename:policy.file});
    context.__nativeTableOptions={mutableTables,digest:text=>createHash('sha256').update(text).digest('hex')};
    try{return runInContext('installQualificationTablePolicy(__nativeTableOptions)',context);}
    finally{delete context.__nativeTableOptions;}
  };
}
export function installNativeReferenceTrace(runtime,sources,{clockObserver}={}){
  for(const {file,source} of sources)runInContext(source,runtime.context,{filename:file});
  runtime.context.__nativeTraceRuntime=runtime;
  const boundary=runtime.tableBoundary;
  runtime.context.__nativeTraceOptions={compact:true,programState:true,maxNodes:300000,
    globalNames:[...new Set([...runtime.sourceRecords.globals.keys(),...(runtime.sourceRecords.functionDeclarations||[]).map(record=>record.name)])],
    adapterCodes:[{fn:runtime.ed.getDataTable,identity:'source-table-loader'},{fn:runtime.ed.logbugly,identity:'source-logbugly'}],
    mutableTableRoots:boundary?()=>boundary.mutableRoots():undefined,
    immutableReference:boundary?value=>boundary.immutableMetadata(value):undefined,
    assertImmutableClean:boundary?()=>boundary.assertClean():undefined,digest:text=>createHash('sha256').update(text).digest('hex'),onProgress(progress){process.stderr.write(JSON.stringify({status:"trace_progress",...progress})+"\n");},definitionNames:[...runtime.sourceRecords.definitions.keys()],subscribeClock(observer){
    clockObserver.current=observer;
    return()=>{clockObserver.current=null;};
  }};
  try{return runInContext('installBattleTraceInstrumentation(__nativeTraceRuntime,__nativeTraceOptions)',runtime.context);}
  finally{delete runtime.context.__nativeTraceRuntime;delete runtime.context.__nativeTraceOptions;}
}
