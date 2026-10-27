import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const HASH=/^[0-9a-f]{64}$/,BITS=/^[0-9a-f]{16}$/;
const LISTS=['unit_list','dead_unit_list','pet_list','dead_pet_list','fieldNpc_list','dead_fieldNpc_list','projectile_list'];
const UNIT=['identity','fields','attributes','buffEffects','skills','buffs'];
function bad(message){throw new Error(message);}
function object(value,path){if(value===null||typeof value!=='object'||Array.isArray(value))bad(path+': expected record');return value;}
function keys(value,expected,path){object(value,path);const found=Object.keys(value);if(found.length!==expected.length||expected.some(key=>!Object.hasOwn(value,key)))bad(path+': unexpected record keys');}
function array(value,path){if(!Array.isArray(value))bad(path+': expected array');return value;}
function integer(value,min,path){if(!Number.isSafeInteger(value)||value<min)bad(path+': expected safe integer >= '+min);}
function numberTag(value,path){keys(value,['bits'],path);if(typeof value.bits!=='string'||!BITS.test(value.bits))bad(path+': invalid f64 bits');}
function numberValue(value,path){numberTag(value,path);const bytes=new Uint8Array(8);for(let i=0;i<8;i++)bytes[i]=parseInt(value.bits.slice(i*2,i*2+2),16);return new DataView(bytes.buffer).getFloat64(0,false);}
function ordinal(value,path){integer(numberValue(value,path),0,path);}
function atom(value,path,allowRef=false){
 if(value===null||typeof value==='string'||typeof value==='boolean')return;
 object(value,path);
 if(Object.hasOwn(value,'bits'))return numberTag(value,path);
 if(allowRef&&Object.hasOwn(value,'ref')){keys(value,['ref'],path);integer(value.ref,1,path+'.ref');return;}
 switch(value.kind){
  case'undefined':keys(value,['kind'],path);return;
  case'bigint':keys(value,['kind','digits'],path);if(typeof value.digits!=='string'||!/^(-?[1-9][0-9]*|0)$/.test(value.digits))bad(path+': invalid bigint');return;
  case'symbol':keys(value,['kind','identity','globalKey','text'],path);integer(value.identity,1,path+'.identity');if(value.globalKey!==null&&typeof value.globalKey!=='string'||typeof value.text!=='string')bad(path+': invalid symbol');return;
  default:bad(path+': invalid primitive/identity tag');
 }
}
function getterIdentity(value,path){if(value?.kind==='undefined'){keys(value,['kind'],path);return;}keys(value,['ref'],path);integer(value.ref,1,path+'.ref');}
function marker(value,kind,path){keys(value,['kind'],path);if(value.kind!==kind)bad(path+': invalid marker');}
function payloadGraph(root,path){
 const seen=new Set();let next=1;
 function visit(value,where){
  if(value===null||typeof value!=='object')return atom(value,where);
  if(value.kind==='payload-ref'){keys(value,['kind','identity'],where);integer(value.identity,1,where+'.identity');if(!seen.has(value.identity))bad(where+': missing/forward payload reference');return;}
  if(value.kind==='function'){keys(value,['kind','identity'],where);keys(value.identity,['ref'],where+'.identity');integer(value.identity.ref,1,where+'.identity.ref');return;}
  if(value.kind==='payload-object'||value.kind==='payload-array'){
   keys(value,['kind','identity','entries'],where);integer(value.identity,1,where+'.identity');if(value.identity!==next++||seen.has(value.identity))bad(where+': duplicate/out-of-order payload identity');seen.add(value.identity);
   const used=new Set();let lengthValue=null;
   for(const [i,pair]of array(value.entries,where+'.entries').entries()){
    if(!Array.isArray(pair)||pair.length!==2)bad(where+': invalid payload entry');const [key,child]=pair;let token;
    if(typeof key==='string')token='s:'+key;
    else{atom(key,where+'.key');if(key?.kind!=='symbol')bad(where+': invalid payload key');token='y:'+key.identity;}
    if(used.has(token))bad(where+': duplicate payload key');used.add(token);
    if(child?.kind==='accessor'){keys(child,['kind','get','set'],where+'.accessor');getterIdentity(child.get,where+'.get');getterIdentity(child.set,where+'.set');}
    else visit(child,where+'.entries['+i+']');
    if(key==='length')lengthValue=child;
   }
   if(value.kind==='payload-array'){if(!used.has('s:length'))bad(where+': missing array length');const length=numberValue(lengthValue,where+'.length');if(!Number.isInteger(length)||length<0||length>0xffffffff)bad(where+': invalid array length');}
   return;
  }
  atom(value,where);
 }
 visit(root,path);
}
function atomPayload(value,path){
 function decode(item,where){
  if(item===null||typeof item==='string'||typeof item==='boolean')return item;
  if(item?.kind==='payload-object'){
   const result=Object.create(null);
   for(const [key,child]of item.entries){if(typeof key!=='string')bad(where+': unexpected symbol in atom container');result[key]=decode(child,where+'.'+key);}return result;
  }
  if(item&&Object.hasOwn(item,'bits'))return numberValue(item,where);
  bad(where+': invalid atom payload container');
 }
 atom(decode(value,path),path,true);
}
function argumentPayload(value,path){
 if(value?.kind!=='payload-array')bad(path+': expected argument array');const entries=new Map(value.entries),length=numberValue(entries.get('length'),path+'.length');
 if(entries.size!==length+1)bad(path+': sparse or extra argument entries');
 for(let i=0;i<length;i++){if(!entries.has(String(i)))bad(path+': missing argument');atomPayload(entries.get(String(i)),path+'['+i+']');}
}
function payloadFields(payload,expected,path){
 if(payload?.kind!=='payload-object')bad(path+': expected object payload');
 const entries=new Map(payload.entries);if(entries.size!==expected.length||expected.some(key=>!entries.has(key)))bad(path+': invalid event payload keys');return entries;
}
/** Supplemental schema/integrity gate for JSON-decoded typed-entry traces.
 * Captured game fields are OWN ENUMERABLE STRING-KEYED DATA fields only.
 * This is neither whole-program state validation nor a battle semantic proof.
 */
export function validateBattleBoundarySchema(trace){
 try{
  keys(trace,['version','status','rootContract','graphHash','events','snapshots','qualifiesFor10000Target','limitations'],'trace');
  if(trace.version!==1||trace.status!=='completed'||trace.rootContract!=='primitive-vector-battle-boundaries-v1'||trace.graphHash!=='sha256-interned-state-json-v1'||trace.qualifiesFor10000Target!==false)bad('Unsupported completed typed-entry trace contract');
  if(!Array.isArray(trace.limitations)||trace.limitations.some(value=>typeof value!=='string'))bad('Invalid limitations');
  const nodes=new Map();
  for(const [i,node]of array(trace.snapshots,'snapshots').entries()){
   keys(node,['hash','value'],'snapshots['+i+']');if(typeof node.hash!=='string'||!HASH.test(node.hash)||sha(node.value)!==node.hash||nodes.has(node.hash))bad('Invalid/duplicate snapshot node');nodes.set(node.hash,node.value);
  }
  const checked=new Set(),active=new Set();
  function reference(value,type,path){
   keys(value,['$boundaryNode'],path);const hash=value.$boundaryNode;if(typeof hash!=='string'||!HASH.test(hash)||!nodes.has(hash))bad(path+': missing/invalid snapshot reference');
   const node=nodes.get(hash);const actual=node?.kind==='primitive-fields'?'fields':'unit';if(actual!==type)bad(path+': wrong snapshot node type');
   if(active.has(hash))bad(path+': cyclic snapshot reference');if(checked.has(hash))return;
   active.add(hash);if(type==='fields')fields(node,path);else unit(node,path);active.delete(hash);checked.add(hash);
  }
  function fields(value,path){
   keys(value,['kind','entries'],path);if(value.kind!=='primitive-fields')bad(path+': expected primitive-fields');let previous=null;
   for(const pair of array(value.entries,path+'.entries')){
    if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string')bad(path+': malformed field entry');const [key,child]=pair;
    if(previous!==null&&previous>=key)bad(path+': duplicate/unsorted field key');previous=key;
    if(child?.kind==='numeric-vector'){keys(child,['kind','values'],path+'.'+key);for(const item of array(child.values,path+'.values')){if(item?.kind==='hole')marker(item,'hole',path+'.hole');else numberTag(item,path+'.number');}}
    else atom(child,path+'.'+key);
   }
  }
  function ordered(value,visitor,path){
   if(!Array.isArray(value)){marker(value,'absent-list',path);return;}
   for(const [i,item]of value.entries()){if(item?.kind==='hole'||item?.kind==='accessor')marker(item,item.kind,path+'['+i+']');else visitor(item,path+'['+i+']');}
  }
  function unit(value,path){
   keys(value,UNIT,path);atom(value.identity,path+'.identity',true);
   for(const key of ['fields','attributes','buffEffects'])reference(value[key],'fields',path+'.'+key);
   ordered(value.skills,(skill,where)=>{keys(skill,['identity','fields','name'],where);atom(skill.identity,where+'.identity',true);reference(skill.fields,'fields',where+'.fields');atom(skill.name,where+'.name',true);},path+'.skills');
   ordered(value.buffs,(buff,where)=>{keys(buff,['identity','fields'],where);atom(buff.identity,where+'.identity',true);reference(buff.fields,'fields',where+'.fields');},path+'.buffs');
  }
  function state(value,path){
   keys(value,['engine','lists','battleRng','initialBattleSeed','pendingCallbacks','clientCallCount','classManagerCounters'],path);
   reference(value.engine,'fields',path+'.engine');keys(value.lists,LISTS,path+'.lists');for(const name of LISTS)ordered(value.lists[name],(item,where)=>reference(item,'unit',where),path+'.lists.'+name);
   atom(value.battleRng,path+'.battleRng');atom(value.initialBattleSeed,path+'.initialBattleSeed');atom(value.clientCallCount,path+'.clientCallCount');
   ordered(value.pendingCallbacks,(item,where)=>atom(item,where,true),path+'.pendingCallbacks');if(value.classManagerCounters!==null)reference(value.classManagerCounters,'fields',path+'.classManagerCounters');
  }
  // Check even unreferenced nodes: arbitrary orphan data cannot hide in the pool.
  for(const [hash,node]of nodes)reference({$boundaryNode:hash},node?.kind==='primitive-fields'?'fields':'unit','node:'+hash);
  let frame=-1,openFrame=false,entered=0;const stack=[];
  const events=array(trace.events,'events');if(!events.length)bad('Empty event sequence');
  for(const [i,event]of events.entries()){
   const path='events['+i+']';keys(event,['sequence','kind','frame','payload','state','stateHash'],path);if(event.sequence!==i)bad(path+': sequence mismatch');integer(event.frame,-1,path+'.frame');
   if(typeof event.stateHash!=='string'||!HASH.test(event.stateHash)||event.stateHash!==sha(event.state))bad(path+': invalid state hash');state(event.state,path+'.state');payloadGraph(event.payload,path+'.payload');
   const kind=event.kind;if(typeof kind!=='string')bad(path+': invalid kind');
   const wrapped=/^(rng:(draw|seed|host)|mechanic:(setHp|setMp|castSkill|onDied|terminate)):(before|after|throw)$/.exec(kind);
   if(wrapped){const phase=wrapped[4],base=wrapped[1],data=payloadFields(event.payload,phase==='before'?['receiver','args']:phase==='after'?['result']:['error','name','message'],path+'.payload');if(phase==='before'){atomPayload(data.get('receiver'),path+'.receiver');argumentPayload(data.get('args'),path+'.args');stack.push(base);}else{for(const key of phase==='after'?['result']:['error','name','message'])atomPayload(data.get(key),path+'.'+key);if(stack.pop()!==base)bad(path+': unmatched wrapped return/throw');}}
   else if(kind==='frame:before'){if(openFrame||entered!==1||event.frame!==frame+1||event.payload!==null)bad(path+': invalid frame entry');frame++;openFrame=true;}
   else if(kind==='frame:after'){if(!openFrame||event.payload!==null)bad(path+': invalid frame exit');openFrame=false;}
   else if(kind==='battle:entered'){payloadFields(event.payload,[],path+'.payload');if(++entered!==1||frame!==-1||openFrame)bad(path+': duplicate/late battle entry');}
   else if(kind==='battle:completed'){
    const data=payloadFields(event.payload,['status','running','ticks','result'],path+'.payload');if(i!==events.length-1||entered!==1||openFrame||stack.length||data.get('status')!=='completed'||data.get('running')!==false||typeof data.get('result')!=='string')bad(path+': invalid completion');ordinal(data.get('ticks'),path+'.ticks');
   }
   else if(kind==='callback:before'){if(event.payload!==null)bad(path+': invalid callback-before payload');}
   else if(kind==='callback:enqueue'||kind==='callback:after'){const data=payloadFields(event.payload,['callback'],path+'.payload');atomPayload(data.get('callback'),path+'.callback');}
   else if(kind==='host:random'){const data=payloadFields(event.payload,['ordinal','value'],path+'.payload');ordinal(data.get('ordinal'),path+'.ordinal');numberTag(data.get('value'),path+'.value');}
   else if(kind==='host:clock'){const data=payloadFields(event.payload,['ordinal','entry'],path+'.payload');ordinal(data.get('ordinal'),path+'.ordinal');}
   else if(kind==='device:output'){const data=payloadFields(event.payload,['ordinal','event'],path+'.payload');ordinal(data.get('ordinal'),path+'.ordinal');}
   else bad(path+': unsupported event discriminant '+kind);
   if(event.frame!==frame)bad(path+': frame mismatch');
  }
  if(events.at(-1).kind!=='battle:completed')bad('Missing completion event');
  return{passed:true,events:events.length,snapshotNodes:nodes.size,frames:frame+1,scope:'Supplemental JSON schema and integrity for typed-entry boundary traces; own enumerable string-keyed data fields only. No whole-program or battle semantic qualification.',qualifiesFor10000Target:false};
 }catch(error){return{passed:false,reason:error.message,qualifiesFor10000Target:false};}
}
