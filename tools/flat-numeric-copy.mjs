import { types } from 'node:util';
import { runInContext } from 'node:vm';
export const sourceCopyFunction='function(e){for(var t=e.constructor?new e.constructor:{},r=Object.keys(e),i=0;i<r.length;i++){var a=r[i],n=e[a];t[a]="object"==typeof n&&n?ed.copyObj(n):n}return t}';

/** Private observer/guard: no source Get, getter, constructor or Object.keys call.
 * Unsupported values fall back BEFORE observable source work. Finite numbers
 * only: other Number representations remain on the original JS path.
 */
export function classifyFlatNumericCopy(value,realm){
 const reject=reason=>({eligible:false,reason});
 if(types.isProxy(value))return reject('proxy');
 if(value===null||typeof value!=='object')return reject('not_object');
 if(Array.isArray(value))return reject('array');
 if(Reflect.getPrototypeOf(value)!==realm.objectPrototype)return reject('prototype');
 const objectBinding=Reflect.getOwnPropertyDescriptor(realm.global,'Object');
 if(!objectBinding||!('value'in objectBinding)||objectBinding.value!==realm.Object)return reject('global_Object_changed');
 const keysBinding=Reflect.getOwnPropertyDescriptor(realm.Object,'keys');
 if(!keysBinding||!('value'in keysBinding)||keysBinding.value!==realm.keys)return reject('Object_keys_changed');
 const constructor=Reflect.getOwnPropertyDescriptor(realm.objectPrototype,'constructor');
 if(!constructor||!('value'in constructor)||constructor.value!==realm.Object)return reject('prototype_constructor_changed');
 if(!Object.isExtensible(value))return reject('non_extensible');
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 if(Object.prototype.hasOwnProperty.call(descriptors,'constructor'))return reject('own_constructor');
 for(const key of keys){
  if(typeof key!=='string')return reject('symbol');
  if(key==='__proto__'||key in realm.objectPrototype)return reject('inherited_key_conflict');
  const d=descriptors[key];
  if(!('value'in d))return reject('accessor');
  if(!d.writable||!d.enumerable||!d.configurable)return reject('nonstandard_descriptor');
  if(typeof d.value!=='number')return reject(d.value!==null&&typeof d.value==='object'?'object_child':'non_number');
  if(!Number.isFinite(d.value))return reject('nonfinite_number');
 }
 return{eligible:true,reason:'flat_finite_numeric',keys,descriptors};
}

export function installFlatNumericCopyPrototype(runtime,{mode='observe'}={}){
 if(!['observe','specialize'].includes(mode))throw Error('Copy prototype mode must be observe or specialize');
 const global=runInContext('globalThis',runtime.context),objectPrototype=Reflect.getPrototypeOf(runInContext('({})',runtime.context));
 const objectBinding=Reflect.getOwnPropertyDescriptor(global,'Object'),constructor=Reflect.getOwnPropertyDescriptor(objectPrototype,'constructor');
 if(!objectBinding||!('value'in objectBinding)||!constructor||!('value'in constructor)||objectBinding.value!==constructor.value||types.isProxy(objectBinding.value)||Function.prototype.toString.call(objectBinding.value)!=='function Object() { [native code] }')throw Error('Unmodified source-realm Object intrinsic required');
 const ObjectIntrinsic=objectBinding.value,keysBinding=Reflect.getOwnPropertyDescriptor(ObjectIntrinsic,'keys');
 if(!keysBinding||!('value'in keysBinding)||types.isProxy(keysBinding.value)||Function.prototype.toString.call(keysBinding.value)!=='function keys() { [native code] }')throw Error('Unmodified source-realm Object.keys intrinsic required');
 const realm={global,Object:ObjectIntrinsic,objectPrototype,keys:keysBinding.value};
 const original=runtime.ed.copyObj;
 if(typeof original!=='function'||types.isProxy(original)||Function.prototype.toString.call(original)!==sourceCopyFunction)throw Error('Exact original ed.copyObj source required');
 const counts={calls:0,eligible:0,originalCalls:0,fastCalls:0,rootCalls:0,maxDepth:0},reasons=new Map(),keyCounts=new Map();let depth=0;
 function replacement(value){
  counts.calls++;if(depth===0)counts.rootCalls++;depth++;counts.maxDepth=Math.max(counts.maxDepth,depth);
  try{
   const shape=classifyFlatNumericCopy(value,realm);reasons.set(shape.reason,(reasons.get(shape.reason)??0)+1);
   if(shape.eligible){counts.eligible++;keyCounts.set(shape.keys.length,(keyCounts.get(shape.keys.length)??0)+1);}
   if(mode==='specialize'&&shape.eligible){
    counts.fastCalls++;
    // Standard Object allocation in the SOURCE realm, then ordinary assignment
    // creates fresh default descriptors in exact source Object.keys order.
    const copy=Reflect.construct(realm.Object,[]);
    for(const key of shape.keys)copy[key]=shape.descriptors[key].value;
    return copy;
   }
   counts.originalCalls++;return Reflect.apply(original,this,[value]);
  }finally{depth--;}
 }
 runtime.ed.copyObj=replacement;
 return{
  classify:value=>classifyFlatNumericCopy(value,realm),
  stats:()=>({...counts,mode,reasons:Object.fromEntries(reasons),eligibleOwnKeyCounts:Object.fromEntries([...keyCounts].sort((a,b)=>a[0]-b[0]))}),
  restore(){if(runtime.ed.copyObj!==replacement)throw Error('Copy prototype replaced externally');runtime.ed.copyObj=original;}
 };
}
