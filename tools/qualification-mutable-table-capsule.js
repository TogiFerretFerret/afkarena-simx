/* Qualification-only fixed-object-graph table capsule. Keep this capability and
 * all raw decoded tables private to the host loader. Supported primitive writes
 * update exact Merkle records; every unsupported write invalidates qualification.
 */
(function(host){
 "use strict";
 host.installQualificationMutableTableCapsule=function(options){
  options=options||{};
  if(typeof options.digest!=="function")throw Error("Mutable table capsule requires SHA-256 digest");
  var digest=options.digest,parse=JSON.parse,ownKeys=Reflect.ownKeys,desc=Object.getOwnPropertyDescriptor,proto=Object.getPrototypeOf;
  var records=new WeakMap(),proxies=new WeakMap(),names=new Map(),firstFailure=null,pending=[];
  var data=new DataView(new ArrayBuffer(8)),maxNodes=options.maxNodes===undefined?2000000:options.maxNodes,maxDepth=options.maxDepth===undefined?256:options.maxDepth;
  var counters={roots:0,nodes:0,proxies:0,gets:0,descriptors:0,writeAttempts:0,mutations:0,additions:0,failures:0,hashNodeRecomputes:0,dirtyMarks:0};
  function fail(message){counters.failures++;if(firstFailure===null)firstFailure=message;var e=Error("Qualification mutable table capsule: "+message);e.tableMembraneFailure=true;throw e;}
  function clean(){if(firstFailure!==null)fail("previous violation: "+firstFailure);return true;}
  function bits(n){data.setFloat64(0,n,false);return data.getUint32(0,false).toString(16).padStart(8,"0")+data.getUint32(4,false).toString(16).padStart(8,"0");}
  function scalar(v,initial){
   if(v===null)return["null"];
   var type=typeof v;
   if(type==="string"||type==="boolean")return[type,v];
   if(type==="number"){var raw=bits(v);if(v!==v&&raw!=="7ff8000000000000")fail("unsupported NaN sign/payload");return["f64",raw];}
   if(type==="undefined"&&!initial)return["undefined"];
   fail("unsupported "+type+" primitive");
  }
  function same(a,b){return Object.is(a,b)&&(typeof a!=="number"||a===a||bits(a)===bits(b));}
  function nodeHash(record){
   if(!record.dirty)return record.hash;
   var props=[];
   for(var i=0;i<record.entries.length;i++){
    var entry=record.entries[i],encoded=entry.child?["ref",entry.child.id,nodeHash(entry.child)]:scalar(entry.value,false);
    props.push([entry.key,entry.writable,entry.enumerable,entry.configurable,encoded]);
   }
   var hash=digest(JSON.stringify(["qualification-mutable-json-node-v1",record.id,record.kind,record.kind==="array"?"Array.prototype":"Object.prototype",true,props]));
   if(typeof hash!=="string"||!/^[0-9a-f]{64}$/.test(hash))fail("digest must return lowercase SHA-256 hex");
   record.hash=hash;record.dirty=false;counters.hashNodeRecomputes++;return hash;
  }
  function dirty(record){
   var queue=[record];for(var i=0;i<queue.length;i++){var item=queue[i];if(item.dirty)continue;item.dirty=true;counters.dirtyMarks++;item.parents.forEach(function(parent){queue.push(parent);});}
  }
  function metadata(record){
   clean();var root=record.root;
   if(!record.metadata||record.metadataVersion!==root.version){
    record.metadata=Object.freeze({table:record.table,path:record.frozenPath,sha256:nodeHash(root.record),kind:record.kind});record.metadataVersion=root.version;
   }
   return record.metadata;
  }
  function register(value,name){
   clean();if(typeof name!=="string"||!name)fail("named table root required");
   if(value===null||typeof value!=="object")fail("table root must be object/array");
   if(proxies.has(value)){var wrapped=proxies.get(value);if(wrapped.table!==name||wrapped.path.length)fail("root alias changes name/path");return value;}
   if(records.has(value)){var existing=records.get(value);if(existing.table!==name||existing.path.length)fail("cross-root raw alias");return proxyFor(existing);}
   if(names.has(name))fail("named table root replaced: "+name);
   var local=new WeakMap(),list=[],root={name:name,version:0,record:null};
   function visit(raw,path,depth){
    if(depth>maxDepth||list.length>=maxNodes)fail("JSON graph bound exceeded");
    if(options.isProxy&&options.isProxy(raw))fail("initial Proxy is unsupported");
    var previous=local.get(raw);if(previous){if(previous.visiting)fail("cyclic initial table");return previous;}
    if(records.has(raw)||proxies.has(raw))fail("cross-root child alias");
    var array=Array.isArray(raw);if(proto(raw)!==(array?Array.prototype:Object.prototype)||!Object.isExtensible(raw))fail("unsupported initial prototype/extensibility");
    var record={raw:raw,table:name,path:path.slice(),frozenPath:Object.freeze(path.slice()),kind:array?"array":"object",id:list.length,root:root,entries:[],byKey:new Map(),parents:new Set(),visiting:true,dirty:true,hash:null,proxy:null,metadata:null,metadataVersion:-1};
    local.set(raw,record);list.push(record);
    var keys=ownKeys(raw);
    for(var i=0;i<keys.length;i++){
     var key=keys[i],d=desc(raw,key),length=array&&key==="length";
     if(typeof key!=="string"||!d||!("value"in d)||d.writable!==true||d.enumerable!==!length||d.configurable!==!length)fail("unsupported initial own descriptor");
     if(array&&!length&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=4294967295||Number(key)>=raw.length))fail("non-index array property");
     var entry={key:key,writable:d.writable,enumerable:d.enumerable,configurable:d.configurable,value:d.value,child:null};
     if(d.value!==null&&typeof d.value==="object"){entry.child=visit(d.value,path.concat([key]),depth+1);entry.child.parents.add(record);}else scalar(d.value,true);
     record.entries.push(entry);record.byKey.set(key,entry);
    }
    record.visiting=false;return record;
   }
   root.record=visit(value,[],0);nodeHash(root.record);
   for(var i=0;i<list.length;i++)records.set(list[i].raw,list[i]);
   names.set(name,root);counters.roots++;counters.nodes+=list.length;return proxyFor(root.record);
  }
  function allowAddition(record,key){
   // Only the observed source AnimAtkFrame frame annotation is admitted. No
   // generic arbitrary table properties or object-graph changes are accepted.
   if(record.table!=="AnimAtkFrame"||record.kind!=="object"||record.path.length!==3||key!=="Type")return false;
   var cha=record.byKey.get("Cha"),action=record.byKey.get("Action"),time=record.byKey.get("Time");
   return !!cha&&!!action&&!!time&&!cha.child&&!action.child&&!time.child&&typeof cha.value==="string"&&cha.value===record.path[0]&&typeof action.value==="string"&&action.value===record.path[1]&&typeof time.value==="number";
  }
  function proxyFor(record){
   if(record.proxy)return record.proxy;
   var target=record.raw;
   function child(value,key){if(value!==null&&typeof value==="object"){var found=records.get(value);if(found)return proxyFor(found);if(desc(target,key))fail("unregistered raw own child");}return value;}
   var proxy=new Proxy(target,{
    get:function(t,key,receiver){counters.gets++;return child(Reflect.get(t,key,receiver),key);},
    getOwnPropertyDescriptor:function(t,key){counters.descriptors++;var d=desc(t,key);if(!d)return undefined;if(!("value"in d))fail("raw accessor introduced");return{value:child(d.value,key),writable:d.writable,enumerable:d.enumerable,configurable:d.configurable};},
    set:function(t,key,value,receiver){
     clean();counters.writeAttempts++;
     if(receiver!==proxy)fail("set receiver must be canonical proxy");
     if(typeof key!=="string")fail("symbol write unsupported");
     scalar(value,false);var d=desc(t,key),entry=record.byKey.get(key),addition=!d;
     if(record.kind==="array"&&(key==="length"||addition))fail("array length/growth write unsupported");
     if(addition){if(key in t||!Object.isExtensible(t)||!allowAddition(record,key))fail("new/inherited property unsupported: "+key);}
     else if(!entry||entry.child||!("value"in d)||d.writable!==true||d.enumerable!==true||d.configurable!==true||!same(entry.value,d.value))fail("existing property is not tracked writable primitive");
     var token={record:record,key:key,value:value,addition:addition,committed:false};pending.push(token);var result;
     try{result=Reflect.set(t,key,value,receiver);}finally{pending.pop();}
     if(!result||!token.committed)fail("canonical Reflect.set failed");
     // Hash the ACTUAL stored own descriptor, not the incoming operand. Engine
     // array element storage can change Number representations (notably NaNs).
     var stored=desc(t,key);
     if(!stored||!("value"in stored)||stored.writable!==true||stored.enumerable!==true||stored.configurable!==true)fail("stored descriptor changed shape");
     scalar(stored.value,false);var actual=stored.value;
     if(addition){entry={key:key,writable:true,enumerable:true,configurable:true,value:actual,child:null};record.entries.push(entry);record.byKey.set(key,entry);counters.additions++;}
     if(addition||!same(entry.value,actual)){entry.value=actual;rootChanged(record);}return true;
    },
    defineProperty:function(t,key,d){
     var token=pending.length?pending[pending.length-1]:null;
     if(!token||token.record!==record||token.key!==key||token.committed){counters.writeAttempts++;fail("external defineProperty unsupported");}
     var keys=ownKeys(d),valid=token.addition?keys.length===4&&d.writable===true&&d.enumerable===true&&d.configurable===true:keys.length===1;
     if(!valid||!("value"in d)||!same(d.value,token.value))fail("internal Reflect.set descriptor changed");
     var result=Reflect.defineProperty(t,key,d);if(!result)fail("internal primitive commit failed");token.committed=true;return true;
    },
    deleteProperty:function(){counters.writeAttempts++;return fail("delete unsupported");},
    setPrototypeOf:function(){counters.writeAttempts++;return fail("setPrototypeOf unsupported");},
    preventExtensions:function(){counters.writeAttempts++;return fail("preventExtensions unsupported");}
   });
   record.proxy=proxy;proxies.set(proxy,record);counters.proxies++;return proxy;
  }
  function rootChanged(record){record.root.version++;counters.mutations++;dirty(record);}
  return{
   wrap:function(value,info){return register(value,info&&info.name);},
   parse:function(text,info){if(typeof text!=="string")fail("JSON text must be string");return register(parse(text),info&&info.name);},
   immutableMetadata:function(value){clean();var r=value!==null&&(typeof value==="object"||typeof value==="function")?proxies.get(value):null;return r?metadata(r):null;},
   assertClean:clean,
   stats:function(){return{roots:counters.roots,nodes:counters.nodes,proxies:counters.proxies,gets:counters.gets,descriptors:counters.descriptors,writeAttempts:counters.writeAttempts,mutations:counters.mutations,additions:counters.additions,failures:counters.failures,hashNodeRecomputes:counters.hashNodeRecomputes,dirtyMarks:counters.dirtyMarks,clean:firstFailure===null,firstFailure:firstFailure};}
  };
 };
})(globalThis);
