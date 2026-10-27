// Post-battle export only: no game functions execute inside this serializer.
export function emitBattleBoundaryNDJSON(report,emit){
 var trace=report.trace,summary=Object.create(null),header=Object.create(null),keys=Object.keys(report),i;
 for(i=0;i<keys.length;i++)if(keys[i]!=='trace')summary[keys[i]]=report[keys[i]];
 keys=Object.keys(trace);for(i=0;i<keys.length;i++)if(keys[i]!=='events'&&keys[i]!=='snapshots')header[keys[i]]=trace[keys[i]];
 function row(value){var text=JSON.stringify(value);if(text.length>16*1024*1024)throw new Error('Boundary trace export row exceeds16Mi UTF-16 code units');emit(text);}
 row({record:'report',report:summary,traceHeader:header,eventCount:trace.events.length,snapshotCount:trace.snapshots.length});
 for(i=0;i<trace.snapshots.length;i++)row({record:'snapshot',index:i,snapshot:trace.snapshots[i]});
 for(i=0;i<trace.events.length;i++)row({record:'event',index:i,event:trace.events[i]});
 row({record:'end',events:trace.events.length,snapshots:trace.snapshots.length,completed:report.completed});
}
export function decodeBattleBoundaryNDJSON(text,{exitCode}={}){
 if(exitCode!==0)throw new Error('Native boundary export requires process exit0');
 const lines=(text.endsWith('\n')?text.slice(0,-1):text).split('\n'),snapshots=[],events=[],snapshotHashes=new Set();let header=null,ended=false,phase='progress',lastProgress=0;
 function keys(record,names){if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).length!==names.length||names.some(name=>!Object.hasOwn(record,name)))throw new Error('Unexpected boundary export record keys');}
 function count(n){if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid boundary export count');}
 for(const line of lines){
  if(ended)throw new Error('Data after boundary export footer');
  let record;try{record=JSON.parse(line);}catch{throw new Error('Malformed boundary export JSON');}
  if(record?.status==='boundary_trace_progress'){
   keys(record,['status','events','frame','kind']);if(phase!=='progress')throw new Error('Progress after boundary export header');count(record.events);if(record.events<=lastProgress||record.events%1000!==0||!Number.isSafeInteger(record.frame)||record.frame< -1||typeof record.kind!=='string')throw new Error('Invalid boundary progress record');lastProgress=record.events;continue;
  }
  switch(record?.record){
   case'report':
    keys(record,['record','report','traceHeader','eventCount','snapshotCount']);if(header||phase!=='progress')throw new Error('Duplicate boundary export header');
    if(!record.report||typeof record.report!=='object'||Array.isArray(record.report)||Object.hasOwn(record.report,'trace')||record.report.completed!==1)throw new Error('Invalid boundary terminal report');
    keys(record.traceHeader,['version','status','rootContract','graphHash','qualifiesFor10000Target','limitations']);
    if(record.traceHeader.version!==1||record.traceHeader.status!=='completed'||record.traceHeader.rootContract!=='primitive-vector-battle-boundaries-v1'||record.traceHeader.graphHash!=='sha256-interned-state-json-v1'||record.traceHeader.qualifiesFor10000Target!==false||!Array.isArray(record.traceHeader.limitations)||record.traceHeader.limitations.some(value=>typeof value!=='string'))throw new Error('Invalid boundary trace header');
    count(record.eventCount);count(record.snapshotCount);if(!record.eventCount||!record.snapshotCount||lastProgress>record.eventCount)throw new Error('Invalid boundary declared counts');header=record;phase='snapshots';break;
   case'snapshot':
    keys(record,['record','index','snapshot']);if(!header||phase!=='snapshots'||record.index!==snapshots.length||snapshots.length>=header.snapshotCount)throw new Error('Invalid snapshot ordering');
    keys(record.snapshot,['hash','value']);if(typeof record.snapshot.hash!=='string'||!/^[0-9a-f]{64}$/.test(record.snapshot.hash)||snapshotHashes.has(record.snapshot.hash))throw new Error('Invalid or duplicate snapshot hash');snapshotHashes.add(record.snapshot.hash);snapshots.push(record.snapshot);break;
   case'event':
    keys(record,['record','index','event']);if(!header||!['snapshots','events'].includes(phase)||snapshots.length!==header.snapshotCount||record.index!==events.length||events.length>=header.eventCount||record.event?.sequence!==record.index)throw new Error('Invalid event ordering');phase='events';events.push(record.event);break;
   case'end':
    keys(record,['record','events','snapshots','completed']);if(!header||phase!=='events'||record.events!==events.length||record.snapshots!==snapshots.length||events.length!==header.eventCount||snapshots.length!==header.snapshotCount||record.completed!==1||events.at(-1)?.kind!=='battle:completed')throw new Error('Invalid or incomplete boundary export footer');ended=true;break;
   default:throw new Error('Unknown boundary export record');
  }
 }
 if(!ended)throw new Error('Missing boundary export footer');
 return{...header.report,trace:{...header.traceHeader,snapshots,events}};
}
