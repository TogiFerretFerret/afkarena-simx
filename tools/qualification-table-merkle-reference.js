/* Independent uncached descriptor walker for validating mutable capsule hashes.
 * This validation helper performs a complete raw graph walk on EVERY call. It
 * uses no capsule records, proxy registry, dirty flags or prior hash cache.
 */
(function(host){
 "use strict";
 host.qualificationTableFullHash=function(root,digest){
  var ids=new WeakMap(),nodes=[],data=new DataView(new ArrayBuffer(8));
  function scalar(value){
   if(value===null)return["null"];
   var type=typeof value;
   if(type==="number"){data.setFloat64(0,value,false);return["f64",data.getUint32(0,false).toString(16).padStart(8,"0")+data.getUint32(4,false).toString(16).padStart(8,"0")];}
   if(type==="undefined")return["undefined"];
   if(type!=="string"&&type!=="boolean")throw Error("Unsupported full-reference scalar");
   return[type,value];
  }
  function visit(value){
   if(ids.has(value))return nodes[ids.get(value)];
   var kind=Array.isArray(value)?"array":"object",p=Object.getPrototypeOf(value);
   var node={id:nodes.length,kind:kind,prototype:p===(kind==="array"?Array.prototype:Object.prototype)?(kind==="array"?"Array.prototype":"Object.prototype"):"unsupported-prototype",extensible:Object.isExtensible(value),entries:[]};ids.set(value,node.id);nodes.push(node);
   var keys=Reflect.ownKeys(value);
   for(var i=0;i<keys.length;i++){
    var key=keys[i],d=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=="string"||!d||!("value"in d))throw Error("Unsupported full-reference descriptor");
    var v=d.value;node.entries.push({key:key,writable:d.writable,enumerable:d.enumerable,configurable:d.configurable,value:v,child:v!==null&&typeof v==="object"?visit(v):null});
   }
   return node;
  }
  function hash(node){
   var properties=node.entries.map(function(entry){return[entry.key,entry.writable,entry.enumerable,entry.configurable,entry.child?["ref",entry.child.id,hash(entry.child)]:scalar(entry.value)];});
   return digest(JSON.stringify(["qualification-mutable-json-node-v1",node.id,node.kind,node.prototype,node.extensible,properties]));
  }
  return hash(visit(root));
 };
})(globalThis);
