import {runInContext} from 'node:vm';

const importers=new WeakMap();
/** Move JSON-like data into the SAME realm as the original game source.
 * No JSON number reserialization: -0 and binary64 payloads are retained. Shared
 * references, holes and undefined data properties are preserved. Live functions
 * or accessors are rejected, not silently replaced with host-realm behavior.
 */
export function importBootstrapValue(context,value){
  let importer=importers.get(context);
  if(!importer){
    importer=runInContext(`(function(value){
      var seen=new WeakMap();
      function copy(value){
        if(typeof value==='function')throw new Error('Source realm import does not accept live functions');
        if(value===null||typeof value!=='object')return value;
        if(seen.has(value))return seen.get(value);
        var array=Array.isArray(value),out=array?new Array(value.length):{};
        seen.set(value,out);
        for(var keys=Object.keys(value),i=0;i<keys.length;i++){
          var key=keys[i],descriptor=Object.getOwnPropertyDescriptor(value,key);
          if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))throw new Error('Source realm import does not accept accessors: '+key);
          Object.defineProperty(out,key,{value:copy(descriptor.value),writable:true,enumerable:true,configurable:true});
        }
        return out;
      }
      return copy(value);
    })`,context,{filename:'tools/bootstrap-realm.mjs:source-realm-data-import'});
    importers.set(context,importer);
  }
  return importer(value);
}
