import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

// Some managed /proc implementations omit task/*/children. PPid and comm
// remain available to ps; comm avoids collecting unrelated process arguments.
export function nativeDescendants(processTable,parentPid,comm='rust-battle-pro'){
 const entries=[];for(const line of processTable.split('\n')){const match=/^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);if(match)entries.push({pid:Number(match[1]),parent:Number(match[2]),comm:match[3]});}
 const descendants=new Set([parentPid]);let changed=true;
 while(changed){changed=false;for(const row of entries)if(descendants.has(row.parent)&&!descendants.has(row.pid)){descendants.add(row.pid);changed=true;}}
 return entries.filter(row=>row.pid!==parentPid&&descendants.has(row.pid)&&row.comm===comm).map(row=>row.pid);
}
export async function discoverNativeDescendants(parentPid){
 const {stdout}=await execute('ps',['-eo','pid=,ppid=,comm='],{encoding:'utf8',maxBuffer:1024*1024});
 return nativeDescendants(stdout,parentPid);
}
